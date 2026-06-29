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
  '0HUd3zYwg7drRMeKHI7hOX',
  '56w6Uns7gENOQdP7e99k0S',
  '3YU5ZqMJOchPbG7DEZEZcF',
  '6CgzpPmHJFo3nTNyyj1iTH',
  '2pjdYXAB3zHcuY8yUjAKAE',
  '4eM6foMcJdCgMYKUQBi1E3',
  '7EGBn6qZP7ngRny9nQsHB9',
  '6VgXO4NJiX6ygWDjhDWsL9',
  '4EriXwnDOckm52Gt46jUx2',
  '4QJGQpVyqnLgHtolgCp7gL',
  '1yeWzqcdpKUnHmZMUOa9Ma',
  '3LEHQ0zFPAkNcm21GC4rE1',
  '07xImrFVCTJg8SzUu3cxXw',
  '3z4ioL0RWXvTqRW45P94dz',
  '15ZsLTvybmVMZcQ6ynJ1Wd',
  '0IYFqOtJaNVJpj2sgaRwKo',
  '6CViqzavVGQk0O9Lukx5Pd',
  '01BO8Btvq2dWdQqvIKjTgU',
  '0uzzDQsAY48qKMeseh3w5N',
  '4vD9OzCEMMTnxJkAbXuJMM',
  '0RO73kiZJcbnntnICnPhnP',
  '4uuxBkCxJkvMLxjnC7x8lW',
  '5lJumEpnjrp9sZcIukIsBN',
  '6CViqzavVGQk0O9Lukx5Pd', // Center Stage Theater
  '20mbxU8VsErIgAYlrKxPCQ', // Masquerade - Heaven
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

async function main() {
  console.log('[scraper] Starting Atlanta venues scrape...');

  const BOOTSTRAP_VENUE = ATLANTA_VENUE_IDS[0];
  const { tokens, venueResult: firstResult } = await captureTokensViaPlaywright(BOOTSTRAP_VENUE);

  if (!tokens) {
    console.error('[scraper] Failed to capture Spotify tokens via Playwright');
    process.exit(1);
  }

  const results: VenueResult[] = [];
  if (firstResult) results.push(firstResult);

  const remaining = firstResult ? ATLANTA_VENUE_IDS.slice(1) : ATLANTA_VENUE_IDS;
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

  // Collect artist IDs already embedded in shows from the partner API URIs
  const artistIdFromApi = new Map<string, string>();
  allShows.forEach((show) => {
    show.artists.forEach((name, idx) => {
      const id = show.spotifyArtistIds?.[idx];
      if (id) artistIdFromApi.set(name, id);
    });
  });

  // Upsert partner-API-sourced artist IDs into Supabase
  if (artistIdFromApi.size > 0) {
    const toUpsert = Array.from(artistIdFromApi.entries()).map(([name, spotify_id]) => ({ name, spotify_id }));
    const { error: upsertErr } = await supabase.from('artists').upsert(toUpsert, { onConflict: 'name' });
    if (upsertErr) {
      console.log('[scraper] Warning: could not upsert API artist IDs:', upsertErr.message);
    } else {
      console.log(`[scraper] Upserted ${toUpsert.length} artists from partner API`);
    }
  }

  // For artists whose ID wasn't in the partner API response (title-fallback cases), search Spotify
  const allArtistNames = [...new Set(allShows.flatMap((s) => s.artists))];
  const stillMissing = allArtistNames.filter(name => !artistIdFromApi.has(name));
  const searchToken = await getClientCredentialsToken();
  if (searchToken && stillMissing.length > 0) {
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

  const resolved = allShows.filter((s) => s.spotifyArtistIds?.some((id) => id !== null)).length;
  console.log(`[scraper] ${resolved}/${allShows.length} shows have at least one Spotify artist ID`);

  const venues = results.map((r) => ({
    id: r.venueId,
    name: r.venueName !== r.venueId ? r.venueName : null,
  }));

  const payload = { shows: allShows, venues, scrapedAt: new Date().toISOString() };

  const { error } = await supabase
    .from('atlanta_shows_cache')
    .upsert({ id: 1, data: payload, updated_at: new Date().toISOString() });

  if (error) {
    console.error('[scraper] Supabase upsert error:', error.message);
    process.exit(1);
  }

  console.log(`[scraper] Done — ${allShows.length} shows across ${results.length} venues`);
}

main().catch((err) => {
  console.error('[scraper] Fatal error:', err);
  process.exit(1);
});
