require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
const refreshRoute = require('./refresh');

app.use(cookieParser());
app.use(bodyParser.json());

app.use('/api/refresh', refreshRoute);        // Refresh route

// Create application/x-www-form-urlencoded parser
const urlencodedParser = bodyParser.urlencoded({ extended: false });

app.get('/api/config', (req, res) => {
    res.json({
        client_id: process.env.SPOTIFY_CLIENT_ID,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        or_key: process.env.OPENROUTER_KEY,
        groq_key: process.env.GROQ_KEY
    });
});

app.use(express.static(path.join(__dirname, '..', 'public'))); // Serve static files

// Route for serving home.htm
app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, '..', 'components', 'home.htm'));
});

app.get('/callback', async function (req, res) {
    const code = req.query.code as string;
    const error = req.query.error as string;

    if (error) {
        return res.redirect('/?error=' + encodeURIComponent(error));
    }
    if (!code) {
        return res.sendFile(path.join(__dirname, '..', 'components', 'callback.htm'));
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri!);

    try {
        const tokenRes = await axios.post('https://accounts.spotify.com/api/token', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
            }
        });

        const { access_token, refresh_token, expires_in } = tokenRes.data;
        res.cookie('spotifyAccessToken', access_token, { maxAge: expires_in * 1000, path: '/' });
        if (refresh_token) {
            res.cookie('spotifyRefreshToken', refresh_token, { maxAge: 30 * 24 * 60 * 60 * 1000, path: '/' });
        }
        res.redirect('/dashboard');
    } catch (err: any) {
        console.error('Token exchange failed:', err.response?.data || err.message);
        res.redirect('/?error=token_exchange_failed');
    }
});

interface Track {
  track: string;
  artist: string;
}

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

let atlantaCache: { data: any; fetchedAt: number } | null = null;
const ATLANTA_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const SP_WP_VERSION = '1.2.93.577.g601a69db';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// In-memory token cache — Spotify bearer tokens last ~1 hour
let browserTokenCache: { accessToken: string; clientToken: string; expiresAt: number } | null = null;

function parseVenueApiResponse(venueData: any, venueId: string): VenueResult {
    const venueName = venueData.name || venueId;
    const shows: Show[] = [];
    const concerts: any[] = venueData.concerts?.items || [];

    concerts.forEach((c: any) => {
        // The API wraps each concert in a { data: {...} } envelope
        const d = c.data || c;
        const datetime = d.startDateIsoString || d.startDate;
        const artistItems: any[] = d.artists?.items || [];
        const artist = artistItems[0]?.data?.profile?.name || d.title;
        const venue = d.location?.name || venueName;
        if (datetime && artist) shows.push({ datetime, artist, venue, venueId });
    });

    return { venueId, venueName, shows };
}

// Launches a headless browser, navigates to a Spotify venue page, and intercepts:
//   - the auth headers (Bearer + client-token) from outgoing requests
//   - the venue JSON from the api-partner response
// Returns the captured tokens (reusable for all other venues via axios) and the
// venue data for the page we loaded.
async function fetchOneVenueViaPlaywright(venueId: string): Promise<{
    tokens: { accessToken: string; clientToken: string } | null;
    venueResult: VenueResult | null;
}> {
    if (browserTokenCache && Date.now() < browserTokenCache.expiresAt - 60000) {
        console.log('[playwright] reusing cached tokens');
        return { tokens: browserTokenCache, venueResult: null };
    }

    let pw: any;
    let chromiumPkg: any;
    try {
        pw = require('playwright-core');
        chromiumPkg = require('@sparticuz/chromium');
    } catch {
        console.error('[playwright] playwright-core or @sparticuz/chromium not available');
        return { tokens: null, venueResult: null };
    }

    console.log(`[playwright] launching browser for venue ${venueId}`);
    const browser = await pw.chromium.launch({
        executablePath: await chromiumPkg.executablePath(),
        args: chromiumPkg.args,
        headless: true,
    });
    try {
        const context = await browser.newContext({
            userAgent: UA,
            locale: 'en-US',
            extraHTTPHeaders: { 'accept-language': 'en' },
        });
        const page = await context.newPage();

        let capturedTokens: { accessToken: string; clientToken: string } | null = null;
        let capturedVenueData: any = null;

        page.on('request', (request: any) => {
            console.log('REQ', request.url());
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

        page.on('response', async (response: any) => {
            console.log('RESP', response.url());
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
            timeout: 45000,
        });

        await page.waitForTimeout(5000);

        if (capturedTokens) {
            // Cache for slightly less than the token's 1-hour lifetime
            browserTokenCache = { ...capturedTokens, expiresAt: Date.now() + 50 * 60 * 1000 };
        }

        const venueResult = capturedVenueData
            ? parseVenueApiResponse(capturedVenueData, venueId)
            : null;

        console.log(`[playwright] ${venueId}: tokens=${!!capturedTokens} venueData=${!!capturedVenueData}`);
        return { tokens: capturedTokens, venueResult };
    } finally {
        await browser.close();
    }
}

// Fetches a single venue via the partner API using tokens captured by Playwright
async function tryPartnerApiV2(venueId: string, tokens: { accessToken: string; clientToken: string }): Promise<VenueResult | null> {
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
            },
        );

        const venueData = resp.data?.data?.venue;
        if (!venueData) {
            console.log(`[atlanta] partnerV2 ${venueId}: no venue in response`);
            return null;
        }

        const result = parseVenueApiResponse(venueData, venueId);
        console.log(`[atlanta] partnerV2 ${venueId}: "${result.venueName}" shows=${result.shows.length}`);
        return result;
    } catch (err: any) {
        console.log(`[atlanta] partnerV2 ${venueId}: ${err.response?.status || err.message}`);
        return null;
    }
}

async function getVenueData(
    venueId: string,
    tokens: { accessToken: string; clientToken: string }
): Promise<VenueResult> {
    const result = await tryPartnerApiV2(venueId, tokens);
    return result ?? { venueId, venueName: venueId, shows: [] };
}

app.get('/auto-playlist', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'components', 'autoPlaylist.htm'));
});

app.get('/ai-dj', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'components', 'aiDj.htm'));
});

app.get('/atlanta-shows', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'components', 'atlantaShows.htm'));
});

app.get('/api/atlanta-shows', async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    if (!forceRefresh && atlantaCache && Date.now() - atlantaCache.fetchedAt < ATLANTA_CACHE_TTL) {
        return res.json(atlantaCache.data);
    }

    try {
        const results: VenueResult[] = [];

        // Use Playwright on the first venue to get real browser tokens + that venue's data
        const BOOTSTRAP_VENUE = ATLANTA_VENUE_IDS[0];
        const { tokens, venueResult: firstResult } = await fetchOneVenueViaPlaywright(BOOTSTRAP_VENUE);

        if (firstResult) results.push(firstResult);

        if (!tokens) {
            console.error('[atlanta] Playwright failed to capture tokens — no data available');
            return res.status(500).json({ error: 'Failed to capture Spotify tokens', shows: [], venues: [] });
        }

        // Fetch all remaining venues with the captured tokens via axios (much faster than more browser pages)
        const remaining = firstResult ? ATLANTA_VENUE_IDS.slice(1) : ATLANTA_VENUE_IDS;
        for (let i = 0; i < remaining.length; i += 5) {
            const batch = remaining.slice(i, i + 5);
            const batchResults = await Promise.all(batch.map(id => getVenueData(id, tokens)));
            results.push(...batchResults);
        }

        const allShows = results.flatMap(r => r.shows);
        allShows.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

        const venues = results.map(r => ({
            id: r.venueId,
            name: r.venueName !== r.venueId ? r.venueName : null,
        }));

        const data = { shows: allShows, venues, scrapedAt: new Date().toISOString() };
        atlantaCache = { data, fetchedAt: Date.now() };

        res.json(data);
    } catch (err: any) {
        console.error('[atlanta] endpoint error:', err.message);
        res.status(500).json({ error: 'Failed to fetch shows', shows: [], venues: [] });
    }
});

app.get('/api/scape-html-only', async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing URL');

    try {
        const response = await axios.get(url);
        res.setHeader('Content-Type', 'text/plain');
        res.send(response.data); // This is the raw HTML as a string
    } catch (err) {
        console.error('Error fetching URL:', err);
        res.status(500).send('Failed to fetch URL');
    }
});

app.get('/api/scrape-html-tracks', async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing URL');

    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        // Extract title
        const rawTitle = $('title').text().trim();
        const playlistName = rawTitle.replace('| Spotify Playlist', '').trim(); // Clean it up

        // Extract tracks
        const trackLinks: string[] = [];
        $('meta[name="music:song"]').each((_, el) => {
            const link = $(el).attr('content');
            if (link) trackLinks.push(link);
        });

        if (trackLinks.length === 0) {
            return res.status(404).send('No tracks found in the playlist');
        }

        res.status(200).json({ playlistName, trackLinks });
    } catch (err) {
        console.error('Download error:', err);
        res.status(500).send('Failed to fetch playlist');
    }
});

app.get('/api/test-discover', async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing URL');

    try {
        const response = await axios.get(url);
        // const $ = cheerio.load(response.data);

        res.setHeader('Content-Type', 'text/plain');
        res.send(response.data); // This is the raw HTML as a string
    } catch (err) {
        console.error('Download error:', err);
        res.status(500).send('Failed to fetch playlist');
    }
});

app.get('/api/ai-dj-test-button', async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing URL');

    try {
        const response = await axios.get(url);
        // const $ = cheerio.load(response.data);

        res.setHeader('Content-Type', 'text/plain');
        res.send(response.data); // This is the raw HTML as a string
    } catch (err) {
        console.error('Download error:', err);
        res.status(500).send('Failed to fetch playlist');
    }
});

app.get('/api/chartmetric-search', async (req, res) => {
    const artistName = req.query.artist as string;
    if (!artistName) return res.status(400).send('Missing artist');

    const apiKey = process.env.GOOGLE_KEY;
    const cx = process.env.GOOGLE_SEARCH_KEY;
    const query = `${artistName} site:chartmetric.com/artist`;

    try {
        const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: {
                key: apiKey,
                cx: cx,
                q: query
            }
        });
        const firstResult = response.data.items?.[0]?.link || null;
        res.json({ url: firstResult });
    } catch (err) {
        console.error('Google Search error:', err);
        res.status(500).send('Search failed');
    }
});

app.get('/api/scrape', function (req, res) {
  console.log("here for scrape.")
  const url = req.query.url;
  if (!url) {
      return res.status(400).send('URL parameter is missing');
  }

  console.log("Scraping:", url);

  axios.get(url).then(async response => {
      const $ = cheerio.load(response.data);

      // Extract title
      const rawTitle = $('title').text().trim();
      const playlistName = rawTitle.replace('| Spotify Playlist', '').trim(); // Clean it up

      // Extract tracks
      const tracks: Track[] = [];
      $('div.Box__BoxComponent-sc-y4nds-0').each((_, el) => {
          const trackName = $(el).find('span.ListRowTitle__LineClamp-sc-1xe2if1-0').text().trim();
          const artistName = $(el).find('p.ListRowDetails__ListRowDetailText-sc-sozu4l-0').text().trim();
          if (trackName && artistName) {
              tracks.push({ track: trackName, artist: artistName });
          }
      });

      if (tracks.length === 0) {
          return res.status(404).send('No tracks found in the playlist');
      }

      res.status(200).json({ playlistName, tracks });

  }).catch(error => {
      console.log('Scrape error:', error);
      res.status(500).send('Scrape failed');
  });
});

app.get('/api/me', (req, res) => {
  const accessToken = req.cookies.spotifyAccessToken;
  if (!accessToken) return res.status(401).send('Unauthorized');
  fetch('https://api.spotify.com/v1/me', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  })
  .then(response => response.json())
  .then(data => res.json(data))
  .catch(err => {
    console.error(err);
    res.status(500).send('Error fetching user data');
  });
});

app.get('/dashboard', function (req, res) {
    const accessToken = req.cookies.spotifyAccessToken;
    // const token = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
    // console.log(accessToken);
    
    if (accessToken) {
      fetch('https://api.spotify.com/v1/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      .then(async response => {
        console.log("Status:", response.status);
        if (!response.ok) {
          const text = await response.text(); // In case it's not JSON
          console.error("Spotify API error:", text);
          return;
        }
        const data = await response.json();
        console.log("User Data:", data);
        
        res.sendFile(path.join(__dirname, '..', 'components', 'dashboard.htm'));
          
      })
      .catch(error => {
        console.error('Error fetching user data:', error);
        res.send('Error fetching user data');
      });
    } else {
      res.send('You are not logged in.');
    }
  });
  
  
  

// app.listen(3001, () => console.log('Server ready on port 3001.'));

module.exports = app;


