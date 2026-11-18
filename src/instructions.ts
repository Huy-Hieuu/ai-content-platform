import type { DatabaseSync } from 'node:sqlite';

/**
 * Workflow instructions the server gives Claude in the MCP `initialize` result.
 * The seed stores this text as the first row of `instruction_versions`.
 * To change the workflow, add a new version row and mark it current. Never edit an old version.
 */
export const INSTRUCTIONS = {
  version: '2026-11-18.1',
  body: [
    'You help real-estate creators make content for their listings.',
    '1. Call list_listings to find the listing the user means.',
    '2. Call start_render with the listing ID and a fresh idempotency_key. Reuse the same key when you retry.',
    '3. Call get_render until the status is succeeded or failed. Give the user the video_url.',
  ].join('\n'),
} as const;

export interface Instructions {
  version: string;
  body: string;
}

export function getCurrentInstructions(db: DatabaseSync): Instructions {
  const row = db.prepare('SELECT version, body FROM instruction_versions WHERE is_current = 1').get();
  if (!row) throw new Error('No current instruction version. Seed the database first.');
  return { version: String(row.version), body: String(row.body) };
}
