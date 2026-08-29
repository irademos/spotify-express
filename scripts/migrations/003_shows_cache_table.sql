-- Generic per-city shows cache, replaces the Atlanta-only atlanta_shows_cache table
CREATE TABLE IF NOT EXISTS shows_cache (
  city       TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
