require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
const refreshRoute = require('./refresh');

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

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
    if (!supabase) {
        return res.status(503).json({ error: 'Supabase not configured', shows: [], venues: [] });
    }
    try {
        const { data, error } = await supabase
            .from('atlanta_shows_cache')
            .select('data, updated_at')
            .eq('id', 1)
            .single();

        if (error || !data) {
            return res.status(503).json({ error: 'No cached data available', shows: [], venues: [] });
        }

        res.json(data.data);
    } catch (err: any) {
        console.error('[atlanta] error reading from Supabase:', err.message);
        res.status(500).json({ error: 'Failed to read cached shows', shows: [], venues: [] });
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


