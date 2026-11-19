import { requireOwner } from './auth.js';
import { db } from './supabase.js';

const columns = 'id, word, tag, created_at';
const pageSize = 500;

function getDeviceType() {
  const { userAgent, userAgentData, maxTouchPoints } = navigator;
  const platform = userAgentData?.platform;
  // iPad Safari 可能发送桌面版 Mac 的 user agent。
  if (/iPad|Tablet|Kindle|Silk/i.test(userAgent)
      || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'tablet';
  if (userAgentData?.mobile || /iPhone|iPod|Windows Phone|Mobile/i.test(userAgent)) return 'mobile';
  if (platform === 'Android' || /Android/i.test(userAgent)) return 'tablet';
  if (['Windows', 'macOS', 'Linux', 'Chrome OS'].includes(platform)
      || /Windows NT|Macintosh|CrOS|X11|Linux (?:x86_64|i[3-6]86)/i.test(userAgent)) return 'desktop';
  return 'unknown';
}

export async function queryVocabulary() {
  await requireOwner();
  const appends = [];
  let cursor = 0;
  while (true) {
    const { data, error } = await db.from('vocabulary_appends')
      .select(columns).gt('id', cursor).order('id').limit(pageSize);
    if (error) throw error;
    if (data.length === 0) return appends;
    appends.push(...data);
    cursor = data.at(-1).id;
    if (data.length < pageSize) return appends;
  }
}

export async function appendVocabulary(word, requestId) {
  await requireOwner();
  const { data, error } = await db.from('vocabulary_appends')
    .insert({ request_id: requestId, word, device_type: getDeviceType() })
    .select(columns).single();

  if (!error) return data;
  if (error.code !== '23505') throw error;

  // 首次请求可能已经成功提交，只是响应丢失。重试时取回原记录。
  const existing = await db.from('vocabulary_appends')
    .select(columns).eq('request_id', requestId).single();
  if (existing.error) throw existing.error;
  return existing.data;
}
