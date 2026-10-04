PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_drafts (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL CHECK (source IN ('AGENT', 'HUMAN')),
  title TEXT,
  description TEXT,
  category TEXT CHECK (category IS NULL OR category IN ('PHONE', 'TABLET')),
  brand TEXT,
  model TEXT,
  storage_gb INTEGER CHECK (storage_gb IS NULL OR storage_gb > 0),
  condition TEXT CHECK (condition IS NULL OR condition IN ('LIKE_NEW', 'GOOD', 'FAIR')),
  accessories TEXT,
  price_krw INTEGER CHECK (price_krw IS NULL OR price_krw >= 0),
  images_json TEXT NOT NULL DEFAULT '[]',
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  next_questions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'READY_FOR_REVIEW', 'PUBLISHED')),
  source_listing_id TEXT REFERENCES listings(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id),
  draft_id TEXT NOT NULL UNIQUE REFERENCES listing_drafts(id),
  title TEXT,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('PHONE', 'TABLET')),
  brand TEXT,
  model TEXT NOT NULL,
  storage_gb INTEGER CHECK (storage_gb IS NULL OR storage_gb > 0),
  condition TEXT CHECK (condition IS NULL OR condition IN ('LIKE_NEW', 'GOOD', 'FAIR')),
  accessories TEXT,
  price_krw INTEGER NOT NULL CHECK (price_krw > 0),
  images_json TEXT NOT NULL DEFAULT '[]',
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_requests (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL CHECK (source IN ('AGENT', 'HUMAN')),
  category TEXT CHECK (category IS NULL OR category IN ('PHONE', 'TABLET')),
  model_query TEXT,
  max_budget_krw INTEGER CHECK (max_budget_krw IS NULL OR max_budget_krw >= 0),
  storage_gb INTEGER CHECK (storage_gb IS NULL OR storage_gb > 0),
  condition_preferences_json TEXT NOT NULL DEFAULT '[]',
  skipped_question_fields_json TEXT NOT NULL DEFAULT '[]',
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  next_questions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'CONFIRMED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_results (
  id TEXT PRIMARY KEY,
  purchase_request_id TEXT NOT NULL REFERENCES purchase_requests(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  match_status TEXT NOT NULL CHECK (match_status IN ('MATCH', 'NEEDS_CONFIRMATION', 'EXCLUDED')),
  matched_fields_json TEXT NOT NULL DEFAULT '[]',
  unmet_fields_json TEXT NOT NULL DEFAULT '[]',
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  rule_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_action_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  status TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, request_id, operation)
);

CREATE INDEX IF NOT EXISTS listings_status_category_price
  ON listings(status, category, price_krw);
CREATE INDEX IF NOT EXISTS listing_drafts_seller_updated
  ON listing_drafts(seller_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS purchase_requests_buyer_updated
  ON purchase_requests(buyer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS search_results_request_created
  ON search_results(purchase_request_id, created_at DESC);
