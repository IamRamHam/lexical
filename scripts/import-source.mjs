import { access, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const [original, reference] = process.argv.slice(2);
if (!original) throw new Error('Usage: node scripts/import-source.mjs <original.json> [Phonetic directory]');
const phonetic = reference ||
  (await access(resolve('../phonetic/assets/phonetic-logo.png')).then(() => true, () => false) ? '../phonetic' : '..');
const bytes = await readFile(resolve(original));
const source = JSON.parse(bytes);
if (source.words?.length !== 4111 || source.format_version !== '1.3.1') throw new Error('Lexical原本 v3.1 が必要です。');
await mkdir('data/source', { recursive: true });
await writeFile('data/source/lexical_words_short_reviewed_v3_1.json.gz', gzipSync(bytes, { level: 9 }));
await writeFile('data/source/original.sha256', createHash('sha256').update(bytes).digest('hex') + '\n');
await mkdir('vendor/phonetic', { recursive: true });
for (const name of ['pronunciations.js', 'dictionary.js', 'fallback-speech.js', 'english-voice.js',
  'CMUdict-LICENSE.txt', 'english-voice-LICENSE.txt', 'audio-source.txt']) {
  await copyFile(resolve(phonetic, 'assets', name), 'vendor/phonetic/' + name);
}
console.log('原本の圧縮保存とPhonetic素材のコピーを完了しました。');
