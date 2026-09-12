-- D1 schema for the charging dashboard.
--
-- Table ownership is a hard rule and the whole concurrency design:
--   `cache`         is written only by the private upstream service
--   `sessions`      likewise -- it is the authentication half, and the key that signs the
--                   cookie is a binding on that service, so nothing else can write it
--   `login_tokens`  likewise
--   `comments`      is written only by the Pages Function in this repo
-- None of them ever writes another's table.

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

-- One row per successful sign-in, and the reason it exists today rather than later: the
-- session cookie's `jti` is checked against this table on EVERY request, so the "my sessions
-- / revoke this browser" page that is not built yet becomes a SELECT and a DELETE against a
-- table that is already there and already load-bearing. Nothing is revoked today; deleting a
-- row is what revoking will be, and it works right now from the CLI.
--
-- No address, no IP: the subject is the constant 'owner' and there is only ever one person.
-- `user_agent` is what makes a row recognisable to a human ("the iPhone"); `location` is a
-- country code when the platform hands one over for free, and null otherwise.
CREATE TABLE IF NOT EXISTS sessions (
  jti        TEXT PRIMARY KEY,      -- the cookie's jti claim; the revoke handle
  created_at INTEGER NOT NULL,      -- epoch ms, when the link was followed
  last_seen  INTEGER NOT NULL,      -- epoch ms, refreshed at most once a minute per session
  user_agent TEXT,                  -- truncated, for recognising the row; never parsed
  location   TEXT                   -- coarse country code or null. Never an IP address.
);

-- Single-use sign-in links, stored as SHA-256 and never in plaintext, so the table is not a
-- set of live credentials. Also the rate-limit ledger: one row per link actually minted, which
-- is what a per-IP and a global cap are counted from -- no second store, no scheduler. Rows
-- older than the rate window are deleted on the next request, which is the whole cleanup.
--
-- `ip_hash` is SHA-256 of the address salted with the signing key: a bucket to count, not an
-- address to keep. It cannot be walked back even by someone holding this database.
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,      -- SHA-256 hex of the link token. The token itself is never stored.
  created_at INTEGER NOT NULL,      -- epoch ms
  expires_at INTEGER NOT NULL,      -- epoch ms, ten minutes after created_at
  used_at    INTEGER,               -- epoch ms once burned; NULL until then. The replay guard.
  ip_hash    TEXT                   -- salted hash of the requester's address. Never the address.
);

CREATE INDEX IF NOT EXISTS login_tokens_created ON login_tokens (created_at);
