import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS } from './rules.mjs';
import { normalizeState, transition } from './study.mjs';
import { acknowledgeImport, captureGuest, pendingImports, readLocal, statePatch, updateLocal } from './storage.mjs';

export function connect(config) {
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export class UnsavedError extends Error {
  constructor(cause) {
    super('アカウントへの保存を確認できませんでした。接続を確認して保存を再試行してください。', { cause });
    this.name = 'UnsavedError';
  }
}

export function accountStore(db, client, accountId) {
  const key = 'journal:' + accountId;
  let snapshot = null;

  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc(name, { p_account: accountId, ...args });
    if (error) throw error;
    if (!data || typeof data !== 'object') throw new Error('保存サーバーから正しい応答を受け取れませんでした。');
    return data;
  }

  async function load() {
    const { revision, ...rawState } = await rpc('lexical_snapshot');
    const state = normalizeState({ ...rawState, settings: { ...DEFAULT_SETTINGS, ...rawState.settings } });
    snapshot = { revision, state };
    return state;
  }

  async function flush() {
    let journal = await readLocal(db, key);
    if (!journal?.pending) return snapshot?.state ?? load();
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!snapshot) await load();
      const { clientId, sequence, pending } = journal;
      const previous = snapshot;
      const next = transition(previous.state, pending);
      let reply;
      try {
        reply = await rpc('lexical_commit', {
          p_revision: previous.revision, p_client: clientId, p_sequence: sequence,
          p_patch: statePatch(previous.state, next),
          p_guest: pending.type === 'import' ? pending.guest.id : null,
        });
      } catch (error) {
        throw new UnsavedError(error);
      }
      if (reply.status === 'conflict') {
        await load();
        journal = await readLocal(db, key);
        if (!journal?.pending) return snapshot.state;
        continue;
      }
      if (!['applied', 'duplicate', 'duplicate_import'].includes(reply.status)) throw new UnsavedError();
      if (pending.type === 'import') await acknowledgeImport(db, accountId, pending.guest.id);
      await updateLocal(db, key, current => current?.pending?.id === pending.id
        ? { ...current, pending: null, sequence: current.sequence + 1 } : current);
      if (reply.status === 'applied') {
        snapshot = { revision: reply.revision, state: next };
        return next;
      }
      return load();
    }
    throw new UnsavedError();
  }

  async function dispatch(action) {
    await flush();
    const result = await updateLocal(db, key, previous => {
      const record = previous ?? { clientId: crypto.randomUUID(), sequence: 1 };
      return record.pending ? record : { ...record, pending: action };
    });
    if (result.pending.id !== action.id) {
      // A second tab may have stored work since flush(). Retry the other op
      // before re-evaluating this action against the latest lesson position.
      await flush();
      const queued = await updateLocal(db, key, previous =>
        previous.pending ? previous : { ...previous, pending: action });
      if (queued.pending.id !== action.id) throw new Error('別のタブの保存中です。状態を更新してから操作してください。');
    }
    return flush();
  }

  async function initialize() {
    await load();
    await flush();
    // Move the snapshot out of the editable guest slot atomically. Logout
    // opens that empty/new slot, while a failed import stays bound to this account.
    await captureGuest(db, accountId);
    for (const guest of await pendingImports(db, accountId)) {
      await dispatch({ id: crypto.randomUUID(), type: 'import', guest, now: Date.now() });
    }
    return snapshot.state;
  }

  return { kind: 'account', accountId, load, dispatch, initialize, flush,
    async waiting() { return Boolean((await readLocal(db, key))?.pending) || (await pendingImports(db, accountId)).length > 0; } };
}
