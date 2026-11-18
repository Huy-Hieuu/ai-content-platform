import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { nowIso } from './database.ts';

export interface ToolCall {
  id: string;
  userId: string;
  tool: string;
  instructionsVersion: string;
  input: unknown;
  output: unknown;
  isError: boolean;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

/** Writes one row per tool call. Good runs become templates later (M6), so keep the full input and output. */
export function recordToolCall(db: DatabaseSync, call: Omit<ToolCall, 'id' | 'createdAt'>): void {
  db.prepare('INSERT INTO tool_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    call.userId,
    call.tool,
    call.instructionsVersion,
    JSON.stringify(call.input),
    call.output === undefined ? null : JSON.stringify(call.output),
    call.isError ? 1 : 0,
    call.error,
    call.durationMs,
    nowIso(),
  );
}

export function listToolCalls(db: DatabaseSync, filter: { userId?: string; limit: number }): ToolCall[] {
  const rows = db
    .prepare(`
      SELECT * FROM tool_calls
      WHERE (?1 IS NULL OR user_id = ?1)
      ORDER BY created_at DESC, rowid DESC LIMIT ?2`)
    .all(filter.userId ?? null, filter.limit);
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    tool: String(row.tool),
    instructionsVersion: String(row.instructions_version),
    input: JSON.parse(String(row.input_json)),
    output: row.output_json === null ? null : JSON.parse(String(row.output_json)),
    isError: row.is_error === 1,
    error: row.error === null ? null : String(row.error),
    durationMs: Number(row.duration_ms),
    createdAt: String(row.created_at),
  }));
}
