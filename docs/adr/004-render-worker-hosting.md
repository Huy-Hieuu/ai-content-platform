# 004. One Docker image for the render worker on Cloudflare Containers; Remotion Lambda as the scale-out path

- Status: accepted
- Date: 2026-11-18

## Context

The project already has a Remotion setup. Remotion renders with headless Chrome and encodes with FFmpeg ([server-side rendering](https://www.remotion.dev/docs/ssr)).
A Worker cannot run either. Renders take from seconds to minutes. Pilot volume is low: tens of renders a day.

Remotion lists its server-side options in [a comparison page](https://www.remotion.dev/docs/compare-ssr): Lambda, Vercel Sandbox, Cloud Run (alpha), the Node.js APIs on your own server, and Cloudflare Containers.

## Options

### Option A: a container that calls `renderMedia()`

One Docker image: Node.js, the Remotion bundle, Chrome Headless Shell ([Remotion Docker guide](https://www.remotion.dev/docs/docker)).
It exposes `POST /render`, calls [`renderMedia()`](https://www.remotion.dev/docs/renderer/render-media), uploads the MP4 to R2 and returns.

- Good: the same image runs on a laptop, on [Cloudflare Containers](https://developers.cloudflare.com/containers/), on ECS Fargate or on Cloud Run. No lock-in.
- Good: the cheapest compute per minute. [Billed per 10 ms of run time](https://developers.cloudflare.com/containers/platform/pricing/).
- Bad: one machine per render. No split across many machines.
- Bad: we build queueing, retries and progress ourselves. Remotion's own [Cloudflare Containers example](https://www.remotion.dev/docs/cloudflare-containers) is a proof of concept for that reason. Our queue and job table fill that gap.
- Bad: on Cloudflare, a Worker starts the container through a Durable Object and talks to it over HTTP ([architecture](https://developers.cloudflare.com/containers/concepts/architecture/)). A queue consumer has [15 minutes of wall time](https://developers.cloudflare.com/queues/platform/limits/), so one render must finish within that.

### Option B: Remotion Lambda

- Good: splits one video across many Lambdas. The fastest option. Remotion recommends it for most users.
- Good: built-in progress, webhooks and cost estimates.
- Bad: needs an AWS account, IAM setup and S3 next to our Cloudflare stack.
- Bad: [15 minutes maximum per function and per-region concurrency limits](https://www.remotion.dev/docs/lambda/limits).

## Decision

We choose **Option A**. Build one render worker image. Run it on **Cloudflare Containers** (`standard-2`: 1 vCPU, 6 GiB, [instance types](https://developers.cloudflare.com/containers/platform/limits/)).
The queue consumer Worker sends each message to the container, waits for the result, updates `render_jobs`, and acks.

## Consequences

- Locally, `src/render-worker.ts` plays the container and the consumer together. It has a fake renderer behind the `VideoRenderer` type. Milestone M5 replaces it with `renderMedia()`.
- The worker must be idempotent: skip finished jobs, write to `renders/<render_id>.mp4`.
- Move to Remotion Lambda if a render takes more than about 10 minutes or users need faster renders. Only the `VideoRenderer` function changes.
- Check the [Remotion license](https://www.remotion.dev/docs/license) before production use.
