# Learning plan

Eight milestones. Each one ends with something you can run and check.
M0 and M1 work with the code in this repo today. Later milestones tell you what to add.
Read [architecture.md](architecture.md) first. Keep a short note per milestone of what surprised you.

| Milestone | You learn | Cloud account |
|---|---|---|
| M0 Local setup | Node.js type stripping, `node:sqlite`, the repo layout | No |
| M1 Remote MCP server | MCP tools, Streamable HTTP, connect Claude Code | No |
| M2 Auth and roles | OAuth resource server, JWT, protected resource metadata | No |
| M3 Logging and storage | Tool call logs, object storage, signed URLs | No |
| M4 AI gateway and limits | AI Gateway, per-user quota, cost tracking | Cloudflare (free) + an image provider key |
| M5 Queue and render worker | At-least-once queues, idempotency, Remotion in Docker | No (Docker) |
| M6 Instructions and templates | Versioned instructions, templates from logs | No |
| M7 Deploy and monitor | Workers, D1, R2, Queues, Containers, OAuth sign-in, Claude.ai connector | Cloudflare (Workers Paid) |

---

## M0. Local setup

**Goal:** run the server, the worker and the tests on your machine.

**Build:** nothing. Read `src/` top to bottom: `server.ts` → `mcp-server.ts` → `renders.ts` → `render-worker.ts`.

**Commands:**

```bash
node --version          # needs 24.2 or later
npm ci
npm run typecheck
npm test
```

**Expected output:** `tsc` prints nothing. The tests end with:

```text
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

**It worked if:** all tests pass. Then break one on purpose: delete the role check in `buildMcpServer` and run `npm test`. The test `a creator cannot call an admin tool` must fail. Put the check back.

**Read:**

- [Node.js: run TypeScript natively](https://nodejs.org/api/typescript.html)
- [Node.js: `node:sqlite`](https://nodejs.org/api/sqlite.html)
- [Node.js test runner](https://nodejs.org/api/test.html)

---

## M1. Minimal remote MCP server, connected to Claude

**Goal:** Claude calls your tool over Streamable HTTP.

**Build:** the server already has `list_listings`. Add one small tool yourself, for example `get_listing(listing_id)`. Follow the pattern in `createTools()`: name, description, roles, input and output schemas, `run`.

**Commands:**

```bash
npm run start:server
# second terminal
npm run call -- list_listings '{"limit":1}'
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3000/mcp --transport http \
  --header "Authorization: Bearer dev-creator-token" --method tools/list
# connect Claude Code
claude mcp add --transport http content-platform http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer dev-creator-token"
```

**Expected output:** `npm run call` prints JSON with `listings[0].id = "listing_1"`. The Inspector prints `tools` with `list_listings`, `start_render`, `get_render`, `list_tool_calls` and your new tool.
In Claude Code, ask "Which listings do we have?". Claude calls `list_listings`.

**It worked if:** `curl -si -X POST http://127.0.0.1:3000/mcp` without a token returns `401`, and the calls with the token work.

**Read:**

- [MCP architecture overview](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP transports (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [TypeScript SDK v2: tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools) and [serving over HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http)
- [Claude Code: add a remote HTTP server](https://code.claude.com/docs/en/mcp)

---

## M2. Auth and roles

**Goal:** the server accepts real OAuth access tokens (JWTs) and knows each user's role. Unknown or disabled users get nothing.

**Build:**

1. Add `jose`. Write `scripts/issue-dev-token.ts`. It signs a JWT (`sub` = user ID, `aud` = `http://127.0.0.1:3000/mcp`, `exp` = 1 hour) with a local key. It plays the authorization server for now.
2. Replace the `access_tokens` lookup in `verifyAccessToken` (`src/auth.ts`) with JWT verification. Fill `resource` from `aud`. Read the role and status from `users`.
3. Pass `resourceMetadataUrl` and `expectedResource` to `requireBearerAuth`. Mount `mcpAuthMetadataRouter` so `/.well-known/oauth-protected-resource/mcp` exists.
4. Add an admin tool `invite_user(email, role)`. It inserts a `users` row with `status = invited`.

**Commands:**

```bash
TOKEN=$(node scripts/issue-dev-token.ts user_creator)
MCP_TOKEN=$TOKEN npm run call -- list_listings
curl -si -X POST http://127.0.0.1:3000/mcp | grep -i www-authenticate
curl -s http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp
```

**Expected output:** the call works. The `401` has `WWW-Authenticate: Bearer ... resource_metadata="http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp"`. The metadata JSON has `resource` and `authorization_servers`.

**It worked if:** a token with the wrong `aud`, an expired token, and a token for a `disabled` user all get `401`. A creator still cannot call `invite_user`. Add a test for the wrong audience.

**Read:**

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [SDK v2: require authorization](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization)
- [Claude: authentication for connectors](https://claude.com/docs/connectors/building/authentication)
- [RFC 9728: protected resource metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [jose](https://github.com/panva/jose)

---

## M3. Tool call logging and storage

**Goal:** every call is in `tool_calls`; files live in object storage and leave only as signed URLs.

**Build:** logging exists (`src/tool-calls.ts`). Add:

1. `upload_image(listing_id, room_id, image_base64, mime_type)`. Store the bytes with `LocalObjectStore.put`. Insert an `assets` row.
2. `list_assets(listing_id)`. Return signed URLs, never raw keys.
3. A size limit on uploads (for example 10 MB) and a MIME allow list.

**Commands:**

```bash
npm run call -- upload_image '{"listing_id":"listing_1","room_id":"room_1","image_base64":"iVBORw0KGgo...","mime_type":"image/png"}'
npm run call -- list_assets '{"listing_id":"listing_1"}'
MCP_TOKEN=dev-admin-token npm run call -- list_tool_calls '{"limit":3}'
```

**Expected output:** `list_assets` returns a URL with `expires` and `signature`. `curl` on it returns the image. `list_tool_calls` shows the upload with its input and `duration_ms`.

**It worked if:** changing one character of the signature returns `403`. Large base64 input is not stored twice in the log (store a hash or size in `tool_calls`, not the bytes).

**Read:**

- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [MCP tool results: structured content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

---

## M4. AI gateway and per-user limits

**Goal:** generate an image through Cloudflare AI Gateway, with a daily limit per user and the cost on record.

**Build:**

1. Create a gateway in the Cloudflare dashboard. Pick an image provider it supports ([provider list](https://developers.cloudflare.com/ai-gateway/usage/providers/)).
2. Add `users.daily_image_limit` and an `ai_requests` table (see the data model).
3. Add `generate_image(listing_id, room_id, prompt, size)`. Count today's images first. Call the gateway with header `cf-aig-metadata: {"user_id":"...","tool_call_id":"..."}`. Store the image as an asset. Insert `ai_requests` with the cost.
4. Add a spend limit rule in the gateway, scoped by `user_id`, as a backstop.
5. Add `get_usage(user_id?)` for admins: images and cost per user per day.

**Commands:**

```bash
export AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/<provider>
npm run call -- generate_image '{"listing_id":"listing_1","room_id":"room_1","prompt":"bright living room, morning light","size":"1024x1024"}'
MCP_TOKEN=dev-admin-token npm run call -- get_usage
```

**Expected output:** an `asset_id` and an `image_url`. The gateway dashboard shows the request with your metadata. `get_usage` shows one image and its cost.

**It worked if:** set the limit to 1, call twice: the second call returns `isError` with the limit and does not reach the gateway (the gateway log shows one request).

**Read:**

- [AI Gateway overview](https://developers.cloudflare.com/ai-gateway/)
- [Custom metadata](https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/)
- [Spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/) and [rate limiting](https://developers.cloudflare.com/ai-gateway/features/rate-limiting/)
- [Costs](https://developers.cloudflare.com/ai-gateway/observability/costs/)

---

## M5. Queue and render worker

**Goal:** a real Remotion render runs in Docker behind the queue, with retries and no duplicates.

**Build:** the queue and the fake worker exist. Now:

1. Put your Remotion project in `render/`. Write a `Dockerfile` from the [Remotion Docker guide](https://www.remotion.dev/docs/docker) (Debian base, Chrome Headless Shell).
2. Implement a `VideoRenderer` that calls [`bundle()`](https://www.remotion.dev/docs/bundle) once and [`renderMedia()`](https://www.remotion.dev/docs/renderer/render-media) per job, with the listing data as `inputProps`.
3. Report progress: add `progress` (0–1) to `render_jobs`, update it from `onProgress`, return it from `get_render`.

**Commands:**

```bash
npm run start:server
npm run start:worker            # prints "Render worker started. Waiting for jobs."
npm run call -- start_render '{"listing_id":"listing_1","template":"listing_tour","idempotency_key":"demo-render-001"}'
npm run call -- start_render '{"listing_id":"listing_1","template":"listing_tour","idempotency_key":"demo-render-001"}'
npm run call -- get_render '{"render_id":"<render_id from above>"}'
```

**Expected output:** both `start_render` calls return the same `render_id`; the second has `"is_new": false`. The worker prints `Render <id> succeeded: renders/<id>.mp4`. `get_render` returns `"status": "succeeded"` and a `video_url`.

**It worked if:** kill the worker during a render and start it again: the job finishes once, after the visibility timeout. Make the renderer throw: you see 3 attempts, then `"status": "failed"`.

**Read:**

- [Remotion server-side rendering](https://www.remotion.dev/docs/ssr) and [options compared](https://www.remotion.dev/docs/compare-ssr)
- [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Queues batching and retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [ADR 004](adr/004-render-worker-hosting.md) and [ADR 005](adr/005-queue.md)

---

## M6. Versioned instructions and templates from logs

**Goal:** change the workflow without a deploy, and turn a good run into a reusable template.

**Build:**

1. Admin tool `publish_instructions(body)`. It inserts a new `instruction_versions` row and makes it current in one transaction. Never update an old row.
2. A `templates` table and an admin tool `save_template(name, tool_call_ids)`. It copies the ordered tool names and inputs from `tool_calls` into `steps_json`.
3. A tool `list_templates` and a tool `get_template(template_id)`, so Claude can follow a template.
4. Add the template list to the instructions text.

**Commands:**

```bash
MCP_TOKEN=dev-admin-token npm run call -- list_tool_calls '{"user_id":"user_creator","limit":5}'
MCP_TOKEN=dev-admin-token npm run call -- save_template '{"name":"listing tour video","tool_call_ids":["<id1>","<id2>"]}'
MCP_TOKEN=dev-admin-token npm run call -- publish_instructions '{"body":"..."}'
npm run call -- list_templates
```

**Expected output:** the new instructions version appears in new `tool_calls` rows (`instructions_version`). `list_templates` returns the saved template.

**It worked if:** you can compare error rates per `instructions_version` with one SQL query on `tool_calls`.

**Read:**

- [MCP server instructions and discovery (2026-07-28 changelog)](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts): another way to ship templates

---

## M7. Deploy and monitor

**Goal:** the system runs on Cloudflare, and a person adds it to Claude as a custom connector with OAuth sign-in.

**Build:**

1. Move the MCP server to a Worker with Cloudflare's [`createMcpHandler`](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api). Keep `buildMcpServer`; swap the adapters: `node:sqlite` → D1, `LocalObjectStore` → R2 (signed URLs with `aws4fetch`), `RenderQueue` → a Queues producer.
2. Add an authorization server Worker with [workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider): an upstream login, then a check that the email is in `users` with status `invited` or `active`. The MCP Worker validates tokens over a Service Binding. `verifyAccessToken` is the only auth code that changes.
3. Add a queue consumer Worker with a dead letter queue. It calls the render container through a [Container](https://developers.cloudflare.com/containers/) binding, then updates D1.
4. Add a cron Worker that re-sends jobs stuck in `queued`.
5. Monitoring: Workers Logs, AI Gateway analytics, an alert when the dead letter queue is not empty, and a daily cost-per-user query.

**Commands:**

```bash
npx wrangler d1 create content-platform
npx wrangler d1 execute content-platform --remote --file src/schema.sql
npx wrangler r2 bucket create content-platform-assets
npx wrangler queues create renders
npx wrangler queues create renders-dlq
npx wrangler deploy
npx @modelcontextprotocol/inspector --cli https://<your-worker>/mcp --transport http --method tools/list
```

**Expected output:** the unauthenticated Inspector call gets `401` with `resource_metadata`. In Claude, **Settings → Connectors → Add custom connector** with `https://<your-worker>/mcp` opens your sign-in page. After sign-in, Claude lists the tools.

**It worked if:** an invited user signs in and renders a video from Claude. A person who is not invited cannot finish sign-in. `tool_calls` in D1 shows the calls.

**Read:**

- [Cloudflare: build a remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Claude: get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) and [test your connector](https://claude.com/docs/connectors/building/testing)
- [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/), [Queues](https://developers.cloudflare.com/queues/), [Containers](https://developers.cloudflare.com/containers/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
