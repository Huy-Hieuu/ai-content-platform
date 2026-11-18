# 002. Stateless Streamable HTTP with MCP SDK v2; OAuth 2.1 through workers-oauth-provider

- Status: accepted
- Date: 2026-11-18

## Context

Claude reaches the server as a [custom connector](https://claude.com/docs/connectors/custom/remote-mcp) over the internet.
Each person must sign in with their own account, because roles and logs are per user.

Facts:

- MCP has two standard transports: stdio and [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports). The old HTTP+SSE transport is [deprecated](https://modelcontextprotocol.io/specification/2026-07-28/deprecated).
- The current spec is [2026-07-28](https://modelcontextprotocol.io/specification/versioning). It is stateless: no `initialize` handshake and no session ID.
- Claude [is rolling out 2026-07-28 support](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude). Its connector docs still describe the 2025-11-25 handshake. So the server must serve both.
- The TypeScript SDK v1 (`@modelcontextprotocol/sdk`) is now the [maintenance line](https://www.npmjs.com/package/@modelcontextprotocol/sdk). It does not support 2026-07-28. v2 ships as `@modelcontextprotocol/server` and `@modelcontextprotocol/client`, and [`createMcpHandler` serves 2025-era clients from the same factory](https://ts.sdk.modelcontextprotocol.io/v2/serving/http).
- Cloudflare's [`createMcpHandler`](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api) takes an SDK v2 factory. [`McpAgent` is deprecated](https://developers.cloudflare.com/changelog/post/2026-07-27-agents-sdk-v0.20.0-mcp-sdk-v2/).
- Claude's OAuth client needs PKCE S256, either DCR or a Client ID Metadata Document, a `401` with `resource_metadata`, and the callback `https://claude.ai/api/mcp/auth_callback` ([Claude connector auth](https://claude.com/docs/connectors/building/authentication)).

## Options

### Transport

- **Stateless Streamable HTTP (SDK v2).** One `POST /mcp`. A fresh server instance per request. Scales out with no session store. Serves old and new clients.
- **Sessionful Streamable HTTP (SDK v1 or `McpAgent`).** Needs session state (a Durable Object on Cloudflare). Both are deprecated paths.

### Authorization server

- **[workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)** on a Worker. Supports pre-registered clients, CIMD, DCR, PKCE and refresh tokens. We add the sign-in page and the invite check. An upstream identity provider (Google, GitHub, or email magic link) proves who the person is.
- **A hosted identity provider** (Auth0, WorkOS, Stytch, Cognito). Less code. One more vendor and cost. Must support DCR or CIMD for Claude.
- **Static bearer token** per organization. Claude supports it [only in beta](https://claude.com/docs/connectors/building/authentication#static-credentials-in-request-headers), and it [cannot tell users apart](https://claude.com/docs/connectors/building/authentication#static-credentials-in-request-headers). It breaks per-user roles and logs.

## Decision

- Transport: **stateless Streamable HTTP with MCP TypeScript SDK v2** (`@modelcontextprotocol/server`). The first brief named `@modelcontextprotocol/sdk`; v2 replaces it as the stable line, so we use v2.
- Auth: **OAuth 2.1 through workers-oauth-provider**, with an upstream login and our `users` table as the invite list. The MCP server only verifies tokens (`requireBearerAuth` with our `verifyAccessToken`).

## Consequences

- Tool code does not change when auth changes. Only `verifyAccessToken` changes (`src/auth.ts`).
- Locally, the skeleton uses dev tokens from the `access_tokens` table. Milestone M2 swaps in real OAuth.
- We own the sign-in page and its security. Keep the OAuth endpoints [under 10 s](https://claude.com/docs/connectors/building/authentication#endpoint-latency).
- Review when Claude finishes 2026-07-28 rollout; then drop legacy support with `legacy: "reject"`.
