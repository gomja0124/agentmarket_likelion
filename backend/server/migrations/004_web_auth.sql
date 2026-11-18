CREATE TABLE IF NOT EXISTS web_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  login_name TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS web_sessions (
  session_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS web_sessions_user ON web_sessions(user_id);
CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires_at);
