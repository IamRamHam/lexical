import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = 'ad2d7ba2-2310-4187-bbe1-351b8127627c';
const other = '63dc2672-6b95-41ea-ad17-a805871a34f9';
const client = '43301b45-a918-4c24-98ec-12d3d6ff67ff';
const secondClient = 'd1ba23af-0303-41ca-a838-51952c63ff11';
const guest = 'cf4bfd2a-a69d-4ddf-912c-21371d0adcb8';
const word = 'lex_00000000000000000000000000000001';
const migration = await readFile('supabase/migrations/202611240001_lexical.sql', 'utf8');
const unifiedMigration = await readFile('supabase/migrations/202611280001_unified_progress.sql', 'utf8');

test('real PostgreSQL schema: CAS, client receipts, import receipt, RLS and identity enforcement', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth to authenticated, anon;`);
  await db.query('insert into auth.users(id) values ($1),($2)', [owner, other]);
  await db.exec(migration);
  await db.exec(unifiedMigration);
  const auth = async sub => {
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
  };
  const rpc = async (name, args, params) => (await db.query('select public.lexical_' + name + '(' + args + ') as value', params)).rows[0].value;
  const snapshot = id => rpc('snapshot', '$1', [id]);
  const commit = (id, revision, device, seq, patch, importId = null) =>
    rpc('commit', '$1,$2,$3,$4,$5,$6', [id, revision, device, seq, JSON.stringify(patch), importId]);
  try {
    await auth(owner);
    assert.equal((await snapshot(owner)).revision, 0);
    const progress = { correct: 1, incorrect: 0, lastAnswered: 10000, bar: 8, mastered: false, streak: 1, halfLife: 600, due: 600000 };
    const day = '2026-11-24';
    const first = { settings: { goal: 50 }, progress: [{ word_id: word, method: 'typing', state: progress }],
      days: { [day]: 1 }, tags: { [word]: true }, session: { id: 'test-session', cursor: 0, ids: [word], wrongIds: [], correct: 0 } };
    assert.equal((await commit(owner, 0, client, 1, first)).status, 'applied');
    assert.equal((await commit(owner, 0, client, 1, first)).status, 'duplicate');
    assert.equal((await commit(owner, 0, secondClient, 1, { days: { [day]: 9 } })).status, 'conflict');
    assert.equal((await snapshot(owner)).days[day], 1);
    const importResult = await commit(owner, 1, secondClient, 1, { days: { [day]: 2 } }, guest);
    assert.equal(importResult.status, 'applied');
    assert.equal((await commit(owner, 2, secondClient, 2, { days: { [day]: 3 } }, guest)).status, 'duplicate_import');
    assert.equal((await snapshot(owner)).days[day], 2);
    const step = { session_step: { id: 'test-session', cursor: 1, correct: 0, last: { wordId: word, correct: false } } };
    await assert.rejects(commit(owner, 2, secondClient, 3, { session_step: { ...step.session_step, id: 'stale-session' } }), /Lesson step/);
    assert.equal((await commit(owner, 2, secondClient, 3, step)).status, 'applied');
    const saved = await snapshot(owner);
    assert.equal(saved.session.cursor, 1);
    assert.deepEqual(saved.session.ids, [word]);
    assert.deepEqual(saved.session.wrongIds, [word]);
    assert.equal((await commit(owner, 3, secondClient, 4, { tags: { [word]: false }, session: null })).status, 'applied');
    assert.deepEqual((await snapshot(owner)).tags, {});
    assert.equal((await snapshot(owner)).session, null);
    assert.deepEqual((await snapshot(owner)).progress[word], progress);
    await assert.rejects(db.exec('update public.lexical_progress set state = state'), /permission denied/i);
    await auth(other);
    for (const table of ['profiles','progress','word_progress','days','tags']) {
      assert.equal((await db.query('select * from public.lexical_' + table + ' where user_id=$1', [owner])).rows.length, 0);
    }
    await assert.rejects(snapshot(owner), /Account does not match/);
    await assert.rejects(commit(owner, 3, client, 2, { days: { [day]: 3 } }), /Account does not match/);
    assert.equal((await commit(other, 0, client, 1, { days: { [day]: 4 } }, guest)).status, 'duplicate_import');
    assert.deepEqual((await snapshot(other)).days, {});
    await db.exec('reset role; set role anon');
    await assert.rejects(snapshot(other), /permission denied/i);
    await assert.rejects(db.exec('select * from public.lexical_progress'), /permission denied/i);
  } finally {
    await db.close();
  }
});
