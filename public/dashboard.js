


document.addEventListener('DOMContentLoaded', function() {
    let player = null;

    fetch('/api/config')
    .then(response => response.json())
    .then(config => {
        window.or_key = config.or_key;
        window.groq_key = config.groq_key;
    })
    .catch(error => console.error('Error fetching config:', error));

    function goToAutoPlaylist() {
        window.location.href = '/auto-playlist';
    }

    function goToAiDj() {
        window.location.href = '/ai-dj';
    }

    document.getElementById("autoPlaylist").addEventListener("click", goToAutoPlaylist);
    document.getElementById("aiDj").addEventListener("click", goToAiDj);
});

window.onload = function () {
    const urlParams = new URLSearchParams(window.location.hash.substr(1)); // Get the hash params after '#'
    const accessToken = urlParams.get('access_token'); // Get access token from URL

    if (accessToken) {
        // console.log('Spotify access token:', accessToken);
        // Store token in localStorage for later use
        localStorage.setItem('spotifyAccessToken', accessToken);
        document.getElementById('loginTemplate').style.display = 'none';
        document.getElementById('mainContentTemplate').style.display = 'block';
    }
};
