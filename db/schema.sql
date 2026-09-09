PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  photo_key TEXT,
  proof_status TEXT NOT NULL DEFAULT 'community',
  confirmations INTEGER NOT NULL DEFAULT 0,
  rejections INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contributions_geo ON contributions(lat, lon);
CREATE INDEX IF NOT EXISTS idx_contributions_category ON contributions(category);

CREATE TABLE IF NOT EXISTS search_terms (
  term TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  last_lat REAL,
  last_lon REAL,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  known_category INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_candidates (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source_term TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  place_name TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_community_events_geo ON community_events(lat, lon);

CREATE TABLE IF NOT EXISTS source_status (
  source_key TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  checked_at TEXT,
  details TEXT
);

CREATE TABLE IF NOT EXISTS transport_catalog_cache (
  dataset_id TEXT PRIMARY KEY,
  slug TEXT,
  title TEXT,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analytics_events (
  day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  label TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(day, visitor_hash, event_type, label)
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_day ON analytics_events(day);

CREATE TABLE IF NOT EXISTS search_daily (
  day TEXT NOT NULL,
  term TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(day, term)
);
CREATE INDEX IF NOT EXISTS idx_search_daily_day ON search_daily(day);

CREATE TABLE IF NOT EXISTS analytics_reports (
  day TEXT PRIMARY KEY,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT
);
