


document.addEventListener('DOMContentLoaded', function() {
    let player = null;

    fetch('/api/me')
    .then(response => response.json())
    .then(data => {
        const name = data.display_name || data.id || '';
        document.getElementById('userDisplayName').textContent = name;
    })
    .catch(error => console.error('Error fetching user:', error));

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

    function goToAtlantaShows() {
        window.location.href = '/upcoming-shows';
    }

    document.getElementById("autoPlaylist").addEventListener("click", goToAutoPlaylist);
    document.getElementById("aiDj").addEventListener("click", goToAiDj);
    document.getElementById("atlantaShows").addEventListener("click", goToAtlantaShows);
});

