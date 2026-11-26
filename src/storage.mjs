import { emptyState, transition } from './study.mjs';

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lexical.study.v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のタブでLexicalを閉じてから開き直してください。'));
  });
}

export function readLocal(db, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction('data').objectStore('data').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Read and write in the same IndexedDB transaction, including across tabs.
export function updateLocal(db, key, change) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', 'readwrite');
    const store = tx.objectStore('data');
    const request = store.get(key);
    let result, failure;
    request.onsuccess = () => {
      try {
        result = change(request.result);
        if (result !== request.result) store.put(result, key);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('ブラウザに保存できませんでした。'));
  });
}

const key = 'guest-vault';
const newGuest = () => ({ id: crypto.randomUUID(), state: emptyState() });
const newVault = () => ({ guest: newGuest(), imports: {} });
const hasGuestData = s => s.settings.updatedAt || s.session || Object.keys(s.tags).length ||
  Object.keys(s.days).length || Object.keys(s.progress).length;

export function guestStore(db) {
  return {
    kind: 'guest',
    async load() { return (await updateLocal(db, key, previous => previous ?? newVault())).guest.state; },
    async dispatch(action) {
      const value = await updateLocal(db, key, previous => {
        const vault = previous ?? newVault();
        const state = transition(vault.guest.state, action);
        return state === vault.guest.state ? vault : { ...vault, guest: { ...vault.guest, state } };
      });
      return value.guest.state;
    },
  };
}

export function captureGuest(db, accountId) {
  return updateLocal(db, key, previous => {
    const vault = previous ?? newVault();
    if (!hasGuestData(vault.guest.state)) return vault;
    return {
      guest: newGuest(),
      imports: { ...vault.imports, [accountId]: [...(vault.imports[accountId] ?? []), vault.guest] },
    };
  });
}

export async function pendingImports(db, accountId) {
  return (await readLocal(db, key))?.imports[accountId] ?? [];
}

export function acknowledgeImport(db, accountId, guestId) {
  return updateLocal(db, key, previous => {
    if (!previous?.imports[accountId]) return previous;
    const imports = { ...previous.imports };
    imports[accountId] = imports[accountId].filter(g => g.id !== guestId);
    if (!imports[accountId].length) delete imports[accountId];
    return { ...previous, imports };
  });
}

export function statePatch(previous, next) {
  const patch = {};
  if (next.settings !== previous.settings) patch.settings = next.settings;
  if (next.session !== previous.session) {
    // The RPC validates compact steps against the original order. Retry steps use a full session
    // under the same revision check so they also work with databases already set up for Lexical.
    if (next.session && next.session.id === previous.session?.id &&
        next.session.ids === previous.session.ids && previous.session.cursor < previous.session.ids.length &&
        next.session.cursor === previous.session.cursor + 1) {
      const { id, cursor, correct, last, retryIds } = next.session;
      patch.session_step = { id, cursor, correct, last };
      if (retryIds !== previous.session.retryIds) patch.session_step.retryIds = retryIds;
    } else patch.session = next.session;
  }
  const progress = Object.entries(next.progress).filter(([id, state]) => previous.progress[id] !== state);
  if (progress.length) patch.progress = progress.map(([key, state]) => {
    const [word_id, method] = key.split(':');
    return { word_id, method, state };
  });
  const days = Object.entries(next.days).filter(([day, value]) => previous.days[day] !== value);
  if (days.length) patch.days = Object.fromEntries(days);
  const tagIds = new Set([...Object.keys(previous.tags), ...Object.keys(next.tags)]);
  const tags = [...tagIds].filter(id => previous.tags[id] !== next.tags[id]);
  if (tags.length) patch.tags = Object.fromEntries(tags.map(id => [id, Boolean(next.tags[id])]));
  return patch;
}
