import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { grade } from '../src/grading.mjs';

const catalog = JSON.parse(await readFile('dist/data/catalog.json', 'utf8'));
const words = new Map(catalog.words.map(w => [w.lemma, w]));

test('all 4,111 canonical answers retain their own IDs, and displayed alternatives remain incorrect', () => {
  assert.equal(words.size, 4111);
  for (const w of words.values()) {
    for (const version of [w.lemma, w.lemma.toUpperCase(), w.lemma.normalize('NFD'), ...w.answerPolicy.punctuation_aliases]) {
      const result = grade(w, '  ' + version + '　');
      assert.equal(result.accepted, true, w.lemma + '/' + version);
      assert.equal(result.wordId, w.id);
      assert.equal(result.canonical, w.lemma);
    }
    for (const a of w.alts) assert.equal(grade(w, a.text).accepted, false, w.lemma + '/' + a.text);
  }
});

test('approved changes highlight the original and the typed differences', () => {
  for (const [canonical, input] of [['email', 'E‑Mail'], ['e-book', 'ebook'], ['résumé', 'resume'], ['café', 'Cafe'], ['café', 'cafe\u0301'], ["ma'am", 'ma’am']]) {
    const result = grade(words.get(canonical), input);
    assert(result.accepted, canonical + '/' + input);
    assert.equal(result.differences.map(p => p.canonical).join(''), canonical);
    assert.equal(result.differences.map(p => p.input).join(''), input);
    assert(result.differences.some(p => p.changed));
  }
  assert(grade(words.get('e-book'), 'ebook').differences.some(p => p.input === '' && p.canonical === '-'));
});

test('no arbitrary punctuation, alternate accents, internal spaces, case collisions or synonym answers', () => {
  for (const [lemma, input] of [["ma'am", 'maam'], ['help', 'assist'], ['café', 'cafè'], ['resume', 'résumé'],
    ['ice cream', 'icecream'], ['ice cream', 'ice  cream'], ['help', 'helps'], ['neighbor', 'neighbour'],
    ['email', 'e--mail'], ['e-book', 'e book']]) {
    assert.equal(grade(words.get(lemma), input).accepted, false, lemma + '/' + input);
  }
  assert(grade(words.get('help'), ' 　　 ').empty);
  for (const [a, b] of [['May', 'may'], ['March', 'march'], ['résumé', 'resume']]) {
    assert.notEqual(grade(words.get(a), b).wordId, grade(words.get(b), b).wordId);
  }
});
