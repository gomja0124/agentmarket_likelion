CREATE TABLE IF NOT EXISTS connection_messages (
  id TEXT PRIMARY KEY,
  connection_request_id TEXT NOT NULL REFERENCES connection_requests(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS connection_messages_thread ON connection_messages(connection_request_id, created_at, id);
