// import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    return res.status(400).send('URL parameter is missing or invalid');
  }

  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const tracks: { track: string; artist: string }[] = [];

    $('div.Box__BoxComponent-sc-y4nds-0').each((_, el) => {
      const trackName = $(el).find('span.ListRowTitle__LineClamp-sc-1xe2if1-0').text().trim();
      const artistName = $(el).find('p.ListRowDetails__ListRowDetailText-sc-sozu4l-0').text().trim();
      if (trackName && artistName) {
        tracks.push({ track: trackName, artist: artistName });
      }
    });

    if (tracks.length === 0) {
      return res.status(404).send('No tracks found');
    }

    res.status(200).json(tracks);
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).send('Scrape failed');
  }
}
