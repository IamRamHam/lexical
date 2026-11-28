import { CATEGORIES, DEFAULT_SETTINGS, LEVEL_ANSWERS, MASTERY_EXPIRY_MS, MAX_GOAL, METHODS, REVIEW } from './rules.mjs';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Progress belongs to the word, rather than to a particular answer method.
// Keep the optional second argument for callers from older pages and saved sessions.
export const progressKey = id => id;
export const EMPTY_PROGRESS = Object.freeze({
  correct: 0, incorrect: 0, streak: 0, bar: 0, mastered: false,
  lastAnswered: null, halfLife: null, due: null,
});
export const emptyState = () => ({ settings: { ...DEFAULT_SETTINGS }, progress: {}, days: {}, tags: {}, session: null });

// Older local and cloud snapshots kept one progress record per answer method.
// The newest format has one shared record per word. Counts are retained and
// the most recently answered record supplies the current review state.
export function normalizeState(value, now = Date.now()) {
  const state = { ...emptyState(), ...value, settings: { ...DEFAULT_SETTINGS, ...value?.settings },
    progress: {}, days: { ...(value?.days ?? {}) }, tags: { ...(value?.tags ?? {}) } };
  for (const [legacyKey, raw] of Object.entries(value?.progress ?? {})) {
    const wordId = legacyKey.split(':')[0];
    const current = state.progress[wordId];
    const candidate = effectiveProgress(raw, now);
    if (!current) { state.progress[wordId] = { ...candidate }; continue; }
    const latest = (candidate.lastAnswered ?? -1) > (current.lastAnswered ?? -1) ? candidate : current;
    state.progress[wordId] = {
      ...latest,
      correct: (current.correct ?? 0) + (candidate.correct ?? 0),
      incorrect: (current.incorrect ?? 0) + (candidate.incorrect ?? 0),
    };
  }
  return state;
}

export function studyDay(timestamp = Date.now()) {
  // UTC+9, with the first five hours still belonging to the preceding study day.
  return new Date(timestamp + 4 * 3_600_000).toISOString().slice(0, 10);
}

export function effectiveProgress(progress = EMPTY_PROGRESS, now = Date.now()) {
  if (progress.mastered && progress.lastAnswered !== null && now - progress.lastAnswered >= MASTERY_EXPIRY_MS) {
    return { ...progress, mastered: false, streak: 0 };
  }
  return progress;
}

export function schedule(progress, correct, now, settings = REVIEW) {
  let halfLife;
  if (correct) {
    const positive = Math.log2(clamp(progress.correct, 1, settings.evidenceCap));
    const negative = Math.log2(1 + clamp(progress.incorrect, 0, settings.evidenceCap));
    const streak = clamp(progress.streak - 1, 0, settings.correctStreakCap - 1);
    halfLife = settings.firstCorrectHalfLife * (2 ** (
      settings.cumulativeCorrectWeight * positive - settings.cumulativeIncorrectWeight * negative
      + settings.correctStreakWeight * streak
    ));
  } else {
    const streak = clamp(-progress.streak - 1, 0, settings.incorrectStreakCap - 1);
    halfLife = settings.incorrectBaseHalfLife * settings.incorrectStreakFactor ** streak;
  }
  halfLife = Math.round(clamp(halfLife, settings.minHalfLife, settings.maxHalfLife));
  const interval = Math.round(clamp(-halfLife * Math.log2(settings.targetRecall), settings.minInterval, settings.maxInterval));
  return { halfLife, due: now + interval * 1000 };
}

export function recall(progress, now = Date.now()) {
  if (progress?.lastAnswered == null || !progress.halfLife) return null;
  return 2 ** (-Math.max(0, now - progress.lastAnswered) / (1000 * progress.halfLife));
}

export function answerProgress(value, correct, now) {
  const prev = effectiveProgress(value, now);
  const streak = correct ? Math.max(0, prev.streak) + 1 : Math.min(0, prev.streak) - 1;
  const gain = streak === 1 ? 8 : streak < 5 ? 10 : 15;
  const bar = correct ? Math.min(100, prev.bar + gain)
    : prev.mastered ? prev.bar : Math.max(0, prev.bar - (streak === -1 ? 5 : 10));
  const progress = {
    correct: prev.correct + Number(correct), incorrect: prev.incorrect + Number(!correct),
    lastAnswered: now, streak, bar, mastered: correct && prev.bar === 100,
  };
  return { ...progress, ...schedule(progress, correct, now) };
}

export const currentWordId = session => session?.ids[session.cursor] ?? session?.retryIds?.[0] ?? null;
export const inProgress = session => currentWordId(session) !== null;
export const remainingToday = (state, now = Date.now()) => Math.max(0, (state.settings.goal ?? 0) - (state.days[studyDay(now)] ?? 0));

export function totals(state, methodOrNow = Date.now(), legacyNow) {
  const now = typeof legacyNow === 'number' ? legacyNow : typeof methodOrNow === 'number' ? methodOrNow : Date.now();
  let mastered = 0;
  for (const item of Object.values(state.progress)) if (effectiveProgress(item, now).mastered) mastered++;
  const count = Object.values(state.days).reduce((a, b) => a + b, 0);
  return { mastered, count, today: state.days[studyDay(now)] ?? 0, level: 1 + Math.floor(count / LEVEL_ANSWERS) };
}

export function eligibleWords(words, category) {
  return words.filter(word => word.memberships.some(m => !category || m.category === category));
}

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function recommendation(words, state, methodOrNow, nowOrEarly = false, legacyEarly = false) {
  const now = typeof methodOrNow === 'number' ? methodOrNow : nowOrEarly;
  const includeEarly = typeof methodOrNow === 'number' ? nowOrEarly : legacyEarly;
  const due = [], unseen = [], early = [];
  for (const word of words) {
    const p = effectiveProgress(state.progress[progressKey(word.id)], now);
    if (p.lastAnswered === null) unseen.push(word);
    else if (p.due <= now) due.push({ word, p });
    else if (includeEarly) early.push({ word, p });
  }
  due.sort((a, b) => a.p.bar - b.p.bar || a.p.due - b.p.due || a.word.order - b.word.order);
  early.sort((a, b) => a.p.due - b.p.due || a.word.order - b.word.order);
  return [...due.map(x => x.word), ...unseen, ...early.map(x => x.word)];
}

export function lessonPool(words, state, spec, now) {
  const eligible = eligibleWords(words, spec.category);
  if (spec.mode === 'difficult') return eligible.filter(w => state.tags[w.id]);
  if (spec.mode === 'recommended') return recommendation(eligible, state, now, spec.includeEarly);
  return eligible;
}

export function makeSession(words, state, spec, now, id, random) {
  const pool = lessonPool(words, state, spec, now);
  const part = spec.mode === 'normal' ? pool.filter(word => word.memberships.some(m => {
    // `index` is present in the catalog. The fallback keeps pre-v1.1 saved
    // lesson fixtures using their original item-range semantics.
    const index = m.index ?? m.rank ?? word.order;
    return m.category === spec.category && index >= spec.start && index <= spec.end;
  })) : pool;
  const ordered = spec.mode !== 'recommended' && spec.order === 'random' ? shuffle(part, random) : part;
  const chosen = spec.mode === 'normal' ? ordered : ordered.slice(0, spec.count);
  if (!chosen.length) return null;
  return {
    id, ids: chosen.map(w => w.id), method: spec.method, mode: spec.mode, category: spec.category,
    startedAt: now, cursor: 0, correct: 0, wrongIds: [], retryIds: [], last: null,
  };
}

export function mergeGuest(account, guest, now) {
  account = normalizeState(account, now);
  guest = normalizeState(guest, now);
  const state = {
    ...account, progress: { ...account.progress }, days: { ...account.days },
    tags: { ...account.tags, ...guest.tags },
  };
  if (guest.settings.updatedAt > account.settings.updatedAt || account.settings.goal === null) {
    state.settings = { ...account.settings, ...guest.settings, goal: guest.settings.goal ?? account.settings.goal };
  }
  for (const [key, guestValue] of Object.entries(guest.progress)) {
    const accountValue = account.progress[key];
    const latest = !accountValue || guestValue.lastAnswered > accountValue.lastAnswered ? guestValue : accountValue;
    state.progress[key] = effectiveProgress({
      ...latest,
      correct: (accountValue?.correct ?? 0) + guestValue.correct,
      incorrect: (accountValue?.incorrect ?? 0) + guestValue.incorrect,
    }, now);
  }
  for (const [key, value] of Object.entries(guest.days)) state.days[key] = (account.days[key] ?? 0) + value;
  if (!inProgress(account.session) && inProgress(guest.session)) state.session = guest.session;
  return state;
}

const validMethod = id => METHODS.some(m => m.id === id);

// One transition for both guest and account storage. A stale lesson step is a no-op.
export function transition(state, action) {
  const { now } = action;
  switch (action.type) {
    case 'settings': {
      const settings = { ...state.settings, ...action.settings, updatedAt: Math.max(now, state.settings.updatedAt) };
      if (!validMethod(settings.method) || (settings.goal !== null &&
          (!Number.isInteger(settings.goal) || settings.goal < 1 || settings.goal > MAX_GOAL))) return state;
      return { ...state, settings };
    }
    case 'tag': {
      const tags = { ...state.tags };
      if (action.value) tags[action.wordId] = true;
      else delete tags[action.wordId];
      return { ...state, tags };
    }
    case 'start': {
      if (state.session?.id !== action.previousId) return state;
      const s = action.session;
      if (!validMethod(s.method) || !['normal', 'difficult', 'recommended'].includes(s.mode) ||
          (s.category && !CATEGORIES.some(c => c.id === s.category)) || !s.ids.length ||
          new Set(s.ids).size !== s.ids.length) return state;
      return {
        ...state, session: s,
        settings: s.method === state.settings.method ? state.settings
          : { ...state.settings, method: s.method, updatedAt: Math.max(now, state.settings.updatedAt) },
      };
    }
    case 'discard':
      return state.session?.id === action.sessionId ? { ...state, session: null } : state;
    case 'answer': {
      const s = state.session;
      const wordId = currentWordId(s);
      if (!wordId || s.id !== action.sessionId || s.cursor !== action.index ||
          wordId !== action.wordId || typeof action.correct !== 'boolean') return state;
      const key = progressKey(action.wordId);
      const day = studyDay(now);
      const previous = effectiveProgress(state.progress[key], now);
      const next = answerProgress(previous, action.correct, now);
      const last = {
        wordId: action.wordId, index: action.index, operationId: action.id,
        correct: action.correct, input: action.input ?? null, gaveUp: Boolean(action.gaveUp),
        beforeBar: previous.bar, afterBar: next.bar,
      };
      const cursor = s.cursor + 1;
      const wrongIds = !action.correct && !s.wrongIds.includes(wordId) ? [...s.wrongIds, wordId] : s.wrongIds;
      // Keep the original order fixed and the cursor increasing across retries.
      let retryIds = s.retryIds;
      if (s.cursor >= s.ids.length) {
        retryIds = retryIds.slice(1);
        if (!action.correct) retryIds.push(wordId);
      } else if (cursor === s.ids.length) {
        retryIds = wrongIds;
      }
      return {
        ...state,
        progress: { ...state.progress, [key]: next },
        days: action.correct ? { ...state.days, [day]: (state.days[day] ?? 0) + 1 } : state.days,
        session: { ...s, last, cursor, correct: s.correct + Number(action.correct), wrongIds, retryIds },
      };
    }
    case 'expire': {
      let changed = null;
      for (const [key, p] of Object.entries(state.progress)) {
        const value = effectiveProgress(p, now);
        if (value !== p) {
          changed ??= { ...state.progress };
          changed[key] = value;
        }
      }
      return changed ? { ...state, progress: changed } : state;
    }
    case 'import':
      return mergeGuest(state, action.guest.state, now);
    default:
      throw new Error('学習操作を認識できませんでした。');
  }
}
