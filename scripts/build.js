#!/usr/bin/env node
// Build: experiences/<slug>/ -> dist/e/<slug>/{index.html, player.html, poster.png, app/}
//
// The hops X takes when someone posts https://YOUR_DOMAIN/e/<slug>/ :
//   1. X's crawler (Twitterbot) fetches the share page and reads its twitter:* meta tags.
//   2. The post renders a card: poster.png with a play button.
//   3. Viewer taps -> X loads player.html in an iframe inside the post (approved domains only).
//   4. player.html (the "shell") loads your app/ in a nested iframe, shows a loader,
//      handles tap-to-start, fallbacks and the "open full" link.
//   5. Your app runs, talking to the shell through the XEmbed SDK (postMessage).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIST, loadConfig, listExperiences, esc, copyDir, placeholderPoster } from './lib.js';

export function build({ quiet = false, includeDrafts = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  const cfg = loadConfig();
  const exps = listExperiences(cfg).filter(e => includeDrafts || !e.draft);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'sdk'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'sdk', 'xembed.js'), path.join(DIST, 'sdk', 'xembed.js'));

  const warnings = [];
  for (const e of exps) {
    const out = path.join(DIST, 'e', e.slug);
    const appOut = path.join(out, 'app');
    copyDir(e.dir, appOut);
    fs.rmSync(path.join(appOut, 'experience.json'), { force: true });

    // Inject the SDK into the experience's index.html
    const idx = path.join(appOut, 'index.html');
    let html = fs.readFileSync(idx, 'utf8');
    if (!html.includes('xembed.js')) {
      const tag = '<script src="/sdk/xembed.js"></script>';
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => `${m}\n${tag}`) : tag + '\n' + html;
      fs.writeFileSync(idx, html);
    }

    // Poster: use experiences/<slug>/poster.png if present, else a generated placeholder.
    const userPoster = path.join(e.dir, 'poster.png');
    if (fs.existsSync(userPoster)) {
      fs.copyFileSync(userPoster, path.join(out, 'poster.png'));
      fs.rmSync(path.join(appOut, 'poster.png'), { force: true });
    } else {
      fs.writeFileSync(path.join(out, 'poster.png'), placeholderPoster(e.width * 2, e.height * 2, e.accent));
      warnings.push(`${e.slug}: using a placeholder poster — run "npm run poster" for a real screenshot.`);
    }
    if (e.description.length > 200) warnings.push(`${e.slug}: description is over 200 characters; X will truncate it.`);
    if (e.width > 1000 || e.height > 1000) warnings.push(`${e.slug}: ${e.width}x${e.height} is large for a timeline card; 480x480 or 640x360 render best.`);

    fs.writeFileSync(path.join(out, 'index.html'), sharePage(cfg, e));
    fs.writeFileSync(path.join(out, 'player.html'), playerPage(cfg, e));
    log(`  ✓ ${e.slug.padEnd(24)} ${cfg.baseUrl}/e/${e.slug}/`);
  }

  fs.writeFileSync(path.join(DIST, 'index.html'), galleryPage(cfg, exps));
  fs.writeFileSync(path.join(DIST, '_headers'), headersFile());
  fs.writeFileSync(path.join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  fs.writeFileSync(path.join(DIST, '404.html'), '<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font:16px system-ui;padding:2rem">Not found.</p>');

  if (/example\.com/.test(cfg.baseUrl)) warnings.push('baseUrl is still the placeholder — set it in site.config.json or with BASE_URL=https://… before deploying.');
  if (!/^https:\/\//.test(cfg.baseUrl) && !/localhost/.test(cfg.baseUrl)) warnings.push('baseUrl must be https:// for X to accept the card.');
  warnings.forEach(w => log('  ! ' + w));
  log(`\nBuilt ${exps.length} experience(s) into dist/  (baseUrl ${cfg.baseUrl})`);
  return { cfg, exps };
}

// ---------------------------------------------------------------------------
// fit:"scale" renders the app at exactly width x height and scales it to whatever
// size the card is shown at (X shrinks cards to feed width: ~500px desktop, ~300px
// on phones). Layout is identical everywhere. fit:"fill" hands the app the real size.
function fitScript(e, frameId, boxSel) {
  if (e.fit !== 'scale') return '';
  return `<script>
(function () {
  var f = document.getElementById('${frameId}'), box = ${boxSel};
  f.style.width = '${e.width}px'; f.style.height = '${e.height}px';
  f.style.position = 'absolute'; f.style.left = '50%'; f.style.top = '50%'; f.style.transformOrigin = '0 0';
  function fit() {
    var s = Math.min(box.clientWidth / ${e.width}, box.clientHeight / ${e.height});
    f.style.transform = 'scale(' + s + ') translate(-50%, -50%)';
  }
  addEventListener('resize', fit); fit();
})();
</script>`;
}

// ---------------------------------------------------------------------------
// Share page — the URL you paste into a post. Carries the card meta tags, and
// shows the experience full-screen to anyone who opens the link directly.
function sharePage(cfg, e) {
  const url = `${cfg.baseUrl}/e/${e.slug}/`;
  const player = `${url}player.html`;
  const poster = `${url}poster.png`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(e.title)}</title>
<meta name="description" content="${esc(e.description)}">
<link rel="canonical" href="${url}">

<!-- X Player Card: this is what makes it run inside the post -->
<meta name="twitter:card" content="player">
<meta name="twitter:site" content="${esc(cfg.xHandle)}">
<meta name="twitter:title" content="${esc(e.title)}">
<meta name="twitter:description" content="${esc(e.description)}">
<meta name="twitter:player" content="${player}">
<meta name="twitter:player:width" content="${e.width}">
<meta name="twitter:player:height" content="${e.height}">
<meta name="twitter:image" content="${poster}">
<meta name="twitter:image:alt" content="${esc(e.imageAlt)}">

<!-- Open Graph: fallback card everywhere else (and on X if the domain isn't approved yet) -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(cfg.siteName)}">
<meta property="og:title" content="${esc(e.title)}">
<meta property="og:description" content="${esc(e.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${poster}">
<meta property="og:image:width" content="${e.width * 2}">
<meta property="og:image:height" content="${e.height * 2}">
<meta property="og:video" content="${player}">
<meta property="og:video:secure_url" content="${player}">
<meta property="og:video:type" content="text/html">
<meta property="og:video:width" content="${e.width}">
<meta property="og:video:height" content="${e.height}">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #0b0b10; }
  body { display: grid; place-items: center; }
  .stage { position: relative; overflow: hidden; width: min(100vw, calc(100dvh * ${e.width} / ${e.height}), ${Math.max(e.width * 2, 960)}px);
           aspect-ratio: ${e.width} / ${e.height}; }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<main class="stage" id="stage"><iframe id="app" src="app/?mode=page" title="${esc(e.title)}" allow="autoplay; fullscreen; accelerometer; gyroscope" allowfullscreen></iframe></main>
${fitScript(e, 'app', "document.getElementById('stage')")}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Player shell — what X iframes inside the post.
function playerPage(cfg, e) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(e.title)}</title>
<style>
  :root { color-scheme: dark; --accent: ${e.accent}; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #0b0b10;
               font: 500 14px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f2f2f7;
               overscroll-behavior: contain; -webkit-tap-highlight-color: transparent; }
  #app { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .layer { position: absolute; inset: 0; display: grid; place-items: center; text-align: center;
           background: #0b0b10 url(poster.png) center / cover no-repeat; transition: opacity .15s; }
  .layer.hide { opacity: 0; pointer-events: none; }
  .btn { appearance: none; border: 0; border-radius: 999px; padding: 12px 20px; cursor: pointer;
         background: var(--accent); color: #fff; font: inherit; font-weight: 650;
         box-shadow: 0 6px 24px rgb(0 0 0 / .45); text-decoration: none; display: inline-block; }
  .spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgb(255 255 255 / .25);
             border-top-color: #fff; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #full { position: absolute; z-index: 5; width: 30px; height: 30px; border-radius: 8px;
          display: grid; place-items: center; background: rgb(0 0 0 / .45); color: #fff; text-decoration: none;
          opacity: .55; transition: opacity .2s; }
  #full.top-right { top: 8px; right: 8px; } #full.top-left { top: 8px; left: 8px; }
  #full.bottom-right { bottom: 8px; right: 8px; } #full.bottom-left { bottom: 8px; left: 8px; }
  #full:hover, #full:focus-visible { opacity: 1; }
  .msg { max-width: 80%; margin: 0 auto 14px; text-shadow: 0 1px 8px #000; }
</style>
</head>
<body>
<iframe id="app" title="${esc(e.title)}" allow="autoplay; fullscreen; accelerometer; gyroscope" allowfullscreen></iframe>

<div id="loader" class="layer">${e.tapToStart
    ? `<button class="btn" id="start" type="button">▶ Tap to start</button>`
    : `<div class="spinner" aria-label="Loading"></div>`}</div>

<div id="fallback" class="layer hide">
  <div><p class="msg">This experience couldn't start here.</p>
  <a class="btn" href="./" target="_blank" rel="noopener">Open ${esc(e.title)} ↗</a></div>
</div>

${e.fullLink ? `<a id="full" class="${e.fullLink}" href="./" target="_blank" rel="noopener" title="Open full screen" aria-label="Open full screen">
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 1h5v5M13 1 7 7M6 2H1v11h11V8"/></svg>
</a>` : ''}

${fitScript(e, 'app', 'document.body')}
<script>
(function () {
  var app = document.getElementById('app');
  var loader = document.getElementById('loader');
  var fallback = document.getElementById('fallback');
  var started = false, ready = false;
  function hide(el) { el.classList.add('hide'); setTimeout(function () { el.style.display = 'none'; }, 200); }
  function show(el) { el.style.display = ''; el.classList.remove('hide'); }

  function start() {
    if (started) return; started = true;
    loader.innerHTML = '<div class="spinner" aria-label="Loading"></div>';
    app.src = 'app/?mode=card';
    // If the app never signals ready (blocked script, crash, unsupported webview) offer the full page.
    setTimeout(function () { if (!ready) { hide(loader); show(fallback); } }, 12000);
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== app.contentWindow) return;
    var d = ev.data || {};
    if (d.source !== 'xembed') return;
    if (d.type === 'ready') { ready = true; hide(loader); hide(fallback); }
    if (d.type === 'open-full') { fallback.querySelector('.msg').textContent = 'Opens in a new tab:'; show(fallback); }
  });

  ${e.tapToStart
    ? `document.getElementById('start').addEventListener('click', start);`
    : `start();`}
})();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
function galleryPage(cfg, exps) {
  const items = exps.map(e => {
    const url = `${cfg.baseUrl}/e/${e.slug}/`;
    return `<li>
  <a class="thumb" href="e/${e.slug}/"><img src="e/${e.slug}/poster.png" alt="" loading="lazy" style="aspect-ratio:${e.width}/${e.height}"></a>
  <div><h2>${esc(e.title)}</h2><p>${esc(e.description)}</p>
  <div class="row"><code>${esc(url)}</code><button type="button" data-url="${esc(url)}">Copy link to post</button>
  <a href="https://x.com/intent/post?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">Compose post ↗</a></div></div>
</li>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.siteName)}</title><meta name="robots" content="noindex">
<style>
  :root { --bg:#fafafa; --fg:#15151a; --mut:#6b6b76; --line:#e4e4ea; --card:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e0e12; --fg:#eeeef2; --mut:#9a9aa6; --line:#26262e; --card:#16161c; } }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; } .lede { color: var(--mut); margin: 0 0 24px; }
  ul { list-style: none; padding: 0; display: grid; gap: 16px; }
  li { display: grid; grid-template-columns: 140px 1fr; gap: 16px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
  .thumb img { width: 100%; border-radius: 10px; display: block; object-fit: cover; }
  h2 { font-size: 16px; margin: 0; } p { margin: 4px 0 10px; color: var(--mut); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  code { font-size: 12px; background: var(--bg); border: 1px solid var(--line); padding: 4px 8px; border-radius: 6px; overflow-wrap: anywhere; }
  button, .row a { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; text-decoration: none; }
  @media (max-width: 520px) { li { grid-template-columns: 1fr; } }
</style></head>
<body><main>
<h1>${esc(cfg.siteName)}</h1>
<p class="lede">Paste any of these links into a post on X. On an approved domain the experience runs inside the post.</p>
<ul>${items}</ul>
</main>
<script>
document.querySelectorAll('button[data-url]').forEach(function (b) {
  b.addEventListener('click', function () {
    var done = function () { var t = b.textContent; b.textContent = 'Copied'; setTimeout(function(){ b.textContent = t; }, 1200); };
    try { navigator.clipboard.writeText(b.dataset.url).then(done, function(){}); } catch (e) {}
  });
});
</script>
</body></html>
`;
}

// Cloudflare Pages / Netlify header rules. The essentials: never send
// X-Frame-Options on player/app pages (that would block X from framing them),
// and let the poster be fetched cross-origin.
function headersFile() {
  return `/e/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=300
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff

/e/*/poster.png
  Cache-Control: public, max-age=86400

/sdk/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build({ includeDrafts: process.argv.includes('--drafts') });
}
