#!/usr/bin/env node
// Dot 的只读入口。复用现有 Owner session，输出到仓库以外的私有文件。
import { realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../core/config.js';

const root = realpathSync(resolve(import.meta.dirname, '..'));
const outputArgument = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!outputArgument || !token) {
  console.error('Usage: SUPABASE_ACCESS_TOKEN=<existing Owner session> node scripts/read-playground-private.mjs /private/path/handoff.json');
  process.exit(1);
}
const output = resolve(realpathSync(dirname(resolve(outputArgument))), basename(outputArgument));
const pathFromRoot = relative(root, output);
if (!isAbsolute(pathFromRoot) && pathFromRoot.split(sep)[0] !== '..') {
  throw new Error('Private output must be outside the repository and its static assets.');
}
const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
async function read(path) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Private read failed: HTTP ${response.status}. Refresh the existing Owner session if needed.`);
  return response.json();
}
const user = await read('/auth/v1/user');
if (user.app_metadata?.role !== 'owner') throw new Error('An existing Owner session is required.');

const records = [];
let cursor = '';
while (true) {
  const params = new URLSearchParams({ select: 'panel,content,updated_at', panel: 'like.playground:*', order: 'panel.asc', limit: '1000' });
  if (cursor) params.append('panel', `gt.${cursor}`);
  const page = await read(`/rest/v1/panel_private?${params}`);
  if (!page.length) break;
  records.push(...page);
  cursor = page.at(-1).panel;
}
writeFileSync(output, JSON.stringify({ schema_version: 1, exported_at: new Date().toISOString(), records }, null, 2), { flag: 'wx', mode: 0o600 });
console.log(`Saved ${records.length} Playground private records to the requested private file.`);
