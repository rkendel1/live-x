#!/usr/bin/env node
// Scaffold a new experience:  npm run new -- my-thing "My Thing"
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, EXP_DIR, copyDir } from './lib.js';

const [slug, ...titleParts] = process.argv.slice(2);
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error('Usage: npm run new -- <slug> ["Title"]   (slug: lowercase letters, numbers, dashes)');
  process.exit(2);
}
const dst = path.join(EXP_DIR, slug);
if (fs.existsSync(dst)) { console.error(`experiences/${slug} already exists`); process.exit(1); }

copyDir(path.join(ROOT, 'templates', 'blank'), dst);
const title = titleParts.join(' ') || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const metaPath = path.join(dst, 'experience.json');
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
meta.title = title;
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
for (const f of ['index.html']) {
  const p = path.join(dst, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('{{TITLE}}', title));
}
console.log(`Created experiences/${slug}/ — run "npm run dev" and open /__preview/${slug}`);
