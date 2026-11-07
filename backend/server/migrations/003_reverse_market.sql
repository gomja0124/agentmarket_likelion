CREATE TABLE IF NOT EXISTS public_demands (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES users(id),
  purchase_request_id TEXT NOT NULL UNIQUE REFERENCES purchase_requests(id),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('PHONE', 'TABLET')),
  model_query TEXT,
  storage_gb INTEGER CHECK (storage_gb IS NULL OR storage_gb > 0),
  condition_preferences_json TEXT NOT NULL DEFAULT '[]',
  min_budget_krw INTEGER CHECK (min_budget_krw IS NULL OR min_budget_krw > 0),
  max_budget_krw INTEGER NOT NULL CHECK (max_budget_krw > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'EXPIRED')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connection_requests (
  id TEXT PRIMARY KEY,
  public_demand_id TEXT NOT NULL REFERENCES public_demands(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  seller_id TEXT NOT NULL REFERENCES users(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (public_demand_id, listing_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('NEW_MATCH', 'CONNECTION_REQUEST', 'CONNECTION_ACCEPTED', 'CONNECTION_DECLINED')),
  public_demand_id TEXT REFERENCES public_demands(id),
  listing_id TEXT REFERENCES listings(id),
  connection_request_id TEXT REFERENCES connection_requests(id),
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (user_id, type, public_demand_id, listing_id)
);

CREATE INDEX IF NOT EXISTS public_demands_active_category ON public_demands(status, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS public_demands_buyer ON public_demands(buyer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS connection_requests_buyer ON connection_requests(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS connection_requests_seller ON connection_requests(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at DESC);
