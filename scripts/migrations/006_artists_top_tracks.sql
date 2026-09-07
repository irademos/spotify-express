-- Adds top_tracks column and a unique index on spotify_id to the artists table.
-- top_tracks is a text array storing up to 2 top song names per artist.
-- The unique index on spotify_id enables upsert-by-spotify_id in the scraper.

alter table artists
  add column if not exists top_tracks text[];

-- Remove duplicate spotify_id rows, keeping the one with the longest name
-- (most likely to be the canonical entry). Primary key is name so we delete
-- by ctid to remove the duplicates without touching the keeper.
delete from artists a
using (
  select spotify_id, min(name) as keep_name
  from artists
  where spotify_id is not null
  group by spotify_id
  having count(*) > 1
) dupes
where a.spotify_id = dupes.spotify_id
  and a.name <> dupes.keep_name;

create unique index if not exists artists_spotify_id_key on artists (spotify_id);
