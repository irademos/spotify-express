// import cities from './top_cities.json'; // assumes you're using bundler that supports JSON imports

let authToken = null; // Placeholder for auth token
let userId = null;
let playlistName = '';
let searchResults = [];
let selectedPlaylists = [];
let frequency = 'daily';
let newPlaylistName = '';

document.addEventListener('DOMContentLoaded', function() {
    // Attach event listener once the DOM is fully loaded
    const searchInput = document.getElementById('playlistSearchInput');
    const searchResultsList = document.getElementById('searchResultsList');
    const selectedPlaylistsList = document.getElementById('selectedPlaylistsList');
    const devicesList = document.getElementById('devicesList');
    let selectedPlaylists = [];
    let selectedDevice = [];
    let or_key = '';
    let player = null;
    let groq_key = '';

    fetch('/api/config')
    .then(response => response.json())
    .then(config => {
        or_key = config.or_key;
        groq_key = config.groq_key;
        const loginButton = document.getElementById('loginButton');
        if (loginButton) {
            loginButton.addEventListener('click', () => {
                const CLIENT_ID = config.client_id;
                const REDIRECT_URI = config.redirect_uri;
                const SCOPES = 'user-library-read user-read-private playlist-read-private playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state';
                

                const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`;
                window.location.href = authUrl;
            });
        } else {
            console.error("Login button not found!");
        }
    })
    .catch(error => console.error('Error fetching config:', error));

    window.onSpotifyWebPlaybackSDKReady = () => {
        const token = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
        player = new Spotify.Player({
            name: 'Web Playback SDK Player',
            getOAuthToken: cb => { cb(token); },
            volume: 0.5
        });
    
        player.addListener('ready', ({ device_id }) => {
            console.log('Player is ready with device ID:', device_id);
            window.spotifyDeviceId = device_id; // Store for later use
            transferPlaybackHere(device_id);
        });
    
        player.connect();
    };

    async function transferPlaybackHere(deviceId) {
        await fetchWithSpotifyAuth('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                device_ids: [deviceId],
                play: true
            })
        })
        .then(config => {
            console.log(config)
        })
        .catch(error => console.error('Error fetching config:', error));
    }
    
    function searchPublicPlaylists(query) {
        if (!query) return;
    
        fetchWithSpotifyAuth(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=playlist&limit=10`, {
            method: 'GET',
            headers: {}
        })
        .then(response => response.json())
        .then(data => {
            if (data.playlists) {
                displayPlaylists(data.playlists.items, `Public Playlists: ${query}`);
            }
        })
        .catch(error => console.error('Error searching public playlists:', error));
    }
    
    function displayPlaylists(playlists, category) {
        if (!playlists || playlists.length === 0) return;
        searchResultsList.innerHTML = ''; // Clear previous results
        playlists.forEach(playlist => {
            if (playlist) {
                // Check if the playlist already exists in the search results
                const existingItems = [...searchResultsList.children].map(item => item.textContent);
                if (!existingItems.includes(playlist.name)) {
                    const listItem = document.createElement('li');
                    listItem.textContent = `${playlist.name} (${playlist.owner.display_name})`;
                    listItem.onclick = () => addToSelectedPlaylists(playlist);
                    searchResultsList.appendChild(listItem);
                }
            }
        });
        
    }

    function searchAllPlaylists(query) {
        // searchResultsList.innerHTML = ''; // Clear previous results
        searchPublicPlaylists(query);
    }
    
    // Function to add a playlist to the selected playlists list
    function addToSelectedPlaylists(playlist) {
        if (!selectedPlaylists.some(p => p.id === playlist.id)) {
            selectedPlaylists.push(playlist);
            updateSelectedPlaylists();
        }
    }

    // Function to update the selected playlists UI
    function updateSelectedPlaylists() {
        selectedPlaylistsList.innerHTML = ''; // Clear the list

        selectedPlaylists.forEach(playlist => {
            const listItem = document.createElement('li');
            listItem.textContent = `${playlist.name} (${playlist.owner.display_name})`;
            
            // Add click event to remove playlist from the list
            listItem.onclick = () => removeFromSelectedPlaylists(playlist);
            
            selectedPlaylistsList.appendChild(listItem);
        });
    }

    // Function to remove a playlist from selected playlists
    function removeFromSelectedPlaylists(playlist) {
        selectedPlaylists = selectedPlaylists.filter(p => p.id !== playlist.id);
        updateSelectedPlaylists(); // Update UI after removal
    }

    // Event listener for the search input
    searchInput.addEventListener('input', function (e) {
        if (!e) return;
        
        const query = e.target.value;
        searchAllPlaylists(query); // Perform search as user types
    });

    // Function to download selected playlists as a JSON file
    function downloadSelectedPlaylists() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(selectedPlaylists, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", "selected_playlists.json");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        document.body.removeChild(downloadAnchor);
    }

    // Function to handle file upload
    function uploadSelectedPlaylists(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                selectedPlaylists = JSON.parse(e.target.result) || [];
                updateSelectedPlaylists();
            } catch (error) {
                console.error("Error parsing uploaded file:", error);
            }
        };
        reader.readAsText(file);
    }

    async function createPlaylist() {   
        const frequency = document.querySelector('input[name="frequency"]:checked')?.value;
        const newPlaylistName = document.getElementById('newPlaylistNameInput').value.trim();
        if (!newPlaylistName) {
            alert('Please enter a playlist name.');
            return;
        }
    
        if (!selectedPlaylists.length) {
            alert('Please select at least one playlist.');
            return;
        }
    
        const timeRanges = {
            daily: 1,
            weekly: 7,
            monthly: 30
        };
        const daysBack = timeRanges[frequency] || 1;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
        try {
            // Get user's Spotify ID
            const userResponse = await fetchWithSpotifyAuth('https://api.spotify.com/v1/me', {
                headers: {}
            });
            const userData = await userResponse.json();
            const userId = userData.id;
    
            if (!userId) {
                console.error('User ID not found.');
                return;
            }
    
            // Create a new empty playlist
            const playlistResponse = await fetchWithSpotifyAuth(`https://api.spotify.com/v1/users/${userId}/playlists`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: newPlaylistName,
                    public: false
                })
            });
            const playlistData = await playlistResponse.json();
            const newPlaylistId = playlistData.id;
    
            if (!newPlaylistId) {
                console.error('Failed to create playlist.');
                return;
            }
    
            let trackUris = [];
    
            // Loop through selected playlists and filter tracks
            for (const playlist of selectedPlaylists) {
                const playlistTracksResponse = await fetchWithSpotifyAuth(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
                    headers: {}
                });
                const playlistTracksData = await playlistTracksResponse.json();
    
                const filteredTracks = playlistTracksData.items.filter(item => {
                    const addedAt = new Date(item.added_at);
                    return addedAt >= cutoffDate;
                }).map(item => item.track.uri);
    
                trackUris = trackUris.concat(filteredTracks);
            }
    
            // Add filtered tracks to the new playlist in batches (max 100 per request)
            for (let i = 0; i < trackUris.length; i += 100) {
                await fetchWithSpotifyAuth(`https://api.spotify.com/v1/playlists/${newPlaylistId}/tracks`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ uris: trackUris.slice(i, i + 100) })
                });
            }
    
            alert('Playlist created successfully!');
        } catch (error) {
            console.error('Error creating playlist:', error);
        }
    }

    function updateDevices(data) {
        
        devicesList.innerHTML = ''; // Clear the list
        devices = data.devices;

        console.log("devices", devices)
        devices.forEach(dev => {
            console.log("dev",dev);
            console.log("dev.name",dev.name);
            const deviceItem = document.createElement('li');
            deviceItem.textContent = `${dev.name}`;
            
            // Add click event to select device
            deviceItem.onclick = () => selectDevice(dev);
            
            devicesList.appendChild(deviceItem);
        });
    }

    function selectDevice(device) {
        selectedDevice = device.id;
        console.log("selecDev",selectedDevice);
    }

    async function setDevice() {
        await fetchWithSpotifyAuth('https://api.spotify.com/v1/me/player/devices', {
            method: 'GET',
            headers: {}
        })
        .then(response => response.json())
        .then(data => {
            console.log(data); // List of available devices
            // Function to update the selected playlists UI
            updateDevices(data);
        });
    }

    async function playTrack(trackUri) {    
        await fetchWithSpotifyAuth('https://api.spotify.com/v1/me/player/play', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                device_id: window.spotifyDeviceId,
                uris: [trackUri],
                position_ms: 0
            })
        })
        .then(response => {
            console.log('Playback started', response);
            alreadyTriggered = false;
        }
        )
        .catch(error => console.error('Error starting playback', error));
    }

    // Function to wait for the track to finish
    let alreadyTriggered = false;
    let lastTrackId = null;
    function waitForTrackToFinish() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(async () => {
                const res = await fetchWithSpotifyAuth('https://api.spotify.com/v1/me/player');
                
                if (!res.ok) {
                    console.error('Failed to fetch player state');
                    return;
                }
            
                const state = await res.json();
                const item = state.item;
                console.log("state", state.is_playing, state.progress_ms);
                const progress = state.progress_ms;
            
                if (item && progress !== null) {
                    const timeLeft = item.duration_ms - progress;
                    const currentTrackId = state?.item?.id;
                    if (timeLeft <= 5000) {
                        console.log('Track is within 5 seconds of ending');
                        clearInterval(checkInterval);
                        resolve();
                        return;
                    }
    
                    if (progress == 0 && state.is_playing == false) {
                        console.log('User skipped to next track');
                        clearInterval(checkInterval);
                        resolve();
                        return;
                    }
                }
                
            }, 1000); // check every second
        });
    }

    // Main function to play songs from bands sequentially
    async function playBandSongsSequentially(bands) {
        for (const band of bands) {
            const bandName = band.name;
            const bandDescription = band.description;
            speech_text = `Playing song from ${bandName}: ${bandDescription}`
            console.log(speech_text);

            const songUri = await getSongUriForBand(bandName); // Placeholder function to get song URI
            if (!songUri) continue; // Skip if no song found

            // Read the band description
            const bandUtterance = new SpeechSynthesisUtterance(speech_text);
            speechSynthesis.speak(bandUtterance);

            // Wait for the speech to finish before starting the song
            await new Promise(resolve => {
                bandUtterance.onend = resolve;
            });

            // Play the track
            await playTrack(songUri); // Start the track

            // Wait until the track finishes before playing the next one
            
            await waitForTrackToFinish();
        }
    }

    async function getGroqResponse(prompt) {
        const url = 'https://api.groq.com/openai/v1/chat/completions';
        const authToken = groq_key; // Replace with your actual token
      
        const data = {
          model: "gemma2-9b-it",
          messages: [{
            role: "user",
            content: prompt
          }]
        };
      
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${authToken}`,
            },
            body: JSON.stringify(data)
          });
      
          const responseData = await response.json();
          console.log('Response:', responseData);
          return responseData
        } catch (error) {
          console.error('Error:', error);
          return error;
        }
    }

    async function aiTalk() {
        await loadCities();
        
        // Step 1: Get user location using the Geolocation API
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(async (position) => {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;
                console.log('User Location:', latitude, longitude);
                
                // Step 2: Determine nearest big city (you can improve this step with a more sophisticated method)
                const nearestCity = await getNearestCity(latitude, longitude); // Placeholder for city retrieval
                const prompt = `List 20 well known local bands in ${nearestCity.city}, ${nearestCity.state_name} or a nearby big city. Respond in this format exactly: BandName: Description. One per line. No numbers, no asterisks, no bullet points, no extra text or explanation.`
                
                // ai prompt
                let bandsResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${or_key}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        messages: [{ 
                            role: "user", 
                            content: prompt
                        }],
                        stream: false,
                    })
                });

                let bandsData = await bandsResponse.json();
                let bandsReply = bandsData.choices?.[0]?.message?.content;
                let bands = null;
                if (bandsReply) {
                    console.log('AI:', bandsReply);
                    bands = parseBands(bandsReply); // Parse the band list from the AI response
                    playBandSongsSequentially(bands);
                } else {
                    bandsResponse = await getGroqResponse(prompt);
                    bandsReply = bandsResponse.choices?.[0]?.message?.content;
                    console.log(bandsReply)
                    bands = parseBands(bandsReply); // Parse the band list from the AI response
                    playBandSongsSequentially(bands);
                }
            }, (error) => {
                console.error('Geolocation error:', error);
            });
        } else {
            console.error('Geolocation is not supported by this browser.');
        }
    }

    let cities = [];

    async function loadCities() {
        const res = await fetch('./top_cities.json');
        cities = await res.json();
    }
    // Function to calculate distance between two lat/lon points using Haversine formula
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
  
    // Async function to load city JSON and find the nearest city
    async function getNearestCity(lat, lon) {
        const response = await fetch('./top_cities.json'); // Ensure this path is correct relative to public root
        const cities = await response.json();
    
        let closestCity = cities[0];
        let minDistance = calculateDistance(lat, lon, closestCity.lat, closestCity.lng);
    
        for (const city of cities) {
            const distance = calculateDistance(lat, lon, city.lat, city.lng);
            if (distance < minDistance) {
                closestCity = city;
                minDistance = distance;
            }
        }
    
        console.log(`Nearest city: ${closestCity.city}, ${closestCity.state_name} (${minDistance.toFixed(1)} km)`);
        return closestCity;
    }
      
    // Placeholder function to parse the band names and descriptions from the AI response
    function parseBands(bandsReply) {
        // Assuming the response looks like:
        // "Band1: Description1\nBand2: Description2\n..."
        const bands = bandsReply.split('\n').map(line => {
            const [name, description] = line.split(':');
            return { name, description };
        });
        return bands;
    }

    async function refreshAccessToken(refreshToken) {
        const response = await fetch('/api/refresh-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
    
        const data = await response.json();
        if (data.access_token) {
            // Save to cookie or memory
            document.cookie = `spotifyAccessToken=${data.access_token}; path=/`;
        }
    }

    async function fetchWithSpotifyAuth(url, options = {}, retry = true) {
        let accessToken = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
    
        const res = await fetch(url, {
            ...options,
            headers: {
                ...(options.headers || {}),
                Authorization: `Bearer ${accessToken}`
            }
        });
    
        // Token expired — refresh and retry once
        if (res.status === 401 && retry) {
            const refreshToken = document.cookie.match(/spotifyRefreshToken=([^;]+)/)?.[1];
            const refreshRes = await fetch('/api/refresh-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken })
            });
    
            const refreshData = await refreshRes.json();
            if (refreshData.access_token) {
                document.cookie = `spotifyAccessToken=${refreshData.access_token}; path=/`;
    
                // Retry original request with new token
                return fetchWithSpotifyAuth(url, options, false);
            } else {
                throw new Error('Token refresh failed');
            }
        }
    
        return res;
    }
    
    
    async function getSongUriForBand(bandName) {
        // search
        const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(bandName)}&type=track&limit=1`;
        const searchResponse = await fetchWithSpotifyAuth(searchUrl);
        const searchData = await searchResponse.json();
        console.log(searchData);
        const track = searchData.tracks.items[0];

        if (track) {
            const artistName = track.artists[0].name;
            if (artistName.toLowerCase().includes(bandName.toLowerCase())) {
                return track.uri; // Return the URI if the artist matches
            } else {
                console.log(`Artist '${artistName}' does not match band '${bandName}'`);
                return null; // No match found
            }
        } else {
            throw new Error("No song found for this band");
        }
    }
    
    // Attach to button
    // Event listeners for buttons
    document.getElementById("downloadFileButton").addEventListener("click", downloadSelectedPlaylists);
    document.getElementById("uploadFileInput").addEventListener("change", uploadSelectedPlaylists);
    document.getElementById("createPlaylistButton").addEventListener("click", createPlaylist);
    // document.getElementById("playButton").addEventListener("click", playButton);
    const testTrackUri = 'spotify:track:2bgFEoaY6r4CqDPjllvKsl'; // example track
    const device = 'cfb69f378915e5f62aeaf0591c4ca3479abddb51';
    document.getElementById("playButton").addEventListener("click", () => {
        // playTrack(testTrackUri);
        aiTalk();
    });
    document.getElementById("setDevice").addEventListener("click", setDevice);

});

window.onload = function () {
    const urlParams = new URLSearchParams(window.location.hash.substr(1)); // Get the hash params after '#'
    const accessToken = urlParams.get('access_token'); // Get access token from URL

    if (accessToken) {
        console.log('Spotify access token:', accessToken);
        // Store token in localStorage for later use
        localStorage.setItem('spotifyAccessToken', accessToken);
        document.getElementById('loginTemplate').style.display = 'none';
        document.getElementById('mainContentTemplate').style.display = 'block';
    }
};
