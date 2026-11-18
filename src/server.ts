import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';

import { createTokenVerifier, userFromAuthInfo } from './auth.ts';
import { config } from './config.ts';
import { openDatabase } from './database.ts';
import { buildMcpServer } from './mcp-server.ts';
import { LocalObjectStore } from './object-store.ts';
import { RenderQueue } from './render-queue.ts';

const db = openDatabase(config.databasePath);
const services = {
  db,
  queue: new RenderQueue(db),
  store: new LocalObjectStore({ rootDir: config.objectsDir, publicBaseUrl: config.publicBaseUrl, signingSecret: config.signingSecret }),
};

// The SDK builds a fresh MCP server per request, so the endpoint is stateless and scales out.
const mcpHandler = createMcpHandler(({ authInfo }) => buildMcpServer(services, userFromAuthInfo(authInfo)));
const handleMcp = toNodeHandler(mcpHandler);

// createMcpExpressApp parses JSON and checks Host/Origin headers (DNS rebinding protection) on localhost.
const app = createMcpExpressApp();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.all('/mcp', requireBearerAuth({ verifier: createTokenVerifier(db) }), (req, res) => void handleMcp(req, res, req.body));

// Local stand-in for R2/S3 signed URLs.
app.get('/files/*key', async (req, res) => {
  const keyParts: string | string[] = req.params.key;
  const key = Array.isArray(keyParts) ? keyParts.join('/') : keyParts;
  const expiresAt = Number(req.query.expires);
  const signature = String(req.query.signature ?? '');
  if (!services.store.isValidSignature(key, expiresAt, signature)) {
    res.status(403).send('Invalid or expired signature');
    return;
  }
  res.type(key.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream').send(await services.store.get(key));
});

const httpServer = app.listen(config.port, '127.0.0.1', () => {
  console.log(`MCP server listening on ${config.publicBaseUrl}/mcp`);
});

process.on('SIGINT', async () => {
  await mcpHandler.close();
  httpServer.close();
  db.close();
  process.exit(0);
});
