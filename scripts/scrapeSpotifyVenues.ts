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
];

const SP_WP_VERSION = '1.2.93.577.g601a69db';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

interface Show {
  datetime: string;
  artist: string;
  venue: string;
  venueId: string;
}

interface VenueResult {
  venueId: string;
  venueName: string;
  shows: Show[];
}

function parseVenueApiResponse(venueData: any, venueId: string): VenueResult {
  const venueName = venueData.name || venueId;
  const shows: Show[] = [];
  const concerts: any[] = venueData.concerts?.items || [];

  concerts.forEach((c: any) => {
    const d = c.data || c;
    const datetime = d.startDateIsoString || d.startDate;
    const artistItems: any[] = d.artists?.items || [];
    const artist = artistItems[0]?.data?.profile?.name || d.title;
    const venue = d.location?.name || venueName;
    if (datetime && artist) shows.push({ datetime, artist, venue, venueId });
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
