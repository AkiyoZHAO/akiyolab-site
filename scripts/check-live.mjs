#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = process.env.LAB_PLAY_URL || 'https://akiyolab.com';
// 域名切换可能晚于 Wrangler 返回；有界等待实际资产，不能把旧版当作发布成功。
const directory = new URL('../plays/playground/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('index.json', directory)));
const latest = [...manifest.dates].sort().at(-1);
const edition = latest ? JSON.parse(readFileSync(new URL(`editions/${latest}.json`, directory))) : null;
const paths = ['index.json', 'model.js', 'playground.js', 'playground.css',
  ...(latest ? [`editions/${latest}.json`] : []),
  ...(edition?.items.flatMap(item => [item.preview?.url, item.access.media_url].filter(Boolean)) || [])];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = paths.map(path => [path, hash(readFileSync(new URL(path, directory)))]);
for (let attempt = 0; ; attempt++) {
  const pending = (await Promise.all(expected.map(async ([path, digest]) => {
    try {
      const response = await fetch(`${base}/plays/playground/${path}`, {
        headers: { 'Cache-Control': 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      return response.ok && hash(Buffer.from(await response.arrayBuffer())) === digest ? null : path;
    } catch { return path; }
  }))).filter(Boolean);
  if (!pending.length) break;
  assert(attempt < 12, `Publication did not converge: ${pending.join(', ')}`);
  console.log(`Waiting for publication: ${pending.join(', ')}`);
  await new Promise(resolve => setTimeout(resolve, 5000));
}

const pages = [
  ['/', '<title>lab-play</title>'],
  ['/auth/', 'id="signInBtn"'],
  ['/plays/draw/', 'id="poolGrid"'],
  ['/plays/ielts/', 'IELTS Deck'],
  ['/plays/playground/', 'id="feedbackForm"'],
  ['/panels/stats/', 'id="board"'],
  ['/panels/career/', 'id="overview"'],
  ['/panels/collection/', 'achievements.json'],
];
const failures = [];

const manifestResponse = await fetch(`${base}/plays/playground/index.json`, { cache: 'no-store' });
if (!manifestResponse.ok) failures.push(`Playground index: HTTP ${manifestResponse.status}`);
else {
  const { validateManifest, validateEdition } = await import('../plays/playground/model.js');
  try {
    const manifest = validateManifest(await manifestResponse.json());
    const date = [...manifest.dates].sort().at(-1);
    if (date) {
      const response = await fetch(`${base}/plays/playground/editions/${date}.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const edition = validateEdition(await response.json());
      if (edition.date !== date) throw new Error('Edition date mismatch');
    }
  } catch (error) { failures.push(`Playground data: ${error.message}`); }
}

for (const [path, marker] of pages) {
  const response = await fetch(`${base}${path}`, { headers: { 'Cache-Control': 'no-cache' } });
  const body = await response.text();
  if (!response.ok) failures.push(`${path}: HTTP ${response.status}`);
  else if (!body.includes(marker)) failures.push(`${path}: missing marker ${marker}`);
}
for (const path of [
  '/.gitignore', '/db/schema.sql', '/AGENTS.md', '/scripts/check.mjs', '/task-lab-play.md',
  '/node_modules/wrangler/package.json', '/package.json', '/package-lock.json',
]) {
  const response = await fetch(`${base}${path}`, { headers: { 'Cache-Control': 'no-cache' } });
  if (response.status !== 404) failures.push(`${path}: expected 404, got ${response.status}`);
}

const home = await fetch(`${base}/`, { headers: { 'Cache-Control': 'no-cache' } });
for (const header of ['content-security-policy', 'x-content-type-options', 'x-frame-options']) {
  if (!home.headers.get(header)) failures.push(`/: missing ${header}`);
}

if (failures.length) {
  console.error(failures.map(item => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log(`OK: ${base} live smoke passed`);
