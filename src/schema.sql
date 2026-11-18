-- SQLite schema. It runs on node:sqlite locally and on Cloudflare D1 in production.
-- See docs/architecture.md#data-model for the meaning of each table.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('creator', 'admin')),
  status      TEXT NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
  created_at  TEXT NOT NULL
);

-- Local stand-in for OAuth access tokens. M2 replaces it with a real authorization server.
CREATE TABLE IF NOT EXISTS access_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id),
  expires_at  INTEGER NOT NULL -- Unix seconds
);

CREATE TABLE IF NOT EXISTS listings (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  address     TEXT NOT NULL,
  price_usd   INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  listing_id  TEXT NOT NULL REFERENCES listings (id),
  name        TEXT NOT NULL,
  area_m2     REAL
);

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users (id),
  listing_id  TEXT REFERENCES listings (id),
  room_id     TEXT REFERENCES rooms (id),
  kind        TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  source      TEXT NOT NULL CHECK (source IN ('upload', 'generated', 'render')),
  object_key  TEXT NOT NULL UNIQUE,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS render_jobs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id),
  listing_id       TEXT NOT NULL REFERENCES listings (id),
  template         TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'succeeded', 'failed')),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  output_asset_id  TEXT REFERENCES assets (id),
  error            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users (id),
  tool                  TEXT NOT NULL,
  instructions_version  TEXT NOT NULL,
  input_json            TEXT NOT NULL,
  output_json           TEXT,
  is_error              INTEGER NOT NULL,
  error                 TEXT,
  duration_ms           INTEGER NOT NULL,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_calls_by_user ON tool_calls (user_id, created_at);

CREATE TABLE IF NOT EXISTS instruction_versions (
  version     TEXT PRIMARY KEY,
  body        TEXT NOT NULL,
  is_current  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- Local stand-in for Cloudflare Queues (at-least-once delivery with a visibility timeout).
CREATE TABLE IF NOT EXISTS queue_messages (
  id             TEXT PRIMARY KEY,
  queue          TEXT NOT NULL,
  body           TEXT NOT NULL,
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  visible_at     INTEGER NOT NULL -- Unix milliseconds
);
CREATE INDEX IF NOT EXISTS queue_messages_by_visibility ON queue_messages (queue, visible_at);
