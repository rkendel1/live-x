// Validates the build output for every experience. Zero dependencies: node:test + node:assert.
// Run with: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, EXP_DIR, DIST } from '../scripts/lib.js';

const BASE_URL = 'https://example.test';

// Same discovery rules as scripts/lib.js listExperiences(): directories, not hidden/underscore.
const readMeta = dir => {
  const p = path.join(dir, 'experience.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
};
const experiences = fs.readdirSync(EXP_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
  .map(d => ({ slug: d.name, dir: path.join(EXP_DIR, d.name) }))
  .filter(e => !readMeta(e.dir).draft); // drafts are not built by default

// Pull the content of a <meta> tag by its name/property attribute.
const meta = (html, key) => {
  const re = new RegExp(`<meta\\s+(?:name|property)="${key.replace(/[:.]/g, '\\$&')}"\\s+content="([^"]*)"`);
  const m = html.match(re);
  return m ? m[1] : undefined;
};

before(() => {
  execFileSync(process.execPath, ['scripts/build.js'], {
    cwd: ROOT,
    env: { ...process.env, BASE_URL },
    stdio: 'pipe'
  });
});

test('there is at least one experience to validate', () => {
  assert.ok(experiences.length > 0, `no buildable experiences found in ${EXP_DIR}`);
});

test('build writes the site-level files', () => {
  for (const f of ['index.html', '404.html', 'robots.txt', '_headers', 'sdk/xembed.js']) {
    assert.ok(fs.existsSync(path.join(DIST, f)), `dist/${f} is missing after build`);
  }
});

for (const { slug, dir } of experiences) {
  test(`experience "${slug}"`, async t => {
    const out = path.join(DIST, 'e', slug);
    const base = `${BASE_URL}/e/${slug}/`;

    await t.test('experience.json parses and has the fields build.js uses', () => {
      const p = path.join(dir, 'experience.json');
      assert.ok(fs.existsSync(p), `experiences/${slug}/experience.json is missing`);
      let m;
      assert.doesNotThrow(() => { m = JSON.parse(fs.readFileSync(p, 'utf8')); }, `experiences/${slug}/experience.json is not valid JSON`);
      for (const k of ['title', 'description', 'imageAlt']) {
        assert.equal(typeof m[k], 'string', `experience.json "${k}" must be a string`);
        assert.ok(m[k].length > 0, `experience.json "${k}" must not be empty`);
      }
      for (const k of ['width', 'height']) {
        assert.ok(Number.isInteger(m[k]) && m[k] > 0, `experience.json "${k}" must be a positive integer, got ${m[k]}`);
      }
      assert.match(m.accent, /^#[0-9a-f]{3}([0-9a-f]{3})?$/i, 'experience.json "accent" must be a hex colour');
    });

    await t.test('share page has player card meta tags with BASE_URL-prefixed URLs', () => {
      const file = path.join(out, 'index.html');
      assert.ok(fs.existsSync(file), `dist/e/${slug}/index.html is missing`);
      const html = fs.readFileSync(file, 'utf8');
      const m = readMeta(dir);

      assert.equal(meta(html, 'twitter:card'), 'player', 'twitter:card must be "player"');
      assert.equal(meta(html, 'twitter:player'), `${base}player.html`, 'twitter:player must point at BASE_URL + player.html');
      assert.equal(meta(html, 'twitter:image'), `${base}poster.png`, 'twitter:image must reference the poster under BASE_URL');
      assert.equal(meta(html, 'twitter:player:width'), String(m.width), 'twitter:player:width mismatch');
      assert.equal(meta(html, 'twitter:player:height'), String(m.height), 'twitter:player:height mismatch');
      assert.ok(html.includes(`<link rel="canonical" href="${base}">`), 'canonical link must use BASE_URL');
      assert.equal(meta(html, 'og:image'), `${base}poster.png`, 'og:image must reference the poster under BASE_URL');
    });

    await t.test('every absolute URL in the share page uses the BASE_URL override', () => {
      const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
      assert.ok(!html.includes('example.com'), 'share page still contains the placeholder example.com host');
      const urls = [...html.matchAll(/content="(https?:\/\/[^"]+)"|href="(https?:\/\/[^"]+)"/g)].map(x => x[1] || x[2]);
      assert.ok(urls.length > 0, 'share page has no absolute URLs');
      for (const u of urls) assert.ok(u.startsWith(`${BASE_URL}/`), `URL "${u}" does not start with ${BASE_URL}/`);
    });

    await t.test('player.html and poster.png exist', () => {
      const player = path.join(out, 'player.html');
      assert.ok(fs.existsSync(player), `dist/e/${slug}/player.html is missing`);
      assert.match(fs.readFileSync(player, 'utf8'), /<iframe[^>]+id="app"/, 'player.html must contain the app iframe');
      const poster = path.join(out, 'poster.png');
      assert.ok(fs.existsSync(poster), `dist/e/${slug}/poster.png is missing`);
      const head = fs.readFileSync(poster).subarray(0, 8);
      assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'poster.png is not a PNG');
    });

    await t.test('app is copied with the SDK injected and experience.json stripped', () => {
      const idx = path.join(out, 'app', 'index.html');
      assert.ok(fs.existsSync(idx), `dist/e/${slug}/app/index.html is missing`);
      assert.ok(fs.readFileSync(idx, 'utf8').includes('xembed.js'), 'app/index.html must reference the XEmbed SDK');
      assert.ok(!fs.existsSync(path.join(out, 'app', 'experience.json')), 'experience.json must not be shipped in app/');
    });
  });
}
