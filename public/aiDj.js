document.addEventListener('DOMContentLoaded', function() {
    const devicesList = document.getElementById('devicesList');

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
    document.getElementById("playButton").addEventListener("click", () => {
        // playTrack(testTrackUri);
        aiTalk();
    });
    document.getElementById("setDevice").addEventListener("click", setDevice);
});