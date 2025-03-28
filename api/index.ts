require('dotenv').config();

const express = require('express');
const app = express();
const { sql } = require('@vercel/postgres');
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
// const fetch = require('node-fetch');
const mongoose = require('mongoose');
const User = require('./models/User'); // Import your User schema

app.use(cookieParser());
app.use(express.json());

// Create application/x-www-form-urlencoded parser
const urlencodedParser = bodyParser.urlencoded({ extended: false });

app.get('/api/config', (req, res) => {
    res.json({
        client_id: process.env.SPOTIFY_CLIENT_ID,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI
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
    
    if (accessToken) {
      fetch('https://api.spotify.com/v1/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      .then(response => response.json())
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
              <p>Welcome, <span id="userDisplayName">${data.display_name}</span></p>
  
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
  
app.post('/auth/spotify', async (req, res) => {
    const { accessToken } = req.body;

    // Fetch user info from Spotify
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const userData = await userResponse.json();

    if (!userData.id) {
        return res.status(400).json({ success: false, error: 'Failed to fetch user info' });
    }

    // Store user in database
    const user = await User.findOneAndUpdate(
        { spotifyId: userData.id },
        { spotifyId: userData.id, accessToken },
        { upsert: true, new: true }
    );

    res.json({ success: true, user });
});

app.post('/save-settings', async (req, res) => {
  const { spotifyId, selectedPlaylists, newPlaylistName, frequency } = req.body;

  const cronSchedules = {
      daily: '0 0 * * *',  // Midnight every day
      weekly: '0 0 * * 0'   // Midnight every Sunday
  };

  await User.findOneAndUpdate(
      { spotifyId },
      { selectedPlaylists, newPlaylistName, frequency, cronSchedule: cronSchedules[frequency] },
      { new: true }
  );

  res.json({ success: true });
});

  

// app.listen(3001, () => console.log('Server ready on port 3001.'));

module.exports = app;


