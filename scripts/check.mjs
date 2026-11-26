import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { grade, spellingMatches } from '../src/grading.mjs';
import { readOriginal, readRelease } from './data.mjs';

for (const directory of ['src', 'scripts', 'tests']) {
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.mjs')) continue;
    const checked = spawnSync(process.execPath, ['--check', directory + '/' + name], { stdio: 'inherit' });
    assert.equal(checked.status, 0, directory + '/' + name);
  }
}
const files = {};
for (const name of ['catalog', 'attribution', 'build-summary']) {
  files[name] = await readFile('dist/data/' + name + '.json', 'utf8');
}
const { words, categories } = JSON.parse(files.catalog);
const attribution = JSON.parse(files.attribution);
const summary = JSON.parse(files['build-summary']);
const original = await readOriginal();
if (original) assert.equal(summary.sourceSha256, original.sourceSha256);
if (!original || !process.env.LEXICAL_WORDS_ORIGINAL?.trim()) {
  const release = await readRelease();
  for (const [name, data] of Object.entries(release)) {
    assert(files[name] === JSON.stringify(data),
      name + 'が公開用データと一致しません。原本があるPCで pnpm data:release を実行してください。');
  }
}

assert.deepEqual(categories, { NGSL: 2809, TSL: 1250, SUPPLEMENTARY: 52 });
assert.equal(words.length, 4111);
assert.equal(summary.wordCount, words.length);
assert.deepEqual(summary.categoryCounts, categories);
assert.equal(summary.catalogBytes, Buffer.byteLength(files.catalog));
assert.equal(new Set(words.map(w => w.id)).size, words.length);
assert(summary.catalogBytes < summary.sourceBytes / 15);
const senseIds = new Set();
const licenseIds = new Set(attribution.licenses.map(license => license.id));
for (const reference of Object.values(attribution.registry)) {
  if (reference.license_id) assert(licenseIds.has(reference.license_id));
  for (const url of [reference.url, reference.revision_url, reference.history_url]) {
    if (url) assert(['https:', 'http:'].includes(new URL(url).protocol));
  }
}
for (const [index, w] of words.entries()) {
  assert.match(w.id, /^lex_[0-9a-f]{32}$/);
  assert.equal(w.order, index + 1);
  const references = attribution.words[w.id];
  assert(references, w.lemma);
  assert(w.senses.length > 0 && w.alts.length <= 3);
  assert(w.senses.every((s, i) => s.order === i + 1 && s.label && s.japanese));
  for (const s of w.senses) {
    assert(!senseIds.has(s.id), s.id);
    senseIds.add(s.id);
  }
  const displayItems = new Map(w.senses.map(s => [s.displayId, s.id]));
  assert.equal(displayItems.size, w.senses.length);
  assert.deepEqual(new Set(references.senses.map(s => s.id)), new Set(displayItems.values()));
  for (const row of [...references.memberships, ...references.senses]) {
    assert(row.sourceIds.every(id => Object.hasOwn(attribution.registry, id)), w.lemma);
  }
  for (const alt of w.alts) {
    assert(alt.scopes.length && alt.scopes.every(s => displayItems.get(s.displayId) === s.senseId));
    assert(!spellingMatches(alt.text, w.lemma, w.answerPolicy), w.lemma);
  }
  const input = original?.source.words[index];
  if (input) {
    assert.equal(w.id, input.id);
    assert.equal(w.lemma, input.lemma);
    assert.equal(w.questionId, input.typing_question.id);
    assert.deepEqual(w.senses.map(s => [s.id, s.pos, s.japanese, s.supplement]),
      input.typing_question.display_senses.map(s => [s.sense_id, s.part_of_speech, s.japanese, s.supplement_ja]));
    assert.deepEqual(w.alts.map(a => a.text), input.typing_question.unused_expressions.items.map(a => a.expression));
    assert.deepEqual(w.answerPolicy.punctuation_aliases, input.answer_policy.punctuation_aliases);
  }
  if (w.memberships.some(m => m.category === 'SUPPLEMENTARY')) {
    assert.equal(w.memberships.find(m => m.category === 'SUPPLEMENTARY').stars, null);
  }
}
if (original) {
  const byId = new Map(words.map(w => [w.id, w]));
  for (const example of original.source.grading_policy.examples) {
    const input = example.input_original;
    const word = byId.get(example.active_word_id);
    const expected = input === input.trim() ? example.accepted : grade(word, input.trim()).accepted;
    assert.equal(grade(word, input).accepted, expected, input);
  }
}
for (const [category, size] of Object.entries(categories)) {
  const members = words.flatMap(w => w.memberships.filter(m => m.category === category)).sort((a,b) => a.rank - b.rank);
  assert.equal(members.length, size);
  if (category === 'SUPPLEMENTARY') continue;
  const bands = [0, 0, 0, 0, 0];
  members.forEach((m, i) => {
    assert.equal(m.stars, 5 - Math.floor(i * 5 / members.length));
    bands[m.stars - 1]++;
  });
  assert(Math.max(...bands) - Math.min(...bands) <= 1);
}
assert.equal(words.find(w => w.lemma === 'damn').senses.length, 3);
assert(words.find(w => w.lemma === 'permit').alts.find(a => a.text === 'license').scopes.length === 2);
console.log('静的検査と4,111語の' + (original ? '原本照合' : '公開用データ検査') + 'に合格しました。');
