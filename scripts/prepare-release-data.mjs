import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { buildData, readOriginal, releaseArchive } from './data.mjs';

const data = await buildData(await readOriginal({ requireStoredSource: true }));
const bytes = gzipSync(JSON.stringify(data), { level: 9 });
await mkdir(dirname(releaseArchive), { recursive: true });
const candidate = releaseArchive + '.' + randomUUID() + '.tmp';
try {
  await writeFile(candidate, bytes, { flag: 'wx' });
  await rename(candidate, releaseArchive);
} finally {
  await rm(candidate, { force: true });
}
console.log('公開用データを更新しました。', releaseArchive, data.catalog.words.length + '語');
