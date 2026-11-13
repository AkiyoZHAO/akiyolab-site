// 复用现有 Owner-only panel_private。每条反馈独立存储，重试沿用 UUID。
// 私人文字不进入匿名可读的 events / panel_states。
import { queryPanelPrivate, savePanelPrivate } from './panels.js';

export const preferencesKey = 'playground:preferences:v1';
export const feedbackPrefix = 'playground:feedback:v1:';

export async function readPreferences() {
  const row = await queryPanelPrivate(preferencesKey, { signal: AbortSignal.timeout(15000) });
  return row?.content || null;
}

export async function writePreferences(preferences) {
  return savePanelPrivate(preferencesKey, preferences, { signal: AbortSignal.timeout(15000) });
}

export async function submitFeedback(feedback) {
  if (feedback?.schema_version !== 1 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(feedback.id) ||
      !['item', 'edition', 'product'].includes(feedback.scope) ||
      typeof feedback.text !== 'string' || !feedback.text.trim() || feedback.text.length > 4000) {
    throw new Error('Invalid feedback. Please check your message.');
  }
  if ((feedback.scope === 'product' && (feedback.edition_id !== null || feedback.item_id !== null)) ||
      (feedback.scope !== 'product' && !/^playground-\d{4}-\d{2}-\d{2}$/.test(feedback.edition_id)) ||
      (feedback.scope === 'edition' && feedback.item_id !== null) ||
      (feedback.scope === 'item' && (typeof feedback.item_id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(feedback.item_id))) ||
      !Number.isFinite(Date.parse(feedback.submitted_at))) {
    throw new Error('Invalid feedback context. Please choose a target again.');
  }
  return savePanelPrivate(`${feedbackPrefix}${feedback.id}`, feedback, { signal: AbortSignal.timeout(15000) });
}
