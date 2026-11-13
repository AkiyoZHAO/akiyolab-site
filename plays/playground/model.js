// 页面与发布验收共用的数据契约。保持纯函数，供浏览器和 Node 直接读取。
export const metadataFields = {
  interest: ['domain', 'topic', 'angle'],
  format: ['modality', 'interaction', 'narrative', 'consumption'],
  source: ['creator', 'platform', 'discovery', 'access'],
};
export const contentTypes = ['news', 'article', 'video', 'audio', 'interactive'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function tags(value) {
  return Array.isArray(value) && value.every(text);
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function webUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function localAsset(value) {
  return typeof value === 'string' && /^(previews|media)\/[a-zA-Z0-9_./-]+$/.test(value) &&
    !value.split('/').includes('..');
}

// 分类保持开放；图像、视频与空间视觉模态也必须通过预览验收。
export function requiresPreview(item) {
  return item.type !== 'news' && (['interactive', 'video'].includes(item.type) ||
    item.metadata?.format?.modality?.some(tag =>
      /^(visual|image|images|video|3d|spatial)$/i.test(tag.trim())));
}

export function validateManifest(value) {
  assert(value?.schema_version === 1, 'Unsupported edition index version.');
  assert(value.timezone === 'Asia/Shanghai', 'Edition timezone must be Asia/Shanghai.');
  assert(Array.isArray(value.dates) && value.dates.every(validDate), 'Invalid edition dates.');
  assert(new Set(value.dates).size === value.dates.length, 'Duplicate edition dates.');
  return value;
}

export function validateEdition(value) {
  assert(value?.schema_version === 1, 'Unsupported edition version.');
  assert(validDate(value.date) && value.id === `playground-${value.date}`, 'Invalid edition identity.');
  assert(value.timezone === 'Asia/Shanghai', 'Invalid edition timezone.');
  assert(text(value.title) && text(value.intro), 'Edition title and intro are required.');
  assert(Array.isArray(value.items) && value.items.length > 0, 'This edition has no items.');
  const ids = new Set();
  for (const item of value.items) {
    assert(text(item.id) && /^[a-z0-9][a-z0-9-]{0,95}$/.test(item.id) && !ids.has(item.id), 'Invalid or duplicate item ID.');
    ids.add(item.id);
    assert(contentTypes.includes(item.type), `${item.id} has an unknown content type.`);
    assert([item.title, item.summary, item.comment, item.language].every(text), `${item.id} needs display copy and language.`);
    assert(webUrl(item.url), `${item.id} needs an original HTTP(S) URL.`);
    assert(tags(item.keywords), `${item.id} needs keywords.`);
    for (const [group, fields] of Object.entries(metadataFields)) {
      for (const field of fields) {
        assert(tags(item.metadata?.[group]?.[field]), `${item.id} is missing ${group}.${field}.`);
      }
    }
    const access = item.access;
    assert(['external', 'native'].includes(access?.mode), `${item.id} has an unsupported access mode.`);
    const check = access?.verification;
    assert(['unverified', 'verified', 'inaccessible'].includes(check?.status), `${item.id} needs link verification status.`);
    if (check.status !== 'unverified') {
      assert(text(check.checked_at) && Number.isFinite(Date.parse(check.checked_at)) && text(check.note), `${item.id} needs dated verification evidence.`);
    }
    assert(Array.isArray(item.evidence) && item.evidence.length > 0 &&
      item.evidence.every(source => webUrl(source.url) && text(source.label)), `${item.id} needs source evidence.`);
    assert(!requiresPreview(item) || item.preview, `${item.id} requires a real, licensed preview.`);
    if (item.preview) {
      assert(localAsset(item.preview.url) && item.preview.url.startsWith('previews/'), `${item.id} needs a local preview asset.`);
      assert(['screenshot', 'source-image'].includes(item.preview.kind) && text(item.preview.alt) &&
        webUrl(item.preview.source_url) && Number.isFinite(Date.parse(item.preview.verified_at)), `${item.id} needs real preview provenance.`);
      const rights = item.preview.rights;
      assert(text(rights?.basis) && webUrl(rights?.url) && text(rights?.note), `${item.id} needs preview reuse permission and attribution evidence.`);
    }
    if (access.mode === 'native') {
      assert(['audio', 'video'].includes(item.type) && localAsset(access.media_url) &&
        access.media_url.startsWith('media/') && check.status === 'verified', `${item.id} needs a verified local audio/video file.`);
    }
  }
  return value;
}

export function validatePreferences(value) {
  assert(value?.schema_version === 1, 'Unsupported preference version.');
  for (const group of Object.keys(metadataFields)) {
    assert(tags(value[group]?.prefer) && tags(value[group]?.avoid), `Invalid ${group} preferences.`);
  }
  assert(Number.isFinite(value.exploration) && value.exploration >= 0 && value.exploration <= 1, 'Exploration must be between 0 and 1.');
  assert(tags(value.languages) && value.languages.length > 0, 'Choose at least one language.');
  return value;
}

export function splitTags(value) {
  return [...new Set(value.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))];
}

export function editionProfile(edition) {
  const counts = new Map();
  const domains = new Map();
  for (const item of edition.items) {
    counts.set(item.type, (counts.get(item.type) || 0) + 1);
    for (const domain of new Set(item.metadata.interest.domain)) {
      domains.set(domain, (domains.get(domain) || 0) + 1);
    }
  }
  const types = [...counts].map(([type, count]) => `${count} ${type}`).join(' · ');
  const interests = [...domains].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([domain, count]) => `${domain} (${count})`).join(', ');
  return `${types}. Recurring interests · ${interests || 'Open mix'}.`;
}
