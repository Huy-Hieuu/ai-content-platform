# Architecture decision records

An ADR records one real choice: the context, the options, the decision and its cost.
Do not edit an accepted ADR. To change a decision, write a new ADR and mark the old one `superseded by NNN`.
Copy [template.md](template.md) to start a new one.

| ADR | Decision | Status |
|---|---|---|
| [001](001-cloud-provider.md) | Cloudflare for the control plane; render worker in a container | accepted |
| [002](002-mcp-transport-and-auth.md) | Stateless Streamable HTTP with MCP TypeScript SDK v2; OAuth 2.1 through workers-oauth-provider | accepted |
| [003](003-database.md) | D1 (SQLite) for the pilot; Postgres through Hyperdrive when we outgrow it | accepted |
| [004](004-render-worker-hosting.md) | One Docker image for the render worker, run on Cloudflare Containers; Remotion Lambda as the scale-out path | accepted |
| [005](005-queue.md) | Cloudflare Queues with a dead letter queue; idempotency in the database | accepted |
