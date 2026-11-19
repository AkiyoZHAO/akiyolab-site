import { requireOwner } from './auth.js';
import { db } from './supabase.js';

const columns = 'id, word, tag, created_at';
const pageSize = 500;

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

export async function appendVocabulary(word, tag, requestId) {
  await requireOwner();
  const { data, error } = await db.from('vocabulary_appends')
    .insert({ request_id: requestId, word, tag })
    .select(columns).single();

  if (!error) return data;
  if (error.code !== '23505') throw error;

  // 首次请求可能已经成功提交，只是响应丢失。重试时取回原记录。
  const existing = await db.from('vocabulary_appends')
    .select(columns).eq('request_id', requestId).single();
  if (existing.error) throw existing.error;
  return existing.data;
}
