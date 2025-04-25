document.addEventListener('DOMContentLoaded', function() {
    // Attach event listener once the DOM is fully loaded
    const searchInput = document.getElementById('playlistSearchInput');
    const searchResultsList = document.getElementById('searchResultsList');
    const selectedPlaylistsList = document.getElementById('selectedPlaylistsList');
    
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
            const res = await fetch(`/scrape?url=${encodeURIComponent(url)}`);
            if (!res.ok) {
                throw new Error('Failed to fetch data');
            }
            const data = await res.json();  // Parse the response body as JSON
            console.log(data);  // Logs the scraped tracks (name, artist)
            return data;
        } catch (error) {
            console.error('Error during scrape:', error);
            return "";
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
    
            // Loop through selected URLs and scrape tracks
            for (const url of selectedURLs) {
                try {
                    const response = await scrapePlaylist(url);
                    for (const scraped of response) {
                        const uri = await getUriForTrack(scraped);
                        if (uri) {
                            trackUris.push(uri);
                        } else {
                            console.warn(`Track not found: ${query}`);
                        }
                    }
                } catch (error) {
                    console.error('Error scraping playlist from URL:', url, error);
                }
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

    async function getUriForTrack(scraped) {
        const query = `${scraped.track} ${scraped.artist}`;
        const searchParams = new URLSearchParams({ q: query, type: 'track', limit: 1 });

        try {
            const searchResponse = await fetchWithSpotifyAuth(`https://api.spotify.com/v1/search?${searchParams}`, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            const searchData = await searchResponse.json();

            const uri = searchData.tracks?.items?.[0]?.uri;
            return uri;
        } catch (searchError) {
            console.error(`Error searching track: ${query}`, searchError);
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
    document.getElementById("addButton").addEventListener("click", addURL);
});