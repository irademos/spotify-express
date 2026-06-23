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
        if (selectedVenueIds.size === 0) {
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
            lbl.textContent = v.name;

            item.appendChild(cb);
            item.appendChild(lbl);
            container.appendChild(item);
        });
    }

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    function parseDate(datetime) {
        // datetime like "2026-06-25T19:00-04:00"
        // Split at T to avoid timezone pitfalls when just displaying the calendar date
        const datePart = datetime.split('T')[0];
        const [year, month, day] = datePart.split('-').map(Number);
        // Use UTC constructor so no local timezone shift on the date
        const d = new Date(Date.UTC(year, month - 1, day));
        return {
            sortKey: datetime,
            monthStr: MONTHS[d.getUTCMonth()],
            dayNum: d.getUTCDate(),
            dayOfWeek: DAYS[d.getUTCDay()],
            year: d.getUTCFullYear()
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
            container.innerHTML = '<div class="state-msg">No shows match the selected venues.</div>';
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

    fetch('/api/atlanta-shows')
        .then(res => {
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            return res.json();
        })
        .then(data => {
            allShows = data.shows || [];
            venues = (data.venues || []).sort((a, b) => a.name.localeCompare(b.name));
            selectedVenueIds = new Set(venues.map(v => v.id));

            if (allShows.length === 0) {
                document.getElementById('showsContainer').innerHTML =
                    '<div class="state-msg">No upcoming shows found. Spotify may have blocked the request &mdash; try again later.</div>';
                return;
            }

            buildVenueCheckboxes();
            updateDropdownLabel();
            renderShows();
        })
        .catch(err => {
            document.getElementById('showsContainer').innerHTML =
                `<div class="state-msg error">Failed to load shows.<br><small>${escHtml(err.message)}</small></div>`;
        });
});
