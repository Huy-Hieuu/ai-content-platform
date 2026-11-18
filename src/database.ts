import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { INSTRUCTIONS } from './instructions.ts';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Local development tokens. They exist only in the local seed, never in a deployed system. */
export const DEV_TOKENS = {
  creator: 'dev-creator-token',
  admin: 'dev-admin-token',
} as const;

/** Opens (or creates) the SQLite database, applies the schema and seeds demo data once. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(schema);
  seedDemoData(db);
  return db;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}

function seedDemoData(db: DatabaseSync): void {
  const isSeeded = db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined;
  if (isSeeded) return;

  const createdAt = nowIso();
  const tokenExpiresAt = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const insertUser = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)');
  const insertToken = db.prepare('INSERT INTO access_tokens VALUES (?, ?, ?)');
  insertUser.run('user_creator', 'creator@example.com', 'Demo Creator', 'creator', 'active', createdAt);
  insertUser.run('user_admin', 'admin@example.com', 'Demo Admin', 'admin', 'active', createdAt);
  insertToken.run(hashToken(DEV_TOKENS.creator), 'user_creator', tokenExpiresAt);
  insertToken.run(hashToken(DEV_TOKENS.admin), 'user_admin', tokenExpiresAt);

  const insertListing = db.prepare('INSERT INTO listings VALUES (?, ?, ?, ?, ?)');
  const insertRoom = db.prepare('INSERT INTO rooms VALUES (?, ?, ?, ?)');
  insertListing.run('listing_1', 'Two-bedroom flat with garden', '12 Example Street', 420000, createdAt);
  insertRoom.run('room_1', 'listing_1', 'Living room', 28.5);
  insertRoom.run('room_2', 'listing_1', 'Kitchen', 12);
  insertListing.run('listing_2', 'Studio near the station', '3 Sample Road', 185000, createdAt);
  insertRoom.run('room_3', 'listing_2', 'Main room', 24);

  db.prepare('INSERT INTO instruction_versions VALUES (?, ?, 1, ?)').run(INSTRUCTIONS.version, INSTRUCTIONS.body, createdAt);
}
