import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { spellingMatches } from '../src/grading.mjs';
import { CATEGORIES, MAX_GOAL } from '../src/rules.mjs';

const sourceArchive = 'data/source/lexical_words_short_reviewed_v3_1.json.gz';
const sourceHashFile = 'data/source/original.sha256';
export const releaseArchive = 'data/release/site-data.json.gz';
const expectedSourceHash = async () => (await readFile(sourceHashFile, 'utf8')).trim();

const counts = { NGSL: 2809, TSL: 1250, SUPPLEMENTARY: 52 };
const rows = {};
const senseSensitive = new Set(('read close lead wind minute present record refuse object conduct permit project ' +
  'produce suspect content tear bow bass live use house row invalid increase decrease resume does ' +
  'desert address console progress conflict contract contrast contest converse digest estimate graduate ' +
  'separate associate delegate appropriate coordinate advocate elaborate deliberate').split(' '));

async function phoneticDictionary() {
  const window = {};
  const engine = { window };
  runInNewContext(await readFile('vendor/phonetic/pronunciations.js', 'utf8'), engine);
  const code = await readFile('vendor/phonetic/dictionary.js', 'utf8');
  const field = 'Object.freeze({ lookup, size: window.PhoneticCMU.size })';
  if (!code.includes(field)) throw new Error('Phoneticの辞書APIが変更されました。');
  // Expose all exact CMU readings without relying on Phonetic's representative variant.
  const adapter = `Object.freeze({ lookup, size: window.PhoneticCMU.size,
    variants(raw) { return (entriesFor(headword(normalize(raw))) || []).map(transcribe); }
  })`;
  runInNewContext(code.replace(field, adapter), engine);
  return window.PhoneticDictionary;
}

function pronunciation(word, dictionary) {
  const original = word.pronunciations.filter(p => p.ipa && p.dialect === 'en-US');
  if (original.length) {
    return { status: 'original', candidates: original.map(p => ({ ipa: p.ipa, senseIds: p.sense_ids, sourceIds: p.source_ids })) };
  }
  const ipa = word.lemma.split(/\s+/u).map(term => dictionary.lookup(term));
  const exact = [...new Set(dictionary.variants(word.lemma))].filter(Boolean);
  const candidates = exact.length ? exact : ipa.every(Boolean) ? [ipa.join(' ')] : [];
  let status = 'dictionary_candidate';
  if (!candidates.length || candidates.some(s => s.includes('undefined'))) return { status: 'missing', candidates: [] };
  if (candidates.length > 1) status = 'multiple_candidates';
  else if (!exact.length || /[^\x00-\x7F]/u.test(word.lemma) || senseSensitive.has(word.lemma.toLowerCase())) status = 'needs_sense_review';
  return { status, candidates: candidates.map(ipa => ({ ipa })) };
}

export async function readOriginal({ requireStoredSource = false } = {}) {
  const override = requireStoredSource ? '' : process.env.LEXICAL_WORDS_ORIGINAL?.trim();
  const archive = override || sourceArchive;
  let file;
  try {
    file = await readFile(archive);
  } catch (error) {
    if (error.code !== 'ENOENT' || override) throw error;
    if (requireStoredSource) throw new Error('公開用データを更新するには、data/source に保存した単語原本が必要です。');
    return null;
  }
  const bytes = archive.endsWith('.gz') ? gunzipSync(file) : file;
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (!override && hash !== await expectedSourceHash()) throw new Error('原本のハッシュが一致しません。');
  return { source: JSON.parse(bytes), sourceSha256: hash, sourceBytes: bytes.length };
}

export async function readRelease() {
  const { catalog, attribution, 'build-summary': summary } = JSON.parse(gunzipSync(await readFile(releaseArchive)));
  if (!catalog || !attribution || summary?.sourceSha256 !== await expectedSourceHash()) {
    throw new Error('公開用データと原本のハッシュが一致しません。原本があるPCで pnpm data:release を実行してください。');
  }
  return { catalog, attribution, 'build-summary': summary };
}

export async function buildData({ source, sourceSha256, sourceBytes }) {
  if (source.words.length !== MAX_GOAL || source.format_version !== '1.3.1') throw new Error('原本 v3.1 の単語数・バージョンを確認してください。');
  const grading = source.grading_policy;
  if (grading.identity !== 'grade_against_active_word_id_only' || !grading.accepted_case_difference || !grading.accent_omission.enabled) {
    throw new Error('原本の採点方針と現在の採点処理が一致しません。');
  }
  const dictionary = await phoneticDictionary();
  for (const { id } of CATEGORIES) {
    const list = source.words.flatMap(word => word.memberships.filter(m => m.category === id).map(m => ({ word, m })));
    if (list.length !== counts[id]) throw new Error('カテゴリ件数が原本と一致しません: ' + id);
    if (id === 'SUPPLEMENTARY') continue;
    list.sort((a, b) => a.m.rank - b.m.rank || a.m.display_order - b.m.display_order);
    if (list.some((x) => !Number.isInteger(x.m.rank) || x.m.rank < 1)) throw new Error('頻度順位が未入力: ' + id);
    rows[id] = new Map(list.map(({ word }, i) => [word.id, 5 - Math.floor(i * 5 / list.length)]));
  }
  const referenceIds = new Set();
  const references = {};
  const seenWords = new Set(), seenSenses = new Set();
  const words = source.words.map((word, i) => {
    const q = word.typing_question;
    if (!q.active_for_delivery || !q.usable || q.word_id !== word.id || q.answer.canonical !== word.lemma ||
        word.answer_policy.canonical !== word.lemma || !word.typing_usable || seenWords.has(word.id)) {
      throw new Error('現行の出題情報が一致しません: ' + word.lemma);
    }
    seenWords.add(word.id);
    for (const sense of word.senses) {
      if (seenSenses.has(sense.id)) throw new Error('語義IDが重複: ' + sense.id);
      seenSenses.add(sense.id);
    }
    const originalSenses = new Map(word.senses.map(s => [s.id, s]));
    const senses = [...q.display_senses].sort((a, b) => a.display_order - b.display_order).map(s => {
      const sense = originalSenses.get(s.sense_id);
      if (!sense?.learning_usable || !s.japanese) throw new Error('表示語義を確認できません: ' + word.lemma);
      return { id: s.sense_id, displayId: s.display_item_id, order: s.display_order, pos: s.part_of_speech,
        label: s.part_of_speech_ja, japanese: s.japanese, supplement: s.supplement_ja };
    });
    if (!senses.length || new Set(senses.map(s => s.displayId)).size !== senses.length) throw new Error('表示語義の重複・欠損: ' + word.lemma);
    const displayMap = new Map(senses.map(s => [s.displayId, s.id]));
    const alts = q.unused_expressions.items.map(a => {
      if (a.registered_as_correct_answer || spellingMatches(a.expression, word.lemma, word.answer_policy) ||
          !a.applies_to.length || a.applies_to.some(s => displayMap.get(s.display_item_id) !== s.sense_id)) {
        throw new Error('別解の対応が不正: ' + word.lemma + '/' + a.expression);
      }
      return { text: a.expression, scopes: a.applies_to.map(s =>
        ({ displayId: s.display_item_id, senseId: s.sense_id, japanese: s.japanese_scope_ja })) };
    });
    if (alts.length > 3 || alts.length !== new Set(alts.map(x => x.text.toLowerCase())).size) throw new Error('別解の重複・超過: ' + word.lemma);
    const useSource = ids => [...new Set(ids)].filter(Boolean).map(id => {
      if (!source.source_registry[id]) throw new Error('出典を解決できません: ' + id);
      referenceIds.add(id);
      return id;
    });
    references[word.id] = {
      memberships: word.memberships.map(m => ({ ...m, sourceIds: useSource([m.source_id]) })),
      senses: q.display_senses.map(s => {
        const sense = originalSenses.get(s.sense_id);
        return {
          id: s.sense_id, japanese: s.japanese, displayOrigin: s.translation_origin, origin: sense.translation_origin,
          aiTags: sense.ai_tags, sourceIds: useSource([...s.verification.source_ids, ...sense.part_of_speech_source_ids,
            ...sense.evidence.map(e => e.source_id), ...sense.english_definition.original_definitions.map(e => e.source_id)]),
        };
      }),
    };
    const { case_insensitive, accent_omission_allowed, typographic_equivalents, punctuation_aliases } = word.answer_policy;
    return {
      id: word.id, lemma: word.lemma, order: i + 1, questionId: q.id,
      memberships: word.memberships.map(m => ({ category: m.category, rank: m.rank, stars: rows[m.category]?.get(word.id) ?? null })),
      senses, alts, answerPolicy: { case_insensitive, accent_omission_allowed, typographic_equivalents, punctuation_aliases },
      pronunciation: pronunciation(word, dictionary),
    };
  });
  const registry = {};
  for (const id of referenceIds) {
    const s = source.source_registry[id];
    const { title, name, filename, url, revision_url, history_url, authors, license_id } = s;
    registry[id] = { title: s.kind === 'user_instruction' ? '制作側による指定' : title ?? name ?? filename ?? id,
      authors, url, revision_url, history_url, license_id };
  }
  const catalog = { version: source.format_version, categories: counts, words };
  const notices = {
    ...source.attribution,
    redistribution_ja: 'Wiktionary・NGSL・TSLに由来する学習データの翻案部分はCC BY-SA 4.0で提供します。各項目の出典・改変区分と、WordNetなど個別のライセンス情報を付記しています。',
  };
  const attribution = { notices, licenses: source.licenses, registry, words: references };
  const ipaCounts = {};
  for (const w of words) ipaCounts[w.pronunciation.status] = (ipaCounts[w.pronunciation.status] ?? 0) + 1;
  const summary = { sourceSha256, sourceBytes, wordCount: words.length,
    gradingPolicyVersion: grading.version, gradingOverride: 'ignore_only_outer_whitespace',
    categoryCounts: counts, ipaCounts, catalogBytes: Buffer.byteLength(JSON.stringify(catalog)) };
  return { catalog, attribution, 'build-summary': summary };
}
