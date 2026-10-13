#!/usr/bin/env node
// Local dev server: builds, watches experiences/ for changes, serves dist/,
// and adds /__preview/<slug> — a mock timeline post showing the card at feed width.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, DIST, EXP_DIR, esc, loadConfig, listExperiences } from './lib.js';

const PORT = Number(process.env.PORT || 5173);
process.env.BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Build in a child process so edits to scripts/ are picked up too.
function rebuild(quiet) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js'), '--drafts'], { stdio: quiet ? 'pipe' : 'inherit', env: process.env });
  return { exps: listExperiences(loadConfig()) };
}
let state = rebuild(false);
let timer = null;
for (const dir of [EXP_DIR, path.join(ROOT, 'sdk'), path.join(ROOT, 'scripts'), path.join(ROOT, 'site.config.json')]) {
  fs.watch(dir, { recursive: !dir.endsWith('.json') }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { state = rebuild(true); console.log('↻ rebuilt'); }
      catch (err) { console.error('build failed:', String(err.stderr || err.message)); }
    }, 150);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function previewPage(e) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview · ${esc(e.title)}</title>
<style>
  body { margin:0; background:#000; color:#e7e9ea; font:15px/1.35 system-ui, sans-serif; }
  .feed { max-width: 600px; margin: 0 auto; border-left:1px solid #2f3336; border-right:1px solid #2f3336; min-height:100vh; }
  .note { padding:10px 16px; font-size:12px; color:#71767b; border-bottom:1px solid #2f3336; }
  article { display:grid; grid-template-columns: 40px 1fr; gap:12px; padding:12px 16px; border-bottom:1px solid #2f3336; }
  .av { width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg,${e.accent},#222); }
  .who b { color:#e7e9ea } .who span { color:#71767b }
  .card { margin-top:12px; border:1px solid #2f3336; border-radius:16px; overflow:hidden; }
  .frame { position:relative; aspect-ratio:${e.width}/${e.height}; background:#111; }
  .frame img, .frame iframe { position:absolute; inset:0; width:100%; height:100%; border:0; object-fit:cover; }
  .play { position:absolute; inset:0; display:grid; place-items:center; cursor:pointer; background:none; border:0; }
  .play span { width:64px; height:64px; border-radius:50%; background:rgba(29,155,240,.9); display:grid; place-items:center; }
  .meta { padding:10px 12px; border-top:1px solid #2f3336; color:#71767b; font-size:13px; }
  .meta b { display:block; color:#e7e9ea; font-weight:400; }
  .sizes { display:flex; gap:6px; padding:8px 16px; border-bottom:1px solid #2f3336; }
  .sizes button { background:#16181c; color:#e7e9ea; border:1px solid #2f3336; border-radius:999px; padding:4px 10px; cursor:pointer; font:inherit; font-size:12px; }
</style></head><body>
<div class="feed" id="feed">
  <div class="note">Local preview of how the card sits in a timeline. Tap the poster to load the player, as X does.</div>
  <div class="sizes"><button data-w="600">Desktop (600)</button><button data-w="390">Phone (390)</button><button data-w="320">Small (320)</button></div>
  <article><div class="av"></div><div>
    <div class="who"><b>You</b> <span>${esc('@you')} · now</span></div>
    <div>Try this — it runs right here in the post 👇</div>
    <div class="card">
      <div class="frame" id="frame"><img src="/e/${e.slug}/poster.png" alt="">
        <button class="play" id="play" aria-label="Play"><span><svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span></button></div>
      <div class="meta">${esc(new URL(process.env.BASE_URL).host)}<b>${esc(e.title)}</b></div>
    </div>
  </div></article>
</div>
<script>
document.getElementById('play').onclick = function () {
  var f = document.getElementById('frame');
  f.innerHTML = '<iframe src="/e/${e.slug}/player.html" allow="autoplay; fullscreen" allowfullscreen></iframe>';
};
document.querySelectorAll('.sizes button').forEach(function (b) {
  b.onclick = function () { document.getElementById('feed').style.maxWidth = b.dataset.w + 'px'; };
});
</script></body></html>`;
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);

  const pm = p.match(/^\/__preview\/([^/]+)\/?$/);
  if (pm) {
    const e = state.exps.find(x => x.slug === pm[1]);
    res.writeHead(e ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(e ? previewPage(e) : 'Unknown experience');
  }

  let file = path.join(DIST, p);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, { location: p + '/' + u.search }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`\nDev server: http://localhost:${PORT}/`);
  for (const e of state.exps) console.log(`  preview  http://localhost:${PORT}/__preview/${e.slug}`);
});
