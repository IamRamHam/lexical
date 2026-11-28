import { EXTRA_STUDY_COUNT, MAX_GOAL } from './rules.mjs';
import { currentWordId, effectiveProgress, emptyState, inProgress, lessonPool, makeSession, progressKey, remainingToday, studyDay } from './study.mjs';
import { grade } from './grading.mjs';
import { icon } from './icons.mjs';
import { WordAudio } from './audio.mjs';
import { guestStore, openDatabase } from './storage.mjs';
import * as view from './views.mjs';

const main = document.querySelector('#main');
const globalMessage = document.querySelector('#global-message');
const audio = new WordAudio();
let wordsPerPage = 30;
let db, store, client, sync, account, config, words, byId;
let state = emptyState();
let busy = false, accountLoading = false, accountError = false, pendingSave = false;
let route = 'home', wordId, viewId, presentedQuestion, requestedAccountVersion = 0;
let revealed = false, typingDraft = '', composing = false, lastComposition = -Infinity, feedback = null;
let attributionData = null, attributionRequest = null;
const spec = { mode: 'recommended', category: 'SUPPLEMENTARY', order: 'registered', start: 1, end: 2, count: null, includeEarly: false };
const filters = { query: '', category: '', status: '', page: 1, pageSize: 30 };
let setupStep = 1;
let selectedDay = studyDay(), month = selectedDay.slice(0, 7), lastDay = selectedDay;

const changes = 'BroadcastChannel' in window ? new BroadcastChannel('lexical.study.v1') : null;
document.querySelector('#menu-icon').innerHTML = icon('menu', 22);
document.querySelector('#phonetic-icon').innerHTML = icon('waves', 19);
document.querySelector('#menu').addEventListener('click', event => {
  if (event.target.closest('a')) event.currentTarget.open = false;
});
document.addEventListener('click', e => {
  const menu = document.querySelector('#menu');
  if (menu.open && !menu.contains(e.target)) menu.open = false;
});
document.addEventListener('keydown', e => {
  const menu = document.querySelector('#menu');
  if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
});

function textMessage(id, message) {
  const target = document.getElementById(id);
  if (target) target.textContent = message;
}
function notice(message = '', type = '') {
  globalMessage.replaceChildren();
  globalMessage.dataset.type = type;
  if (!message) return;
  const text = document.createElement('span');
  text.textContent = message;
  globalMessage.append(text);
  if (account && ['error', 'pending'].includes(type)) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn secondary';
    retry.textContent = '保存を再試行';
    retry.addEventListener('click', retrySync);
    globalMessage.append(retry);
  }
}
const locked = () => busy || accountLoading || accountError || pendingSave;
const action = (type, args = {}) => ({ type, id: crypto.randomUUID(), now: Date.now(), ...args });
const lessonSpec = () => ({
  ...spec, method: state.settings.method,
  count: spec.count ?? (spec.mode === 'recommended' ? remainingToday(state) : 20),
});
const go = id => {
  if (location.hash === '#' + id) enter(id);
  else location.hash = id;
};
function quizWord() {
  const lesson = state.session;
  return lesson ? byId.get(feedback?.wordId ?? currentWordId(lesson)) : null;
}

function render({ focus = false, animateAnswer = false } = {}) {
  if (!words) return;
  if (accountLoading && !accountError) {
    main.innerHTML = '<p class="loading" role="status">アカウントの学習記録を確認しています…</p>';
    return;
  }
  let body;
  presentedQuestion = null;
  if (route === 'lesson') {
    const current = quizWord();
    if (!current) {
      go(state.session && !inProgress(state.session) ? 'result' : 'home');
      return;
    }
    if (!feedback) presentedQuestion = { sessionId: state.session.id, index: state.session.cursor, wordId: current.id };
    body = view.lesson(current, state.session, revealed, feedback, state, typingDraft, locked(), animateAnswer);
  } else if (route === 'result' && state.session && !inProgress(state.session)) {
    body = view.result(state.session, byId);
  } else if (route === 'words') {
    body = view.wordsPage(filters);
  } else if (route === 'word' && byId.has(wordId)) {
    body = view.wordDetail(byId.get(wordId), state, Date.now(), locked());
  } else if (route === 'records') {
    body = view.records(state, month, selectedDay, Date.now());
  } else if (route === 'settings') {
    body = view.settings(state, account, Boolean(client), busy || accountLoading);
  } else if (route === 'sources') {
    body = view.sources(attributionData);
  } else {
    const pool = lessonPool(words, state, lessonSpec(), Date.now());
    const indexCount = Math.max(1, ...pool.flatMap(word => word.memberships.filter(m => m.category === spec.category).map(m => m.index)));
    body = view.home(state, spec, pool.length, indexCount, Date.now(), locked(), setupStep);
  }
  const top = route === 'lesson' ? '' : view.nav(route === 'word' ? 'words' : route);
  main.innerHTML = top + '<div class="view-content">' + body + '</div>';
  if (route === 'words') renderList();
  if (route === 'sources' && !attributionData) fillAttribution();
  const details = document.querySelector('#word-sources');
  details?.addEventListener('toggle', () => { if (details.open) fillAttribution(); });
  if (focus) {
    const input = document.querySelector('#typing-input');
    if (input && matchMedia('(pointer:fine)').matches) input.focus({ preventScroll: true });
    else main.focus({ preventScroll: true });
  }
}

async function fillAttribution() {
  try {
    attributionRequest ??= request('./data/attribution.json');
    const loaded = await attributionRequest;
    if (route === 'sources' && !attributionData) {
      attributionData = loaded;
      render();
    } else {
      attributionData = loaded;
      const pane = document.querySelector('#word-attribution');
      if (pane && route === 'word') pane.innerHTML = view.attribution(byId.get(wordId), loaded);
    }
  } catch {
    attributionRequest = null;
    if (route === 'sources') notice('出典データの読み込みに失敗しました。ページを開き直してください。', 'error');
    else textMessage('word-attribution', '出典データの読み込みに失敗しました。');
  }
}

let listedWords = [];
const searchKey = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function renderList() {
  const block = document.querySelector('#word-results');
  if (!block) return;
  const query = searchKey(filters.query.trim());
  const now = Date.now();
  listedWords = words.filter(word => {
    if (!word.memberships.some(m => !filters.category || filters.category === m.category)) return false;
    if (query && !word.search.includes(query)) return false;
    if (!filters.status) return true;
    const p = effectiveProgress(state.progress[progressKey(word.id)], now);
    if (filters.status === 'difficult') return Boolean(state.tags[word.id]);
    if (filters.status === 'mastered') return p.mastered;
    if (filters.status === 'new') return p.lastAnswered === null;
    return p.lastAnswered !== null && !p.mastered;
  });
  wordsPerPage = Number(filters.pageSize) || 30;
  filters.page = Math.min(filters.page, Math.max(1, Math.ceil(listedWords.length / wordsPerPage)));
  block.innerHTML = view.wordResults(listedWords, state, filters.page, wordsPerPage, locked(), now);
}

function showListPage(page) {
  filters.page = page;
  renderList();
  const count = document.querySelector('#word-list-count');
  count.focus({ preventScroll: true });
  document.querySelector('#word-results').scrollIntoView({ block: 'start' });
}

function play(word, manual = false) {
  if (!word || (!manual && !state.settings.autoplay)) return;
  if (manual) audio.unlock();
  const status = document.querySelector('[data-audio-status]');
  audio.play(word.lemma, message => { if (status?.isConnected) status.textContent = message; });
}

function resetQuestion() {
  audio.stop();
  revealed = false; feedback = null; typingDraft = ''; composing = false; lastComposition = -Infinity;
}
function enter(id, focus = true) {
  if (id === 'main') { main.focus(); return; }
  resetQuestion();
  [route, wordId] = id.split('/');
  if (!['home', 'lesson', 'result', 'words', 'word', 'records', 'settings', 'sources'].includes(route)) route = 'home';
  if (route === 'word' && !byId.has(wordId)) route = 'words';
  viewId = state.session?.id;
  render({ focus });
  window.scrollTo(0, 0);
  if (route === 'lesson' && state.session?.method === 'en-ja') play(quizWord());
}

function updateSetupButton() {
  const button = document.querySelector('#start-button');
  if (!button) return;
  const total = lessonPool(words, state, lessonSpec(), Date.now()).length;
  const valid = spec.mode === 'normal' ? spec.start >= 1 && spec.end >= spec.start && spec.end <= total : lessonSpec().count > 0;
  button.disabled = locked() || state.settings.goal === null || total === 0 || !valid;
}

async function persist(operation, element) {
  if (locked()) return false;
  const currentStore = store;
  busy = true;
  if (element) element.disabled = true;
  let ok = false;
  try {
    const latest = await currentStore.dispatch(operation);
    if (store !== currentStore) return false;
    state = latest;
    changes?.postMessage({ scope: store.accountId ?? 'guest' });
    ok = true;
  } catch (err) {
    if (store !== currentStore) return false;
    console.warn('Lexical save', err);
    if (account) pendingSave = await currentStore.waiting().catch(() => true);
    notice(account ? (pendingSave ? 'アカウントへの保存を確認できません。保存を再試行してください。' : '同期に失敗しました。接続を確認してください。')
      : 'ブラウザに保存できませんでした。データの保存設定を確認して再試行してください。', 'error');
  } finally {
    busy = false;
    if (element?.isConnected) element.disabled = locked();
    if (pendingSave) render();
  }
  return ok;
}

async function confirmAnswer(correct, input, gaveUp, element, { swipe = false } = {}) {
  const s = state.session;
  if (locked() || route !== 'lesson' || s?.id !== viewId || !inProgress(s) || feedback) return;
  const question = presentedQuestion;
  if (!question || question.sessionId !== s.id || question.index !== s.cursor || question.wordId !== currentWordId(s)) {
    resetQuestion();
    render();
    return;
  }
  const current = quizWord();
  if (s.method !== 'typing' && !revealed) return;
  const op = action('answer', { wordId: current.id, sessionId: s.id, index: s.cursor, correct, input, gaveUp });
  if (!await persist(op, element)) return;
  if (state.session?.last?.operationId !== op.id || route !== 'lesson') {
    if (route === 'lesson' && state.session?.id !== s.id) go('home');
    else render();
    notice('別の画面で進んだ学習位置に更新しました。');
    return;
  }
  feedback = state.session.last;
  if (swipe) {
    const card = main.querySelector('.quiz-card');
    card?.classList.add(correct ? 'swipe-right' : 'swipe-left');
    await new Promise(resolve => setTimeout(resolve, 190));
    resetQuestion();
    render({ focus: true, animateAnswer: false });
    if (s.method === 'en-ja') play(quizWord());
    return;
  }
  render({ animateAnswer: true });
  main.querySelector('[data-action="next"],[data-action="finish"]')?.focus({ preventScroll: true });
  if (s.method === 'typing') play(current);
}

function giveUp(element) {
  audio.unlock();
  return confirmAnswer(false, null, true, element);
}

async function retrySync() {
  if (!account || busy || accountLoading) return;
  const current = store;
  busy = true;
  let answered = false;
  try {
    const previous = state.session;
    const loaded = await current.initialize();
    if (store !== current) return;
    state = loaded;
    accountError = false;
    pendingSave = false;
    notice('アカウントの学習記録を同期しました。');
    if (route === 'lesson' && previous && state.session?.id === previous.id && state.session.cursor === previous.cursor + 1) {
      feedback = state.session.last;
      answered = true;
    } else if (route === 'lesson' && state.session?.id !== viewId) go('home');
    changes?.postMessage({ scope: account.id });
  } catch (error) {
    console.warn('Lexical sync', error);
    notice('同期に失敗しました。通信とSupabase設定を確認して再試行してください。', 'error');
  } finally {
    busy = false;
    render({ animateAnswer: answered });
    if (answered && store === current && state.session.method === 'typing') play(quizWord());
  }
}

main.addEventListener('compositionstart', e => { if (e.target.id === 'typing-input') composing = true; });
main.addEventListener('compositionend', e => {
  if (e.target.id !== 'typing-input') return;
  composing = false;
  typingDraft = e.target.value;
  lastComposition = performance.now();
});
main.addEventListener('keydown', e => {
  if (route === 'lesson' && state.session?.method !== 'typing' && revealed && !feedback &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    void confirmAnswer(e.key === 'ArrowRight', null, false, null, { swipe: true });
    return;
  }
  if (e.target.id !== 'typing-input' || e.key !== 'Enter') return;
  if (e.isComposing || composing || e.keyCode === 229 || performance.now() - lastComposition < 90) {
    e.preventDefault();
    return;
  }
  if (!e.target.value.trim()) {
    e.preventDefault();
    if (!e.repeat) void giveUp(e.target.form.querySelector('button[type="submit"]'));
  }
});

let swipeStart = null;
main.addEventListener('pointerdown', event => {
  if (route === 'lesson' && state.session?.method !== 'typing' && revealed && !feedback) {
    swipeStart = { x: event.clientX, y: event.clientY };
  }
});
main.addEventListener('pointerup', event => {
  if (!swipeStart || route !== 'lesson' || state.session?.method === 'typing' || !revealed || feedback) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    void confirmAnswer(dx > 0, null, false, null, { swipe: true });
  }
});

main.addEventListener('input', e => {
  if (e.target.id === 'typing-input') typingDraft = e.target.value;
  if (e.target.name === 'query') {
    filters.query = e.target.value; filters.page = 1; renderList();
  }
  if (e.target.form?.id === 'start-form' && e.target.type === 'number') {
    spec[e.target.name] = e.target.valueAsNumber || (e.target.name === 'count' ? null : 0);
    updateSetupButton();
  }
});
main.addEventListener('change', async e => {
  const { name, value, checked } = e.target;
  if (name === 'viewMethod') {
    if (await persist(action('settings', { settings: { method: value } }))) render();
    return;
  }
  const form = e.target.form?.id;
  if (form === 'start-form' && ['category', 'order', 'includeEarly'].includes(name)) {
    spec[name] = name === 'includeEarly' ? checked : value;
    if (name === 'category') {
      spec.start = 1;
      const indices = lessonPool(words, state, { ...lessonSpec(), mode: 'normal' }, Date.now()).flatMap(word =>
        word.memberships.filter(m => m.category === spec.category).map(m => m.index));
      spec.end = Math.max(1, Math.min(2, Math.max(...indices)));
    }
    render();
    document.querySelector('#start-form [name="' + name + '"]')?.focus({ preventScroll: true });
  } else if (form === 'word-filters' && ['category', 'status', 'pageSize'].includes(name)) {
    filters[name] = value;
    filters.page = 1;
    if (name === 'pageSize') renderList(); else render();
    document.querySelector('#word-filters [name="' + name + '"]')?.focus({ preventScroll: true });
  }
});

main.addEventListener('submit', async e => {
  e.preventDefault();
  if (locked()) return;
  const form = e.target;
  const data = new FormData(form);
  if (form.id === 'typing-form') {
    if (composing || performance.now() - lastComposition < 90) return;
    const current = byId.get(presentedQuestion?.wordId);
    if (!current) return;
    const result = grade(current, String(data.get('answer') ?? ''));
    if (result.empty) {
      textMessage('answer-error', '英単語を入力するか、「分からない・答えを見る」を押してください。');
      return;
    }
    audio.unlock();
    await confirmAnswer(result.accepted, result.originalInput, false, e.submitter);
  } else if (form.id === 'word-page-jump') {
    const page = form.elements.page.valueAsNumber;
    const max = Math.ceil(listedWords.length / wordsPerPage);
    if (Number.isInteger(page) && page >= 1 && page <= max) showListPage(page);
  } else if (form.id === 'goal-setup' || form.id === 'settings-form') {
    const goal = Number(data.get('goal'));
    if (!Number.isInteger(goal) || goal < 1 || goal > MAX_GOAL) return;
    const settings = form.id === 'settings-form' ? { goal, autoplay: data.has('autoplay') } : { goal };
    if (await persist(action('settings', { settings }), e.submitter)) {
      if (!state.settings.autoplay) audio.stop();
      render();
      if (form.id === 'goal-setup') document.querySelector('#start-form [aria-pressed="true"]')?.focus();
      else notice('学習設定を保存しました。');
    }
  } else if (form.id === 'start-form') {
    if (inProgress(state.session)) {
      textMessage('setup-error', '途中のセットを再開するか、破棄してから開始してください。');
      return;
    }
    if (state.settings.goal === null) return;
    audio.unlock();
    const op = action('start');
    const s = makeSession(words, state, lessonSpec(), op.now, op.id);
    if (!s) { textMessage('setup-error', '出題対象の単語がありません。'); return; }
    op.session = s;
    op.previousId = state.session?.id;
    if (await persist(op, e.submitter)) {
      if (state.session?.id === s.id) {
        if (s.mode === 'recommended') spec.count = null;
        notice(); go('lesson');
      }
      else { render(); notice('別の画面に途中のセットがあります。'); }
    }
  }
});

main.addEventListener('click', async e => {
  const control = e.target.closest('button');
  if (!control || control.disabled) return;
  const ds = control.dataset;
  if (ds.speak) { play(byId.get(ds.speak), true); return; }
  if (ds.method) {
    if (await persist(action('settings', { settings: { method: ds.method } }), control)) {
      setupStep = 2;
      render();
      document.querySelector('[data-method="' + ds.method + '"]')?.focus({ preventScroll: true });
    }
    return;
  }
  if (ds.mode) {
    spec.mode = ds.mode; spec.count = null;
    setupStep = 3;
    render();
    document.querySelector('[data-mode="' + ds.mode + '"]')?.focus({ preventScroll: true });
    return;
  }
  if (ds.tag || ds.action === 'tag-quiz') {
    const id = ds.tag || quizWord()?.id;
    if (id && await persist(action('tag', { wordId: id, value: !state.tags[id] }), control)) {
      if (route === 'words') renderList();
      else render();
      document.querySelector(ds.tag ? '[data-tag="' + id + '"]' : '[data-action="tag-quiz"]')?.focus({ preventScroll: true });
    }
    return;
  }
  if (ds.day) { selectedDay = ds.day; drawCalendar(ds.day); return; }
  switch (ds.action) {
    case 'scroll-setup': {
      setupStep = 1;
      render();
      const focusTarget = document.querySelector('#goal-setup input, #start-form [data-method][aria-pressed="true"]');
      document.querySelector('#setup').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      focusTarget?.focus({ preventScroll: true });
      break;
    }
    case 'setup-back':
      setupStep = Math.max(1, setupStep - 1); render(); break;
    case 'resume':
      audio.unlock(); notice(); go('lesson'); break;
    case 'discard':
      if (confirm('途中のセットを破棄しますか？ 確定した回答は学習記録に残ります。') &&
          await persist(action('discard', { sessionId: state.session.id }), control)) render();
      break;
    case 'extra-study':
      spec.count = EXTRA_STUDY_COUNT; render(); document.querySelector('#start-form [name="count"]')?.focus(); break;
    case 'reveal':
      if (locked()) break;
      audio.unlock(); revealed = true; render();
      main.querySelector('[data-action="mark-right"]')?.focus({ preventScroll: true });
      if (state.session.method === 'ja-en') play(quizWord());
      break;
    case 'mark-right':
    case 'mark-wrong':
      await confirmAnswer(ds.action === 'mark-right', null, false, control); break;
    case 'give-up':
      await giveUp(control); break;
    case 'next':
      audio.unlock(); resetQuestion(); render({ focus: true }); window.scrollTo(0, 0);
      if (state.session.method === 'en-ja') play(quizWord());
      break;
    case 'finish':
      go('result'); break;
    case 'page-prev':
    case 'page-next':
      showListPage(filters.page + (ds.action === 'page-prev' ? -1 : 1));
      break;
    case 'previous-month':
    case 'next-month': {
      const [y, m] = month.split('-').map(Number);
      month = new Date(Date.UTC(y, m - 1 + (ds.action === 'previous-month' ? -1 : 1), 1)).toISOString().slice(0, 7);
      selectedDay = month + '-01'; drawCalendar(null, ds.action);
      break;
    }
    case 'retry-sync':
      await retrySync(); break;
    case 'login':
      if (!client) break;
      control.disabled = true;
      try {
        const redirectTo = new URL(location.pathname, location.origin).href;
        const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
        if (error) throw error;
      } catch (err) {
        console.warn('Lexical login', err); notice('Googleログインを開始できませんでした。設定を確認してください。', 'error');
        control.disabled = false;
      }
      break;
    case 'logout':
      if (!client || busy) break;
      if (!confirm('Googleアカウントからログアウトしますか？ このブラウザではゲストとして続けられます。')) break;
      control.disabled = true;
      try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
        await chooseAccount(null);
      } catch (err) {
        console.warn('Lexical logout', err); notice('ログアウトできませんでした。接続を確認してください。', 'error');
        control.disabled = false;
      }
      break;
    default:
  }
});

function drawCalendar(day, action) {
  document.querySelector('#calendar-card').innerHTML = view.calendar(state, month, selectedDay);
  const selector = day ? '[data-day="' + day + '"]' : '[data-action="' + action + '"]';
  document.querySelector(selector)?.focus({ preventScroll: true });
}

async function chooseAccount(user) {
  if ((account?.id ?? null) === (user?.id ?? null) && store) return;
  const version = ++requestedAccountVersion;
  account = user;
  resetQuestion();
  accountLoading = Boolean(user);
  accountError = false;
  pendingSave = false;
  const nextStore = user ? sync.accountStore(db, client, user.id) : guestStore(db);
  store = nextStore;
  state = emptyState();
  if (accountLoading) render();
  try {
    const loaded = await (user ? nextStore.initialize() : nextStore.load());
    if (version !== requestedAccountVersion) return;
    state = loaded;
    accountLoading = false;
    notice();
    enter(location.hash.slice(1) || 'home', false);
    await expire();
  } catch (err) {
    if (version !== requestedAccountVersion) return;
    console.warn('Lexical storage', err);
    accountLoading = false;
    accountError = true;
    notice(user ? 'アカウントの学習記録を読み込めませんでした。通信と接続設定をご確認ください。'
      : 'ブラウザに学習記録を保存できません。ブラウザ設定をご確認ください。', 'error');
    render();
  }
}

async function expire() {
  if (locked()) return false;
  const now = Date.now();
  if (!Object.values(state.progress).some(p => effectiveProgress(p, now) !== p)) return false;
  return persist(action('expire', { now }));
}

async function refresh({ syncAccount = false } = {}) {
  if (!store || locked() || composing || document.hidden) return;
  busy = true;
  const currentStore = store;
  const previous = state.session;
  try {
    if (store.kind === 'guest' || syncAccount) {
      const latest = await currentStore.load();
      if (store !== currentStore) return;
      state = latest;
    }
  } catch (err) {
    console.warn('Lexical refresh', err);
  } finally {
    busy = false;
  }
  if (store !== currentStore) return;
  const expired = await expire();
  const day = studyDay();
  const dayChanged = lastDay !== day;
  if (dayChanged) lastDay = day;
  if (route === 'lesson') {
    if (state.session?.id !== viewId) { go('home'); return; }
    if (state.session.cursor !== previous?.cursor) {
      resetQuestion();
      if (!inProgress(state.session)) go('result');
      else render();
      notice('別の画面で進んだ学習位置に更新しました。');
    }
  } else if (dayChanged || expired || syncAccount) {
    render();
  }
}

changes?.addEventListener('message', e => {
  if (e.data?.scope === (store?.accountId ?? 'guest')) void refresh({ syncAccount: true });
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.stop();
  else void refresh({ syncAccount: true });
});
window.addEventListener('online', () => { if (account && (pendingSave || accountError)) void retrySync(); });
window.addEventListener('hashchange', () => { if (words) enter(location.hash.slice(1) || 'home'); });
setInterval(() => void refresh(), 10_000);

async function request(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load ' + url);
  return response.json();
}

try {
  const [catalog, settings, local] = await Promise.all([request('./data/catalog.json'), request('./config.json'), openDatabase()]);
  config = settings;
  db = local;
  words = catalog.words;
  for (const word of words) word.search = searchKey([word.lemma, ...word.senses.map(s => s.japanese)].join(' '));
  byId = new Map(words.map(w => [w.id, w]));
  if (config.phoneticUrl) {
    const phonetic = document.querySelector('#phonetic-link');
    phonetic.href = config.phoneticUrl;
    phonetic.hidden = false;
  }
  let user = null;
  if (config.supabaseUrl && config.supabaseKey) {
    try {
      sync = await import('./sync.mjs');
      client = sync.connect(config);
      const { data, error } = await client.auth.getSession();
      if (error) console.warn('Lexical Auth', error);
      user = data.session?.user ?? null;
      // Schedule outside the Auth callback so database calls don't run inside its lock.
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
        setTimeout(() => void chooseAccount(session?.user ?? null), 0);
      });
    } catch (error) { console.warn('Lexical Auth setup', error); }
  }
  await chooseAccount(user);
} catch (error) {
  console.warn('Lexical startup', error);
  main.innerHTML = '<section class="card empty"><h1>Lexicalを開けませんでした</h1><p>学習データとブラウザの保存設定を確認して、読み込み直してください。</p><a href="./" class="btn primary">読み込み直す</a></section>';
}
