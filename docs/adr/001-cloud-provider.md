# 001. Cloudflare for the control plane; render worker in a container

- Status: accepted
- Date: 2026-11-18

## Context

The pilot needs: a public HTTPS endpoint for MCP, OAuth, a small database, object storage, a queue, an AI gateway, and a place that runs Chrome and FFmpeg for Remotion.
One person builds and runs it. Low fixed cost and few moving parts matter more than fine control.

## Options

### Option A: Cloudflare (Workers, D1, R2, Queues, AI Gateway, Containers)

- Good: every part has a binding in one Worker config. No VPC, no IAM policies, no load balancer.
- Good: [Cloudflare has an official remote MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/) and an [OAuth provider library](https://github.com/cloudflare/workers-oauth-provider).
- Good: [R2 has no egress fee](https://developers.cloudflare.com/r2/pricing/). Videos are large downloads.
- Good: [AI Gateway](https://developers.cloudflare.com/ai-gateway/) gives rate limits, spend limits per metadata key, logs and cost without our own code.
- Bad: [Workers have 128 MB memory per isolate](https://developers.cloudflare.com/workers/platform/limits/). They cannot run Chrome or FFmpeg, so renders need [Containers](https://developers.cloudflare.com/containers/) (GA since [2026-04-13](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/)).
- Bad: [D1 has a 10 GB limit per database](https://developers.cloudflare.com/d1/platform/limits/). Fine for a pilot.
- Bad: fewer people know it than AWS. Some APIs are young.

### Option B: AWS (Lambda or ECS, RDS Postgres, S3, SQS, Bedrock, Remotion Lambda)

- Good: the most mature services. [Remotion Lambda](https://www.remotion.dev/docs/lambda) is Remotion's own recommended way to render at scale.
- Good: [SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html), [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) and [Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.AuroraPostgreSQL.html) are well known.
- Bad: much more setup: VPC, IAM, API Gateway or a load balancer, secrets, and an OAuth server (Cognito or a third party).
- Bad: no built-in AI gateway. We must build per-user limits and cost tracking around Bedrock or provider SDKs.
- Bad: S3 egress costs money.

## Decision

We choose **Cloudflare** for the control plane. We put the render worker in a **plain Docker image**, so it can also run on AWS (ECS Fargate) or any container host.

## Consequences

- One `wrangler.jsonc` describes most of the system.
- The skeleton uses local stand-ins (SQLite, files, a table queue) with the same behavior, so you can learn without an account.
- The render worker is the only part that depends on Chrome and FFmpeg. [ADR 004](004-render-worker-hosting.md) covers it.
- Review this decision if D1 size, Worker memory, or a client's AWS requirement becomes a hard limit.
