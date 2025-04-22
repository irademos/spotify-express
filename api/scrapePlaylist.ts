// const express = require('express');
import express from 'express';


const router = express.Router();

router.get('/', async (req, res, next) => {
    try {
        console.log("Here up");
        const url = req.query.url;
        if (!url) {
            return res.status(400).send('URL parameter is missing');
        }

        console.log("Here");
        const response = ""
        // const response = await axios.get(url);
        // const $ = cheerio.load(response.data);

        // const tracks = [];
        // $('div.Box__BoxComponent-sc-y4nds-0').each((_, el) => {
        //     const trackName = $(el).find('span.ListRowTitle__LineClamp-sc-1xe2if1-0').text().trim();
        //     const artistName = $(el).find('p.ListRowDetails__ListRowDetailText-sc-sozu4l-0').text().trim();

        //     if (trackName && artistName) {
        //         tracks.push({ track: trackName, artist: artistName });
        //     }
        // });

        // if (tracks.length === 0) {
        //     return res.status(404).send('No tracks found in the playlist');
        // }

        // res.status(200).json(tracks);  // Respond with the tracks in JSON format


        res.status(200).send(response);
    } catch (error) {
        console.error('Error scraping playlist:', error.message);
        next(error);  // Pass the error to the error handling middleware
    }
});

// Error handling middleware
router.use((err, req, res, next) => {
    // console.error('Internal server error:', err.message);
    console.log(err);
    console.log(req);
    console.log(next);
    res.status(500).send('Internal Server Error');
});

module.exports = router;
