import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let playwright;
if (process.env.LEXICAL_PLAYWRIGHT_MODULE) playwright = await import(process.env.LEXICAL_PLAYWRIGHT_MODULE);
else playwright = await import('playwright');
const base = process.env.LEXICAL_TEST_URL || 'http://127.0.0.1:4173/';
const screenshots = process.env.LEXICAL_SCREENSHOTS || 'test-results';
await mkdir(screenshots, { recursive: true });
const browser = await playwright.chromium.launch({ channel: process.env.LEXICAL_BROWSER || 'msedge', headless: true });
const faults = [];
const catalog = JSON.parse(await readFile('dist/data/catalog.json', 'utf8'));
const config = JSON.parse(await readFile('dist/config.json', 'utf8'));
const ebook = catalog.words.find(w => w.lemma === 'e-book');
const firstWord = catalog.words[0];
const target = name => screenshots + '/' + name + '.png';

async function pageFor(context) {
  const page = await context.newPage();
  page.on('pageerror', err => faults.push(err.message));
  await page.addInitScript(() => {
    window.lexicalAudioStarts = 0;
    if (window.AudioBufferSourceNode) {
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) { window.lexicalAudioStarts++; return start.apply(this, args); };
    }
  });
  return page;
}
async function waitText(locator, pattern) {
  await locator.filter({ hasText: pattern }).waitFor({ state: 'visible' });
  assert.match(await locator.innerText(), pattern);
}
const nav = async (page, hash) => {
  await page.evaluate(hash => { location.hash = hash; }, hash);
  await page.waitForFunction(hash => location.hash === '#' + hash, hash);
};
const button = (page, text) => page.getByRole('button', { name: text, exact: true });
async function goal(page, value) {
  await page.locator('#goal-setup input').fill(String(value));
  await button(page, '目標を設定').click();
  await page.locator('#goal-setup').waitFor({ state: 'detached' });
}
async function setMethod(page, method) {
  const b = page.locator('[data-method="' + method + '"]');
  await b.click();
  await page.locator('[data-method="' + method + '"][aria-pressed=true]').waitFor();
}
async function normal(page, { method = 'en-ja', category = '', start = 1, end = start, random = false } = {}) {
  await nav(page, 'home');
  await setMethod(page, method);
  await page.locator('[data-mode=normal]').click();
  await page.locator('#start-form [name=category]').selectOption(category);
  await page.locator('#start-form [name=order]').selectOption(random ? 'random' : 'registered');
  await page.locator('#start-form [name=start]').fill(String(start));
  await page.locator('#start-form [name=end]').fill(String(end));
  await button(page, 'この設定で開始').click();
  await page.locator('.quiz-card').waitFor();
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('lexical.study.v1', 1);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    try {
      return await new Promise((res, rej) => {
        const req = db.transaction('data').objectStore('data').get('guest-vault');
        req.onsuccess = () => res(req.result.guest.state);
        req.onerror = () => rej(req.error);
      });
    } finally { db.close(); }
  });
}
function count(state) { return Object.values(state.days).reduce((a, b) => a + b, 0); }
async function noOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await pageFor(desktop);
  await page.goto(base);
  await waitText(page.getByRole('heading', { level: 1 }), /今日の習慣に/);
  await noOverflow(page);
  await page.waitForFunction(() => (document.querySelector('.site-header .brand img')?.naturalWidth ?? 0) > 0);
  await page.screenshot({ path: target('desktop-home') });
  const phoneticLink = page.locator('#phonetic-link');
  if (config.phoneticUrl) {
    await phoneticLink.waitFor({ state: 'visible' });
    assert.equal(await phoneticLink.getAttribute('href'), config.phoneticUrl);
    if (config.phoneticUrl === './phonetic/') assert((await desktop.request.get(new URL('phonetic/', base).href)).ok());
  } else {
    await phoneticLink.waitFor({ state: 'hidden' });
  }
  const privacyLink = page.getByRole('link', { name: 'プライバシー', exact: true });
  const privacy = await desktop.request.get(new URL(await privacyLink.getAttribute('href'), base).href);
  assert(privacy.ok());
  assert.match(await privacy.text(), /Googleでログインする場合/);
  await page.locator('#menu summary').click();
  await page.locator('#menu').getByRole('link', { name: '設定', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#menu').getAttribute('open'), null);
  await goal(page, 2);
  assert.equal((await snapshot(page)).settings.goal, 2);

  await normal(page, { method: 'typing', category: 'TSL', start: 4 });
  await waitText(page.locator('.meanings'), /電子書籍/);
  await waitText(page.locator('.alternatives'), /digital book/);
  assert.equal(await page.locator('.quiz-word, [data-speak]').count(), 0);
  assert.equal(await page.evaluate(() => window.lexicalAudioStarts), 0);
  await button(page, '回答を送信').click();
  await waitText(page.locator('#answer-error'), /英単語を入力/);
  assert.equal(count(await snapshot(page)), 0);
  await page.locator('#typing-input').fill('  ebook  ');
  await page.locator('#typing-input').dispatchEvent('compositionstart');
  await page.locator('#typing-input').press('Enter');
  assert.equal(count(await snapshot(page)), 0);
  await page.locator('#typing-input').dispatchEvent('compositionend');
  await page.waitForTimeout(110);
  await page.locator('#typing-input').press('Enter');
  await waitText(page.locator('.feedback-label'), /^正解$/);
  assert.equal(await page.locator('#question-title mark').innerText(), '-');
  assert.equal((await page.locator('.typed-answer .letter-match').allTextContents()).join(''), 'ebook');
  assert.equal((await snapshot(page)).progress[ebook.id + ':typing'].correct, 1);
  await page.waitForFunction(() => window.lexicalAudioStarts > 0);
  const amount = await page.evaluate(() => window.lexicalAudioStarts);
  await page.getByRole('button', { name: '発音を聴く' }).click();
  await page.waitForFunction(amount => window.lexicalAudioStarts > amount, amount);
  await page.screenshot({ path: target('desktop-answer') });
  await button(page, '結果を見る').click();
  await waitText(page.getByRole('heading', { level: 1 }), /学習完了/);

  await normal(page, { method: 'ja-en', end: 2 });
  assert.equal(await page.locator('[data-speak]').count(), 0);
  await button(page, '答えを見る').click();
  await waitText(page.locator('#question-title'), /^the$/);
  assert(await page.locator('.quiz-card').evaluate(card =>
    card.querySelector('.meanings').getBoundingClientRect().bottom <=
      card.querySelector('#question-title').getBoundingClientRect().top));
  assert.equal(count(await snapshot(page)), 1);
  await button(page, '正解').click();
  await waitText(page.locator('.feedback-label'), /^正解$/);
  await page.getByRole('link', { name: '学習を中断' }).click();
  await button(page, '続きから').waitFor();
  await page.reload();
  await button(page, '続きから').click();
  await waitText(page.locator('.quiz-progress'), /1 \/ 2 語 正解/);
  assert.equal(count(await snapshot(page)), 2);
  await button(page, '答えを見る').click();
  await waitText(page.locator('#question-title'), /^be$/);
  await button(page, '不正解').click();
  await waitText(page.locator('.feedback-label'), /^不正解$/);
  assert.equal(count(await snapshot(page)), 2);
  assert.equal(await button(page, '結果を見る').count(), 0);
  await button(page, '次の問題').click();
  await waitText(page.locator('.quiz-progress'), /解き直し/);
  await button(page, '答えを見る').click();
  await waitText(page.locator('#question-title'), /^be$/);
  await button(page, '正解').click();
  await button(page, '結果を見る').click();
  await page.getByRole('heading', { name: '学習完了' }).waitFor();
  assert.deepEqual(await page.locator('.result-metrics strong').allTextContents(), ['2', '3', '1']);
  assert.equal(count(await snapshot(page)), 3);

  // Two tabs open the same unanswered question. Only one IndexedDB transaction can count it.
  await normal(page, { method: 'en-ja', end: 3, random: true });
  const order = (await snapshot(page)).session.ids;
  assert.equal(new Set(order).size, 3);
  const tab = await pageFor(desktop);
  await tab.goto(base + '#lesson');
  await tab.locator('.quiz-word').waitFor();
  await Promise.all([button(page, '答えを見る').click(), button(tab, '答えを見る').click()]);
  await Promise.allSettled([button(page, '正解').click({ timeout: 3000 }), button(tab, '正解').click({ timeout: 3000 })]);
  await page.waitForFunction(async () => {
    const res = document.querySelector('.feedback-label,.global-message');
    return Boolean(res?.textContent);
  });
  assert.equal(count(await snapshot(page)), 4);
  await tab.close();
  await nav(page, 'home');
  await button(page, '続きから').waitFor();
  await page.reload();
  assert.deepEqual((await snapshot(page)).session.ids, order);
  await button(page, '続きから').click();
  assert.equal(await page.locator('#question-title').innerText(), catalog.words.find(w => w.id === order[1]).lemma);
  await nav(page, 'home');
  page.once('dialog', dialog => dialog.accept());
  await button(page, 'セットを破棄').click();
  await page.locator('.resume').waitFor({ state: 'detached' });
  assert.equal(count(await snapshot(page)), 4);

  await nav(page, 'words');
  const pageNumber = page.getByRole('spinbutton', { name: '移動先のページ番号' });
  await pageNumber.fill('37');
  assert.deepEqual(await pageNumber.evaluate(input => {
    const { outlineWidth, outlineOffset } = getComputedStyle(input);
    return [outlineWidth, outlineOffset];
  }), ['2px', '1px']);
  await pageNumber.press('Enter');
  await page.locator('.word-row').first().getByRole('link', { name: catalog.words[1080].lemma, exact: true }).waitFor();
  await button(page, '次のページ').click();
  assert.equal(await pageNumber.inputValue(), '38');
  await pageNumber.fill('999');
  await button(page, '移動').click();
  assert.equal(await page.locator('.word-row').first().getByRole('link').innerText(), catalog.words[1110].lemma);
  await page.getByRole('searchbox').fill('e-book');
  await waitText(page.locator('.word-count'), /^1 語/);
  const tag = page.locator('.word-row [data-tag]');
  await tag.click();
  await page.locator('.word-row [aria-pressed=true]').waitFor();
  await page.getByRole('link', { name: 'e-book', exact: true }).click();
  await page.locator('#word-sources summary').click();
  await page.locator('#word-attribution a', { hasText: '使用版' }).first().waitFor();
  await nav(page, 'home');
  await page.locator('[data-mode=difficult]').click();
  await page.locator('#start-form [name=category]').selectOption('');
  await button(page, 'この設定で開始').click();
  await waitText(page.locator('#question-title'), /^e-book$/);
  assert.deepEqual((await snapshot(page)).session.ids, [ebook.id]);
  await nav(page, 'home');
  await page.locator('[data-mode=recommended]').click();
  await button(page, '追加で学習する').waitFor();
  await nav(page, 'records');
  await waitText(page.locator('.primary-stat .stat-value'), /^4 \/ 2 語分/);
  await page.screenshot({ path: target('desktop-records') });
  console.log('PASS desktop: 3 methods, 2-tab dedupe, IME, sound, range, tag, session reload, list, records');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const phone = await pageFor(mobile);
  await phone.goto(base);
  await waitText(phone.getByRole('heading', { level: 1 }), /今日の習慣に/);
  await noOverflow(phone);
  await phone.screenshot({ path: target('mobile-home') });
  await goal(phone, 2);
  await nav(phone, 'settings');
  await phone.getByLabel('発音を自動再生する').uncheck();
  await button(phone, '設定を保存').tap();
  await waitText(phone.locator('#global-message'), /学習設定を保存/);
  await normal(phone, { method: 'typing' });
  await noOverflow(phone);
  await button(phone, '分からない・答えを見る').tap();
  await waitText(phone.locator('.feedback-label'), /^不正解$/);
  const afterGiveUp = await snapshot(phone);
  assert.equal(afterGiveUp.progress[firstWord.id + ':typing'].incorrect, 1);
  assert.equal(count(afterGiveUp), 0);
  assert.deepEqual(afterGiveUp.session.retryIds, [firstWord.id]);
  assert.equal(await button(phone, '結果を見る').count(), 0);
  assert.equal(await phone.evaluate(() => window.lexicalAudioStarts), 0);
  await phone.screenshot({ path: target('mobile-answer') });
  await nav(phone, 'words');
  await phone.getByRole('searchbox').fill('damn');
  await waitText(phone.locator('.word-count'), /^1 語/);
  await phone.getByRole('link', { name: 'damn', exact: true }).tap();
  await waitText(phone.locator('.meanings'), /罵る、呪う/);
  assert.equal(await phone.locator('.meaning-rows .pos').count(), 3);
  assert.equal(await phone.locator('.meaning-note').count(), 2);
  await noOverflow(phone);
  await nav(phone, 'records');
  await noOverflow(phone);
  console.log('PASS mobile viewport: layout, touch, give up, autoplay off, word detail, records');
  await mobile.close();

  const studyUi = await browser.newContext({ viewport: { width: 390, height: 860 }, reducedMotion: 'no-preference' });
  const review = await pageFor(studyUi);
  await review.goto(base);
  await goal(review, 3);
  const answerInput = review.locator('#typing-input');
  async function checkGrowth(selector, from, to) {
    const ranges = await review.locator(selector + ' .meter-growing').evaluate(fill => {
      const [animation] = fill.getAnimations();
      const width = () => fill.getBoundingClientRect().width / fill.parentElement.getBoundingClientRect().width * 100;
      animation.pause();
      animation.currentTime = 0;
      const from = width();
      animation.finish();
      return [from, width()];
    });
    assert(Math.abs(ranges[0] - from) < 0.1, 'Unexpected animation start: ' + ranges);
    assert(Math.abs(ranges[1] - to) < 0.1, 'Unexpected animation end: ' + ranges);
  }
  await normal(review, { method: 'typing', start: 2, end: 3 });
  await waitText(review.locator('.meaning-text'), /存在する・生きている・～である/);
  assert.equal(await review.locator('.meaning-rows .pos').count(), 1);
  await answerInput.dispatchEvent('compositionstart');
  await answerInput.press('Enter');
  assert.equal(count(await snapshot(review)), 0);
  await answerInput.dispatchEvent('compositionend');
  await review.waitForTimeout(110);
  await answerInput.press('Enter');
  await waitText(review.locator('.feedback-label'), /^不正解$/);
  assert.equal((await snapshot(review)).session.last.gaveUp, true);
  assert.equal(count(await snapshot(review)), 0);
  assert.equal(await review.locator('.typed-answer').count(), 0);
  assert.equal(await review.getByRole('progressbar').getAttribute('aria-valuenow'), '0');
  assert.equal(await review.locator('.quiz-progress .meter-growing').count(), 0);
  await button(review, '次の問題').click();
  const repeat = catalog.words[2];
  await answerInput.fill(repeat.lemma);
  await answerInput.press('Enter');
  await waitText(review.locator('.feedback-label'), /^正解$/);
  await checkGrowth('.quiz-progress', 0, 50);
  await checkGrowth('.feedback .mastery', 0, 8);
  assert.equal(await button(review, '結果を見る').count(), 0);
  await review.getByRole('link', { name: '学習を中断' }).click();
  await button(review, '続きから').waitFor();
  await review.reload();
  await button(review, '続きから').click();
  await waitText(review.locator('.quiz-progress'), /解き直し/);
  await waitText(review.locator('.meaning-text'), /存在する・生きている・～である/);
  await answerInput.fill('be');
  await answerInput.press('Enter');
  await waitText(review.locator('.feedback-label'), /^正解$/);
  await checkGrowth('.quiz-progress', 50, 100);
  await button(review, '結果を見る').press('Enter');
  await review.getByRole('heading', { name: '学習完了' }).waitFor();
  assert.equal(count(await snapshot(review)), 2);
  assert.equal(await review.locator('main').evaluate(el => getComputedStyle(el).outlineStyle), 'none');

  await normal(review, { method: 'typing', start: 3 });
  await answerInput.fill(repeat.lemma);
  await answerInput.press('Enter');
  await waitText(review.locator('.feedback-label'), /^正解$/);
  await checkGrowth('.feedback .mastery', 8, 18);
  assert.equal(await review.locator('.streak-badge').getAttribute('title'), '連続正解 2 回');
  await review.screenshot({ path: target('typing-streak') });
  await button(review, '苦手にする').click();
  await button(review, '苦手タグを外す').waitFor();
  assert.equal(await review.locator('.meter-growing').count(), 0);
  await button(review, '結果を見る').click();

  await normal(review, { method: 'typing', start: ebook.order });
  await answerInput.fill('e-bokk');
  await answerInput.press('Enter');
  await waitText(review.locator('.feedback-label'), /^不正解$/);
  assert.equal(await review.locator('.typed-answer b').innerText(), 'e-bokk');
  assert.equal((await review.locator('.typed-answer .letter-match').allTextContents()).join(''), 'ebok');
  assert.equal(await review.locator('#question-title').innerText(), ebook.lemma);
  const typedLayout = await review.locator('.typed-answer b').evaluate(typed => {
    const correct = document.querySelector('#question-title');
    const prompt = document.querySelector('.meanings');
    const pronunciation = document.querySelector('.pronunciation');
    const audio = document.querySelector('.quiz-word .audio-status');
    const textSize = parseFloat(getComputedStyle(typed).fontSize);
    return prompt.getBoundingClientRect().bottom <= correct.getBoundingClientRect().top &&
      pronunciation.getBoundingClientRect().bottom <= typed.getBoundingClientRect().top &&
      audio.getBoundingClientRect().bottom <= typed.getBoundingClientRect().top &&
      textSize <= parseFloat(getComputedStyle(correct).fontSize) * 0.55;
  });
  assert(typedLayout);
  await review.screenshot({ path: target('typing-wrong') });
  await button(review, '次の問題').click();
  await waitText(review.locator('.quiz-progress'), /解き直し/);
  await answerInput.fill(ebook.lemma);
  await answerInput.press('Enter');
  await button(review, '結果を見る').click();

  await review.emulateMedia({ reducedMotion: 'reduce' });
  for (let correct = 3; correct <= 10; correct++) {
    await normal(review, { method: 'typing', start: 3 });
    await answerInput.fill(repeat.lemma);
    await answerInput.press('Enter');
    await waitText(review.locator('.feedback-label'), /^正解$/);
    const animations = await review.locator('.feedback .meter i').evaluate(fill => fill.getAnimations().length);
    assert.equal(animations, 0);
    if (correct === 10) {
      const [meter, flame, value] = await review.locator('.feedback .mastery').evaluate(el =>
        [...el.children].map(child => child.getBoundingClientRect().toJSON()));
      assert(meter.right < flame.left && flame.right < value.left);
      assert.equal(await review.locator('.feedback .flame').getAttribute('title'), '習得済み');
      assert.equal(await review.locator('.streak-badge').count(), 0);
      await review.screenshot({ path: target('typing-mastered') });
    }
    await button(review, '結果を見る').click();
  }

  const permit = catalog.words.find(w => w.lemma === 'permit');
  await review.setViewportSize({ width: 320, height: 860 });
  await normal(review, { method: 'typing', start: permit.order });
  await noOverflow(review);
  assert.equal(await review.locator('.meanings').count(), 1);
  const coordinates = await review.locator('.meaning-rows').evaluate(rows => [...rows.children].map(el => el.getBoundingClientRect().toJSON()));
  assert(coordinates[0].left < coordinates[1].left && coordinates[2].left < coordinates[3].left);
  assert(coordinates[1].top < coordinates[3].top);
  const alternativeRows = await review.locator('.alternatives li').evaluateAll(items =>
    items.map(item => Math.round(item.getBoundingClientRect().top)));
  assert.equal(alternativeRows.length, 3);
  assert.equal(alternativeRows[0], alternativeRows[1]);
  assert(new Set(alternativeRows).size <= 2);
  await waitText(review.locator('.alternatives'), /license[\s\S]*許可する[\s\S]*許可証/);
  await review.screenshot({ path: target('typing-narrow') });
  await studyUi.close();
  console.log('PASS study UI: answer layout, retry and resume, correct-only study totals, empty Enter, IME and progress motion');

  // Supabase's API is represented by the real migration in local PostgreSQL.
  // The browser session is synthetic; no Google or hosted Supabase project is contacted.
  const pg = new PGlite();
  const owner = 'ad2d7ba2-2310-4187-bbe1-351b8127627c';
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth to authenticated, anon;`);
  await pg.query('insert into auth.users(id) values ($1)', [owner]);
  await pg.exec(await readFile('supabase/migrations/202611240001_lexical.sql', 'utf8'));
  await pg.exec('set role authenticated');
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  const getCloud = async () => (await pg.query('select public.lexical_snapshot($1) as value', [owner])).rows[0].value;
  let loseImportReply = true, loseAnswerReply = true;
  const url = new URL(base);
  const tokenPart = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const accessToken = tokenPart({ alg: 'HS256', typ: 'JWT' }) + '.' +
    tokenPart({ sub: owner, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.stub';
  const user = { id: owner, email: 'lexical-test@example.invalid', aud: 'authenticated' };
  const authSession = { access_token: accessToken, refresh_token: 'test', token_type: 'bearer',
    user, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  await desktop.route('**/config.json', route => route.fulfill({ json: {
    supabaseUrl: url.origin, supabaseKey: 'sb_publishable_localtest', phoneticUrl: './phonetic/',
  } }));
  await desktop.route('**/auth/v1/**', route => {
    const { pathname } = new URL(route.request().url());
    return ['/auth/v1/logout', '/auth/v1/authorize'].includes(pathname)
      ? route.fulfill({ status: 204 }) : route.fulfill({ json: user });
  });
  await desktop.route('**/rest/v1/rpc/**', async route => {
    const args = route.request().postDataJSON();
    try {
      if (route.request().url().endsWith('lexical_snapshot')) {
        await route.fulfill({ json: await getCloud() });
        return;
      }
      const reply = (await pg.query('select public.lexical_commit($1,$2,$3,$4,$5,$6) as result', [
        args.p_account, args.p_revision, args.p_client, args.p_sequence, JSON.stringify(args.p_patch), args.p_guest,
      ])).rows[0].result;
      if ((args.p_guest && loseImportReply) || (args.p_patch.days && !args.p_guest && loseAnswerReply)) {
        if (args.p_guest) loseImportReply = false;
        else loseAnswerReply = false;
        await route.abort();
      } else await route.fulfill({ json: reply });
    } catch (err) {
      await route.fulfill({ status: 400, json: { message: err.message, code: err.code } });
    }
  });
  const useSession = () => page.evaluate(({ hostname, authSession }) =>
    localStorage.setItem('sb-' + hostname.split('.')[0] + '-auth-token', JSON.stringify(authSession)), { hostname: url.hostname, authSession });
  await useSession();
  await page.reload();
  await button(page, '保存を再試行').waitFor();
  assert.equal(count(await getCloud()), 4);
  await button(page, '保存を再試行').click();
  await waitText(page.locator('#global-message'), /同期しました/);
  assert.equal(count(await getCloud()), 4);
  await nav(page, 'home');
  await button(page, '続きから').click();
  await waitText(page.locator('#question-title'), /^e-book$/);
  await button(page, '答えを見る').click();
  await button(page, '不正解').click();
  await waitText(page.locator('.feedback-label'), /^不正解$/);
  const firstPass = await getCloud();
  assert.equal(count(firstPass), 4);
  assert.deepEqual(firstPass.session.retryIds, [ebook.id]);
  await button(page, '次の問題').click();
  await page.reload();
  await waitText(page.locator('.quiz-progress'), /解き直し/);
  await waitText(page.locator('#question-title'), /^e-book$/);
  await button(page, '答えを見る').click();
  await button(page, '正解').click();
  await button(page, '保存を再試行').waitFor();
  assert.equal(await page.locator('.feedback-label').count(), 0);
  assert.equal(count(await getCloud()), 5);
  await button(page, '保存を再試行').click();
  await waitText(page.locator('.feedback-label'), /^正解$/);
  const finished = await getCloud();
  assert.equal(count(finished), 5);
  assert.deepEqual(finished.session.retryIds, []);
  await button(page, '結果を見る').waitFor();
  await nav(page, 'settings');
  await button(page, 'ログアウト').click();
  await button(page, 'Googleでログイン').waitFor();
  assert.equal(count(await snapshot(page)), 0);
  const [authRequest] = await Promise.all([
    page.waitForRequest(request => new URL(request.url()).pathname === '/auth/v1/authorize'),
    button(page, 'Googleでログイン').click(),
  ]);
  const authorization = new URL(authRequest.url());
  assert.equal(authorization.searchParams.get('provider'), 'google');
  assert.equal(authorization.searchParams.get('redirect_to'), base);
  await useSession();
  await page.reload();
  await button(page, 'ログアウト').waitFor();
  assert.equal(count(await getCloud()), 5);
  await pg.close();
  assert.deepEqual(faults, []);
  console.log('PASS account UI: mocked Auth, real SQL, lost replies, retry without double count, guest import and logout');
} finally {
  await browser.close();
}
