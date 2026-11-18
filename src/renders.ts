import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { User } from './auth.ts';
import { nowIso } from './database.ts';
import { hasListing } from './listings.ts';
import type { RenderQueue } from './render-queue.ts';

export type RenderStatus = 'queued' | 'rendering' | 'succeeded' | 'failed';

export interface RenderJob {
  id: string;
  userId: string;
  listingId: string;
  template: string;
  status: RenderStatus;
  attemptCount: number;
  outputObjectKey: string | null;
  error: string | null;
}

/** An error the caller can fix. Tools show its message to Claude as a tool error. */
export class UserError extends Error {}

/**
 * Creates a render job and queues it. The same user + idempotency key always returns the same job,
 * so a retried tool call never starts a second render.
 */
export function startRender(
  db: DatabaseSync,
  queue: RenderQueue,
  user: User,
  request: { listingId: string; template: string; idempotencyKey: string },
): { job: RenderJob; isNew: boolean } {
  if (!hasListing(db, request.listingId)) throw new UserError(`Listing ${request.listingId} does not exist`);

  const createdAt = nowIso();
  const inserted = db
    .prepare(`
      INSERT INTO render_jobs (id, user_id, listing_id, template, idempotency_key, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
      ON CONFLICT (user_id, idempotency_key) DO NOTHING
      RETURNING id`)
    .get(randomUUID(), user.id, request.listingId, request.template, request.idempotencyKey, createdAt, createdAt);

  const job = findRenderJob(db, 'r.user_id = ? AND r.idempotency_key = ?', user.id, request.idempotencyKey)!;
  if (!inserted && (job.listingId !== request.listingId || job.template !== request.template)) {
    throw new UserError('This idempotency_key was already used with a different listing or template');
  }
  if (inserted) queue.send({ renderJobId: job.id });
  return { job, isNew: inserted !== undefined };
}

/** Returns the job if the user may see it: owners see their own jobs, admins see all jobs. */
export function getRender(db: DatabaseSync, user: User, id: string): RenderJob {
  const job = findRenderJob(db, 'r.id = ?', id);
  if (!job || (job.userId !== user.id && user.role !== 'admin')) throw new UserError(`Render ${id} does not exist`);
  return job;
}

export function findRenderJob(db: DatabaseSync, where: string, ...params: string[]): RenderJob | undefined {
  const row = db
    .prepare(`
      SELECT r.id, r.user_id, r.listing_id, r.template, r.status, r.attempt_count, r.error, a.object_key
      FROM render_jobs r LEFT JOIN assets a ON a.id = r.output_asset_id
      WHERE ${where}`)
    .get(...params);
  if (!row) return undefined;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    listingId: String(row.listing_id),
    template: String(row.template),
    status: row.status as RenderStatus,
    attemptCount: Number(row.attempt_count),
    outputObjectKey: row.object_key === null ? null : String(row.object_key),
    error: row.error === null ? null : String(row.error),
  };
}
