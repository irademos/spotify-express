-- Adds top_tracks column and a unique index on spotify_id to the artists table.
-- top_tracks is a text array storing up to 2 top song names per artist.
-- The unique index on spotify_id enables upsert-by-spotify_id in the scraper.

alter table artists
  add column if not exists top_tracks text[];

create unique index if not exists artists_spotify_id_key on artists (spotify_id);
