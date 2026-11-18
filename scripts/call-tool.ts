// Calls one MCP tool on the local server, the same way Claude does over Streamable HTTP.
// Usage: node scripts/call-tool.ts <tool> ['<json arguments>']
// Env: MCP_URL (default http://127.0.0.1:3000/mcp), MCP_TOKEN (default the dev creator token).
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const [tool, rawArguments = '{}'] = process.argv.slice(2);
if (!tool) {
  console.error("Usage: node scripts/call-tool.ts <tool> ['<json arguments>']");
  process.exit(2);
}

const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:3000/mcp');
const token = process.env.MCP_TOKEN ?? 'dev-creator-token';
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: 'call-tool-script', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });

await client.connect(transport);
const result = await client.callTool({ name: tool, arguments: JSON.parse(rawArguments) });
console.log(JSON.stringify(result.isError ? result : result.structuredContent, null, 2));
await client.close();
process.exit(result.isError ? 1 : 0);
