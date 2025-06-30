document.addEventListener('DOMContentLoaded', function() {
    // Attach event listener once the DOM is fully loaded
    const searchInput = document.getElementById('playlistSearchInput');
    const searchResultsList = document.getElementById('searchResultsList');
    const selectedPlaylistsList = document.getElementById('selectedPlaylistsList');
    const createPlaylistLog = document.getElementById('createPlaylistLog');
    
    let selectedPlaylists = [];
    let selectedURLs = [];
    let player = null;

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

        selectedURLs.forEach(url => {
            const listItem = document.createElement('li');
            listItem.textContent = `${url}`;

            listItem.onclick = () => removeFromURLs(url);
            selectedPlaylistsList.appendChild(listItem);
        })
    }

    // Function to remove a playlist from selected playlists
    function removeFromSelectedPlaylists(playlist) {
        selectedPlaylists = selectedPlaylists.filter(p => p.id !== playlist.id);
        updateSelectedPlaylists(); // Update UI after removal
    }

    function removeFromURLs(url) {
        selectedURLs = selectedURLs.filter(p => p !== url);
        updateSelectedPlaylists();
    }

    // Event listener for the search input
    searchInput.addEventListener('input', function (e) {
        if (!e) return;
        
        const query = e.target.value;
        searchAllPlaylists(query); // Perform search as user types
    });

    function downloadSelectedPlaylists() {
        const data = {
            selectedPlaylists: selectedPlaylists,
            selectedURLs: selectedURLs
        };
    
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", "playlist_data.json");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        document.body.removeChild(downloadAnchor);
    }
    


    function uploadPlaylistData(event) {
        const file = event.target.files?.[0];
        if (!file) return;
    
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                selectedPlaylists = data.selectedPlaylists || [];
                selectedURLs = data.selectedURLs || [];
                updateSelectedPlaylists();
            } catch (err) {
                alert("Invalid file format.");
            }
        };
        reader.readAsText(file);
    }
    
    // Discover: "https://open.spotify.com/playlist/37i9dQZEVXcMyZVrUpCKOR"
    async function scrapePlaylist(url) {
        try {
            // const res = await fetch(`/scrape?url=${encodeURIComponent(url)}`);
            fetch(`/api/scrape?url=${encodeURIComponent(url)}`)
            .then(response => response.json())
            .then(ret_val => {
                // if (!res.ok) throw new Error('Failed to fetch data');
                console.log(ret_val);
                return ret_val;
            })
            .catch(error => console.error('Error fetching config:', error));
            
        } catch (error) {
            console.error('Error during scrape:', error);
            return [];
        }
    }

    function addURL() {
        const url = document.getElementById('urlInput').value.trim();
        
        // Validate URL before adding
        if (url && isValidURL(url)) {
            selectedURLs.push(url);
            document.getElementById('urlInput').value = "";
            updateSelectedPlaylists();
        } else {
            alert("Please enter a valid URL");
        }
    }
    
    function isValidURL(url) {
        // Basic URL validation (you can improve it)
        const regex = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
        return regex.test(url);
    }

    async function testDiscover() { 
        window.open('/api/test-discover?url=' + encodeURIComponent("https://open.spotify.com/playlist/37i9dQZF1DWWjGdmeTyeJ6"));
        // const res = await fetch(`/api/test-discover?id=37i9dQZF1DWWjGdmeTyeJ6`);
        // if (!res.ok) throw new Error("Failed to get playlist tracks");
        // return await res.json();
        console.log('button pressed!');
    }

    function createPlistLog(text) {
        createPlaylistLog.innerHTML = ''; // Clear the list
        const listItem = document.createElement('li');
        listItem.textContent = text;
        createPlaylistLog.appendChild(listItem);
    }

    async function createPlaylist() {   
        const frequency = document.querySelector('input[name="frequency"]:checked')?.value;
        const newPlaylistName = document.getElementById('newPlaylistNameInput').value.trim();
        if (!newPlaylistName) {
            alert('Please enter a playlist name.');
            return;
        }
    
        if (!selectedPlaylists.length && selectedURLs.length === 0) {
            alert('Please select at least one playlist or provide a URL.');
            return;
        }

        createPlistLog("Creating playlist. Please wait.");
    
        const timeRanges = {
            daily: 1,
            weekly: 7,
            monthly: 30
        };
        const daysBack = timeRanges[frequency] || 7;
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
                createPlistLog("Spotify User ID not found.");
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
                createPlistLog("Failed to create playlist.");
                console.error('Failed to create playlist.');
                return;
            }
    
            let uniqueTracks = new Map(); // Map<artistName, { uri, artistId, trackName }>
            let trackSet = new Set(); // To track duplicate songs

            // Selected Playlists
            for (const playlist of selectedPlaylists) {
                createPlistLog(`Getting tracks from ${playlist.name}.`);
                const playlistTracksResponse = await fetchWithSpotifyAuth(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
                    headers: {}
                });
                const playlistTracksData = await playlistTracksResponse.json();

                for (const item of playlistTracksData.items) {
                    const addedAt = new Date(item.added_at);
                    if (addedAt < cutoffDate) continue;

                    const track = item.track;
                    const artist = track.artists[0]; // use primary artist
                    const trackUri = track.uri;
                    const trackId = track.id;

                    if (!trackSet.has(trackUri) && !uniqueTracks.has(artist.name)) {
                        uniqueTracks.set(artist.name, {
                            uri: trackUri,
                            artistId: artist.id,
                            trackName: track.name,
                            playlistName: playlist.name
                        });

                        trackSet.add(trackUri);
                    }
                }
            }

            // Selected URLs
            for (const url of selectedURLs) {
                try {
                    createPlistLog(`Getting tracks from ${url}.`);
                    const scraped = await scrapeHTMLTracks(url);
                    const { tracks, playlistName } = scraped;
                    console.log(scraped)
                    for (const { track, artist } of tracks) {
                        const uriInfo = await getUriForTrack({ track, artist }); // returns { uri, artistId }
                        console.log(uriInfo)
                        if (uriInfo && !trackSet.has(uriInfo.uri) && !uniqueTracks.has(artist)) {
                            uniqueTracks.set(artist, {
                                uri: uriInfo.uri,
                                artistId: uriInfo.artistId,
                                trackName: track,
                                playlistName: playlistName
                            });
                            trackSet.add(uriInfo.uri);
                        }
                    }
                } catch (error) {
                    console.error('Error scraping playlist from URL:', url, error);
                }
            }

            // Fetch monthly listeners
            async function getMonthlyListeners(artistId) {
                if (!artistId) {
                    console.warn('Artist ID is missing');
                    return 0;
                }

                console.log("Getting listeners for artist ID:", artistId);

                try {
                    const res = await fetchWithSpotifyAuth(`https://api.spotify.com/v1/artists/${artistId}`);
                    if (!res.ok) {
                        if (res.status === 429) {
                            const retryAfter = res.headers.get("Retry-After");
                            const waitTime = (retryAfter ? parseInt(retryAfter) : 1) * 1000;
                            console.warn(`Rate limited. Waiting ${waitTime}ms...`);
                            await sleep(waitTime);
                            return await getMonthlyListeners(artistId); // retry
                        }
                        return 0;
                    }

                    const data = await res.json();
                    return data.followers?.total || 0;

                } catch (error) {
                    console.error('Fetch failed:', error);
                    return 0;
                }
            }
            
            const trackEntries = Array.from(uniqueTracks.values());
            for (const entry of trackEntries) {
                try {
                    await sleep(50); // 50 ms delay between requests
                    entry.monthlyListeners = await getMonthlyListeners(entry.artistId) || 0;
                    console.log(entry.monthlyListeners);
                    createPlistLog(`Sorting by listeners: ${entry.trackName}, ${entry.monthlyListeners}`);
                } catch (error) {
                    createPlistLog(`Error getting listeners: ${error}`);
                    console.log('Error getting listeners:', error);
                    entry.monthlyListeners = 0;
                }
            }

            // Sort by least to most monthly listeners
            trackEntries.sort((a, b) => a.monthlyListeners - b.monthlyListeners);
            console.log(trackEntries, trackEntries.length);

            // Add to playlist
            for (let i = 0; i < trackEntries.length; i += 100) {
                const batchUris = trackEntries.slice(i, i + 100).map(entry => entry.uri);
                await fetchWithSpotifyAuth(`https://api.spotify.com/v1/playlists/${newPlaylistId}/tracks?position=${i}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uris: batchUris })
                });
            }

            // save to file for debug
            createPlistLog("Playlist created, saving to txt file.");
            const lines = [];
            for (const entry of trackEntries) {
                const { trackName, uri, artistId, playlistName } = entry;
                const artistName = [...uniqueTracks.entries()]
                    .find(([, val]) => val.uri === uri)?.[0] || 'Unknown Artist';

                lines.push(`${trackName} - ${artistName} - ${playlistName || 'Unknown Playlist'}`);
            }

            const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'playlist_tracks.txt';
            a.click();
            URL.revokeObjectURL(url);

            alert('Playlist created successfully!');

        } catch (error) {
            console.error('Error creating playlist:', error);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function getUriForTrack({ track, artist }) {
        const query = `${track} ${artist}`;
        const searchParams = new URLSearchParams({ q: query, type: 'track', limit: 1 });

        try {
            const searchResponse = await fetchWithSpotifyAuth(`https://api.spotify.com/v1/search?${searchParams}`, {
                headers: { 'Content-Type': 'application/json' }
            });

            const searchData = await searchResponse.json();
            const item = searchData.tracks?.items?.[0];

            if (!item) return null;

            return {
                uri: item.uri,
                artistId: item.artists?.[0]?.id ?? null,
            };
        } catch (searchError) {
            console.error(`Error searching track: ${query}`, searchError);
            return null;
        }
    }

    async function scrapeHTMLTracks(url) {
        const res = await fetch('/api/scrape-html-tracks?url=' + encodeURIComponent(url));
        if (!res.ok) {
            console.error("Failed to fetch track links");
            return [];
        }

        const res_json = await res.json();  // Parse the JSON response
        console.log('Response JSON:', res_json);
        const trackLinks = Array.isArray(res_json.trackLinks) ? res_json.trackLinks : [];
        const playlistName = res_json.playlistName;
        const resolvedTracks = [];

        for (const link of trackLinks) {
            const track = await getTrackNameAndArtistFromUrl(link);
            if (track) resolvedTracks.push(track);
        }

        return { tracks: resolvedTracks, playlistName: playlistName };
    }

    async function getTrackNameAndArtistFromUrl(trackUrl) {
        // Extract the track ID from the URL
        const match = trackUrl.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            console.error('Invalid track URL:', trackUrl);
            return null;
        }

        const trackId = match[1];
        const apiUrl = `https://api.spotify.com/v1/tracks/${trackId}`;

        try {
            const response = await fetchWithSpotifyAuth(apiUrl, {
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                console.error(`Failed to fetch track: ${response.status} ${response.statusText}`);
                return null;
            }

            const data = await response.json();
            const trackName = data.name;
            const artistName = data.artists.map(a => a.name).join(', ');

            return { track: trackName, artist: artistName };
        } catch (err) {
            console.error('Error fetching track info:', err);
            return null;
        }
    }

    
    async function refreshAccessToken(refreshToken) {
        const response = await fetch('/api/refresh', {
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
    
    // Attach to button
    // Event listeners for buttons
    document.getElementById("downloadFileButton").addEventListener("click", downloadSelectedPlaylists);
    document.getElementById("uploadFileInput").addEventListener("change", uploadPlaylistData);
    document.getElementById("createPlaylistButton").addEventListener("click", createPlaylist);
    document.getElementById("testDiscover").addEventListener("click", testDiscover);
    document.getElementById("addButton").addEventListener("click", addURL);
});