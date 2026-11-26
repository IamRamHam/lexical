import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { loadPreview, startPreview } from './serve.mjs';

const run = promisify(execFile);
const port = 4173;
const url = 'http://127.0.0.1:4173/';

function readPage(path) {
  return fetch(new URL(path, url), { signal: AbortSignal.timeout(1500), redirect: 'error' });
}

async function samePreview(preview, allowOlderServer = false) {
  try {
    const status = await readPage('__lexical_ready__');
    if (status.ok && status.headers.get('content-type')?.includes('application/json')) {
      const { site, build } = await status.json();
      return site === 'Lexical' && build === preview.build && (await readPage('.')).ok;
    }
    if (!allowOlderServer || status.status !== 404) return false;
    // Accept a manually started copy from before the status endpoint existed
    // only if its page, configuration and manifest match this build exactly.
    for (const [name, bytes] of preview.files) {
      const response = await readPage(name);
      if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(bytes)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function openBrowser() {
  try {
    const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await run(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      "Start-Process -FilePath 'http://127.0.0.1:4173/' -ErrorAction Stop"], { windowsHide: true });
  } catch {
    console.log('ブラウザーの自動起動ができませんでした。次のアドレスをブラウザーに入力してください。');
    console.log(url);
    return false;
  }
  return true;
}

async function launch() {
  const preview = await loadPreview();
  let server;
  try {
    server = await startPreview(preview, port);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    if (await samePreview(preview, true)) {
      console.log('Lexical は起動済みです。起動中のサーバーを使います。');
      console.log('停止するときは、最初に開いた起動ウィンドウで Ctrl+C を押してください。');
      if (!await openBrowser()) process.exitCode = 1;
      return;
    }
    throw new Error('ポート 4173 は別のプログラムが使用中です。使用中のプログラムを閉じてから、もう一度起動してください。');
  }

  // The browser only opens after an actual HTTP response from this build.
  const deadline = Date.now() + 5000;
  let ready = false;
  do {
    ready = await samePreview(preview);
    if (!ready && Date.now() < deadline) await wait(200);
  } while (!ready && Date.now() < deadline);
  if (!ready) {
    server.close();
    throw new Error('サーバーから応答を確認できませんでした。少し待ってから起動し直してください。');
  }
  console.log('Lexical を起動しました。 ' + url);
  console.log('使っている間はこのウィンドウを開いたままにしてください。');
  console.log('停止するときは Ctrl+C を押すか、このウィンドウを閉じてください。');
  await openBrowser();
}

try {
  await launch();
} catch (err) {
  console.error('Lexical を起動できませんでした。');
  console.error(err.code === 'EACCES'
    ? 'Windows がポート 4173 の使用を許可しませんでした。ほかのプログラムの使用状況を確認してください。'
    : err.message);
  process.exitCode = 1;
}
