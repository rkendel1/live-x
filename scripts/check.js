#!/usr/bin/env node
// Card checker — stands in for X's retired Card Validator.
//   npm run check -- https://play.example.com/e/gravity-garden/
//   npm run check -- http://localhost:5173/e/gravity-garden/ --local   (skips HTTPS rules)
//
// Fetches the share page the way X's crawler does, then verifies every hop:
// meta tags, poster image, player page framability, app page, robots.txt.

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const local = args.includes('--local');
if (!target) { console.error('Usage: npm run check -- <share-page-url> [--local]'); process.exit(2); }

const UA = 'Twitterbot/1.0';
let fails = 0, warns = 0;
const ok = m => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = m => { fails++; console.log('  \x1b[31m✗\x1b[0m ' + m); };
const warn = m => { warns++; console.log('  \x1b[33m!\x1b[0m ' + m); };

async function get(url, method = 'GET') {
  const r = await fetch(url, { method, redirect: 'follow', headers: { 'user-agent': UA } });
  return r;
}

function metaTags(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = (tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (key && val !== undefined && !(key in out)) out[key.toLowerCase()] = val.replace(/&amp;/g, '&');
  }
  return out;
}

function frameBlockers(res) {
  const xfo = res.headers.get('x-frame-options');
  const csp = res.headers.get('content-security-policy') || '';
  const fa = (csp.match(/frame-ancestors([^;]*)/i) || [])[1];
  const problems = [];
  if (xfo) problems.push(`X-Frame-Options: ${xfo} (blocks X from framing it — remove this header)`);
  if (fa && !/\*|x\.com|twitter\.com/.test(fa)) problems.push(`CSP frame-ancestors '${fa.trim()}' doesn't allow X`);
  return problems;
}

(async () => {
  console.log(`\nChecking ${target}\n`);

  // Hop 1 — share page
  console.log('Share page (what X\'s crawler reads)');
  let res;
  try { res = await get(target); } catch (e) { bad(`Could not fetch: ${e.message}`); return finish(); }
  if (!res.ok) { bad(`HTTP ${res.status}`); return finish(); }
  ok(`HTTP ${res.status} for UA "${UA}"`);
  if (!local && !res.url.startsWith('https://')) bad('Share page must be served over HTTPS');
  const html = await res.text();
  if (html.length > 1_000_000) warn('Share page is over 1 MB; crawlers may give up before the meta tags');
  const m = metaTags(html);

  const need = ['twitter:card', 'twitter:title', 'twitter:player', 'twitter:player:width', 'twitter:player:height', 'twitter:image'];
  for (const k of need) if (!m[k]) bad(`Missing <meta name="${k}">`);
  if (m['twitter:card'] && m['twitter:card'] !== 'player') bad(`twitter:card is "${m['twitter:card']}", must be "player"`);
  else if (m['twitter:card']) ok('twitter:card = player');
  if (m['twitter:title']) (m['twitter:title'].length > 70 ? warn : ok)(`title (${m['twitter:title'].length} chars)${m['twitter:title'].length > 70 ? ' — X truncates after ~70' : ''}`);
  if ((m['twitter:description'] || '').length > 200) warn('description over 200 chars will be truncated');
  if (!m['twitter:site']) warn('twitter:site (@handle) not set — approval requests tie a domain to an account');
  const w = +m['twitter:player:width'], h = +m['twitter:player:height'];
  if (m['twitter:player:width']) (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 ? ok : bad)(`player size ${w}x${h}`);

  const abs = u => new URL(u, res.url).href;

  // Hop 2 — poster
  if (m['twitter:image']) {
    console.log('\nPoster image (shown before tap, and as the fallback)');
    const img = abs(m['twitter:image']);
    if (!local && !img.startsWith('https://')) bad('twitter:image must be HTTPS');
    try {
      const r = await get(img);
      const type = r.headers.get('content-type') || '';
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok) bad(`HTTP ${r.status} for ${img}`);
      else if (!/image\/(png|jpe?g|webp|gif)/.test(type)) bad(`content-type "${type}" — use PNG, JPEG, WEBP or GIF`);
      else {
        ok(`${type}, ${(buf.length / 1024).toFixed(0)} KB`);
        if (buf.length > 5 * 1024 * 1024) bad('image over 5 MB — X will reject it');
        if (type.includes('png') && buf.length > 24) {
          const iw = buf.readUInt32BE(16), ih = buf.readUInt32BE(20);
          const ratioPoster = iw / ih, ratioPlayer = w / h;
          (Math.abs(ratioPoster - ratioPlayer) < 0.02 ? ok : warn)(`poster ${iw}x${ih} — ${Math.abs(ratioPoster - ratioPlayer) < 0.02 ? 'matches' : 'does NOT match'} the player aspect ratio`);
          if (iw * ih < 68600) bad('poster smaller than X\'s 68,600 px minimum for player cards');
        }
      }
    } catch (e) { bad(`Could not fetch poster: ${e.message}`); }
  }

  // Hop 3 — player shell
  if (m['twitter:player']) {
    console.log('\nPlayer page (what X iframes inside the post)');
    const pl = abs(m['twitter:player']);
    if (!local && !pl.startsWith('https://')) bad('twitter:player must be HTTPS');
    try {
      const r = await get(pl);
      if (!r.ok) bad(`HTTP ${r.status} for ${pl}`); else ok(`HTTP ${r.status}`);
      const blocks = frameBlockers(r);
      blocks.length ? blocks.forEach(bad) : ok('framable (no X-Frame-Options / restrictive frame-ancestors)');
      const body = await r.text();
      if (!local && /(src|href)\s*=\s*["']http:\/\//i.test(body)) bad('player references http:// resources (mixed content will be blocked)');
      const appSrc = (body.match(/app\.src\s*=\s*'([^']+)'/) || [])[1];

      // Hop 4 — the app itself
      if (appSrc) {
        console.log('\nExperience app (loaded by the player)');
        const au = new URL(appSrc, pl).href;
        const ar = await get(au);
        if (!ar.ok) bad(`HTTP ${ar.status} for ${au}`); else ok(`HTTP ${ar.status}`);
        frameBlockers(ar).forEach(bad);
        const ab = await ar.text();
        (ab.includes('xembed.js') ? ok : warn)(ab.includes('xembed.js') ? 'XEmbed SDK present' : 'XEmbed SDK not found — the shell will wait for its timeout');
        if (!local && /(src|href)\s*=\s*["']http:\/\//i.test(ab)) bad('app references http:// resources');
        if (ab.length > 500_000) warn(`app HTML is ${(ab.length / 1024).toFixed(0)} KB — keep the first load light for mobile`);
      }
    } catch (e) { bad(`Could not fetch player: ${e.message}`); }
  }

  // robots.txt
  console.log('\nCrawler access');
  try {
    const rb = await get(new URL('/robots.txt', res.url).href);
    if (rb.ok) {
      const txt = await rb.text();
      const blocked = /user-agent:\s*(twitterbot|\*)\s*[\r\n]+(?:[^\r\n]*[\r\n]+)*?\s*disallow:\s*\/\s*$/im.test(txt);
      (blocked ? bad : ok)(blocked ? 'robots.txt appears to disallow Twitterbot' : 'robots.txt allows Twitterbot');
    } else ok('no robots.txt (crawler allowed)');
  } catch { warn('could not read robots.txt'); }

  finish();
})();

function finish() {
  console.log(`\n${fails ? '\x1b[31m' + fails + ' problem(s)' : '\x1b[32mAll required checks passed'}\x1b[0m${warns ? `, ${warns} warning(s)` : ''}.`);
  if (!fails) console.log('Note: the card only plays inline once X has approved your domain for Player Cards (see README).');
  process.exit(fails ? 1 : 0);
}
