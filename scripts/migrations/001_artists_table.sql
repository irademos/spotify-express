-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- Creates the artists lookup table used by the Atlanta shows scraper

create table if not exists artists (
  name       text primary key,
  spotify_id text not null
);
