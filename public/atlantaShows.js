document.addEventListener('DOMContentLoaded', function () {
    let allShows = [];
    let venues = [];
    let selectedVenueIds = new Set();

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

        visible.forEach(show => {
            const date = parseDate(show.datetime);
            const li = document.createElement('li');
            li.className = 'show-item';
            li.innerHTML = `
                <div class="show-date">
                    <div class="date-main">${escHtml(date.monthStr)} ${date.dayNum}</div>
                    <div class="date-sub">${date.dayOfWeek}, ${date.year}</div>
                </div>
                <div class="show-artist">${escHtml(show.artist)}</div>
                <div class="show-venue-name">${escHtml(show.venue)}</div>
            `;
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
                allShows = data.shows || [];

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
