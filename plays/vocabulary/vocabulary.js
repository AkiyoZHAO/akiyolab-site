import { isOwner, onAuthChange } from '../../core/auth.js';
import { appendVocabulary, queryVocabulary } from '../../core/vocabulary.js';

const $ = id => document.getElementById(id);
const wordInput = $('word');
const sort = $('sort');
const filter = $('filter');
const words = new Map();
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });

const loginUrl = new URL('../../auth/', location.href);
loginUrl.searchParams.set('next', location.href);
$('login').href = loginUrl.href;

let ownerId;
let sessionVersion = 0;
let pending;

function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').toggleAttribute('data-error', error);
}

function addOccurrence(record) {
  const entry = words.get(record.word) ?? { word: record.word, count: 0, latest: 0, tags: new Set() };
  entry.count++;
  entry.latest = Math.max(entry.latest, Date.parse(record.created_at));
  if (record.tag) entry.tags.add(record.tag);
  words.set(entry.word, entry);
  return entry;
}

function renderWords() {
  const entries = Array.from(words.values());
  const selectedTag = filter.value;
  const tags = [...new Set(entries.flatMap(entry => [...entry.tags]))].sort((a, b) => a.localeCompare(b));
  filter.replaceChildren(new Option('全部标签', ''), ...tags.map(tag => new Option(tag, tag)));
  filter.value = tags.includes(selectedTag) ? selectedTag : '';
  $('tagFilter').hidden = tags.length === 0;

  const visible = entries.filter(entry => !filter.value || entry.tags.has(filter.value));
  visible.sort((a, b) =>
    (sort.value === 'frequency' ? b.count - a.count : 0)
    || b.latest - a.latest
    || a.word.localeCompare(b.word)
  );

  const rows = document.createDocumentFragment();
  for (const entry of visible) {
    const row = document.createElement('li');
    const details = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'term';
    title.dir = 'auto';
    title.textContent = entry.word;
    const info = document.createElement('div');
    info.className = 'muted tags';
    info.textContent = [dateFormat.format(entry.latest), ...entry.tags].join(' · ');
    details.append(title, info);

    const count = document.createElement('span');
    count.className = 'muted count';
    count.textContent = `${entry.count} 次`;
    row.append(details, count);
    rows.append(row);
  }
  $('wordList').replaceChildren(rows);

  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const filtered = filter.value ? ` · 当前标签 ${visible.length} 个` : '';
  $('summary').textContent = entries.length ? `${entries.length} 个词 · ${total} 次追加${filtered}` : '还没有词。想到什么就收下。';
  $('random').disabled = entries.length === 0;
}

async function loadWords(version) {
  $('retry').hidden = true;
  $('append').disabled = true;
  setStatus('正在打开盒子…');
  try {
    const records = await queryVocabulary();
    if (version !== sessionVersion) return;
    words.clear();
    records.forEach(addOccurrence);
    renderWords();
    $('append').disabled = false;
    setStatus('');
  } catch {
    if (version !== sessionVersion) return;
    setStatus('暂时打不开盒子，请稍后重试。', true);
    $('retry').hidden = false;
  }
}

function renderSession(session) {
  const nextOwner = isOwner(session) ? session.user.id : null;
  if (nextOwner === ownerId) return;
  ownerId = nextOwner;
  const version = ++sessionVersion;

  words.clear();
  pending = undefined;
  $('appendForm').reset();
  wordInput.readOnly = false;
  sort.value = 'recent';
  filter.value = '';
  $('randomSection').hidden = true;
  $('randomWords').replaceChildren();
  renderWords();

  $('gate').hidden = Boolean(ownerId);
  $('gateStatus').textContent = session ? '需要 Owner 权限才能打开盒子。' : '登录后即可打开你的词汇盒子。';
  $('login').hidden = false;
  $('box').hidden = !ownerId;
  if (ownerId) void loadWords(version);
}

onAuthChange(session => setTimeout(() => renderSession(session), 0));
$('retry').addEventListener('click', () => void loadWords(sessionVersion));
sort.addEventListener('change', renderWords);
filter.addEventListener('change', renderWords);

$('appendForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!ownerId || $('append').disabled) return;
  const word = wordInput.value.trim().normalize('NFC');
  if (!word) {
    setStatus('先输入一个词或短语。', true);
    return;
  }
  const version = sessionVersion;
  if (pending?.word !== word) pending = { word, requestId: crypto.randomUUID() };

  $('append').disabled = true;
  wordInput.readOnly = true;
  setStatus('正在追加…');
  try {
    const record = await appendVocabulary(word, pending.requestId);
    if (version !== sessionVersion) return;
    const entry = addOccurrence(record);
    pending = undefined;
    $('appendForm').reset();
    renderWords();
    setStatus(entry.count === 1 ? `已收下「${word}」。` : `「${word}」已出现 ${entry.count} 次。`);
  } catch {
    if (version === sessionVersion) setStatus('追加未确认，保留输入再试一次。', true);
  } finally {
    if (version === sessionVersion) {
      $('append').disabled = false;
      wordInput.readOnly = false;
      wordInput.focus();
    }
  }
});

$('random').addEventListener('click', () => {
  const choices = Array.from(words.keys());
  const size = Math.min(3, choices.length);
  const picked = [];
  for (let index = 0; index < size; index++) {
    const target = index + Math.floor(Math.random() * (choices.length - index));
    [choices[index], choices[target]] = [choices[target], choices[index]];
    const card = document.createElement('li');
    card.className = 'term';
    card.dir = 'auto';
    card.textContent = choices[index];
    picked.push(card);
  }
  $('randomSection').hidden = false;
  $('randomWords').replaceChildren(...picked);
});
