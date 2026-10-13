#!/usr/bin/env node
// Capture a real poster for each experience by screenshotting it at card size.
//   npm i -D playwright && npx playwright install chromium
//   npm run poster              (all experiences)
//   npm run poster -- my-slug   (one)
// Writes experiences/<slug>/poster.png (2x the card size). Skips ones that already
// have a poster unless you pass --force. Optional: experience.json "posterDelayMs".
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DIST, EXP_DIR, loadConfig, listExperiences } from './lib.js';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  console.error('Playwright is not installed. Run:\n  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter(a => !a.startsWith('--'));
const PORT = 5199;
process.env.BASE_URL = `http://localhost:${PORT}`;
const { build } = await import('./build.js');
build({ quiet: true, includeDrafts: true });

const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

const browser = await chromium.launch();
const cfg = loadConfig();
for (const e of listExperiences(cfg)) {
  if (only.length && !only.includes(e.slug)) continue;
  const out = path.join(EXP_DIR, e.slug, 'poster.png');
  if (fs.existsSync(out) && !force) { console.log(`  - ${e.slug}: has poster.png (use --force to replace)`); continue; }
  const meta = JSON.parse(fs.readFileSync(path.join(EXP_DIR, e.slug, 'experience.json'), 'utf8'));
  const page = await browser.newPage({ viewport: { width: e.width, height: e.height }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${PORT}/e/${e.slug}/app/?mode=poster`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(meta.posterDelayMs ?? 1500);
  await page.screenshot({ path: out });
  await page.close();
  console.log(`  ✓ ${e.slug}: wrote experiences/${e.slug}/poster.png`);
}
await browser.close();
server.close();
build({ quiet: true });
