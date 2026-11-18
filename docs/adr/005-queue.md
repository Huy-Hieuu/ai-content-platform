# 005. Cloudflare Queues with a dead letter queue; idempotency in the database

- Status: accepted
- Date: 2026-11-18

## Context

`start_render` must return at once. A render must survive a crash and run again, but never produce two videos for one request.

## Options

### Option A: Cloudflare Queues

- Good: a producer binding in the MCP Worker and a consumer Worker. No servers.
- Good: retries (`max_retries`, default 3), delayed retry up to 24 h, and a [dead letter queue](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/) ([batching and retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)).
- Good: [HTTP pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/) let a container outside Cloudflare consume, if we ever move the worker.
- Bad: [at-least-once delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/): a message can arrive twice.
- Bad: [128 KB per message](https://developers.cloudflare.com/queues/platform/limits/). Send IDs, not data.

### Option B: Amazon SQS

- Good: mature; [visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) and [redrive to a dead letter queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).
- Bad: a second cloud for one feature. Also [at-least-once](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html).

### Option C: a jobs table that workers poll

- Good: no extra service. The skeleton uses this as its local stand-in.
- Bad: polling cost and lock handling. D1 is single-threaded, so many pollers hurt it.

## Decision

We choose **Cloudflare Queues**, with a dead letter queue, `max_retries = 3` and individual `ack()`.
Exactly-once is not possible here, so the **database owns idempotency**:

1. `render_jobs` has `UNIQUE (user_id, idempotency_key)`. A retried tool call finds the existing job.
2. The message carries only `render_job_id`.
3. The consumer skips jobs that are `succeeded` or `failed`.
4. The output key depends only on the job ID, so a second run overwrites the same object.

## Consequences

- The local queue (`src/render-queue.ts`) copies this behavior: visibility timeout, attempt count, retry with delay, ack.
- Alert when the dead letter queue is not empty.
- A cron Worker re-sends jobs stuck in `queued`, because the database write and the queue send are not one transaction.
