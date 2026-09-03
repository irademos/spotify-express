CREATE TABLE IF NOT EXISTS city_reports (
  id          bigserial PRIMARY KEY,
  city        text NOT NULL,
  reporter_id text NOT NULL DEFAULT 'anonymous',
  created_at  timestamptz DEFAULT now(),
  UNIQUE (city, reporter_id)
);
