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

app.get('/callback', function (req, res) {
    res.sendFile(path.join(__dirname, '..', 'components', 'callback.htm'));
});

interface Track {
  track: string;
  artist: string;
}

app.get('/scrape', function (req, res) {
  const url = req.query.url;
  if (!url) {
      return res.status(400).send('URL parameter is missing');
  }

  console.log("Here");

  axios.get(url).then(async response => {
      
      const $ = cheerio.load(response.data);
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

      res.status(200).json(tracks);  // Respond with the tracks in JSON format
  })
  .catch(error => {
      console.log(error);
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
        res.send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Spotify Playlist Creator</title>
              <link rel="stylesheet" href="/styles.css">
          </head>
          <body>
              <div>
                  <h1>Spotify Playlist Creator</h1>
                  <p>Welcome, <span id="userDisplayName">${data.display_name}</span></p>

                  <!-- Playlist search and selection -->
                  <div id="content"></div>

                  <div id="mainContentTemplate">
                      <div>
                        <input type="text" id="urlInput" placeholder="URLs for Spotify Made Playlists" />
                        <button id="addButton">Add</button>
                      </div>
                      <input type="text" id="playlistSearchInput" placeholder="Search Playlists" />
                      <ul id="searchResultsList"></ul>

                      <h3>Selected Playlists:</h3>
                      <ul id="selectedPlaylistsList"></ul>

                      <h3>Frequency:</h3>
                      <label><input type="radio" name="frequency" value="daily" /> Daily</label>
                      <label><input type="radio" name="frequency" value="weekly" /> Weekly</label>
                      <label><input type="radio" name="frequency" value="monthly" /> Monthly</label>

                      <input type="text" id="newPlaylistNameInput" placeholder="New Playlist Name">
                      <button id="createPlaylistButton">Create Playlist</button>
                      <button id="testDiscover">Test Discover</button>

                      <!-- Upload and Download Buttons -->
                      <h3>Manage Playlist Settings:</h3>
                      <button id="downloadFileButton" style="margin-right: 60px;">Save Settings</button>
                      <input type="file" id="uploadFileInput" /><br>
                      <button id="setDevice">Set Device</button>
                      <ul id="devicesList"></ul><br>
                      <button id="playButton">AI DJ Beta</button><br>
                      <script src="https://sdk.scdn.co/spotify-player.js"></script>
                  </div>

                  <script src="/scripts.js"></script>
              </div>
          </body>
          </html>

        `);
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


