document.addEventListener('DOMContentLoaded', function () {
    let allShows = [];
    let venues = [];
    let selectedVenueIds = new Set();

    // Spotify player state
    let player = null;
    let spotifyDeviceId = null;
    // currentPlayingKey format: "datetime|venue::artist::idx"
    let currentPlayingKey = null;
    let isPlaying = false;
    let lastPosition = 0;

    window.onSpotifyWebPlaybackSDKReady = () => {
        const token = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];
        if (!token) return;

        player = new Spotify.Player({
            name: 'Atlanta Shows Player',
            getOAuthToken: cb => { cb(token); },
            volume: 0.5
        });

        player.addListener('ready', ({ device_id }) => {
            spotifyDeviceId = device_id;
        });

        player.addListener('player_state_changed', (state) => {
            if (!state) return;

            // Detect natural song end: was playing at a non-zero position, now paused at 0
            if (isPlaying && state.paused && state.position === 0 && lastPosition > 5000) {
                isPlaying = false;
                playNextArtist();
                return;
            }

            if (!state.paused) {
                lastPosition = state.position;
            }

            isPlaying = !state.paused;
            updateAllPlayButtons();
        });

        player.connect();
    };

    function showKey(show) {
        return show.datetime + '|' + show.venue;
    }

    function artistKey(show, idx) {
        return showKey(show) + '::artist::' + idx;
    }

    function getVisibleShows() {
        return allShows.filter(s => selectedVenueIds.has(s.venueId));
    }

    function updateAllPlayButtons() {
        document.querySelectorAll('.play-btn').forEach(btn => {
            const active = btn.dataset.key === currentPlayingKey && isPlaying;
            btn.textContent = active ? '⏸' : '▶';
            btn.title = active ? 'Pause' : 'Play';
        });
    }

    function playNextArtist() {
        if (!currentPlayingKey) return;

        const sep = '::artist::';
        const sepIdx = currentPlayingKey.indexOf(sep);
        const showPart = currentPlayingKey.slice(0, sepIdx);
        const artistIdx = parseInt(currentPlayingKey.slice(sepIdx + sep.length));

        const visible = getVisibleShows();
        const currentShowIdx = visible.findIndex(s => showKey(s) === showPart);

        if (currentShowIdx === -1) {
            currentPlayingKey = null;
            updateAllPlayButtons();
            return;
        }

        const currentShow = visible[currentShowIdx];
        const nextArtistIdx = artistIdx + 1;

        // Try next artist within the same event first
        if (nextArtistIdx < currentShow.artists.length) {
            playShow(currentShow, nextArtistIdx);
            return;
        }

        // No more artists in this event — move to next event
        const nextShowIdx = currentShowIdx + 1;
        if (nextShowIdx < visible.length) {
            playShow(visible[nextShowIdx], 0);
        } else {
            currentPlayingKey = null;
            updateAllPlayButtons();
        }
    }

    function normalizeArtistName(name) {
        return name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]/g, '');
    }

    async function playShow(show, artistIdx = 0) {
        if (!spotifyDeviceId) {
            alert('Spotify player not ready yet. Please wait a moment and try again.');
            return;
        }

        lastPosition = 0;
        const artistName = show.artists[artistIdx];
        const key = artistKey(show, artistIdx);

        try {
            // Use stored artist ID when available — skip the search entirely
            let artistId = show.spotifyArtistIds?.[artistIdx] || null;

            if (!artistId) {
                const searchRes = await fetchWithSpotifyAuth(
                    `https://api.spotify.com/v1/search?q=${encodeURIComponent('"' + artistName + '"')}&type=artist&limit=10`
                );
                const searchData = await searchRes.json();
                const items = searchData.artists?.items || [];
                const normalTarget = normalizeArtistName(artistName);

                const exactMatch = items.find(a => normalizeArtistName(a.name) === normalTarget);
                if (exactMatch) {
                    artistId = exactMatch.id;
                } else {
                    const sorted = [...items].sort((a, b) => b.popularity - a.popularity);
                    artistId = sorted[0]?.id || null;
                }

                // Cache the found ID locally and persist to Supabase
                if (artistId) {
                    if (!show.spotifyArtistIds) show.spotifyArtistIds = [];
                    show.spotifyArtistIds[artistIdx] = artistId;
                    fetch('/api/cache-artist-id', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: artistName, spotifyId: artistId })
                    }).catch(() => {});
                }
            }

            if (!artistId) return;

            const tracksRes = await fetchWithSpotifyAuth(
                `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`
            );
            const tracksData = await tracksRes.json();
            const trackUri = tracksData.tracks?.[0]?.uri;
            if (!trackUri) return;

            await fetchWithSpotifyAuth(
                `https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uris: [trackUri] })
            });

            currentPlayingKey = key;
            isPlaying = true;
            updateAllPlayButtons();
        } catch (err) {
            console.error('Error playing artist:', artistName, err);
        }
    }

    document.getElementById('backBtn').addEventListener('click', () => {
        window.location.href = '/dashboard';
    });

    // Dropdown open/close
    const trigger = document.getElementById('dropdownTrigger');
    const panel = document.getElementById('dropdownPanel');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = panel.classList.toggle('open');
        trigger.classList.toggle('open', isOpen);
    });

    document.addEventListener('click', () => {
        panel.classList.remove('open');
        trigger.classList.remove('open');
    });

    panel.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('selectAllBtn').addEventListener('click', () => {
        selectedVenueIds = new Set(venues.map(v => v.id));
        syncCheckboxes();
        updateDropdownLabel();
        renderShows();
    });

    document.getElementById('clearAllBtn').addEventListener('click', () => {
        selectedVenueIds.clear();
        syncCheckboxes();
        updateDropdownLabel();
        renderShows();
    });

    function syncCheckboxes() {
        document.querySelectorAll('.venue-cb').forEach(cb => {
            cb.checked = selectedVenueIds.has(cb.dataset.id);
        });
    }

    function updateDropdownLabel() {
        const label = document.getElementById('dropdownLabel');
        if (venues.length === 0) {
            label.textContent = 'No Venues Loaded';
        } else if (selectedVenueIds.size === 0) {
            label.textContent = 'No Venues Selected';
        } else if (selectedVenueIds.size === venues.length) {
            label.textContent = 'All Venues';
        } else {
            label.textContent = `${selectedVenueIds.size} of ${venues.length} Venues`;
        }
    }

    function buildVenueCheckboxes() {
        const container = document.getElementById('venueCheckboxes');
        container.innerHTML = '';

        if (venues.length === 0) {
            container.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:#888;">No venues found</div>';
            return;
        }

        venues.forEach(v => {
            const item = document.createElement('div');
            item.className = 'venue-item';

            const cbId = `vcb-${v.id}`;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'venue-cb';
            cb.id = cbId;
            cb.dataset.id = v.id;
            cb.checked = selectedVenueIds.has(v.id);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    selectedVenueIds.add(v.id);
                } else {
                    selectedVenueIds.delete(v.id);
                }
                updateDropdownLabel();
                renderShows();
            });

            const lbl = document.createElement('label');
            lbl.htmlFor = cbId;
            lbl.textContent = v.displayName;

            item.appendChild(cb);
            item.appendChild(lbl);
            container.appendChild(item);
        });
    }

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    function parseDate(datetime) {
        const datePart = datetime.split('T')[0];
        const [year, month, day] = datePart.split('-').map(Number);
        const d = new Date(Date.UTC(year, month - 1, day));
        return {
            monthStr:  MONTHS[d.getUTCMonth()],
            dayNum:    d.getUTCDate(),
            dayOfWeek: DAYS[d.getUTCDay()],
            year:      d.getUTCFullYear()
        };
    }

    function escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function renderShows() {
        const container = document.getElementById('showsContainer');
        const meta = document.getElementById('showsMeta');

        const visible = allShows.filter(s => selectedVenueIds.has(s.venueId));

        if (visible.length === 0) {
            meta.textContent = '';
            if (allShows.length === 0) {
                container.innerHTML = `
                    <div class="state-msg">
                        No shows loaded yet — Spotify's API is still being explored.<br>
                        <a href="/atlanta-shows?refresh=1" class="retry-link">Retry</a>
                    </div>`;
            } else {
                container.innerHTML = '<div class="state-msg">No shows match the selected venues.</div>';
            }
            return;
        }

        meta.textContent = `${visible.length} show${visible.length !== 1 ? 's' : ''}`;

        const ul = document.createElement('ul');
        ul.className = 'shows-list';

        visible.forEach((show) => {
            const date = parseDate(show.datetime);

            const li = document.createElement('li');
            li.className = 'show-item';

            const dateDiv = document.createElement('div');
            dateDiv.className = 'show-date';
            dateDiv.innerHTML = `<div class="date-main">${escHtml(date.monthStr)} ${date.dayNum}</div><div class="date-sub">${date.dayOfWeek}, ${date.year}</div>`;

            const artistsDiv = document.createElement('div');
            artistsDiv.className = 'show-artists';

            show.artists.forEach((artistName, idx) => {
                const key = artistKey(show, idx);
                const isActive = key === currentPlayingKey && isPlaying;

                const chip = document.createElement('span');
                chip.className = 'artist-chip';

                const playBtn = document.createElement('button');
                playBtn.className = 'play-btn';
                playBtn.dataset.key = key;
                playBtn.textContent = isActive ? '⏸' : '▶';
                playBtn.title = isActive ? 'Pause' : 'Play';

                playBtn.addEventListener('click', async () => {
                    if (key === currentPlayingKey) {
                        if (isPlaying) {
                            player?.pause();
                            isPlaying = false;
                            updateAllPlayButtons();
                        } else {
                            player?.resume();
                            isPlaying = true;
                            updateAllPlayButtons();
                        }
                    } else {
                        await playShow(show, idx);
                    }
                });

                const artistLink = document.createElement('a');
                artistLink.className = 'artist-name-link';
                artistLink.textContent = artistName;
                artistLink.target = '_blank';
                artistLink.rel = 'noopener noreferrer';
                const spotifyId = show.spotifyArtistIds?.[idx];
                artistLink.href = spotifyId
                    ? `https://open.spotify.com/artist/${spotifyId}`
                    : `https://open.spotify.com/search/${encodeURIComponent(artistName)}`;

                chip.appendChild(playBtn);
                chip.appendChild(artistLink);
                artistsDiv.appendChild(chip);
            });

            const venueDiv = document.createElement('div');
            venueDiv.className = 'show-venue-name';
            const venueLink = document.createElement('a');
            venueLink.className = 'venue-link';
            venueLink.textContent = show.venue;
            venueLink.href = `https://www.google.com/maps/search/${encodeURIComponent(show.venue + ' Atlanta GA')}`;
            venueLink.target = '_blank';
            venueLink.rel = 'noopener noreferrer';
            venueDiv.appendChild(venueLink);

            li.appendChild(dateDiv);
            li.appendChild(artistsDiv);
            li.appendChild(venueDiv);
            ul.appendChild(li);
        });

        container.innerHTML = '';
        container.appendChild(ul);
    }

    function loadShows(url) {
        document.getElementById('showsContainer').innerHTML = `
            <div class="state-msg">
                <span class="loading-dots">Loading Atlanta shows</span>
                <div class="scrape-note">Fetching from 23 venues &mdash; this may take a moment</div>
            </div>`;
        document.getElementById('showsMeta').textContent = '';

        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`Server returned ${res.status}`);
                return res.json();
            })
            .then(data => {
                // Normalize to always have artists array (handles old cached data with single artist)
                allShows = (data.shows || []).map(show => {
                    if (!show.artists) {
                        show.artists = show.artist ? [show.artist] : [];
                    }
                    if (!show.spotifyArtistIds && show.spotifyArtistId) {
                        show.spotifyArtistIds = [show.spotifyArtistId];
                    }
                    return show;
                });

                // Build venues list; filter out entries with no name (name===null means unknown)
                const rawVenues = data.venues || [];
                venues = rawVenues
                    .filter(v => v.name !== null && v.name !== undefined)
                    .map(v => ({ id: v.id, name: v.name, displayName: v.name }))
                    .sort((a, b) => a.displayName.localeCompare(b.displayName));

                // If no named venues came back, use all venue IDs with placeholder labels
                if (venues.length === 0 && rawVenues.length > 0) {
                    venues = rawVenues.map((v, i) => ({
                        id: v.id,
                        name: v.id,
                        displayName: `Venue ${i + 1}`
                    }));
                }

                selectedVenueIds = new Set(venues.map(v => v.id));
                buildVenueCheckboxes();
                updateDropdownLabel();
                renderShows();
            })
            .catch(err => {
                document.getElementById('showsContainer').innerHTML =
                    `<div class="state-msg error">Failed to load shows.<br><small>${escHtml(err.message)}</small><br>
                     <a href="/atlanta-shows?refresh=1" class="retry-link">Retry</a></div>`;
            });
    }

    // Support ?refresh=1 in URL to bypass server cache
    const refresh = new URLSearchParams(window.location.search).get('refresh') === '1';
    loadShows(refresh ? '/api/atlanta-shows?refresh=1' : '/api/atlanta-shows');
});
