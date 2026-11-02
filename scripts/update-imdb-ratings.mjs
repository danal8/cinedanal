import { mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const API_URL = 'https://odtbtugzilxsfqxlpofq.supabase.co/functions/v1/cinedanal-api';
const DATASET_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
const MAX_IDS = 50_000;

const trackedResponse = await fetch(API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'trackedRatingIds' }),
});
if (!trackedResponse.ok) throw new Error(`Tracked IDs request failed: ${trackedResponse.status}`);
const tracked = await trackedResponse.json();
const ids = Array.isArray(tracked.ids) ? tracked.ids.filter(id => /^tt\d+$/.test(id)) : [];
if (!ids.length) throw new Error('No tracked IMDb IDs returned; refusing to overwrite the current ratings file.');
if (ids.length > MAX_IDS) throw new Error(`Tracked IMDb ID limit exceeded: ${ids.length}`);

const wanted = new Set(ids);
const datasetResponse = await fetch(DATASET_URL);
if (!datasetResponse.ok || !datasetResponse.body) {
  throw new Error(`IMDb dataset download failed: ${datasetResponse.status}`);
}

const ratings = new Map();
const lines = createInterface({
  input: Readable.fromWeb(datasetResponse.body).pipe(createGunzip()),
  crlfDelay: Infinity,
});
let firstLine = true;
for await (const line of lines) {
  if (firstLine) { firstLine = false; continue; }
  const [id, ratingText, votesText] = line.split('\t');
  if (!wanted.has(id)) continue;
  const rating = Number(ratingText);
  const votes = Number(votesText);
  if (Number.isFinite(rating) && rating > 0) ratings.set(id, { r: rating, v: votes });
}
if (!ratings.size) throw new Error('No tracked IDs matched the IMDb dataset; refusing to overwrite.');

const sortedRatings = Object.fromEntries([...ratings.entries()].sort(([a], [b]) => a.localeCompare(b)));
const output = {
  updatedAt: new Date().toISOString(),
  source: 'IMDb Non-Commercial Datasets',
  ratings: sortedRatings,
};
await mkdir('data', { recursive: true });
await writeFile('data/imdb-ratings.json', `${JSON.stringify(output)}\n`, 'utf8');
console.log(`Saved ${ratings.size} official IMDb ratings for ${ids.length} tracked titles.`);

