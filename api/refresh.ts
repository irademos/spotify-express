import express from 'express';
const axios = require('axios');
const router = express.Router();

// These should be securely stored (e.g., in environment variables)
const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;

router.post('/refresh-token', async (req, res) => {
    const { refresh_token } = req.body;

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refresh_token);

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64')
    };

    try {
        const response = await axios.post('https://accounts.spotify.com/api/token', params, { headers });
        res.json(response.data); // includes new access_token (and sometimes a new refresh_token)
    } catch (err) {
        console.error('Error refreshing token:', err.response?.data || err.message);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

module.exports = router;
