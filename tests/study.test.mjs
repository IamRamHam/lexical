import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, REVIEW } from '../src/rules.mjs';
import { answerProgress, currentWordId, effectiveProgress, emptyState, inProgress, makeSession, mergeGuest, progressKey, recall,
  recommendation, remainingToday, studyDay, totals, transition } from '../src/study.mjs';
import { statePatch } from '../src/storage.mjs';

const now = Date.parse('2026-11-24T10:00:00+09:00');
const words = Array.from({ length: 60 }, (_, i) => ({ id: 'lex_' + i.toString(16).padStart(32, '0'), order: i + 1,
  memberships: [{ category: i < 55 ? 'NGSL' : 'TSL', stars: i < 27 ? 5 : 3 }] }));
const options = (method = 'en-ja', order = 'registered') => ({ method, mode: 'normal', order, category: 'NGSL', start: 1, end: 50 });
const settings = (state, goal) => transition(state, { type: 'settings', settings: { goal }, now });
function start(state, id, spec = options()) {
  const session = makeSession(words, state, spec, now, id, () => 0.314);
  return transition(state, { type: 'start', session, previousId: state.session?.id, now });
}
function answer(state, correct, timestamp = now) {
  const { id, cursor } = state.session;
  return { type: 'answer', sessionId: id, wordId: currentWordId(state.session), index: cursor, id: id + ':' + cursor, correct, now: timestamp };
}

test('JST 04:59:59.999 and 05:00:00.000 belong to different study days', () => {
  assert.equal(studyDay(Date.parse('2026-11-24T04:59:59.999+09:00')), '2026-11-23');
  assert.equal(studyDay(Date.parse('2026-11-24T05:00:00.000+09:00')), '2026-11-24');
});

test('two 50-word lessons count 100, retries count once, and methods remain separate', () => {
  let state = settings(emptyState(), 50);
  for (const id of ['first', 'second']) {
    state = start(state, id);
    assert.equal(new Set(state.session.ids).size, 50);
    for (let n = 0; n < 50; n++) {
      const event = answer(state, true);
      const saved = transition(state, event);
      assert.equal(transition(saved, event), saved);
      state = saved;
    }
  }
  assert.deepEqual(totals(state, 'en-ja', now), { mastered: 0, count: 100, today: 100, level: 2 });
  const first = words[0].id;
  for (const method of ['ja-en', 'typing']) {
    state = start(state, method, options(method));
    state = transition(state, answer(state, false));
  }
  assert.equal(state.progress[progressKey(first, 'en-ja')].correct, 2);
  assert.equal(state.progress[progressKey(first, 'ja-en')].incorrect, 1);
  assert.equal(state.progress[progressKey(first, 'typing')].incorrect, 1);
  assert.equal(totals(state, 'typing', now).today, 100);
});


test('misses wait for the first pass, requeue in order and never add to study totals', () => {
  const boundary = Date.parse('2026-11-24T05:00:00.000+09:00');
  let state = start(settings(emptyState(), 3), 'repeat', { ...options('typing'), end: 3 });
  const original = state.session.ids;
  const [first, second, third] = original;
  const send = (correct, timestamp) => {
    const previous = state;
    const operation = answer(state, correct, timestamp);
    state = transition(state, operation);
    assert.equal(transition(state, operation), state);
    return statePatch(previous, state);
  };
  send(false, boundary - 2);
  assert.equal(currentWordId(state.session), second);
  send(false, boundary - 1);
  assert.deepEqual(state.days, {});
  assert.equal(currentWordId(state.session), third);
  assert.equal(remainingToday(state, boundary), 3);
  const initialPatch = send(true, boundary);
  assert.deepEqual(initialPatch.session_step.retryIds, [first, second]);
  assert.equal(remainingToday(state, boundary), 2);

  state = JSON.parse(JSON.stringify(state));
  assert.equal(currentWordId(state.session), first);
  const retryPatch = send(false, boundary + 1);
  assert.deepEqual(retryPatch.session.retryIds, [second, first]);
  assert.equal(retryPatch.days, undefined);
  assert.equal(currentWordId(state.session), second);
  send(true, boundary + 2);
  assert.equal(currentWordId(state.session), first);
  assert(inProgress(state.session));
  send(true, boundary + 3);
  assert.equal(inProgress(state.session), false);
  assert.deepEqual(state.session.ids, original);
  assert.deepEqual(state.session.wrongIds, [first, second]);
  assert.equal(state.session.cursor, 6);
  assert.equal(state.session.correct, 3);
  assert.equal(state.progress[progressKey(first, 'typing')].incorrect, 2);
  assert.equal(state.progress[progressKey(first, 'typing')].correct, 1);
  assert.deepEqual(state.days, { '2026-11-24': 3 });
  assert.equal(totals(state, 'typing', boundary).count, 3);
});

test('an older active session picks up its recorded misses and older results stay complete', () => {
  const state = start(settings(emptyState(), 5), 'legacy', { ...options(), end: 2 });
  const [missed, remaining] = state.session.ids;
  delete state.session.retryIds;
  state.session.cursor = 1;
  state.session.wrongIds = [missed];
  state.days = { '2026-11-24': 1 };
  const completed = { ...state.session, cursor: 2, correct: 1 };
  assert.equal(inProgress(completed), false);
  assert.equal(currentWordId(state.session), remaining);
  const next = transition(state, answer(state, true));
  assert.deepEqual(next.session.retryIds, [missed]);
  assert.equal(currentWordId(next.session), missed);
  assert.equal(next.days[studyDay(now)], 2);
});

test('bar transitions, sign changes, first reach and mastered miss protection', () => {
  let p;
  for (const [i, bar] of [8, 18, 28, 38, 53, 68, 83, 98, 100, 100].entries()) {
    p = answerProgress(p, true, now + i);
    assert.equal(p.bar, bar);
    assert.equal(p.streak, i + 1);
    assert.equal(p.mastered, i === 9);
  }
  p = answerProgress(p, false, now + 20);
  assert.equal(p.bar, 100);
  assert.equal(p.mastered, false);
  assert.equal(p.streak, -1);
  p = answerProgress(p, false, now + 21);
  assert.equal(p.bar, 90);
  assert.equal(p.streak, -2);
  p = answerProgress(p, true, now + 22);
  assert.equal(p.bar, 98);
  assert.equal(p.streak, 1);
});

test('30 days expires mastery and streak only, before scoring a new answer', () => {
  const p = { bar: 100, mastered: true, streak: 10, correct: 10, incorrect: 1,
    lastAnswered: now, halfLife: 50_000, due: now + 80_000 };
  const limit = now + 30 * DAY;
  assert.equal(effectiveProgress(p, limit - 1), p);
  const expired = effectiveProgress(p, limit);
  assert.deepEqual(expired, { ...p, mastered: false, streak: 0 });
  assert.equal(effectiveProgress(expired, limit + DAY), expired);
  const correct = answerProgress(p, true, limit);
  assert.equal(correct.mastered, true);
  assert.equal(correct.streak, 1);
  assert.equal(answerProgress(p, false, limit).bar, 95);
  const key = progressKey(words[0].id, 'en-ja');
  const state = { ...emptyState(), days: { '2026-11-24': 11 }, progress: { [key]: p } };
  const next = transition(state, { type: 'expire', now: limit });
  assert.equal(next.days, state.days);
  assert.equal(totals(state, 'en-ja', limit).mastered, 0);
  assert.equal(totals(next, 'en-ja', limit).count, 11);
});

test('recommendation orders due by bar/date/registration, then unseen, then optional early', () => {
  const state = settings(emptyState(), 50);
  state.days[studyDay(now)] = 20;
  assert.equal(remainingToday(state, now), 30);
  const p = (bar, due) => ({ lastAnswered: now - DAY, due: now + due, mastered: false, bar });
  const [a, b, c, d, e, f, g] = words;
  for (const [word, value] of [[a, p(30, -500)], [b, p(20, -200)], [c, p(20, -200)], [d, p(20, -600)], [f, p(0, 600)], [g, p(95, 100)]]) {
    state.progress[progressKey(word.id, 'typing')] = value;
  }
  assert.deepEqual(recommendation(words.slice(0, 7), state, 'typing', now), [d, b, c, a, e]);
  assert.deepEqual(recommendation(words.slice(0, 7), state, 'typing', now, true), [d, b, c, a, e, g, f]);
  assert.deepEqual(recommendation(words.slice(0, 7), state, 'en-ja', now), [a, b, c, d, e, f, g]);
  state.days[studyDay(now)] = 55;
  assert.equal(remainingToday(state, now), 0);
  assert.equal(start(state, 'normal-over-goal').session.ids.length, 50);
});

test('random resume preserves the fixed order, and difficult mode only uses tagged words', () => {
  let state = start(settings(emptyState(), 20), 'shuffled', options('typing', 'random'));
  const ids = state.session.ids;
  assert.notDeepEqual(ids, words.slice(0, 50).map(w => w.id));
  const action = answer(state, true);
  state = transition(state, action);
  const resumed = JSON.parse(JSON.stringify(state));
  assert.deepEqual(resumed.session.ids, ids);
  assert.equal(resumed.session.cursor, 1);
  assert.equal(transition(resumed, action), resumed);
  resumed.tags = { [words[2].id]: true, [words[5].id]: true };
  const s = makeSession(words, resumed, {
    method: 'ja-en', mode: 'difficult', order: 'registered', category: 'NGSL', count: 10,
  }, now, 'difficult');
  assert.deepEqual(s.ids, [words[2].id, words[5].id]);
  const shuffled = makeSession(words, resumed, {
    method: 'ja-en', mode: 'difficult', order: 'random', category: 'NGSL', count: 10,
  }, now, 'difficult-random', () => 0);
  assert.deepEqual(shuffled.ids, [words[5].id, words[2].id]);
  const lost = transition(resumed, { type: 'discard', sessionId: 'shuffled' });
  assert.equal(lost.session, null);
  assert.equal(lost.days[studyDay(now)], 1);
});

test('review curve has bounded intervals, ordinary short repeat after miss, and long inactivity decays recall', () => {
  const p = answerProgress(undefined, true, now);
  assert.equal(p.halfLife, REVIEW.firstCorrectHalfLife);
  assert.equal(recall(p, now + p.halfLife * 1000), 0.5);
  assert.equal(recall(undefined, now), null);
  const experienced = { ...p, correct: 10 ** 9, incorrect: 10 ** 9, streak: -99 };
  const missed = answerProgress(experienced, false, now);
  assert.equal(missed.halfLife, REVIEW.minHalfLife);
  assert(missed.due - now >= REVIEW.minInterval * 1000);
  assert(missed.due - now < 20 * 60_000);
  assert(recall(p, now + 300 * DAY) < 1e-50);
});

test('guest merge sums counts and preserves the most recent method state, with union of tags', () => {
  const key = progressKey(words[0].id, 'en-ja');
  const account = transition(start(settings(emptyState(), 25), 'cloud'), {
    type: 'answer', sessionId: 'cloud', wordId: words[0].id, index: 0, correct: true, now, id: 'a',
  });
  const guest = transition(start(settings(emptyState(), 60), 'local'), {
    type: 'answer', sessionId: 'local', wordId: words[0].id, index: 0, correct: false, now: now + 1000, id: 'b',
  });
  account.tags[words[1].id] = true;
  guest.tags[words[2].id] = true;
  const merged = mergeGuest(account, guest, now + 10_000);
  assert.deepEqual(merged.progress[key], { ...guest.progress[key], correct: 1, incorrect: 1 });
  assert.equal(merged.days[studyDay(now)], 1);
  assert.deepEqual(merged.tags, { ...account.tags, ...guest.tags });
  assert.equal(merged.session.id, 'cloud');
  assert.equal(statePatch(account, merged).progress[0].state.due, guest.progress[key].due);
});
