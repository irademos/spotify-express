-- Venue reports: one row per (city, venue_id, reporter_id) so duplicate reports
-- from the same user are ignored; count(*) per (city, venue_id) gives report totals.
CREATE TABLE IF NOT EXISTS venue_reports (
  id            bigserial PRIMARY KEY,
  city          text NOT NULL,
  venue_id      text NOT NULL,
  venue_name    text,
  reporter_id   text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (city, venue_id, reporter_id)
);
