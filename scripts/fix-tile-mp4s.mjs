/**
 * Re-mux all tile MP4s with -movflags +faststart so the moov atom sits at
 * the beginning of each file.  This lets the browser seek to any timestamp
 * without a second round-trip to fetch the atom from the end — eliminating
 * the buffering gap that causes the "stuck playback" bug.
 *
 * Run once:  node scripts/fix-tile-mp4s.mjs
 */

import { createRequire } from 'module';
import { readdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname, parse } from 'path';
import { fileURLToPath } from 'url';

const require     = createRequire(import.meta.url);
const ffmpeg      = require('fluent-ffmpeg');
const ffmpegPath  = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const __dirname = dirname(fileURLToPath(import.meta.url));
const TILES_DIR = join(__dirname, '..', 'public', 'tiles');

function findMp4s(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMp4s(full));
    else if (entry.name.endsWith('.mp4')) results.push(full);
  }
  return results;
}

function remux(input) {
  const { dir, name } = parse(input);
  const tmp = join(dir, `${name}_tmp.mp4`);
  return new Promise((resolve, reject) =>
    ffmpeg(input)
      .outputOptions(['-c copy', '-movflags +faststart'])
      .output(tmp)
      .on('end', () => {
        unlinkSync(input);
        renameSync(tmp, input);
        resolve();
      })
      .on('error', (err) => {
        try { unlinkSync(tmp); } catch {}
        reject(err);
      })
      .run()
  );
}

const files = findMp4s(TILES_DIR);
console.log(`Found ${files.length} tile MP4s in ${TILES_DIR}`);

let done = 0;
for (const f of files) {
  const rel = f.replace(TILES_DIR + '\\', '').replace(TILES_DIR + '/', '');
  process.stdout.write(`  [${++done}/${files.length}] ${rel} ... `);
  await remux(f);
  console.log('done');
}

console.log('\nAll tiles remuxed with +faststart.');
