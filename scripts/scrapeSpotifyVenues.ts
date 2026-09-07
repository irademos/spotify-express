import axios from 'axios';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[scraper] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ATLANTA_VENUE_IDS = [
  '56w6Uns7gENOQdP7e99k0S', // Buckhead Theatre
  '3YU5ZqMJOchPbG7DEZEZcF', // 529 Bar EAV
  '6CgzpPmHJFo3nTNyyj1iTH', // Aisle 5
  '2pjdYXAB3zHcuY8yUjAKAE', // The EARL
  '4eM6foMcJdCgMYKUQBi1E3', // Variety Playhouse
  '7EGBn6qZP7ngRny9nQsHB9', // Coca-Cola Roxy
  '6VgXO4NJiX6ygWDjhDWsL9', // Fox Theatre
  '4EriXwnDOckm52Gt46jUx2', // MadLife Stage & Studios
  '4QJGQpVyqnLgHtolgCp7gL', // eyedrum 
  '1yeWzqcdpKUnHmZMUOa9Ma', // The Eastern
  '3LEHQ0zFPAkNcm21GC4rE1', // Eddie's Attic
  '07xImrFVCTJg8SzUu3cxXw', // Culture Shock
  '3z4ioL0RWXvTqRW45P94dz', // Tabernacle
  '15ZsLTvybmVMZcQ6ynJ1Wd', // The Drunken Unicorn
  '0IYFqOtJaNVJpj2sgaRwKo', // The Loft
  '01BO8Btvq2dWdQqvIKjTgU', // Terminal West
  '0uzzDQsAY48qKMeseh3w5N', // Boggs Social & Supply
  '4vD9OzCEMMTnxJkAbXuJMM', // Smith's Olde Bar
  '0RO73kiZJcbnntnICnPhnP', // The Third Door
  '5lJumEpnjrp9sZcIukIsBN', // The Garden Club at Wild Heaven West End
  '6CViqzavVGQk0O9Lukx5Pd', // Center Stage Theater / Vinyl
  '4uuxBkCxJkvMLxjnC7x8lW', // Masquerade - Altar
  '20mbxU8VsErIgAYlrKxPCQ', // Masquerade - Heaven
  '0HUd3zYwg7drRMeKHI7hOX', // Masquerade - Purgatory
  '2Jdti0kwvrcMe9cxuoFjgq', // Lakewood Ampitheater
  '0xoBSGCFuAXXyQd2ETHtTg', // Chastain Park Ampitheater
  '06QO7xdSdeHQxiyVaUXKlZ', // State Farm Arena
  '79u4ZLSiG3YNHbMVMTDiWe', // Believe Music Hall
  '6c4bbdh0a10lPfoGvCVXcR', // District Atlanta
  '5gbgLdHRsuN9DR75eunIoT', // Star Bar
  '0Ypxi7KUWEcetzOr6jbR9U', // Northside Tavern
  '45r6C6zeL3PQ0fBteQDfbD', // Blind Willies
  '5sVth0DdbjgvsPjyHMyq6X', // Atlanta Symphony Hall
  '3uZPorjHCS6P60zebLFYFK', // Ameris Bank Ampitheatre
  '4MH5KNT29dI9jk5wesLf8m', // Gas South Arena
  '6JLAUDO8YiWIw7PZGLD5rU', // Cobb Energy Performing Arts Centre
  '3iX6U4lMbb9dyJfebip6PF', // Mable House Barnes Ampitheatre
  '1ojghBZoqCZgdqUAvofGMX', // From the Earth Brewing
  '2boxN5EsZK9QcT7cB8daDO', // Avon Theater
];

const SP_WP_VERSION = '1.2.93.577.g601a69db';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

interface Show {
  datetime: string;
  artists: string[];
  venue: string;
  venueId: string;
  spotifyArtistIds?: (string | null)[];
  concertUri?: string;
  firstArtistAvatarUrl?: string;
}

interface VenueResult {
  venueId: string;
  venueName: string;
  shows: Show[];
}

function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseVenueApiResponse(venueData: any, venueId: string): VenueResult {
  const venueName = venueData.name || venueId;
  const shows: Show[] = [];
  const concerts: any[] = venueData.concerts?.items || [];

  concerts.forEach((c: any) => {
    const d = c.data || c;
    const datetime = d.startDateIsoString || d.startDate;
    const artistItems: any[] = d.artists?.items || [];

    const artists: string[] = [];
    const spotifyArtistIds: (string | null)[] = [];

    artistItems.forEach((item: any) => {
      const name = item?.data?.profile?.name;
      if (name) {
        artists.push(name);
        const uri: string | undefined = item?.data?.uri; // "spotify:artist:<id>"
        spotifyArtistIds.push(uri ? (uri.split(':')[2] || null) : null);
      }
    });

    // Fall back to title, which may be comma-separated artist names
    if (artists.length === 0 && d.title) {
      d.title.split(',').map((a: string) => a.trim()).filter(Boolean).forEach((name: string) => {
        artists.push(name);
        spotifyArtistIds.push(null);
      });
    }

    const concertUri: string | null = d.uri || null; // "spotify:concert:<id>"
    const firstArtistAvatarUrl: string | null =
      artistItems[0]?.data?.visuals?.avatarImage?.sources?.[0]?.url ?? null;

    const venue = d.location?.name || venueName;
    if (datetime && artists.length > 0) {
      const show: Show = { datetime, artists, venue, venueId };
      if (spotifyArtistIds.some(id => id !== null)) show.spotifyArtistIds = spotifyArtistIds;
      if (concertUri) show.concertUri = concertUri;
      if (firstArtistAvatarUrl) show.firstArtistAvatarUrl = firstArtistAvatarUrl;
      shows.push(show);
    }
  });

  return { venueId, venueName, shows };
}

async function captureTokensViaPlaywright(venueId: string): Promise<{
  tokens: { accessToken: string; clientToken: string } | null;
  venueResult: VenueResult | null;
}> {
  console.log(`[playwright] launching browser for venue ${venueId}`);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: UA,
      locale: 'en-US',
      extraHTTPHeaders: { 'accept-language': 'en' },
    });
    const page = await context.newPage();

    let capturedTokens: { accessToken: string; clientToken: string } | null = null;
    let capturedVenueData: any = null;

    page.on('request', (request) => {
      const url = request.url();
      if ((url.includes('api-partner.spotify.com') || url.includes('spclient.wg.spotify.com')) && !capturedTokens) {
        const headers = request.headers();
        const auth = headers['authorization'];
        const clientToken = headers['client-token'];
        if (auth?.startsWith('Bearer ') && clientToken) {
          capturedTokens = { accessToken: auth.slice(7), clientToken };
          console.log('[playwright] captured tokens from', url.split('?')[0]);
        }
      }
    });

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('api-partner.spotify.com') && !capturedVenueData) {
        try {
          const json = await response.json();
          if (json?.data?.venue) {
            capturedVenueData = json.data.venue;
            console.log('[playwright] captured venue data for', venueId);
          }
        } catch {}
      }
    });

    await page.goto(`https://open.spotify.com/venue/${venueId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForSelector('body', { timeout: 5000 });
    await page.waitForTimeout(2000);

    const venueResult = capturedVenueData
      ? parseVenueApiResponse(capturedVenueData, venueId)
      : null;

    console.log(`[playwright] ${venueId}: tokens=${!!capturedTokens} venueData=${!!capturedVenueData}`);
    return { tokens: capturedTokens, venueResult };
  } finally {
    await browser.close();
  }
}

async function fetchVenueViaPartnerApi(
  venueId: string,
  tokens: { accessToken: string; clientToken: string }
): Promise<VenueResult | null> {
  const body = {
    operationName: 'venue',
    variables: { uri: `spotify:venue:${venueId}`, offset: 0, limit: 20 },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: '9a9e12f916cab5b797b29604fe90d64924d25e55b5696943d4cac00c03644ab9',
      },
    },
  };

  try {
    const resp = await axios.post(
      'https://api-partner.spotify.com/pathfinder/v2/query',
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${tokens.accessToken}`,
          'Client-Token': tokens.clientToken,
          Origin: 'https://open.spotify.com',
          Referer: 'https://open.spotify.com/',
          'app-platform': 'WebPlayer',
          'spotify-app-version': SP_WP_VERSION,
          'User-Agent': UA,
          'sec-fetch-site': 'same-site',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
        },
        timeout: 12000,
      }
    );

    const venueData = resp.data?.data?.venue;
    if (!venueData) {
      console.log(`[scraper] ${venueId}: no venue in response`);
      return null;
    }

    const result = parseVenueApiResponse(venueData, venueId);
    console.log(`[scraper] ${venueId}: "${result.venueName}" shows=${result.shows.length}`);
    return result;
  } catch (err: any) {
    console.log(`[scraper] ${venueId}: ${err.response?.status || err.message}`);
    return null;
  }
}

async function fetchArtistTopTracks(artistId: string, token: string): Promise<string[]> {
  try {
    const resp = await axios.get(`https://api.spotify.com/v1/artists/${artistId}/top-tracks`, {
      params: { market: 'US' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    });
    const tracks: any[] = resp.data?.tracks || [];
    return tracks.slice(0, 2).map((t: any) => t.name).filter(Boolean);
  } catch (err: any) {
    console.log(`[scraper] top-tracks "${artistId}": ${err.response?.status || err.message}`);
    return [];
  }
}

async function getClientCredentialsToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log('[scraper] No Spotify credentials — skipping artist ID lookup');
    return null;
  }

  try {
    const resp = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'client_credentials' }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        timeout: 8000,
      }
    );
    return resp.data.access_token || null;
  } catch (err: any) {
    console.log('[scraper] Failed to get client credentials token:', err.message);
    return null;
  }
}

async function searchSpotifyArtist(artistName: string, token: string): Promise<string | null> {
  try {
    const resp = await axios.get('https://api.spotify.com/v1/search', {
      params: { q: `"${artistName}"`, type: 'artist', limit: 10 },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    });

    const items: any[] = resp.data?.artists?.items || [];
    if (items.length === 0) return null;

    const normalTarget = normalizeArtistName(artistName);

    // Exact normalized name match wins
    const exactMatch = items.find((a: any) => normalizeArtistName(a.name) === normalTarget);
    if (exactMatch) return exactMatch.id;

    // Popularity only breaks ties — no exact match means no result
    return null;
  } catch (err: any) {
    console.log(`[scraper] artist search "${artistName}": ${err.response?.status || err.message}`);
    return null;
  }
}

async function resolveArtistIds(
  artistNames: string[],
  searchToken: string
): Promise<Record<string, string>> {
  const artistIdMap: Record<string, string> = {};

  // Fetch any IDs already stored in Supabase
  const { data: existing, error: fetchError } = await supabase
    .from('artists')
    .select('name, spotify_id')
    .in('name', artistNames);

  if (fetchError) {
    console.log('[scraper] Warning: could not fetch artists table:', fetchError.message);
  } else {
    (existing || []).forEach((a: { name: string; spotify_id: string }) => {
      artistIdMap[a.name] = a.spotify_id;
    });
    console.log(`[scraper] ${Object.keys(artistIdMap).length} artist IDs loaded from cache`);
  }

  // Search for artists we don't have yet
  const missing = artistNames.filter((n) => !artistIdMap[n]);
  if (missing.length === 0) return artistIdMap;

  console.log(`[scraper] Searching Spotify for ${missing.length} unknown artists...`);
  const newArtists: { name: string; spotify_id: string }[] = [];

  for (let i = 0; i < missing.length; i += 3) {
    const batch = missing.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(async (name) => {
        const id = await searchSpotifyArtist(name, searchToken);
        return id ? { name, spotify_id: id } : null;
      })
    );
    results.forEach((r) => {
      if (r) {
        artistIdMap[r.name] = r.spotify_id;
        newArtists.push(r);
      }
    });
  }

  if (newArtists.length > 0) {
    const { error: upsertError } = await supabase
      .from('artists')
      .upsert(newArtists, { onConflict: 'name' });
    if (upsertError) {
      console.log('[scraper] Warning: could not save artist IDs:', upsertError.message);
    } else {
      console.log(`[scraper] Stored ${newArtists.length} new artist IDs`);
    }
  }

  return artistIdMap;
}

async function loadAllCityVenues(): Promise<{ city: string; venueIds: string[] }[]> {
  const { data, error } = await supabase.from('city_venues').select('city, venues').order('city');

  if (error || !data || (data as any[]).length === 0) {
    console.log('[scraper] city_venues lookup failed or empty, falling back to hardcoded Atlanta list:', error?.message);
    return [{ city: 'Atlanta', venueIds: ATLANTA_VENUE_IDS }];
  }

  const cities = (data as any[])
    .map((row: any) => {
      const ids: string[] = (row.venues as any[] || []).map((v: any) => v.id).filter(Boolean);
      return { city: row.city as string, venueIds: ids };
    })
    .filter(c => c.venueIds.length > 0);

  if (cities.length === 0) {
    console.log('[scraper] All city_venues rows are empty, falling back to hardcoded Atlanta list');
    return [{ city: 'Atlanta', venueIds: ATLANTA_VENUE_IDS }];
  }

  cities.forEach(c => console.log(`[scraper] ${c.city}: ${c.venueIds.length} venues`));
  return cities;
}

async function scrapeCity(
  city: string,
  venueIds: string[],
  tokens: { accessToken: string; clientToken: string },
  bootstrapResult: VenueResult | null,
  bootstrapVenueId: string,
  searchToken: string | null
): Promise<void> {
  console.log(`\n[scraper] ── ${city} ──`);

  const results: VenueResult[] = [];
  if (bootstrapResult && venueIds[0] === bootstrapVenueId) results.push(bootstrapResult);

  const remaining = results.length > 0 ? venueIds.slice(1) : venueIds;
  for (let i = 0; i < remaining.length; i += 5) {
    const batch = remaining.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (id) => {
        const r = await fetchVenueViaPartnerApi(id, tokens);
        return r ?? { venueId: id, venueName: id, shows: [] };
      })
    );
    results.push(...batchResults);
  }

  const allShows = results.flatMap((r) => r.shows);
  allShows.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

  const artistIdFromApi = new Map<string, string>();
  allShows.forEach((show) => {
    show.artists.forEach((name, idx) => {
      const id = show.spotifyArtistIds?.[idx];
      if (id) artistIdFromApi.set(name, id);
    });
  });

  if (artistIdFromApi.size > 0) {
    const toUpsert = Array.from(artistIdFromApi.entries()).map(([name, spotify_id]) => ({ name, spotify_id }));
    const { error: upsertErr } = await supabase.from('artists').upsert(toUpsert, { onConflict: 'name' });
    if (upsertErr) console.log('[scraper] Warning: could not upsert API artist IDs:', upsertErr.message);
    else console.log(`[scraper] Upserted ${toUpsert.length} artists from partner API`);
  }

  if (searchToken) {
    const allArtistNames = [...new Set(allShows.flatMap((s) => s.artists))];
    const stillMissing = allArtistNames.filter(name => !artistIdFromApi.has(name));
    if (stillMissing.length > 0) {
      const artistIdMap = await resolveArtistIds(stillMissing, searchToken);
      allShows.forEach((show) => {
        show.artists.forEach((name, idx) => {
          if (!show.spotifyArtistIds?.[idx] && artistIdMap[name]) {
            if (!show.spotifyArtistIds) show.spotifyArtistIds = show.artists.map(() => null);
            show.spotifyArtistIds[idx] = artistIdMap[name];
          }
        });
      });
    }
  }

  const resolved = allShows.filter((s) => s.spotifyArtistIds?.some((id) => id !== null)).length;
  console.log(`[scraper] ${city}: ${resolved}/${allShows.length} shows have at least one Spotify artist ID`);

  // Build artistId map (name → id) from all resolved sources
  const artistTopSongs: Record<string, string[]> = {};
  if (searchToken) {
    const uniqueArtistIds = new Map<string, string>();
    allShows.forEach((show) => {
      show.artists.forEach((name, idx) => {
        const id = show.spotifyArtistIds?.[idx] || artistIdFromApi.get(name) || null;
        if (id && !uniqueArtistIds.has(name)) uniqueArtistIds.set(name, id);
      });
    });

    const entries = Array.from(uniqueArtistIds.entries());

    // Load cached top_tracks from Supabase to avoid redundant Spotify API calls
    const allArtistIds = entries.map(([, id]) => id);
    const cachedTracksMap = new Map<string, string[]>(); // spotify_id → tracks
    if (allArtistIds.length > 0) {
      const { data: cachedRows } = await supabase
        .from('artists')
        .select('spotify_id, top_tracks')
        .in('spotify_id', allArtistIds)
        .not('top_tracks', 'is', null);
      (cachedRows || []).forEach((row: { spotify_id: string; top_tracks: string[] }) => {
        if (row.top_tracks?.length > 0) cachedTracksMap.set(row.spotify_id, row.top_tracks);
      });
      console.log(`[scraper] ${city}: ${cachedTracksMap.size} artists have cached top tracks`);
    }

    // Populate from cache first
    entries.forEach(([name, id]) => {
      const cached = cachedTracksMap.get(id);
      if (cached) artistTopSongs[name] = cached;
    });

    const needsFetch = entries.filter(([, id]) => !cachedTracksMap.has(id));
    console.log(`[scraper] ${city}: fetching top tracks for ${needsFetch.length} artists (${entries.length - needsFetch.length} from cache)...`);

    const newlyCached: { spotify_id: string; top_tracks: string[] }[] = [];
    for (let i = 0; i < needsFetch.length; i += 5) {
      const batch = needsFetch.slice(i, i + 5);
      const results2 = await Promise.all(
        batch.map(async ([name, id]) => ({
          name,
          id,
          songs: await fetchArtistTopTracks(id, searchToken),
        }))
      );
      results2.forEach(({ name, id, songs }) => {
        if (songs.length > 0) {
          artistTopSongs[name] = songs;
          newlyCached.push({ spotify_id: id, top_tracks: songs });
        }
      });
    }

    if (newlyCached.length > 0) {
      const { error: tracksErr } = await supabase
        .from('artists')
        .upsert(newlyCached, { onConflict: 'spotify_id' });
      if (tracksErr) console.log('[scraper] Warning: could not cache top tracks:', tracksErr.message);
      else console.log(`[scraper] ${city}: cached top tracks for ${newlyCached.length} new artists`);
    }

    console.log(`[scraper] ${city}: top songs fetched for ${Object.keys(artistTopSongs).length} artists`);
  }

  const venues = results.map((r) => ({
    id: r.venueId,
    name: r.venueName !== r.venueId ? r.venueName : null,
  }));

  const payload = { shows: allShows, venues, artistTopSongs, scrapedAt: new Date().toISOString() };

  // Write to generic shows_cache keyed by city
  const { error: cacheErr } = await supabase
    .from('shows_cache')
    .upsert({ city, data: payload, updated_at: new Date().toISOString() }, { onConflict: 'city' });

  if (cacheErr) console.error(`[scraper] shows_cache upsert error for ${city}:`, cacheErr.message);
  else console.log(`[scraper] ${city}: saved ${allShows.length} shows across ${results.length} venues`);

  // Also keep atlanta_shows_cache in sync for backward compatibility
  if (city === 'Atlanta') {
    const { error: legacyErr } = await supabase
      .from('atlanta_shows_cache')
      .upsert({ id: 1, data: payload, updated_at: new Date().toISOString() });
    if (legacyErr) console.error('[scraper] atlanta_shows_cache upsert error:', legacyErr.message);
  }
}

async function main() {
  console.log('[scraper] Starting multi-city venues scrape...');

  const cities = await loadAllCityVenues();

  // Use the first venue of the first city to bootstrap Playwright tokens
  const firstCity = cities[0];
  const BOOTSTRAP_VENUE = firstCity.venueIds[0];
  const { tokens, venueResult: bootstrapResult } = await captureTokensViaPlaywright(BOOTSTRAP_VENUE);

  if (!tokens) {
    console.error('[scraper] Failed to capture Spotify tokens via Playwright');
    process.exit(1);
  }

  const searchToken = await getClientCredentialsToken();

  for (const { city, venueIds } of cities) {
    await scrapeCity(city, venueIds, tokens, bootstrapResult, BOOTSTRAP_VENUE, searchToken);
  }

  console.log('\n[scraper] All cities done.');
}

main().catch((err) => {
  console.error('[scraper] Fatal error:', err);
  process.exit(1);
});
