#!/usr/bin/env node
const base = process.env.LAB_PLAY_URL || 'https://akiyolab.com';
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
for (const path of ['/.gitignore', '/db/schema.sql', '/AGENTS.md', '/scripts/check.mjs', '/task-lab-play.md']) {
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
