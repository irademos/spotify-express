-- City-based venue configuration for multi-city scraping support
CREATE TABLE IF NOT EXISTS city_venues (
  city       TEXT PRIMARY KEY,
  venues     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
