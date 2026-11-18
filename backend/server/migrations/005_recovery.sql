CREATE TABLE IF NOT EXISTS web_recovery_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
