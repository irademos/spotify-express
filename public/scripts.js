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
    const selectedPlaylists = [];

    fetch('/api/config')
    .then(response => response.json())
    .then(config => {
        const loginButton = document.getElementById('loginButton');
        if (loginButton) {
            loginButton.addEventListener('click', () => {
                const CLIENT_ID = config.client_id;
                const REDIRECT_URI = config.redirect_uri;
                const SCOPES = 'user-library-read user-read-private playlist-read-private playlist-modify-private playlist-modify-public';

                const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`;
                window.location.href = authUrl;
            });
        } else {
            console.error("Login button not found!");
        }
    })
    .catch(error => console.error('Error fetching config:', error));

    // Function to fetch playlists from the Spotify API
    function searchPlaylists(query) {
        const accessToken = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
        if (!accessToken || !query) return;

        fetch(`https://api.spotify.com/v1/search?q=${query}&type=playlist&limit=5`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
        })
        .then(response => response.json())
        .then(data => {
        // Clear previous results
        searchResultsList.innerHTML = '';

        // Display new search results
        const playlists = data.playlists.items;
        playlists.forEach(playlist => {
            const listItem = document.createElement('li');
            listItem.textContent = playlist.name;
            listItem.onclick = () => addToSelectedPlaylists(playlist);
            searchResultsList.appendChild(listItem);
        });
        })
        .catch(error => console.error('Error searching playlists:', error));
    }



    function searchPublicPlaylists(query) {
        const accessToken = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
        if (!accessToken || !query) return;
    
        console.log(encodeURIComponent(query));
        fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=playlist&limit=10`, {
        // fetch(`https://api.spotify.com/v1/search?offset=0&limit=20&query=Discover%20Weekly&type=playlist&locale=en-US,en;q%3D0.9`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.playlists) {
                // const filteredPlaylists = data.playlists.items.filter(playlist => 
                // {
                //     if (playlist) {
                //         playlist.name.toLowerCase().includes(query.toLowerCase());
                //     }
                // }
                // );
                // displayPlaylists(filteredPlaylists, `Public Playlists: ${query}`);
                displayPlaylists(data.playlists.items, `Public Playlists: ${query}`);
            }
        })
        .catch(error => console.error('Error searching public playlists:', error));
    }

    function searchFeaturedPlaylists(query) {
        const accessToken = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
        if (!accessToken) return;
    
        fetch('https://api.spotify.com/v1/browse/featured-playlists?limit=10', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.playlists) {
                const filteredPlaylists = data.playlists.items.filter(playlist => 
                    playlist.name.toLowerCase().includes(query.toLowerCase())
                );
                displayPlaylists(filteredPlaylists, `Featured Playlists: ${query}`);
            }
        })
        .catch(error => console.error('Error fetching featured playlists:', error));
    }


    // app.post("/search-playlists", async (req, res) => {
    //     const { token, query } = req.body;
    
    //     try {
    //         const response = await axios.get(
    //             `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=playlist&limit=10`,
    //             {
    //                 headers: { Authorization: `Bearer ${token}` },
    //             }
    //         );
    
    //         res.json(response.data.playlists.items);
    //     } catch (error) {
    //         res.status(500).json({ error: error.response.data });
    //     }
    // });
    
    function searchUserPlaylists(query) {
        const accessToken = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
        if (!accessToken) return;
    
        fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.items) {
                const filteredPlaylists = data.items.filter(playlist => 
                    playlist.name.toLowerCase().includes(query.toLowerCase())
                );
                displayPlaylists(filteredPlaylists, `Your Playlists: ${query}`);
            }
        })
        .catch(error => console.error('Error fetching user playlists:', error));
    }    
    
    function displayPlaylists(playlists, category) {
        if (!playlists || playlists.length === 0) return;

        playlists.forEach(playlist => {
            if (playlist) {
                // Check if the playlist already exists in the search results
                const existingItems = [...searchResultsList.children].map(item => item.textContent);
                if (!existingItems.includes(playlist.name)) {
                    const listItem = document.createElement('li');
                    listItem.textContent = playlist.name;
                    listItem.onclick = () => addToSelectedPlaylists(playlist);
                    searchResultsList.appendChild(listItem);
                    console.log(listItem.textContent);
                }
            }
        });
        
    }

    function searchAllPlaylists(query) {
        searchResultsList.innerHTML = ''; // Clear previous results
        searchPublicPlaylists(query);
        // searchFeaturedPlaylists(query);
        // searchUserPlaylists(query);
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
            selectedPlaylistsList.appendChild(listItem);
        });
    }

    // Event listener for the search input
    searchInput.addEventListener('input', function (e) {
        const query = e.target.value;
        searchAllPlaylists(query); // Perform search as user types
    });

    async function createPlaylist() {
        const accessToken = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
        if (!accessToken) {
            console.error('No access token found.');
            return;
        }
    
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
            const userResponse = await fetch('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const userData = await userResponse.json();
            const userId = userData.id;
    
            if (!userId) {
                console.error('User ID not found.');
                return;
            }
    
            // Create a new empty playlist
            const playlistResponse = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
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
                const playlistTracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
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
                await fetch(`https://api.spotify.com/v1/playlists/${newPlaylistId}/tracks`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
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
    
    // Attach to button
    document.getElementById('createPlaylistButton')?.addEventListener('click', createPlaylist);    

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