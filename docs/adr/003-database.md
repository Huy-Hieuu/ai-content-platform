# 003. D1 (SQLite) for the pilot; Postgres through Hyperdrive when we outgrow it

- Status: accepted
- Date: 2026-11-18

## Context

Data: users, listings, rooms, asset metadata, tool call logs, render jobs, instruction versions.
At pilot scale this is a few hundred MB per year. Tool call logs grow fastest.
We need unique constraints (idempotency), simple joins and transactions.

## Options

### Option A: Cloudflare D1

- Good: [SQLite semantics](https://developers.cloudflare.com/d1/), a binding in the Worker, no connection pool, no server to run.
- Good: the same SQL runs locally on `node:sqlite`. The skeleton uses it.
- Bad: [10 GB per database, and you cannot raise it](https://developers.cloudflare.com/d1/platform/limits/). Each database is single-threaded.
- Bad: no rich types (JSON is text, no arrays) and fewer tools for analytics.
- Bad: the render worker in a container cannot use the D1 binding. It must call a Worker endpoint or the Cloudflare API to update jobs.

### Option B: Postgres (Neon, Supabase, RDS) through [Hyperdrive](https://developers.cloudflare.com/hyperdrive/)

- Good: no practical size limit, `jsonb`, strong analytics, many tools. The render worker connects directly.
- Bad: one more service and bill. Connection pooling and migrations need more care.

## Decision

We choose **D1** for the pilot. We write plain SQL with no SQLite-only tricks, so a move to Postgres is a port, not a rewrite.

## Consequences

- The render worker reports results through the queue consumer Worker, which owns D1 writes ([ADR 004](004-render-worker-hosting.md)).
- Keep `tool_calls` lean. Move rows older than 90 days to R2 as JSON lines if the database grows.
- Move to Postgres when any of these is true: the database passes 5 GB, analytics queries get slow, or several services need direct SQL access.
