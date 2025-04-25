async function fetchWithSpotifyAuth(url, options = {}, retry = true) {
    let accessToken = document.cookie.match(/spotifyAccessToken=([^;]+)/)?.[1];

    const res = await fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${accessToken}`
        }
    });

    // Token expired — refresh and retry once
    if (res.status === 401 && retry) {
        const refreshToken = document.cookie.match(/spotifyRefreshToken=([^;]+)/)?.[1];
        const refreshRes = await fetch('/api/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
        });

        const refreshData = await refreshRes.json();
        if (refreshData.access_token) {
            document.cookie = `spotifyAccessToken=${refreshData.access_token}; path=/`;

            // Retry original request with new token
            return fetchWithSpotifyAuth(url, options, false);
        } else {
            throw new Error('Token refresh failed');
        }
    }

    return res;
}