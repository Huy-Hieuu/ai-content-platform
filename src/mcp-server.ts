import type { DatabaseSync } from 'node:sqlite';

import { type CallToolResult, McpServer, type ToolAnnotations } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { Role, User } from './auth.ts';
import { getCurrentInstructions } from './instructions.ts';
import { listListings } from './listings.ts';
import type { LocalObjectStore } from './object-store.ts';
import type { RenderQueue } from './render-queue.ts';
import { getRender, type RenderJob, startRender, UserError } from './renders.ts';
import { listToolCalls, recordToolCall } from './tool-calls.ts';

export interface Services {
  db: DatabaseSync;
  queue: RenderQueue;
  store: LocalObjectStore;
}

/** Signed video URLs stay valid for one hour. */
const VIDEO_URL_TTL_SECONDS = 3600;

/**
 * One MCP tool. `name` and the schemas are a public contract with Claude:
 * never rename a tool or change a field in place. Add `<name>_v2` and deprecate the old one.
 */
interface Tool<Input extends z.ZodObject, Output extends z.ZodObject> {
  name: string;
  description: string;
  roles: readonly Role[];
  annotations: ToolAnnotations;
  inputSchema: Input;
  outputSchema: Output;
  run(input: z.infer<Input>, user: User): Promise<z.infer<Output>> | z.infer<Output>;
}

function defineTool<Input extends z.ZodObject, Output extends z.ZodObject>(tool: Tool<Input, Output>) {
  return tool;
}

const renderSchema = z.object({
  render_id: z.string(),
  status: z.enum(['queued', 'rendering', 'succeeded', 'failed']),
  attempt_count: z.number().int(),
  video_url: z.string().nullable().describe('Signed URL of the video. Valid for one hour. Set when status is succeeded.'),
  error: z.string().nullable(),
});

function toRenderOutput(job: RenderJob, store: LocalObjectStore): z.infer<typeof renderSchema> {
  return {
    render_id: job.id,
    status: job.status,
    attempt_count: job.attemptCount,
    video_url: job.outputObjectKey ? store.signedUrl(job.outputObjectKey, VIDEO_URL_TTL_SECONDS) : null,
    error: job.error,
  };
}

function createTools({ db, queue, store }: Services) {
  return [
    defineTool({
      name: 'list_listings',
      description: 'List property listings with their rooms.',
      roles: ['creator', 'admin'],
      annotations: { readOnlyHint: true },
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
      outputSchema: z.object({
        listings: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            address: z.string(),
            price_usd: z.number().int(),
            rooms: z.array(z.object({ id: z.string(), name: z.string(), area_m2: z.number().nullable() })),
          }),
        ),
      }),
      run: ({ limit }) => ({ listings: listListings(db, { limit }) }),
    }),

    defineTool({
      name: 'start_render',
      description:
        'Start rendering a video for a listing. Returns at once; call get_render to follow the status. ' +
        'Calls with the same idempotency_key return the same render and never start a second one.',
      roles: ['creator', 'admin'],
      annotations: { readOnlyHint: false, idempotentHint: true },
      inputSchema: z.object({
        listing_id: z.string(),
        template: z.enum(['listing_tour']).describe('Video template (Remotion composition ID).'),
        idempotency_key: z.string().min(8).max(100).describe('A unique key per intended render. Reuse it on retry.'),
      }),
      outputSchema: renderSchema.extend({ is_new: z.boolean() }),
      run: (input, user) => {
        const { job, isNew } = startRender(db, queue, user, {
          listingId: input.listing_id,
          template: input.template,
          idempotencyKey: input.idempotency_key,
        });
        return { ...toRenderOutput(job, store), is_new: isNew };
      },
    }),

    defineTool({
      name: 'get_render',
      description: 'Get the status of a render. When it has succeeded, the result has a signed video URL.',
      roles: ['creator', 'admin'],
      annotations: { readOnlyHint: true },
      inputSchema: z.object({ render_id: z.string() }),
      outputSchema: renderSchema,
      run: ({ render_id }, user) => toRenderOutput(getRender(db, user, render_id), store),
    }),

    defineTool({
      name: 'list_tool_calls',
      description: 'Admin only. List recent tool calls, newest first, to review runs and find templates.',
      roles: ['admin'],
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        user_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      outputSchema: z.object({
        tool_calls: z.array(
          z.object({
            id: z.string(),
            user_id: z.string(),
            tool: z.string(),
            instructions_version: z.string(),
            input: z.unknown(),
            output: z.unknown(),
            is_error: z.boolean(),
            error: z.string().nullable(),
            duration_ms: z.number().int(),
            created_at: z.string(),
          }),
        ),
      }),
      run: ({ user_id, limit }) => ({
        tool_calls: listToolCalls(db, { userId: user_id, limit }).map((call) => ({
          id: call.id,
          user_id: call.userId,
          tool: call.tool,
          instructions_version: call.instructionsVersion,
          input: call.input,
          output: call.output,
          is_error: call.isError,
          error: call.error,
          duration_ms: call.durationMs,
          created_at: call.createdAt,
        })),
      }),
    }),
  ];
}

/**
 * Builds the MCP server for one request and one caller.
 * Every tool goes through the same wrapper: role check first, then the tool, then one `tool_calls` row.
 */
export function buildMcpServer(services: Services, user: User): McpServer {
  const instructions = getCurrentInstructions(services.db);
  const server = new McpServer({ name: 'ai-content-platform', version: '0.1.0' }, { instructions: instructions.body });

  for (const tool of createTools(services)) {
    const { name, description, annotations, inputSchema, outputSchema } = tool;
    server.registerTool(name, { description, annotations, inputSchema, outputSchema }, async (input: unknown): Promise<CallToolResult> => {
      const startedAt = performance.now();
      let output: unknown;
      let error: string | null = null;
      try {
        if (!tool.roles.includes(user.role)) throw new UserError(`Role "${user.role}" may not call ${name}`);
        output = await tool.run(input as never, user);
        return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output as Record<string, unknown> };
      } catch (caught) {
        error = caught instanceof UserError ? caught.message : 'Internal error. The server logged the details.';
        if (!(caught instanceof UserError)) console.error(`Tool ${name} failed`, caught);
        return { content: [{ type: 'text', text: error }], isError: true };
      } finally {
        recordToolCall(services.db, {
          userId: user.id,
          tool: name,
          instructionsVersion: instructions.version,
          input,
          output,
          isError: error !== null,
          error,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }
    });
  }
  return server;
}
