-- D1 schema for the charging dashboard.
--
-- Table ownership is a hard rule and the whole concurrency design:
--   `cache`    is written only by the private proxy Worker
--   `comments` is written only by the Pages Function in this repo
-- Neither ever writes the other's table.

CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,      -- 'state' | 'history' | 'invoices'
  payload    TEXT NOT NULL,         -- JSON, already stripped of personal fields upstream
  fetched_at INTEGER NOT NULL       -- epoch ms of the last SUCCESSFUL upstream fetch
);

CREATE TABLE IF NOT EXISTS comments (
  id       TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL,        -- epoch ms
  author   TEXT NOT NULL,
  text     TEXT NOT NULL,
  status   TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'done'
  archived INTEGER NOT NULL DEFAULT 0      -- 0 | 1; rows are archived, never deleted
);

CREATE INDEX IF NOT EXISTS comments_ts ON comments (ts);
