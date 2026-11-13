import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readScopedPlayground } from '../lib/playground-reader.mjs';

const owner = '10000000-0000-4000-8000-000000000001';
const reader = '10000000-0000-4000-8000-000000000002';
const other = '10000000-0000-4000-8000-000000000003';
const otherOwner = '10000000-0000-4000-8000-000000000004';

test('Postgres draft authorization with synthetic users and records', async t => {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const database = new PGlite();
  try {
    await database.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb not null default '{}');
      create function auth.jwt() returns jsonb language sql stable as
        $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(auth.jwt()->>'sub', '')::uuid$$;
      grant usage on schema public, auth to anon, authenticated;
    `);
    await database.exec(readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8'));
    await database.exec('grant select, insert, update on public.events to authenticated; grant usage on sequence public.events_id_seq to authenticated');
    await database.query('insert into auth.users values ($1, $2), ($3, $4), ($5, $6)',
      [owner, { role: 'owner' }, reader, { role: 'playground_reader' }, other, {}]);
    for (const panel of ['career', 'playground:preferences:v1', 'playground:feedback:v1:legacy', 'playground:preferences:v1:extra', 'playground:feedback:v10:extra']) {
      await database.query('insert into public.panel_private(panel, content) values ($1, $2)', [panel, { synthetic: true }]);
    }
    const migration = readFileSync(new URL('../../db/drafts/playground-reader.sql', import.meta.url), 'utf8');
    await t.test('legacy backfill fails closed without verified Owner parameter', async () => {
      await assert.rejects(database.exec(migration), /Verified single Owner/);
      await database.exec('rollback');
    });
    await database.query("select set_config('lab_play.playground_owner_id', $1, false)", [owner]);
    await database.exec(migration);
    await database.query('insert into auth.users values ($1, $2)', [otherOwner, { role: 'owner' }]);
    await database.query('insert into private.playground_reader_grants(reader_id, owner_id) values ($1, $2)', [reader, owner]);
    await database.query('insert into public.panel_private(panel, content, owner_id) values ($1, $2, $3), ($4, $2, null)',
      ['playground:feedback:v1:other-user', { synthetic: true }, otherOwner, 'playground:feedback:v1:unassigned']);

    async function asUser(id, role, sql, parameters = [], databaseRole = 'authenticated') {
      await database.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, app_metadata: { role }, user_metadata: { role: 'playground_reader' } })]);
      await database.exec(`set role ${databaseRole}`);
      try { return await database.query(sql, parameters); }
      finally { await database.exec('reset role'); }
    }
    const read = 'select * from public.read_playground_private_v1()';
    const denied = action => assert.rejects(action, error => error.code === '42501');

    await t.test('only exact Aki keys returned, other panels/users/unassigned rows excluded', async () => {
      const result = await asUser(reader, 'playground_reader', read);
      assert.deepEqual(result.rows.map(row => row.panel), ['playground:feedback:v1:legacy', 'playground:preferences:v1']);
      assert.deepEqual((await asUser(reader, 'playground_reader', 'select * from public.panel_private')).rows, []);
      assert.deepEqual((await asUser(reader, 'playground_reader', 'select * from public.read_playground_private_v1($1, $2)', ['playground:feedback:v1:legacy', 1])).rows.map(row => row.panel), ['playground:preferences:v1']);
    });
    await t.test('anonymous, unbound user, forged user metadata and Owner cannot use reader RPC', async () => {
      await denied(() => asUser(null, '', read, [], 'anon'));
      await denied(() => asUser(other, '', read));
      await denied(() => asUser(other, 'playground_reader', read));
      await denied(() => asUser(owner, 'owner', read));
    });
    await t.test('insert, upsert, update and delete cannot change private records', async () => {
      await denied(() => asUser(reader, 'playground_reader', "insert into public.panel_private(panel) values ('playground:feedback:v1:attempt')"));
      await denied(() => asUser(reader, 'playground_reader', "insert into public.panel_private(panel) values ('playground:preferences:v1') on conflict(panel) do update set content='{}'"));
      assert.deepEqual((await asUser(reader, 'playground_reader', "update public.panel_private set content='{}' returning panel")).rows, []);
      await denied(() => asUser(reader, 'playground_reader', 'delete from public.panel_private'));
    });
    await t.test('existing writer RPCs, event writes and management operations denied', async () => {
      await denied(() => asUser(reader, 'playground_reader', "select public.save_career_panel('{}','{}','[]')"));
      await denied(() => asUser(reader, 'playground_reader', "select public.restore_lab_play_backup('{}')"));
      await denied(() => asUser(reader, 'playground_reader', "insert into public.events(play,type) values ('fixture','fixture')"));
      await denied(() => asUser(reader, 'playground_reader', 'select * from auth.users'));
      await denied(() => asUser(reader, 'playground_reader', 'select * from private.playground_reader_grants'));
      await denied(() => asUser(reader, 'playground_reader', 'create role forbidden_management'));
    });
    await t.test('revocation rejects an otherwise unchanged reader JWT', async () => {
      await database.query('update private.playground_reader_grants set revoked_at=now() where reader_id=$1', [reader]);
      await denied(() => asUser(reader, 'playground_reader', read));
      await database.query('update private.playground_reader_grants set revoked_at=null where reader_id=$1', [reader]);
    });
    await t.test('pagination rejects excessive limits and a cursor cannot widen scope', async () => {
      await assert.rejects(() => asUser(reader, 'playground_reader', 'select * from public.read_playground_private_v1($1,$2)', ['', 501]), error => error.code === '22023');
      const result = await asUser(reader, 'playground_reader', 'select * from public.read_playground_private_v1($1,$2)', ["' or true --", 500]);
      assert.equal(result.rows.length, 2);
    });
    await t.test('normal Owner writes still record ownership on new rows', async () => {
      await asUser(owner, 'owner', "insert into public.panel_private(panel) values ('playground:feedback:v1:new-owner-row')");
      const result = await database.query("select owner_id from public.panel_private where panel='playground:feedback:v1:new-owner-row'");
      assert.equal(result.rows[0].owner_id, owner);
    });
  } finally { await database.close(); }
});

test('client refresh persistence, scope and error redaction using synthetic responses', async t => {
  const initial = { reader_id: reader, access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: 1 };
  const renewed = { user: { id: reader, app_metadata: { role: 'playground_reader' } }, access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh', expires_at: 9999999999 };
  const now = () => 100000;
  const goodRow = { panel: 'playground:preferences:v1', content: { synthetic: true }, updated_at: '2026-11-13T00:00:00Z' };
  function fixture({ saveFails = false, returnedRow = goodRow, refreshUser = renewed.user, failHttp = false } = {}) {
    let saved = false;
    let calls = 0;
    let pages = 0;
    const sessionStore = { withExclusive: run => run({ read: async () => initial, replace: async session => {
      if (saveFails) throw new Error('synthetic-secret-in-storage-error');
      assert.equal(session.refresh_token, renewed.refresh_token);
      saved = true;
    } }) };
    const fetchImpl = async url => {
      calls++;
      if (failHttp) return Response.json({ secret: 'synthetic-secret-in-error-body' }, { status: 401 });
      if (url.includes('/token?')) return Response.json({ ...renewed, user: refreshUser });
      assert(saved, 'rotated session must be persisted before private reads');
      if (url.endsWith('/user')) return Response.json(renewed.user);
      return Response.json(pages++ ? [] : [returnedRow]);
    };
    return { sessionStore, fetchImpl, calls: () => calls };
  }
  await t.test('rotation is saved before authenticated reads', async () => {
    const output = await readScopedPlayground({ ...fixture(), now });
    assert.deepEqual(output.records, [goodRow]);
  });
  await t.test('failed secret persistence stops before any private read', async () => {
    const state = fixture({ saveFails: true });
    await assert.rejects(() => readScopedPlayground({ ...state, now }), /Reader session persistence failed/);
    assert.equal(state.calls(), 1);
  });
  await t.test('Owner refresh responses and out-of-scope records rejected', async () => {
    await assert.rejects(() => readScopedPlayground({ ...fixture({ refreshUser: { id: owner, app_metadata: { role: 'owner' } } }), now }), /Dedicated reader identity required/);
    await assert.rejects(() => readScopedPlayground({ ...fixture({ returnedRow: { ...goodRow, panel: 'career' } }), now }), /Unexpected private record scope/);
  });
  await t.test('HTTP, transport and storage errors do not expose response bodies or secret values', async () => {
    const states = [fixture({ failHttp: true }), {
      sessionStore: { withExclusive: async () => { throw new Error('synthetic-secret-in-storage-error'); } },
    }, { ...fixture(), fetchImpl: async () => { throw new Error('synthetic-secret-in-network-error'); } }];
    for (const state of states) {
      await assert.rejects(() => readScopedPlayground({ ...state, now }), error => !String(error).includes('synthetic-secret'));
    }
  });
});
