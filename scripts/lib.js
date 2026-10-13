// Shared helpers for the build / dev / check scripts. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXP_DIR = path.join(ROOT, 'experiences');
export const DIST = path.join(ROOT, 'dist');

export function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  // Explicit BASE_URL wins; otherwise use the host's own production URL if we're on one.
  const env = process.env;
  const hosted = env.URL /* Netlify */ || env.CF_PAGES_URL /* Cloudflare Pages */ ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + env.VERCEL_PROJECT_PRODUCTION_URL : '');
  if (env.BASE_URL) cfg.baseUrl = env.BASE_URL;
  else if (hosted && /example\.com/.test(cfg.baseUrl)) cfg.baseUrl = hosted;
  cfg.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  return cfg;
}

export function listExperiences(cfg) {
  if (!fs.existsSync(EXP_DIR)) return [];
  return fs.readdirSync(EXP_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map(d => {
      const dir = path.join(EXP_DIR, d.name);
      const metaPath = path.join(dir, 'experience.json');
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
      if (!fs.existsSync(path.join(dir, 'index.html'))) {
        throw new Error(`experiences/${d.name} is missing index.html`);
      }
      return {
        slug: d.name,
        dir,
        title: meta.title || d.name,
        description: meta.description || '',
        width: meta.width || cfg.defaults.width,
        height: meta.height || cfg.defaults.height,
        accent: meta.accent || cfg.defaults.accent,
        tapToStart: !!meta.tapToStart,
        fullLink: meta.fullLink === false ? false : (meta.fullLink || 'top-right'),
        fit: meta.fit === 'fill' ? 'fill' : 'scale',
        imageAlt: meta.imageAlt || meta.title || d.name,
        draft: !!meta.draft
      };
    });
}

export const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// ---- Minimal PNG encoder (used for placeholder posters) -------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Placeholder poster: dark field, accent glow, and a "play" triangle. */
export function placeholderPoster(width, height, accentHex) {
  const [ar, ag, ab] = hexToRgb(accentHex);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const cx = width / 2, cy = height / 2, R = Math.min(width, height);
  const tri = R * 0.12;
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / R, dy = (y - cy) / R;
      const d = Math.sqrt(dx * dx + dy * dy);
      const glow = Math.max(0, 1 - d * 1.6);
      let r = 14 + ar * glow * 0.55, g = 14 + ag * glow * 0.55, b = 22 + ab * glow * 0.55;
      // play triangle pointing right, centred
      const px = x - cx + tri * 0.3, py = y - cy;
      if (px > -tri * 0.8 && px < tri && Math.abs(py) < (tri - px) * 0.58) { r = g = b = 245; }
      // ring
      const ring = Math.abs(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) - tri * 1.9);
      if (ring < 2.2) { r = g = b = 235; }
      const i = row + 1 + x * 3;
      raw[i] = Math.min(255, r); raw[i + 1] = Math.min(255, g); raw[i + 2] = Math.min(255, b);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
