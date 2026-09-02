document.addEventListener('DOMContentLoaded', function () {
    let allShows = [];
    let allApiVenues = [];
    let venues = [];
    let selectedVenueIds = new Set();
    let reportedVenueIds = new Set(); // venues this user has already reported

    // ── City / scraping venue config ────────────────────────────────────────
    let cityVenueData = []; // [{city, venues:[{id,name}]}]
    let selectedCity = 'Atlanta';

    function extractVenueId(raw) {
        raw = raw.trim();
        // Accept full Spotify URL: https://open.spotify.com/venue/<id>
        const urlMatch = raw.match(/open\.spotify\.com\/venue\/([A-Za-z0-9]+)/);
        if (urlMatch) return urlMatch[1];
        // Accept spotify:venue:<id>
        const uriMatch = raw.match(/spotify:venue:([A-Za-z0-9]+)/);
        if (uriMatch) return uriMatch[1];
        // Accept plain ID (alphanumeric, ~22 chars)
        if (/^[A-Za-z0-9]{10,30}$/.test(raw)) return raw;
        return null;
    }

    function currentCityVenues() {
        const entry = cityVenueData.find(e => e.city === selectedCity);
        return entry ? entry.venues : [];
    }

    function renderScrapeVenues() {
        const list = document.getElementById('scrapeVenueList');
        const countEl = document.getElementById('scrapeVenueCount');
        const labelEl = document.getElementById('scrapeLabel');
        const cityVenues = currentCityVenues();

        labelEl.textContent = cityVenues.length === 0
            ? 'No venues configured'
            : `${cityVenues.length} venue${cityVenues.length !== 1 ? 's' : ''}`;

        list.innerHTML = '';
        if (cityVenues.length === 0) {
            list.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:#888;">No venues — use + to add one</div>';
            countEl.textContent = '';
            return;
        }

        const sorted = [...cityVenues].sort((a, b) =>
            (a.name || a.id).localeCompare(b.name || b.id));

        sorted.forEach(v => {
            const row = document.createElement('div');
            row.className = 'scrape-venue-item';

            const name = document.createElement('span');
            name.className = 'scrape-venue-name';
            name.textContent = v.name || '(unnamed)';
            name.title = v.name || '';

            const idSpan = document.createElement('span');
            idSpan.className = 'scrape-venue-id';
            idSpan.textContent = v.id;
            idSpan.title = v.id;

            const reportBtn = document.createElement('button');
            reportBtn.className = 'report-venue-btn';
            const alreadyReported = reportedVenueIds.has(v.id);
            reportBtn.textContent = alreadyReported ? '✓' : '⚑';
            reportBtn.title = alreadyReported ? 'Already reported' : 'Report venue';
            reportBtn.disabled = alreadyReported;
            reportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                reportVenue(selectedCity, v.id, v.name);
            });

            row.appendChild(name);
            row.appendChild(idSpan);
            row.appendChild(reportBtn);
            list.appendChild(row);
        });

        countEl.textContent = `${cityVenues.length} venue${cityVenues.length !== 1 ? 's' : ''} added to ${selectedCity}`;
    }

    function populateCitySelect() {
        const sel = document.getElementById('citySelect');
        const currentVal = sel.value || selectedCity;
        sel.innerHTML = '';
        cityVenueData.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.city;
            opt.textContent = e.city;
            sel.appendChild(opt);
        });
        if (cityVenueData.find(e => e.city === currentVal)) {
            sel.value = currentVal;
        } else if (cityVenueData.length > 0) {
            sel.value = cityVenueData[0].city;
        }
        selectedCity = sel.value;
    }

    async function loadCityVenues() {
        try {
            const res = await fetch('/api/city-venues');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            cityVenueData = await res.json();
            populateCitySelect();
            renderScrapeVenues();
        } catch (err) {
            console.error('Failed to load city venues:', err);
            document.getElementById('scrapeLabel').textContent = 'Error loading';
        }
    }

    async function reportVenue(city, venueId, venueName) {
        try {
            const res = await fetch('/api/venue-reports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ city, venueId, venueName })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            reportedVenueIds.add(venueId);
            renderScrapeVenues();
        } catch (err) {
            alert('Failed to report venue: ' + err.message);
        }
    }

    function rebuildVenuesForCity() {
        const cityVenues = currentCityVenues();
        if (cityVenues.length > 0) {
            // Use cityVenueData names, falling back to API-returned names
            const apiVenueById = new Map(allApiVenues.map(v => [v.id, v]));
            venues = cityVenues
                .map(v => {
                    const api = apiVenueById.get(v.id);
                    const name = v.name || api?.name || null;
                    return name ? { id: v.id, name, displayName: name } : null;
                })
                .filter(Boolean)
                .sort((a, b) => a.displayName.localeCompare(b.displayName));

            if (venues.length === 0) {
                venues = cityVenues.map((v, i) => ({
                    id: v.id,
                    name: v.id,
                    displayName: `Venue ${i + 1}`
                }));
            }
        } else {
            venues = [...allApiVenues];
        }

        selectedVenueIds = new Set(venues.map(v => v.id));
        buildVenueCheckboxes();
        updateDropdownLabel();
        renderShows();
    }

    // City select
    document.getElementById('citySelect').addEventListener('change', function () {
        selectedCity = this.value;
        renderScrapeVenues();
        loadShows(`/api/shows/${encodeURIComponent(selectedCity)}`);
    });

    // Scrape dropdown open/close
    const scrapeTrigger = document.getElementById('scrapeTrigger');
    const scrapePanel = document.getElementById('scrapePanel');
    const scrapeWrapper = document.getElementById('scrapeDropdownWrapper');

    scrapeTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = scrapePanel.classList.toggle('open');
        scrapeTrigger.classList.toggle('open', isOpen);
    });
    scrapePanel.addEventListener('click', (e) => e.stopPropagation());
    scrapeWrapper.addEventListener('click', (e) => e.stopPropagation());

    // Add city
    const addCityBtn = document.getElementById('addCityBtn');
    const addCityInline = document.getElementById('addCityInline');
    const addCityInput = document.getElementById('addCityInput');
    const addCityConfirm = document.getElementById('addCityConfirm');
    const addCityCancel = document.getElementById('addCityCancel');

    addCityBtn.addEventListener('click', () => {
        addCityInline.classList.toggle('visible');
        if (addCityInline.classList.contains('visible')) addCityInput.focus();
    });

    addCityCancel.addEventListener('click', () => {
        addCityInline.classList.remove('visible');
        addCityInput.value = '';
    });

    async function submitAddCity() {
        const city = addCityInput.value.trim();
        if (!city) return;
        try {
            const res = await fetch('/api/city-venues', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ city })
            });
            if (res.status === 409) {
                alert(`"${city}" already exists.`);
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            cityVenueData.push({ city, venues: [] });
            cityVenueData.sort((a, b) => a.city.localeCompare(b.city));
            addCityInput.value = '';
            addCityInline.classList.remove('visible');
            populateCitySelect();
            document.getElementById('citySelect').value = city;
            selectedCity = city;
            renderScrapeVenues();
        } catch (err) {
            alert('Failed to add city: ' + err.message);
        }
    }

    addCityConfirm.addEventListener('click', submitAddCity);
    addCityInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAddCity(); });

    // Add venue
    const addVenueBtn = document.getElementById('addVenueBtn');
    const addVenueInline = document.getElementById('addVenueInline');
    const addVenueInput = document.getElementById('addVenueInput');
    const addVenueConfirm = document.getElementById('addVenueConfirm');
    const addVenueCancel = document.getElementById('addVenueCancel');

    addVenueBtn.addEventListener('click', () => {
        addVenueInline.classList.toggle('visible');
        if (addVenueInline.classList.contains('visible')) addVenueInput.focus();
    });

    addVenueCancel.addEventListener('click', () => {
        addVenueInline.classList.remove('visible');
        addVenueInput.value = '';
    });

    async function submitAddVenue() {
        const raw = addVenueInput.value.trim();
        const venueId = extractVenueId(raw);
        if (!venueId) {
            alert('Enter a valid Spotify venue ID or URL (e.g. https://open.spotify.com/venue/...). ');
            return;
        }
        try {
            const res = await fetch(`/api/city-venues/${encodeURIComponent(selectedCity)}/venues`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ venueId })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (!json.already) {
                const entry = cityVenueData.find(e => e.city === selectedCity);
                if (entry) entry.venues.push({ id: venueId, name: null });
            }
            addVenueInput.value = '';
            addVenueInline.classList.remove('visible');
            renderScrapeVenues();
        } catch (err) {
            alert('Failed to add venue: ' + err.message);
        }
    }

    addVenueConfirm.addEventListener('click', submitAddVenue);
    addVenueInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAddVenue(); });

    loadCityVenues();

    // Show admin link if this user is admin
    fetch('/api/is-admin').then(r => r.json()).then(d => {
        if (d.isAdmin) document.getElementById('adminLink').style.display = '';
    }).catch(() => {});

    // Trigger scrape GitHub Action
    document.getElementById('triggerScrapeBtn').addEventListener('click', async function () {
        const btn = this;
        const status = document.getElementById('triggerScrapeStatus');
        btn.disabled = true;
        btn.textContent = 'Triggering…';
        status.textContent = '';
        try {
            const res = await fetch('/api/trigger-scrape', { method: 'POST' });
            const json = await res.json();
            if (res.ok) {
                status.textContent = 'Scrape triggered! Check GitHub Actions for progress.';
                status.style.color = '#1DB954';
            } else {
                status.textContent = json.error || 'Failed to trigger.';
                status.style.color = '#c00';
            }
        } catch (err) {
            status.textContent = 'Network error: ' + err.message;
            status.style.color = '#c00';
        } finally {
            btn.disabled = false;
            btn.textContent = '▶ Check for Updates';
        }
    });

    // ────────────────────────────────────────────────────────────────────────

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

    function getTodayUtc() {
        const now = new Date();
        return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    }

    function isUpcoming(show) {
        const datePart = show.datetime.split('T')[0];
        const [year, month, day] = datePart.split('-').map(Number);
        return Date.UTC(year, month - 1, day) >= getTodayUtc();
    }

    function getVisibleShows() {
        return allShows.filter(s => selectedVenueIds.has(s.venueId) && isUpcoming(s));
    }

    function updateAllPlayButtons() {
        document.querySelectorAll('.play-btn').forEach(btn => {
            const active = btn.dataset.key === currentPlayingKey && isPlaying;
            btn.textContent = active ? '⏸' : '▶';
            btn.title = active ? 'Pause' : 'Play';
        });

        const activeShowKey = currentPlayingKey && isPlaying
            ? currentPlayingKey.slice(0, currentPlayingKey.indexOf('::artist::'))
            : null;
        document.querySelectorAll('.show-item').forEach(li => {
            li.classList.toggle('show-item--playing', li.dataset.showKey === activeShowKey);
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

    // Image popup
    const imgPopupOverlay = document.getElementById('imgPopupOverlay');
    const imgPopupImg = document.getElementById('imgPopupImg');

    function openImgPopup(src, alt) {
        imgPopupImg.src = src;
        imgPopupImg.alt = alt;
        imgPopupOverlay.classList.add('active');
    }

    function closeImgPopup() {
        imgPopupOverlay.classList.remove('active');
        imgPopupImg.src = '';
    }

    document.getElementById('imgPopupClose').addEventListener('click', closeImgPopup);
    imgPopupOverlay.addEventListener('click', (e) => {
        if (e.target === imgPopupOverlay) closeImgPopup();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeImgPopup();
    });

    document.getElementById('backBtn').addEventListener('click', () => {
        window.location.href = '/upcoming-shows';
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
        scrapePanel.classList.remove('open');
        scrapeTrigger.classList.remove('open');
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

        const visible = allShows.filter(s => selectedVenueIds.has(s.venueId) && isUpcoming(s));

        if (visible.length === 0) {
            meta.textContent = '';
            if (allShows.length === 0) {
                container.innerHTML = `
                    <div class="state-msg">
                        No shows loaded yet — Spotify's API is still being explored.<br>
                        <a href="/upcoming-shows?refresh=1" class="retry-link">Retry</a>
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
            li.dataset.showKey = showKey(show);

            const dateDiv = document.createElement('div');
            dateDiv.className = 'show-date-cell';

            if (show.firstArtistAvatarUrl) {
                const avatar = document.createElement('img');
                avatar.className = 'artist-avatar';
                avatar.src = show.firstArtistAvatarUrl;
                avatar.alt = show.artists[0] || '';
                avatar.loading = 'lazy';
                avatar.addEventListener('click', () => openImgPopup(show.firstArtistAvatarUrl, show.artists[0] || ''));
                dateDiv.appendChild(avatar);
            }

            const dateInfo = document.createElement('div');
            dateInfo.className = 'show-date';
            const dateContent = `<div class="date-main">${escHtml(date.monthStr)} ${date.dayNum}</div><div class="date-sub">${date.dayOfWeek}, ${date.year}</div>`;

            if (show.concertUri) {
                const concertId = show.concertUri.split(':')[2];
                const dateLink = document.createElement('a');
                dateLink.href = `https://open.spotify.com/concert/${concertId}`;
                dateLink.target = '_blank';
                dateLink.rel = 'noopener noreferrer';
                dateLink.className = 'date-link';
                dateLink.innerHTML = dateContent;
                dateInfo.appendChild(dateLink);
            } else {
                dateInfo.innerHTML = dateContent;
            }

            dateDiv.appendChild(dateInfo);

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

                // Build full API venue list (used for cross-referencing names)
                const rawVenues = data.venues || [];
                allApiVenues = rawVenues
                    .filter(v => v.name !== null && v.name !== undefined)
                    .map(v => ({ id: v.id, name: v.name, displayName: v.name }))
                    .sort((a, b) => a.displayName.localeCompare(b.displayName));

                if (allApiVenues.length === 0 && rawVenues.length > 0) {
                    allApiVenues = rawVenues.map((v, i) => ({
                        id: v.id,
                        name: v.id,
                        displayName: `Venue ${i + 1}`
                    }));
                }

                // Build venues for the currently selected city
                rebuildVenuesForCity();
            })
            .catch(err => {
                document.getElementById('showsContainer').innerHTML =
                    `<div class="state-msg error">Failed to load shows.<br><small>${escHtml(err.message)}</small><br>
                     <a href="/upcoming-shows?refresh=1" class="retry-link">Retry</a></div>`;
            });
    }

    // Support ?refresh=1 in URL to bypass server cache
    const refresh = new URLSearchParams(window.location.search).get('refresh') === '1';
    const initialUrl = `/api/shows/${encodeURIComponent(selectedCity)}` + (refresh ? '?refresh=1' : '');
    loadShows(initialUrl);
});
