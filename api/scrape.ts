import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

export default async function scrapeHandler(req: Request, res: Response) {
  const url = req.query.url as string;
  if (!url) return res.status(400).send('Missing URL');

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

    if (!tracks.length) return res.status(404).send('No tracks found');
    return res.status(200).json(tracks);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Failed to scrape');
  }
}