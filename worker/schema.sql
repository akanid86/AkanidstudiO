PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  type_code TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  location_precision TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  emergency_status TEXT NOT NULL DEFAULT 'active',
  source_type TEXT NOT NULL DEFAULT 'community',
  water_depth TEXT,
  vehicle_access TEXT,
  need_code TEXT,
  people_count INTEGER,
  note TEXT,
  owner_token_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_reported_at ON reports(reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_type_status ON reports(type_code, emergency_status);
CREATE INDEX IF NOT EXISTS idx_reports_lat_lng ON reports(latitude, longitude);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL
);
