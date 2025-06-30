document.addEventListener('DOMContentLoaded', function() {
    const devicesList = document.getElementById('devicesList');
    const logList = document.getElementById('logList');

    let selectedDevice = [];

    fetch('/api/config')
    .then(response => response.json())
    .then(config => {
        window.or_key = config.or_key;
        window.groq_key = config.groq_key;
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

    function printStatus(text) {
        logList.innerHTML = ''; // Clear the list
        const statusItem = document.createElement('li');
        statusItem.textContent = `${text}`;
        logList.appendChild(statusItem);
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
        }
        )
        .catch(error => console.error('Error starting playback', error));
    }

    // Function to wait for the track to finish
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
            if (bandDescription == undefined) {
                continue;
            }
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
        const authToken = window.groq_key; // Replace with your actual token
    
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

    async function aiPrompt(prompt) {
        // ai prompt
        let response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${window.or_key}`,
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

        let data = await response.json();
        let reply = data.choices?.[0]?.message?.content;
        if (reply) {
            console.log('AI:', reply);
            return reply;
        } else {
            response = await getGroqResponse(prompt);
            reply = response.choices?.[0]?.message?.content;
            console.log(reply);
            return reply;
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

    async function getCurrentPlayingTrack() {
        try {
            const response = await fetchWithSpotifyAuth('https://api.spotify.com/v1/me/player/currently-playing', {
                method: 'GET',
                headers: {}
            });
    
            if (response.status === 204) {
                console.log('Nothing currently playing.');
                return null;
            }
    
            if (!response.ok) {
                console.error('Error fetching current track:', response.statusText);
                return null;
            }
    
            const data = await response.json();
            const trackName = data.item.name;
            const artistName = data.item.artists.map(artist => artist.name).join(', ');
            const trackId = data.item.id; // <-- Add this
    
            console.log(`Now playing: ${trackName} by ${artistName}`);
            return { trackName, artistName, trackId }; // <-- Include trackId
        } catch (error) {
            console.error('Fetch error:', error);
            return null;
        }
    }
    

    let lastTrackId = null;
    function onTrackChange(callback) {
        async function poll() {
            while (true) {
                const trackInfo = await getCurrentPlayingTrack();
                if (trackInfo && trackInfo.trackId !== lastTrackId) {
                    lastTrackId = trackInfo.trackId;
                    await callback(trackInfo);  // <-- await here!
                }
                await new Promise(resolve => setTimeout(resolve, 3000));  // <-- delay manually
            }
        }
    
        poll(); // Start the loop
    }

    async function waitForTrackToStart(timeoutMs = 10000, pollIntervalMs = 1000) {
        const startTime = Date.now();
        let trackInfo = null;
    
        while (!trackInfo) {
            if (Date.now() - startTime > timeoutMs) {
                console.log('Timeout reached. No track is currently playing.');
                return null; // Stop waiting after timeout
            }
    
            trackInfo = await getCurrentPlayingTrack();
    
            if (trackInfo) {
                console.log(`Now playing: ${trackInfo.trackName} by ${trackInfo.artistName}`);
                return trackInfo;
            }
    
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs)); // Wait before retrying
        }
    }    

    async function aiTalk() {
        await loadCities();
        
        // Get user location
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(async (position) => {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;
                console.log('User Location:', latitude, longitude);
                
                // Get nearest city
                const nearestCity = await getNearestCity(latitude, longitude);
                
                // ai prompt
                const prompt = `List 20 well known local bands in ${nearestCity.city}, ${nearestCity.state_name} or a nearby big city. Respond in this format exactly: BandName: Description. One per line. No numbers, no asterisks, no bullet points, no extra text or explanation.`
                let bandsReply = await aiPrompt(prompt);

                // Parse the band list
                bands = parseBands(bandsReply);
                
                // Play songs from each band
                playBandSongsSequentially(bands);
            }, (error) => {
                console.error('Geolocation error:', error);
            });
        } else {
            console.error('Geolocation is not supported by this browser.');
        }
    }

    async function announceTrack(trackInfo) {
        await loadCities();
    
        // Get user location
        console.log(`Now playing: ${trackInfo.trackName} by ${trackInfo.artistName}`);

        const description = await getArtistDescription(trackInfo.artistName);
        let desc_display = "";
        if (description != "") {
            desc_display = "Here is a description for reference: " + description + " ";
        }

        const prompt = `Provide an interesting fact about the band ${trackInfo.artistName}. ${desc_display}Don't say anything about the genre, style or influences of the music. Use the following format:
location: [City or country where the band is from]
fact: [One or two sentences with an interesting fact about the band]`;

        const responseText = await aiPrompt(prompt);
        const lines = responseText.split('\n');
        let location = '';
        let fact = '';

        lines.forEach(line => {
            const [key, ...rest] = line.split(':');
            const value = rest.join(':').trim();
            if (key.trim().toLowerCase() === 'location') {
                location = value;
            } else if (key.trim().toLowerCase() === 'fact') {
                fact = value;
            }
        });

        if (location && fact) {
            const speech_text = `From ${location}. ${fact}`;
            const bandUtterance = new SpeechSynthesisUtterance(speech_text);
            let paused = false;

            let volumePercent = 40;
            let response = await fetchWithSpotifyAuth(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volumePercent}`, {
                method: 'PUT'
            });
            if (!response.ok) {
                response = await fetchWithSpotifyAuth(`https://api.spotify.com/v1/me/player/pause`, { method: 'PUT' });
                if (!response.ok) {
                    console.error("error pausing or lowering volume.");
                    return;
                }
                paused = true;
            }

            speechSynthesis.speak(bandUtterance);

            await new Promise(resolve => bandUtterance.onend = resolve);

            if (paused) {
                await fetchWithSpotifyAuth('https://api.spotify.com/v1/me/player/play', { method: 'PUT' });
            } else {
                volumePercent = 100;
                response = await fetchWithSpotifyAuth(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volumePercent}`, {
                    method: 'PUT'
                });
            }
        }
    }
     

    function startAnnouncing() {
        onTrackChange(async (trackInfo) => {
            await announceTrack(trackInfo);
        });
    }

    function decodeHTMLEntities(text) {
        const textarea = document.createElement("textarea");
        textarea.innerHTML = text;
        return textarea.value;
    }

    async function searchChartmetricArtistPage(artistName) {
        const apiKey = 'AIzaSyArWaxNa3-CGpgWVaFatOHqjSDgSUUqwbM';
        const cx = '64a7fe09d9d9c4618';
        const query = `${artistName}`; // site:chartmetric.com/artist 

        const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`);
        const data = await res.json();

        console.log(data);

        const firstResult = data.items?.[0]?.link;
        return firstResult || null;
    }

    async function getArtistDescription(artistName) {

        const chartmetric_url = await searchChartmetricArtistPage(artistName);
        if (chartmetric_url == null) {
            console.error("Couldn't get chartmetric url");
            return;
        }
        const url = '/api/ai-dj-test-button?url=' + encodeURIComponent(chartmetric_url.toString());

        try {
            const res = await fetch(url);
            const html = await res.text();

            // Match the JSON string with description (greedy match for robustness)
            const match = html.match(/"description"\s*:\s*"([^"]*?)"\s*[,}]/);
            if (!match) {
                console.error('Artist description not found.');
                return;
            }

            // Decode HTML entities and escape characters
            const rawDescription = match[1];
            const cleanDescription = decodeHTMLEntities(rawDescription.replace(/\\"/g, '"'));

            console.log('Artist Description:', cleanDescription);

            return cleanDescription;

            // Use the description as needed
        } catch (error) {
            console.error('Error fetching or parsing description:', error);
            return "";
        }
    }

    async function testButton() {
        console.log("Button pressed!")
    }

    // Attach to button
    document.getElementById("roadTrip").addEventListener("click", () => {
        // playTrack(testTrackUri);
        aiTalk();
    });
    document.getElementById("setDevice").addEventListener("click", setDevice);
    document.getElementById("announceTracks").addEventListener("click", startAnnouncing);
    document.getElementById("testButton").addEventListener("click", testButton);

});