import {
  metadataFields, validateManifest, validateEdition, validatePreferences,
  validDate, splitTags, editionProfile,
} from './model.js';

const $ = id => document.getElementById(id);
let edition = null;
let defaults = null;
let privateApi = null;
let authApi = null;
let owner = false;
let feedbackId = null;
let authRevision = 0;
let activeIdentity = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function status(id, message, error = false) {
  $(id).textContent = message;
  $(id).classList.toggle('error', error);
}

function externalLink(url, label, className = '') {
  const link = element('a', className, label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

async function json(path) {
  const response = await fetch(path, { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function tags(values, tagName = 'div') {
  const group = element(tagName, 'tags');
  for (const value of [...new Set(values)]) group.append(element('span', 'tag', value));
  return group;
}

function preview(item) {
  const figure = element('figure');
  if (!item.preview) {
    figure.append(element('p', 'media-fallback', 'Preview unavailable. Explore the original below.'));
    return figure;
  }
  const image = element('img', 'preview');
  image.src = item.preview.url;
  image.alt = item.preview.alt;
  image.loading = 'lazy';
  image.addEventListener('error', () => {
    figure.replaceChildren(element('p', 'media-fallback', 'The preview could not load. The original link is below.'));
  }, { once: true });
  figure.append(image, element('figcaption', '', item.preview.kind === 'screenshot' ? 'Preview captured from the original experience' : 'Image from the original source'));
  return figure;
}

function selectFeedback(target) {
  $('feedbackTarget').value = target;
  feedbackId = null;
  $('feedback').scrollIntoView({ behavior: 'auto', block: 'start' });
  if (owner) $('feedbackText').focus();
  else $('ownerLink').focus({ preventScroll: true });
}

function renderItem(item) {
  const article = element('article', 'item');
  article.dataset.type = item.type;
  article.id = item.id;
  if (item.type === 'interactive') article.append(preview(item));
  const copy = element('div', 'item-copy');
  const platform = item.metadata.source.platform.join(' / ');
  copy.append(element('p', 'item-meta', `${item.type.toUpperCase()} · ${platform} · ${item.language}`));
  const heading = element('h2');
  heading.append(externalLink(item.url, item.title));
  copy.append(heading);
  if (['article', 'video'].includes(item.type) && item.preview) copy.append(preview(item));
  copy.append(element('p', 'summary', item.summary), tags(item.keywords), element('p', 'comment', item.comment));

  const check = item.access.verification;
  if (item.access.mode === 'native' && check.status === 'verified') {
    const media = element(item.type);
    media.controls = true;
    media.preload = 'none';
    media.src = item.access.media_url;
    if (item.type === 'video' && item.preview) media.poster = item.preview.url;
    media.addEventListener('error', () => {
      media.replaceWith(element('p', 'media-fallback', 'Playback unavailable. Open the original source below.'));
    }, { once: true });
    copy.append(media);
  }
  const labels = {
    verified: 'Link checked', unverified: 'Link not yet verified', inaccessible: 'Source currently inaccessible',
  };
  const accessNote = element('p', 'access-note', `${labels[check.status]}${check.checked_at ? ` · ${check.checked_at.slice(0, 10)}` : ''}${check.note ? ` · ${check.note}` : ''}`);
  if (check.status === 'inaccessible') accessNote.classList.add('warning');
  copy.append(accessNote);
  const actions = element('div', 'item-actions');
  let label = 'Open original ↗';
  if (check.status === 'inaccessible') label = 'Try original ↗';
  else if (item.type === 'interactive') label = 'Try it ↗';
  else if (item.type === 'audio') label = 'Listen at source ↗';
  else if (item.type === 'video') label = 'Watch at source ↗';
  actions.append(externalLink(item.url, label, item.type === 'interactive' ? 'visit' : ''));
  const noteButton = element('button', 'note-button', 'Leave a note');
  noteButton.type = 'button';
  noteButton.addEventListener('click', () => selectFeedback(`item:${item.id}`));
  actions.append(noteButton);
  copy.append(actions);
  article.append(copy);
  return article;
}

function renderAttributes(item) {
  const details = element('details', 'attribute');
  const summary = element('summary', '', item.title);
  summary.append(tags([...item.metadata.interest.domain, ...item.metadata.format.modality, ...item.metadata.source.access], 'span'));
  details.append(summary);
  const list = element('dl');
  for (const [group, fields] of Object.entries(metadataFields)) {
    for (const field of fields) {
      list.append(element('dt', '', `${group} / ${field}`), element('dd', '', item.metadata[group][field].join(', ') || '—'));
    }
  }
  details.append(list);
  for (const evidence of item.evidence) {
    const line = element('p', 'access-note');
    line.append(externalLink(evidence.url, evidence.label));
    details.append(line);
  }
  if (item.preview) {
    const line = element('p', 'access-note');
    line.append(externalLink(item.preview.source_url, `Preview source · ${item.preview.verified_at.slice(0, 10)}`));
    details.append(line);
  }
  return details;
}

async function loadEdition() {
  $('retry').hidden = true;
  $('latestLink').hidden = true;
  status('editionStatus', 'Opening the latest edition…');
  try {
    const index = validateManifest(await json('./index.json'));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: index.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const dates = index.dates.filter(date => date <= today).sort().reverse();
    const requested = new URLSearchParams(location.search).get('date');
    if (requested && (!validDate(requested) || !dates.includes(requested))) throw new Error('That edition is not published.');
    if (!dates.length) {
      status('editionStatus', 'The first edition is on its way. You can already leave Dot a note below.');
      return;
    }
    const date = requested || dates[0];
    const loaded = validateEdition(await json(`./editions/${date}.json`));
    if (loaded.date !== date) throw new Error('The edition date does not match its file.');
    edition = loaded;
    document.title = `${edition.date} · Playground`;
    $('editionDate').textContent = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'Asia/Shanghai' }).format(new Date(`${date}T12:00:00+08:00`));
    $('editionTitle').textContent = edition.title;
    $('editionIntro').textContent = edition.intro;
    $('items').replaceChildren(...edition.items.map(renderItem));
    $('profile').textContent = editionProfile(edition);
    $('editorialNote').textContent = edition.editorial_note || '';
    $('editorialNote').hidden = !edition.editorial_note;
    $('attributes').replaceChildren(...edition.items.map(renderAttributes));
    $('archive').replaceChildren(...dates.map(day => new Option(day, day, false, day === date)));
    $('archiveLabel').hidden = dates.length < 2;
    $('feedbackTarget').replaceChildren(new Option('Playground as a whole', 'product'), new Option(`This edition · ${date}`, 'edition'),
      ...edition.items.map(item => new Option(item.title, `item:${item.id}`)));
    status('editionStatus', date === today ? `${edition.items.length} things to explore today.` : `${requested ? 'From the archive' : 'Latest published edition'} · ${date}.`);
    $('edition').hidden = false;
  } catch (error) {
    status('editionStatus', `Could not open this edition. ${error.message} Please retry or choose the latest edition.`, true);
    $('retry').hidden = false;
    $('latestLink').hidden = !new URLSearchParams(location.search).has('date');
  }
}

$('retry').addEventListener('click', loadEdition);
$('archive').addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('date', $('archive').value);
  location.href = url.href;
});

function renderPreferenceInputs() {
  for (const group of Object.keys(metadataFields)) {
    const column = element('div');
    column.append(element('h3', '', group[0].toUpperCase() + group.slice(1)));
    for (const tendency of ['prefer', 'avoid']) {
      const id = `${group}-${tendency}`;
      const label = element('label', '', tendency === 'prefer' ? 'More of · comma-separated' : 'Less of · comma-separated');
      label.htmlFor = id;
      const input = element('input');
      input.id = id;
      input.name = id;
      input.maxLength = 500;
      column.append(label, input);
    }
    $('preferenceInputs').append(column);
  }
}

function fillPreferences(preferences) {
  for (const group of Object.keys(metadataFields)) {
    for (const tendency of ['prefer', 'avoid']) $(`${group}-${tendency}`).value = preferences[group][tendency].join(', ');
  }
  $('exploration').value = preferences.exploration * 100;
  $('explorationValue').value = `${Math.round(preferences.exploration * 100)}%`;
  $('languages').value = preferences.languages.join(', ');
}

async function renderSession(session) {
  const identity = `${session?.user?.id || 'anonymous'}:${authApi.isOwner(session)}`;
  if (identity === activeIdentity) return;
  activeIdentity = identity;
  const revision = ++authRevision;
  owner = authApi.isOwner(session);
  $('feedbackFields').disabled = !owner;
  $('downloadHandoff').hidden = !owner;
  $('preferencesFields').disabled = true;
  $('ownerLink').textContent = owner ? 'Owner account' : 'Owner sign in';
  $('ownerLink').href = `../../auth/?next=${encodeURIComponent(location.href)}`;
  $('privateNotice').textContent = owner ? 'Feedback is saved privately for Owner and authorized Dot access.' : 'Feedback is private to Owner and authorized Dot access. Sign in to send.';
  if (!owner) {
    $('feedbackForm').reset();
    feedbackId = null;
    status('feedbackStatus', '');
    if (defaults) fillPreferences(defaults);
    status('preferencesStatus', 'Showing public defaults. Sign in to save your preferences.');
    return;
  }
  status('preferencesStatus', 'Loading your private preferences…');
  try {
    const saved = await privateApi.readPreferences();
    if (revision !== authRevision) return;
    fillPreferences(validatePreferences(saved || defaults));
    $('preferencesFields').disabled = false;
    status('preferencesStatus', saved ? 'Your private preferences are loaded.' : 'Start with these defaults and adjust as you go.');
  } catch (error) {
    if (revision === authRevision) status('preferencesStatus', `Could not load preferences. Reload to retry. ${error.message}`, true);
  }
}

function loadAuthLibrary() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => reject(new Error('Authentication library timed out.')), 15000);
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0';
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Authentication library unavailable.')); };
    document.head.append(script);
  });
}

async function loadPrivateSettings() {
  try {
    defaults = validatePreferences(await json('./preferences.json'));
    fillPreferences(defaults);
    await loadAuthLibrary();
    [authApi, privateApi] = await Promise.all([import('../../core/auth.js'), import('../../core/playground.js')]);
    // Supabase 的 auth 回调中延迟发起数据库读取，避免等待同一 auth 锁。
    authApi.onAuthChange(session => setTimeout(() => renderSession(session), 0));
    await renderSession(await authApi.getSession());
  } catch (error) {
    status('preferencesStatus', `Private settings unavailable. Reload to retry. ${error.message}`, true);
    status('feedbackStatus', 'Private feedback is unavailable. Reload to retry.', true);
  }
}

$('exploration').addEventListener('input', () => { $('explorationValue').value = `${$('exploration').value}%`; });
$('preferencesForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('preferencesFields').disabled = true;
  status('preferencesStatus', 'Saving privately…');
  try {
    const preferences = { schema_version: 1, exploration: Number($('exploration').value) / 100, languages: splitTags($('languages').value) };
    for (const group of Object.keys(metadataFields)) {
      preferences[group] = { prefer: splitTags($(`${group}-prefer`).value), avoid: splitTags($(`${group}-avoid`).value) };
    }
    validatePreferences(preferences);
    await privateApi.writePreferences(preferences);
    status('preferencesStatus', 'Saved privately. Dot can use these tendencies for future editions.');
  } catch (error) {
    status('preferencesStatus', `Save failed. Your changes are still in the form. ${error.message}`, true);
  } finally {
    $('preferencesFields').disabled = !owner;
  }
});

$('feedbackForm').addEventListener('input', () => { feedbackId = null; });
$('feedbackForm').addEventListener('submit', async event => {
  event.preventDefault();
  const target = $('feedbackTarget').value;
  const scope = target.startsWith('item:') ? 'item' : target;
  feedbackId ||= crypto.randomUUID();
  const feedback = {
    schema_version: 1, id: feedbackId, scope,
    edition_id: scope === 'product' ? null : edition.id,
    item_id: scope === 'item' ? target.slice(5) : null,
    text: $('feedbackText').value.trim(), submitted_at: new Date().toISOString(),
  };
  $('feedbackFields').disabled = true;
  status('feedbackStatus', 'Sending privately…');
  try {
    await privateApi.submitFeedback(feedback);
    $('feedbackText').value = '';
    feedbackId = null;
    status('feedbackStatus', 'Saved privately. Your note is ready for Dot.');
  } catch (error) {
    status('feedbackStatus', `Could not confirm delivery. Your note is still here. Retry to confirm the same submission. ${error.message}`, true);
  } finally {
    $('feedbackFields').disabled = !owner;
  }
});

$('downloadHandoff').addEventListener('click', async () => {
  $('downloadHandoff').disabled = true;
  status('handoffStatus', 'Reading private Playground records…');
  try {
    const handoff = await privateApi.readPrivateHandoff();
    const url = URL.createObjectURL(new Blob([JSON.stringify(handoff, null, 2)], { type: 'application/json' }));
    const link = element('a');
    link.href = url;
    link.download = `playground-private-${handoff.exported_at.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('handoffStatus', `Downloaded ${handoff.records.length} private Playground records. Share this file only through your private channel with Dot.`);
  } catch (error) {
    status('handoffStatus', `Private download failed. ${error.message}`, true);
  } finally {
    $('downloadHandoff').disabled = false;
  }
});

renderPreferenceInputs();
await Promise.allSettled([loadEdition(), loadPrivateSettings()]);
