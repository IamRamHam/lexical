import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.txt', 'text/plain; charset=utf-8'],
  ['.png', 'image/png'], ['.webp', 'image/webp'], ['.wav', 'audio/wav'],
]);

export async function loadPreview() {
  try {
    const root = await realpath(fileURLToPath(new URL('../dist/', import.meta.url)));
    const files = new Map();
    const hash = createHash('sha256');
    for (const name of ['index.html', 'config.json', 'data/build-summary.json']) {
      const bytes = await readFile(resolve(root, name));
      files.set(name, bytes);
      hash.update(name).update(bytes);
    }
    await Promise.all(['data/catalog.json', 'js/app.js'].map(name => access(resolve(root, name))));
    return { root, files, build: hash.digest('hex') };
  } catch {
    throw new Error('同梱の dist フォルダーに必要なファイルがありません。配布時の dist を Lexical フォルダーに戻してください。');
  }
}

async function serveFile(root, req, res) {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + requested);
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(404).end(); return; }
    if ((await stat(path)).isDirectory() && !requested.endsWith('/')) {
      res.writeHead(302, { Location: encodeURI(requested) + '/' }).end();
      return;
    }
    const file = await realpath((await stat(path)).isDirectory() ? resolve(path, 'index.html') : path);
    if (!file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types.get(extname(file)) ?? 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

export async function startPreview(preview, port) {
  const server = createServer((req, res) => {
    if (req.url === '/__lexical_ready__' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ site: 'Lexical', build: preview.build }));
      return;
    }
    void serveFile(preview.root, req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.argv[2] || 4173);
  const server = await startPreview(await loadPreview(), port);
  console.log('Lexical: http://127.0.0.1:' + server.address().port + '/');
}
