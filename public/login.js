document.addEventListener('DOMContentLoaded', function() {
    fetch('/api/config')
    .then(response => response.json())
    .then(config => {
        const loginButton = document.getElementById('loginButton');
        if (loginButton) {
            loginButton.addEventListener('click', () => {
                const CLIENT_ID = config.client_id;
                const REDIRECT_URI = config.redirect_uri;
                const SCOPES = 'user-library-read user-read-private playlist-read-private playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state';
                const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`;
                window.location.href = authUrl;
            });
        } else {
            console.error("Login button not found!");
        }
    })
    .catch(error => console.error('Error fetching config:', error));
});
