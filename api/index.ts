require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
const refreshRoute = require('./refresh');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(cookieParser());
app.use(bodyParser.json());

app.use('/api/refresh', refreshRoute);        // Refresh route

// Create application/x-www-form-urlencoded parser
const urlencodedParser = bodyParser.urlencoded({ extended: false });

function requireSpotifyAuth(req: any, res: any, next: any) {
    if (!req.cookies.spotifyAccessToken) {
        return res.redirect('/');
    }
    next();
}

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
        res.redirect('/upcoming-shows');
    } catch (err: any) {
        console.error('Token exchange failed:', err.response?.data || err.message);
        res.redirect('/?error=token_exchange_failed');
    }
});

interface Track {
  track: string;
  artist: string;
}

app.get('/auto-playlist', requireSpotifyAuth, function (req: any, res: any) {
  res.sendFile(path.join(__dirname, '..', 'components', 'autoPlaylist.htm'));
});

app.get('/ai-dj', requireSpotifyAuth, function (req: any, res: any) {
  res.sendFile(path.join(__dirname, '..', 'components', 'aiDj.htm'));
});

app.get('/atlanta-shows', requireSpotifyAuth, function (req: any, res: any) {
  res.redirect('/upcoming-shows');
});

app.get('/upcoming-shows', requireSpotifyAuth, function (req: any, res: any) {
  res.sendFile(path.join(__dirname, '..', 'components', 'atlantaShows.htm'));
});

app.post('/api/cache-artist-id', async (req, res) => {
    const { name, spotifyId } = req.body;
    if (!name || !spotifyId) return res.status(400).json({ error: 'Missing name or spotifyId' });

    const { error } = await supabase
        .from('artists')
        .upsert({ name, spotify_id: spotifyId }, { onConflict: 'name' });

    if (error) {
        console.error('[cache-artist-id] Supabase error:', error.message);
        return res.status(500).json({ error: 'Failed to cache artist ID' });
    }

    res.json({ ok: true });
});

app.get('/api/shows/:city', async (req, res) => {
    const city = decodeURIComponent(req.params.city);
    try {
        const { data, error } = await supabase
            .from('shows_cache')
            .select('data, updated_at')
            .eq('city', city)
            .single();

        if (error || !data) {
            return res.status(503).json({ error: 'No cached data available', shows: [], venues: [] });
        }

        res.json((data as any).data);
    } catch (err: any) {
        console.error(`[shows/${city}] error reading from Supabase:`, err.message);
        res.status(500).json({ error: 'Failed to read cached shows', shows: [], venues: [] });
    }
});

// Legacy route — reads from shows_cache for Atlanta (falls back to atlanta_shows_cache)
app.get('/api/atlanta-shows', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('shows_cache')
            .select('data, updated_at')
            .eq('city', 'Atlanta')
            .single();

        if (!error && data) return res.json((data as any).data);

        // fallback to old table
        const { data: legacy, error: legacyErr } = await supabase
            .from('atlanta_shows_cache')
            .select('data, updated_at')
            .eq('id', 1)
            .single();

        if (legacyErr || !legacy) {
            return res.status(503).json({ error: 'No cached data available', shows: [], venues: [] });
        }

        res.json((legacy as any).data);
    } catch (err: any) {
        console.error('[atlanta] error reading from Supabase:', err.message);
        res.status(500).json({ error: 'Failed to read cached shows', shows: [], venues: [] });
    }
});

// ── City / venue configuration ──────────────────────────────────────────────

const ATLANTA_DEFAULT_VENUES = [
  { id: '56w6Uns7gENOQdP7e99k0S', name: 'Buckhead Theatre' },
  { id: '3YU5ZqMJOchPbG7DEZEZcF', name: '529 Bar EAV' },
  { id: '6CgzpPmHJFo3nTNyyj1iTH', name: 'Aisle 5' },
  { id: '2pjdYXAB3zHcuY8yUjAKAE', name: 'The EARL' },
  { id: '4eM6foMcJdCgMYKUQBi1E3', name: 'Variety Playhouse' },
  { id: '7EGBn6qZP7ngRny9nQsHB9', name: 'Coca-Cola Roxy' },
  { id: '6VgXO4NJiX6ygWDjhDWsL9', name: 'Fox Theatre' },
  { id: '4EriXwnDOckm52Gt46jUx2', name: 'MadLife Stage & Studios' },
  { id: '4QJGQpVyqnLgHtolgCp7gL', name: 'eyedrum' },
  { id: '1yeWzqcdpKUnHmZMUOa9Ma', name: 'The Eastern' },
  { id: '3LEHQ0zFPAkNcm21GC4rE1', name: "Eddie's Attic" },
  { id: '07xImrFVCTJg8SzUu3cxXw', name: 'Culture Shock' },
  { id: '3z4ioL0RWXvTqRW45P94dz', name: 'Tabernacle' },
  { id: '15ZsLTvybmVMZcQ6ynJ1Wd', name: 'The Drunken Unicorn' },
  { id: '0IYFqOtJaNVJpj2sgaRwKo', name: 'The Loft' },
  { id: '01BO8Btvq2dWdQqvIKjTgU', name: 'Terminal West' },
  { id: '0uzzDQsAY48qKMeseh3w5N', name: 'Boggs Social & Supply' },
  { id: '4vD9OzCEMMTnxJkAbXuJMM', name: "Smith's Olde Bar" },
  { id: '0RO73kiZJcbnntnICnPhnP', name: 'The Third Door' },
  { id: '5lJumEpnjrp9sZcIukIsBN', name: 'The Garden Club at Wild Heaven West End' },
  { id: '6CViqzavVGQk0O9Lukx5Pd', name: 'Center Stage Theater / Vinyl' },
  { id: '4uuxBkCxJkvMLxjnC7x8lW', name: 'Masquerade - Altar' },
  { id: '20mbxU8VsErIgAYlrKxPCQ', name: 'Masquerade - Heaven' },
  { id: '0HUd3zYwg7drRMeKHI7hOX', name: 'Masquerade - Purgatory' },
  { id: '2Jdti0kwvrcMe9cxuoFjgq', name: 'Lakewood Amphitheatre' },
  { id: '0xoBSGCFuAXXyQd2ETHtTg', name: 'Chastain Park Amphitheatre' },
  { id: '06QO7xdSdeHQxiyVaUXKlZ', name: 'State Farm Arena' },
  { id: '79u4ZLSiG3YNHbMVMTDiWe', name: 'Believe Music Hall' },
  { id: '6c4bbdh0a10lPfoGvCVXcR', name: 'District Atlanta' },
  { id: '5gbgLdHRsuN9DR75eunIoT', name: 'Star Bar' },
  { id: '0Ypxi7KUWEcetzOr6jbR9U', name: 'Northside Tavern' },
  { id: '45r6C6zeL3PQ0fBteQDfbD', name: 'Blind Willies' },
  { id: '5sVth0DdbjgvsPjyHMyq6X', name: 'Atlanta Symphony Hall' },
  { id: '3uZPorjHCS6P60zebLFYFK', name: 'Ameris Bank Amphitheatre' },
  { id: '4MH5KNT29dI9jk5wesLf8m', name: 'Gas South Arena' },
  { id: '6JLAUDO8YiWIw7PZGLD5rU', name: 'Cobb Energy Performing Arts Centre' },
  { id: '3iX6U4lMbb9dyJfebip6PF', name: 'Mable House Barnes Amphitheatre' },
  { id: '1ojghBZoqCZgdqUAvofGMX', name: 'From the Earth Brewing' },
  { id: '2boxN5EsZK9QcT7cB8daDO', name: 'Avon Theater' },
];

app.get('/api/city-venues', async (req, res) => {
    let { data, error } = await supabase.from('city_venues').select('city, venues').order('city');
    if (error) return res.status(500).json({ error: error.message });

    if (!data || !(data as any[]).find((r: any) => r.city === 'Atlanta')) {
        await supabase.from('city_venues').upsert(
            { city: 'Atlanta', venues: ATLANTA_DEFAULT_VENUES },
            { onConflict: 'city', ignoreDuplicates: true }
        );
        const result = await supabase.from('city_venues').select('city, venues').order('city');
        data = result.data;
    }

    res.json(data || []);
});

app.post('/api/city-venues', async (req, res) => {
    const city: string = (req.body.city || '').trim();
    if (!city) return res.status(400).json({ error: 'Missing city' });
    const { error } = await supabase.from('city_venues').insert({ city, venues: [] });
    if (error) {
        const status = error.code === '23505' ? 409 : 500;
        return res.status(status).json({ error: error.message });
    }
    res.json({ ok: true });
});

app.post('/api/city-venues/:city/venues', async (req, res) => {
    const city = decodeURIComponent(req.params.city);
    const venueId: string = (req.body.venueId || '').trim();
    const name: string = (req.body.name || '').trim() || null;
    if (!venueId) return res.status(400).json({ error: 'Missing venueId' });

    const { data, error } = await supabase.from('city_venues').select('venues').eq('city', city).single();
    if (error || !data) return res.status(404).json({ error: 'City not found' });

    const venues: any[] = (data as any).venues || [];
    if (venues.find((v: any) => v.id === venueId)) return res.json({ ok: true, already: true });
    venues.push({ id: venueId, name });

    const { error: upErr } = await supabase.from('city_venues')
        .update({ venues, updated_at: new Date().toISOString() }).eq('city', city);
    if (upErr) return res.status(500).json({ error: upErr.message });
    res.json({ ok: true });
});

app.delete('/api/city-venues/:city/venues/:venueId', async (req, res) => {
    const city = decodeURIComponent(req.params.city);
    const venueId = decodeURIComponent(req.params.venueId);

    const { data, error } = await supabase.from('city_venues').select('venues').eq('city', city).single();
    if (error || !data) return res.status(404).json({ error: 'City not found' });

    const venues = ((data as any).venues as any[]).filter((v: any) => v.id !== venueId);
    const { error: upErr } = await supabase.from('city_venues')
        .update({ venues, updated_at: new Date().toISOString() }).eq('city', city);
    if (upErr) return res.status(500).json({ error: upErr.message });
    res.json({ ok: true });
});

app.post('/api/trigger-scrape', async (req, res) => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });

    try {
        await axios.post(
            'https://api.github.com/repos/irademos/spotify-express/actions/workflows/atlanta-shows.yml/dispatches',
            { ref: 'main' },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }
        );
        res.json({ ok: true });
    } catch (err: any) {
        const msg = err.response?.data?.message || err.message;
        res.status(500).json({ error: msg });
    }
});

// ────────────────────────────────────────────────────────────────────────────

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

app.get('/dashboard', requireSpotifyAuth, function (req: any, res: any) {
    res.sendFile(path.join(__dirname, '..', 'components', 'dashboard.htm'));
});

app.get('/join-beta', function (req: any, res: any) {
    res.sendFile(path.join(__dirname, '..', 'components', 'joinBeta.htm'));
});

app.post('/api/join-beta', async (req: any, res: any) => {
    const { fullName, email } = req.body;
    if (!fullName || !email) {
        return res.status(400).json({ error: 'Full name and email are required.' });
    }

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: 'shmawhoo@gmail.com',
        subject: 'New Beta Request — Spotify Tools',
        text: `New beta signup request:\n\nName: ${fullName}\nEmail: ${email}\n`,
        html: `<h2>New Beta Signup Request</h2><p><strong>Name:</strong> ${fullName}</p><p><strong>Email:</strong> ${email}</p>`,
    };

    try {
        await transporter.sendMail(mailOptions);
        res.json({ ok: true });
    } catch (err: any) {
        console.error('[join-beta] Email error:', err.message);
        res.status(500).json({ error: 'Failed to send request. Please try again.' });
    }
});
  
  
  

// app.listen(3001, () => console.log('Server ready on port 3001.'));

module.exports = app;


