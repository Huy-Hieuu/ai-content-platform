import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';

import { config } from './config.ts';
import { nowIso, openDatabase } from './database.ts';
import { LocalObjectStore } from './object-store.ts';
import { RenderQueue } from './render-queue.ts';
import { findRenderJob, type RenderJob } from './renders.ts';

/** After this many failed attempts the job fails for good. Cloudflare Queues then moves the message to the dead letter queue. */
export const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 1000;

/** Renders one job and returns the video bytes. The real worker calls Remotion `renderMedia()` here. */
export type VideoRenderer = (job: RenderJob) => Promise<Uint8Array>;

export const fakeRenderer: VideoRenderer = async (job) => {
  await sleep(200);
  return new TextEncoder().encode(`FAKE MP4: template=${job.template} listing=${job.listingId} render=${job.id}\n`);
};

interface WorkerServices {
  db: DatabaseSync;
  queue: RenderQueue;
  store: LocalObjectStore;
  renderVideo: VideoRenderer;
}

/**
 * Takes one message from the queue and handles it. Returns false when the queue is empty.
 * Safe under duplicate delivery: a finished job is skipped, and the output key depends only on the job ID,
 * so a retry overwrites the same object instead of making a second one.
 */
export async function processNextRender({ db, queue, store, renderVideo }: WorkerServices): Promise<boolean> {
  const message = queue.receive();
  if (!message) return false;

  const job = findRenderJob(db, 'r.id = ?', message.body.renderJobId);
  if (!job || job.status === 'succeeded' || job.status === 'failed') {
    queue.ack(message.id); // Unknown or finished job: a duplicate delivery. Drop it.
    return true;
  }

  const setStatus = db.prepare('UPDATE render_jobs SET status = ?, attempt_count = ?, error = ?, updated_at = ? WHERE id = ?');
  setStatus.run('rendering', message.attemptCount, null, nowIso(), job.id);
  try {
    const video = await renderVideo(job);
    const objectKey = `renders/${job.id}.mp4`;
    const { sizeBytes } = await store.put(objectKey, video);
    db.exec('BEGIN');
    try {
      const asset = db
        .prepare(`
          INSERT INTO assets (id, owner_id, listing_id, kind, source, object_key, mime_type, size_bytes, created_at)
          VALUES (?, ?, ?, 'video', 'render', ?, 'video/mp4', ?, ?)
          ON CONFLICT (object_key) DO UPDATE SET size_bytes = excluded.size_bytes
          RETURNING id`)
        .get(randomUUID(), job.userId, job.listingId, objectKey, sizeBytes, nowIso());
      db.prepare("UPDATE render_jobs SET status = 'succeeded', output_asset_id = ?, updated_at = ? WHERE id = ?").run(
        String(asset!.id),
        nowIso(),
        job.id,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    queue.ack(message.id);
    console.log(`Render ${job.id} succeeded: ${objectKey}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Render ${job.id} attempt ${message.attemptCount} failed: ${reason}`);
    if (message.attemptCount >= MAX_ATTEMPTS) {
      setStatus.run('failed', message.attemptCount, reason, nowIso(), job.id);
      queue.ack(message.id);
    } else {
      setStatus.run('queued', message.attemptCount, reason, nowIso(), job.id);
      queue.retry(message.id, 1000 * 2 ** message.attemptCount); // Exponential backoff: 2 s, 4 s, ...
    }
  }
  return true;
}

if (import.meta.main) {
  const db = openDatabase(config.databasePath);
  const services: WorkerServices = {
    db,
    queue: new RenderQueue(db),
    store: new LocalObjectStore({ rootDir: config.objectsDir, publicBaseUrl: config.publicBaseUrl, signingSecret: config.signingSecret }),
    renderVideo: fakeRenderer,
  };
  console.log('Render worker started. Waiting for jobs.');
  while (true) {
    const hasMore = await processNextRender(services);
    if (!hasMore) await sleep(POLL_INTERVAL_MS);
  }
}
