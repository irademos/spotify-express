


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

