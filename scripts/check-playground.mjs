import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { validateManifest, validateEdition, validatePreferences } from '../plays/playground/model.js';

export function checkPlayground(root) {
  const failures = [];
  const directory = join(root, 'plays/playground');
  const read = path => JSON.parse(readFileSync(join(directory, path), 'utf8'));
  try {
    const index = validateManifest(read('index.json'));
    validatePreferences(read('preferences.json'));
    for (const date of index.dates) {
      const edition = validateEdition(read(`editions/${date}.json`));
      if (edition.date !== date) throw new Error(`${date}: edition/file date mismatch`);
      for (const item of edition.items) {
        for (const asset of [item.preview?.url, item.access.media_url].filter(Boolean)) {
          if (!existsSync(join(directory, asset))) throw new Error(`${item.id}: missing asset ${asset}`);
          const stat = statSync(join(directory, asset));
          if (!stat.isFile() || !stat.size) throw new Error(`${item.id}: empty or invalid asset ${asset}`);
        }
        if (item.preview && !['.png', '.jpg', '.jpeg', '.webp'].includes(extname(item.preview.url).toLowerCase())) {
          throw new Error(`${item.id}: previews must be PNG, JPEG or WebP`);
        }
      }
    }
    if (existsSync(join(directory, 'editions'))) {
      for (const file of readdirSync(join(directory, 'editions'))) {
        if (!index.dates.includes(file.replace(/\.json$/, ''))) throw new Error(`Unindexed edition ${file}`);
      }
    }
  } catch (error) {
    failures.push(`Playground: ${error.message}`);
  }
  return failures;
}
