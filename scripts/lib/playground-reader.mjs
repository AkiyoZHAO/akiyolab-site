// 专用只读客户端草案。sessionStore 由实际云端 vault 提供，本模块不实现明文存储。
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../core/config.js';

const allowedKey = key => key === 'playground:preferences:v1' || key.startsWith('playground:feedback:v1:');
class ReaderError extends Error {}

export async function readScopedPlayground({ sessionStore, fetchImpl = fetch, now = Date.now }) {
  // withExclusive 必须跨运行互斥，replace 必须原子、持久地提交轮换后的会话。
  try {
    return await sessionStore.withExclusive(async store => {
      let session = await store.read();
      if (!session?.reader_id || !session.refresh_token) throw new ReaderError('Reader session unavailable');

      async function request(path, options = {}, accessToken) {
        let response;
        try {
          response = await fetchImpl(`${SUPABASE_URL}${path}`, {
            ...options,
            headers: {
              apikey: SUPABASE_ANON_KEY,
              'Content-Type': 'application/json',
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          });
        } catch {
          throw new ReaderError('Reader network request failed');
        }
        // 响应正文可能含私有内容或会话，不附加到异常与日志。
        if (!response.ok) throw new ReaderError(`Reader request rejected (HTTP ${response.status})`);
        try { return await response.json(); }
        catch { throw new ReaderError('Invalid reader response'); }
      }

      if (!session.access_token || !Number.isFinite(session.expires_at) || session.expires_at * 1000 <= now() + 60000) {
        const renewed = await request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }),
        });
        if (renewed.user?.id !== session.reader_id || renewed.user?.app_metadata?.role !== 'playground_reader' ||
            !renewed.access_token || !renewed.refresh_token || !Number.isFinite(renewed.expires_at)) {
          throw new ReaderError('Dedicated reader identity required');
        }
        session = {
          reader_id: session.reader_id,
          access_token: renewed.access_token,
          refresh_token: renewed.refresh_token,
          expires_at: renewed.expires_at,
        };
        // 先保存 refresh rotation，再读取私有数据。保存失败时停止，交由安全存储恢复流程处理。
        try { await store.replace(session); }
        catch { throw new ReaderError('Reader session persistence failed'); }
      }
      const user = await request('/auth/v1/user', {}, session.access_token);
      if (user.id !== session.reader_id || user.app_metadata?.role !== 'playground_reader') {
        throw new ReaderError('Dedicated reader identity required');
      }

      const records = [];
      let after = '';
      while (true) {
        const rows = await request('/rest/v1/rpc/read_playground_private_v1', {
          method: 'POST', body: JSON.stringify({ p_after: after, p_limit: 200 }),
        }, session.access_token);
        if (!Array.isArray(rows)) throw new ReaderError('Invalid private record response');
        if (!rows.length) break;
        for (const row of rows) {
          if (typeof row.panel !== 'string' || !allowedKey(row.panel) || row.panel <= after ||
              !Number.isFinite(Date.parse(row.updated_at))) throw new ReaderError('Unexpected private record scope or order');
          records.push({ panel: row.panel, content: row.content, updated_at: row.updated_at });
          after = row.panel;
        }
      }
      return { schema_version: 1, exported_at: new Date(now()).toISOString(), records };
    });
  } catch (error) {
    if (error instanceof ReaderError) throw error;
    throw new ReaderError('Reader credential store failed');
  }
}
