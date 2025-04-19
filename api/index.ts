require('dotenv').config();

const express = require('express');
const app = express();
const { sql } = require('@vercel/postgres');
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
const refreshRoute = require('./refresh');

app.use(cookieParser());
app.use(bodyParser.json());
app.use('/api', refreshRoute);

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

app.get('/dashboard', function (req, res) {
    const accessToken = req.cookies.spotifyAccessToken;
    // const token = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
    console.log(accessToken);
    
    if (accessToken) {
      fetch('https://api.spotify.com/v1/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      .then(async res => {
        console.log("Status:", res.status);
        if (!res.ok) {
          const text = await res.text(); // In case it's not JSON
          console.error("Spotify API error:", text);
          return;
        }
        const data = await res.json();
        console.log("User Data:", data);
      })
      .then(data => {
        // Send the data to the client-side JavaScript
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
                  <p>Welcome, <span id="userDisplayName"> Andy </span></p>

                  <!-- Playlist search and selection -->
                  <div id="content"></div>

                  <div id="mainContentTemplate">
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


