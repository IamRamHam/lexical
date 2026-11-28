import { access, cp, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import { buildData, readOriginal, readRelease } from './data.mjs';

const env = process.env;
const supabaseUrl = env.LEXICAL_SUPABASE_URL?.trim() || '';
const supabaseKey = env.LEXICAL_SUPABASE_PUBLISHABLE_KEY?.trim() || '';
function validatePublicKey(key) {
  if (key.startsWith('sb_publishable_')) return;
  let role;
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* Invalid key. */ }
  if (role !== 'anon') throw new Error('公開用のpublishableキーまたはanonキーだけを指定してください。');
}
if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) throw new Error('Supabase URLと公開用キーを両方設定してください。');
if (supabaseUrl) {
  const url = new URL(supabaseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('SupabaseにはHTTPSのURLを使ってください。');
  }
  validatePublicKey(supabaseKey);
}
let phoneticUrl = env.LEXICAL_PHONETIC_URL?.trim() || '';
if (phoneticUrl && !['https:', 'http:'].includes(new URL(phoneticUrl).protocol)) throw new Error('Phonetic URLを確認してください。');
const phoneticLocation = env.LEXICAL_PHONETIC_DIR ||
  (await access(resolve('../phonetic/assets/phonetic-logo.png')).then(() => true, () => false) ? '../phonetic' : '..');
const phonetic = resolve(phoneticLocation);
const root = await realpath('.');
const output = resolve(root, 'dist');
const exists = path => access(path).then(() => true, () => false);
async function checkBuildDirectory(path) {
  if (dirname(path) !== root || await realpath(path) !== path || !(await lstat(path)).isDirectory()) {
    throw new Error('Lexicalの生成フォルダーの場所を確認できません。');
  }
}
if (await exists(output)) {
  await checkBuildDirectory(output);
  if (!await exists(resolve(output, 'data/build-summary.json'))) throw new Error('distに既存のファイルがあります。生成先を確認してください。');
}
const stage = await mkdtemp(resolve(root, '.dist-build-'));
try {
  await cp('public', stage, { recursive: true });
  await cp('vendor/phonetic', resolve(stage, 'vendor/phonetic'), { recursive: true, filter: name =>
    !/[\\/](pronunciations\.js|dictionary\.js)$/.test(name) });
  if (!phoneticUrl) {
    if (await exists(resolve(phonetic, 'assets/phonetic-logo.png'))) {
      await mkdir(resolve(stage, 'phonetic'), { recursive: true });
      for (const path of ['index.html', 'style.css', 'assets']) {
        await cp(resolve(phonetic, path), resolve(stage, 'phonetic', path), { recursive: true });
      }
      phoneticUrl = './phonetic/';
    }
  }
  const original = await readOriginal();
  const data = original ? await buildData(original) : await readRelease();
  const dataDir = resolve(stage, 'data');
  await mkdir(dataDir);
  for (const [name, payload] of Object.entries(data)) {
    await writeFile(resolve(dataDir, name + '.json'), JSON.stringify(payload));
  }
  await writeFile(resolve(stage, 'config.json'), JSON.stringify({ supabaseUrl, supabaseKey, phoneticUrl }));
  await build({
    entryPoints: { app: 'src/main.mjs' }, outdir: resolve(stage, 'js'), bundle: true, minify: true,
    splitting: true, format: 'esm', target: ['es2022', 'safari16.4'], legalComments: 'linked',
  });
  await writeFile(resolve(stage, '.nojekyll'), '');
  await checkBuildDirectory(stage);
  if (await exists(output)) {
    await checkBuildDirectory(output);
    await rm(output, { recursive: true });
  }
  await rename(stage, output);
  console.log('Lexical build', JSON.stringify(data['build-summary']));
} finally {
  if (await exists(stage)) {
    await checkBuildDirectory(stage);
    await rm(stage, { recursive: true });
  }
}
