import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface RenderMessage {
  renderJobId: string;
}

export interface ReceivedMessage {
  id: string;
  body: RenderMessage;
  /** 1 on the first delivery. Higher values mean a retry. */
  attemptCount: number;
}

const QUEUE = 'renders';

/**
 * Local stand-in for Cloudflare Queues (or SQS), stored in SQLite.
 * It has the same delivery rule: at least once. A received message stays hidden for
 * `visibilityTimeoutMs`. If the consumer does not ack it in time, it comes back.
 * So the consumer must be idempotent.
 */
export class RenderQueue {
  private readonly db: DatabaseSync;
  private readonly visibilityTimeoutMs: number;

  constructor(db: DatabaseSync, options: { visibilityTimeoutMs?: number } = {}) {
    this.db = db;
    this.visibilityTimeoutMs = options.visibilityTimeoutMs ?? 60_000;
  }

  send(body: RenderMessage): void {
    this.db
      .prepare('INSERT INTO queue_messages (id, queue, body, visible_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), QUEUE, JSON.stringify(body), Date.now());
  }

  /** Takes the next visible message and hides it for the visibility timeout. */
  receive(): ReceivedMessage | undefined {
    const now = Date.now();
    const row = this.db
      .prepare(`
        UPDATE queue_messages
        SET visible_at = ?, attempt_count = attempt_count + 1
        WHERE id = (SELECT id FROM queue_messages WHERE queue = ? AND visible_at <= ? ORDER BY visible_at LIMIT 1)
        RETURNING id, body, attempt_count`)
      .get(now + this.visibilityTimeoutMs, QUEUE, now);
    if (!row) return undefined;
    return { id: String(row.id), body: JSON.parse(String(row.body)), attemptCount: Number(row.attempt_count) };
  }

  /** Deletes a message after the consumer has handled it. */
  ack(id: string): void {
    this.db.prepare('DELETE FROM queue_messages WHERE id = ?').run(id);
  }

  /** Makes a message visible again after `delayMs`, for a retry with backoff. */
  retry(id: string, delayMs: number): void {
    this.db.prepare('UPDATE queue_messages SET visible_at = ? WHERE id = ?').run(Date.now() + delayMs, id);
  }
}
