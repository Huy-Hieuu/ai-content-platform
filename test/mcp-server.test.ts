import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';

import { createTokenVerifier, userFromAuthInfo } from '../src/auth.ts';
import { DEV_TOKENS, openDatabase } from '../src/database.ts';
import { buildMcpServer } from '../src/mcp-server.ts';
import { LocalObjectStore } from '../src/object-store.ts';
import { RenderQueue } from '../src/render-queue.ts';
import { listToolCalls } from '../src/tool-calls.ts';

const db = openDatabase(':memory:');
const services = {
  db,
  queue: new RenderQueue(db),
  store: new LocalObjectStore({ rootDir: mkdtempSync(join(tmpdir(), 'objects-')), publicBaseUrl: 'http://test.local', signingSecret: 'test' }),
};
const verifier = createTokenVerifier(db);

/** Connects an in-process MCP client as the user who owns `token`. */
async function connectAs(token: string): Promise<Client> {
  const authInfo = await verifier.verifyAccessToken(token);
  const handler = createMcpHandler(({ authInfo }) => buildMcpServer(services, userFromAuthInfo(authInfo)));
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo }),
  });
  const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(transport);
  return client;
}

test('a creator cannot call an admin tool, and the denied call is logged', async () => {
  const creator = await connectAs(DEV_TOKENS.creator);
  const result = await creator.callTool({ name: 'list_tool_calls', arguments: {} });

  assert.equal(result.isError, true);
  const [lastCall] = listToolCalls(db, { userId: 'user_creator', limit: 1 });
  assert.equal(lastCall.tool, 'list_tool_calls');
  assert.equal(lastCall.isError, true);
  assert.match(lastCall.error ?? '', /may not call/);
});

test('an allowed call returns structured output and logs input and output', async () => {
  const admin = await connectAs(DEV_TOKENS.admin);
  const result = await admin.callTool({ name: 'list_listings', arguments: { limit: 1 } });

  assert.equal(result.isError, undefined);
  const output = result.structuredContent;
  assert.ok(typeof output === 'object' && output !== null && 'listings' in output && Array.isArray(output.listings));
  assert.equal(output.listings.length, 1);
  const [lastCall] = listToolCalls(db, { userId: 'user_admin', limit: 1 });
  assert.deepEqual(lastCall.input, { limit: 1 });
  assert.deepEqual(lastCall.output, result.structuredContent);
});

test('an unknown token is rejected', async () => {
  await assert.rejects(verifier.verifyAccessToken('not-a-token'), /Unknown token/);
});
