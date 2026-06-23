require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const { sql } = require('@vercel/postgres');
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
const refreshRoute = require('./refresh');
const crypto = require('crypto');

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

// Spotify web-player client ID (public, used by open.spotify.com)
const SP_WP_CLIENT_ID = 'd8a5ed958d274c2e8ee717e6a4b0971d';
const SP_WP_VERSION   = '1.2.93.531.g966e7504';

let webTokenCache: { clientToken: string; accessToken: string; expiresAt: number } | null = null;

async function getSpotifyWebToken(): Promise<{ clientToken: string; accessToken: string } | null> {
    if (webTokenCache && Date.now() < webTokenCache.expiresAt - 60000) {
        return webTokenCache;
    }
    try {
        const clientRes = await axios.post('https://clienttoken.spotify.com/v1/clienttoken', {
            client_data: {
                client_version: SP_WP_VERSION,
                client_id: SP_WP_CLIENT_ID,
                js_sdk_data: {
                    device_brand: 'unknown', device_model: 'unknown',
                    os: 'windows', os_version: 'NT 10.0',
                    device_id: crypto.randomUUID(),
                    device_type: 'computer',
                }
            }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Origin': 'https://open.spotify.com',
                'Referer': 'https://open.spotify.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
            },
            timeout: 10000,
        });

        const clientToken = clientRes.data.granted_token?.token;
        if (!clientToken) {
            console.log('[atlanta] clienttoken response:', JSON.stringify(clientRes.data).slice(0, 200));
            return null;
        }

        const tokenRes = await axios.get(
            'https://open.spotify.com/get_access_token',
            {
                params: {
                    reason: 'transport',
                    productType: 'web_player'
                },
                headers: {
                    'Client-Token': clientToken,
                    'Origin': 'https://open.spotify.com',
                    'Referer': 'https://open.spotify.com/',
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        const accessToken = tokenRes.data.accessToken;
        const expiresAt  = tokenRes.data.accessTokenExpirationTimestampMs || (Date.now() + 3600000);
        if (!accessToken) {
            console.log('[atlanta] get_access_token response:', JSON.stringify(tokenRes.data).slice(0, 200));
            return null;
        }

        console.log(`[atlanta] web token obtained, isAnonymous=${tokenRes.data.isAnonymous}`);
        webTokenCache = { clientToken, accessToken, expiresAt };
        return webTokenCache;
    } catch (err: any) {
        console.error('[atlanta] getSpotifyWebToken error:', err.response?.status, err.message);
        return null;
    }
}

// Try Spotify's partner GraphQL API for venue concert data
async function tryPartnerApi(venueId: string, accessToken: string, clientToken: string): Promise<VenueResult | null> {
    const venueUri = `spotify:venue:${venueId}`;
    try {
        const variables = JSON.stringify({ uri: venueUri });
        const extensions = JSON.stringify({
            persistedQuery: { version: 1, sha256Hash: '9e6ba7d6dd9b65a4fdd0493e1e5e63cbdf6f78c2e0e30e4a9fc97498f95ab9e0' }
        });
        const resp = await axios.get('https://api-partner.spotify.com/pathfinder/v1/query', {
            params: { operationName: 'queryVenuePage', variables, extensions },
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Client-Token': clientToken,
                'Accept': 'application/json',
                'app-platform': 'WebPlayer',
                'spotify-app-version': SP_WP_VERSION,
            },
            timeout: 12000,
        });

        const d = resp.data?.data;
        console.log(`[atlanta] partnerApi ${venueId}: keys=${Object.keys(d || {}).join(',')}`);

        const venueData = d?.venueByUri || d?.venue || null;
        if (!venueData) return null;

        const venueName = venueData.name || venueId;
        const concerts = venueData.upcomingConcerts?.items || venueData.concerts?.items || [];
        const shows: Show[] = [];
        concerts.forEach((c: any) => {
            const datetime = c.startDateTime || c.startDate || c.date;
            const artist = c.title || c.name || c.artists?.items?.[0]?.profile?.name || c.artist?.name;
            if (datetime && artist) shows.push({ datetime, artist, venue: venueName, venueId });
        });

        return { venueId, venueName, shows };
    } catch (err: any) {
        console.log(`[atlanta] partnerApi ${venueId}: ${err.response?.status || err.message}`);
        return null;
    }
}

// Try Spotify's spclient API with whatever access token we have
async function trySpClient(venueId: string, accessToken: string, clientToken?: string): Promise<VenueResult | null> {
    const venueUri = encodeURIComponent(`spotify:venue:${venueId}`);
    const endpoints = [
        `concert-view/v2/page?uri=${venueUri}&market=US&locale=en`,
        `concert-discovery-view/v2/view?uri=${venueUri}`,
    ];
    const headers: any = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'app-platform': 'WebPlayer',
        'spotify-app-version': SP_WP_VERSION,
    };
    if (clientToken) headers['Client-Token'] = clientToken;

    for (const ep of endpoints) {
        try {
            const resp = await axios.get(`https://spclient.wg.spotify.com/${ep}`, { headers, timeout: 10000 });
            const d = resp.data;
            console.log(`[atlanta] spclient ${ep.split('?')[0]} ${venueId}: status=${resp.status} keys=${Object.keys(d || {}).join(',')}`);

            const venueName = d?.name || d?.venue?.name || venueId;
            const items: any[] = d?.concerts?.items || d?.events?.items || [];
            const shows: Show[] = [];
            items.forEach((item: any) => {
                const datetime = item.startDateTime || item.startDate || item.date;
                const artist = item.title || item.name || item.artists?.[0]?.name;
                if (datetime && artist) shows.push({ datetime, artist, venue: venueName, venueId });
            });

            if (shows.length > 0 || venueName !== venueId) return { venueId, venueName, shows };
        } catch (err: any) {
            console.log(`[atlanta] spclient ${ep.split('?')[0]} ${venueId}: ${err.response?.status || err.message}`);
        }
    }
    return null;
}

// Try Spotify's partner GraphQL v2 API (discovered from web player network inspection)
async function tryPartnerApiV2(venueId: string, tokens?: { accessToken: string; clientToken: string }): Promise<VenueResult | null> {
    const venueUri = `spotify:venue:${venueId}`;
    const body = {
        operationName: 'venue',
        variables: { uri: venueUri, offset: 0, limit: 20 },
        extensions: {
            persistedQuery: {
                version: 1,
                sha256Hash: '9a9e12f916cab5b797b29604fe90d64924d25e55b5696943d4cac00c03644ab9',
            },
        },
    };

    const baseHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'app-platform': 'WebPlayer',
        'spotify-app-version': SP_WP_VERSION,
    };

    // Try with auth first; if rejected, retry without auth headers
    const headerSets: Record<string, string>[] = tokens
        ? [
            { ...baseHeaders, Authorization: `Bearer ${tokens.accessToken}`, 'Client-Token': tokens.clientToken },
            { ...baseHeaders },
          ]
        : [baseHeaders];

    for (const headers of headerSets) {
        try {
            const resp = await axios.post(
                'https://api-partner.spotify.com/pathfinder/v2/query',
                body,
                { headers, timeout: 12000 },
            );

            const venueData = resp.data?.data?.venue;
            if (!venueData) {
                console.log(`[atlanta] partnerV2 ${venueId}: no venue field in response`);
                return null;
            }

            const venueName = venueData.name || venueId;
            const concerts: any[] = venueData.concerts?.items || [];
            const shows: Show[] = [];

            concerts.forEach((c: any) => {
                const datetime = c.startDatetime || c.startDateTime || c.date;
                const artists: any[] = c.artists || [];
                const artist = artists[0]?.name || c.title || c.name;
                if (datetime && artist) shows.push({ datetime, artist, venue: venueName, venueId });
            });

            console.log(`[atlanta] partnerV2 ${venueId}: name="${venueName}" shows=${shows.length}`);
            return { venueId, venueName, shows };
        } catch (err: any) {
            const status = err.response?.status;
            console.log(`[atlanta] partnerV2 ${venueId}: ${status || err.message}`);
            // Only retry without auth on auth errors; otherwise stop
            if (status !== 401 && status !== 403) return null;
        }
    }
    return null;
}

// Fetch the venue page HTML using a Spotify access token for auth
async function fetchVenueHtml(venueId: string): Promise<VenueResult | null> {
    try {
        const resp = await axios.get(
            `https://open.spotify.com/venue/${venueId}`,
            {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 20000
            }
        );

        console.log(
            `[atlanta] html ${venueId} status=${resp.status}`
        );

        const $ = cheerio.load(resp.data);

        if (venueId === '0HUd3zYwg7drRMeKHI7hOX') {

            const html = resp.data;

            const match = html.match(/.{0,500}api-partner\.spotify\.com.{0,1500}/s);
            console.log(match?.[0]);

            const regex = /https?:\/\/[^"']+/g;
            const urls = html.match(regex) || [];
            console.log(urls.filter(u => u.includes("spotify")));
            
            $('script[src]').each((_, el) => {
                console.log($(el).attr('src'));
            });
        }

        const venueName =
            $('[data-testid="entityTitle"] h1').first().text().trim() ||
            ($('meta[property="og:title"]').attr('content') || '').replace(/\s*\|\s*Spotify\s*$/i, '').trim() ||
            $('title').text().replace(/\s*\|\s*Spotify\s*$/i, '').replace(/^Spotify\s*$/i, '').trim() ||
            venueId;

        const shows: Show[] = [];
        $('a[data-testid="concert-card"]').each((_, card) => {
            const $card = $(card);
            const datetime = $card.find('time[datetime]').attr('datetime') || '';
            const artist = $card.find('h3').text().trim();
            if (datetime && artist) shows.push({ datetime, artist, venue: venueName, venueId });
        });

        console.log(`[atlanta] html ${venueId}: name="${venueName}" shows=${shows.length}`);
        if (shows.length > 0 || venueName !== venueId) return { venueId, venueName, shows };
    } catch (err: any) {
        console.log(`[atlanta] html ${venueId}: ${err.response?.status || err.message}`);
    }
    return null;
}

async function getVenueData(
    venueId: string,
    userAccessToken?: string,
    tokens?: { clientToken:string; accessToken:string } | null
) {
    const partnerResult = await tryPartnerApiV2(venueId, tokens ?? undefined);
    if (partnerResult) return partnerResult;

    const htmlResult = await fetchVenueHtml(venueId);
    if (htmlResult) return htmlResult;

    return { venueId, venueName: venueId, shows: [] };
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

    const userAccessToken = req.cookies.spotifyAccessToken as string | undefined;

    try {
        const results: VenueResult[] = [];
        const tokens = (await getSpotifyWebToken()) ?? undefined;
        for (let i = 0; i < ATLANTA_VENUE_IDS.length; i += 5) {
            const batch = ATLANTA_VENUE_IDS.slice(i, i + 5);
            const batchResults = await Promise.all(batch.map(id => getVenueData(id, userAccessToken, tokens)));
            results.push(...batchResults);
        }

        const allShows = results.flatMap(r => r.shows);
        allShows.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

        // Always return all venue IDs; use ID as fallback name so the filter works
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


