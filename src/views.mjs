import { CATEGORIES, DEFAULT_SETTINGS, LEVEL_ANSWERS, MAX_GOAL, METHODS, MODES } from './rules.mjs';
import { effectiveProgress, inProgress, progressKey, recall, remainingToday, studyDay, totals } from './study.mjs';
import { answerDiff, grade } from './grading.mjs';
import { icon } from './icons.mjs';

export const h = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const number = n => new Intl.NumberFormat('ja-JP').format(n);
const disabled = off => off ? ' disabled' : '';
const select = (title, name, values, current, attrs = '') => `<label class="field">${h(title)}
  <select name="${name}" ${attrs}>${values.map(([v, label]) =>
    `<option value="${h(v)}"${String(v) === String(current) ? ' selected' : ''}>${h(label)}</option>`).join('')}</select></label>`;
const numeric = (name, value, max, caption) => `<label class="field">${h(caption)}
  <input type="number" inputmode="numeric" name="${name}" value="${value}" min="1" max="${max}" step="1" required></label>`;
const button = (label, action, type = 'secondary', iconName = '', off = false) => `<button class="btn ${type}" type="button"
  data-action="${action}"${disabled(off)}>${iconName ? icon(iconName, 19) : ''}${h(label)}</button>`;

export function nav(view) {
  const current = ['lesson', 'result'].includes(view) ? 'home' : view;
  return `<nav class="tabs" aria-label="Lexical">${[
    ['home', 'book', '学習'], ['words', 'layers', '単語一覧'], ['records', 'calendar', '学習記録'], ['settings', 'settings', '設定'],
  ].map(([route, symbol, label]) => `<a href="#${route}"${route === current ? ' aria-current="page"' : ''}>${icon(symbol, 18)} ${label}</a>`).join('')}</nav>`;
}

const categoryOptions = [['', 'すべての単語'], ...CATEGORIES.map(c => [c.id, c.id + ' · ' + c.detail])];
const starOptions = [['', 'すべての重要度'], ...[5, 4, 3, 2, 1].map(n => [n, '★'.repeat(n) + '（' + n + '）'])];
const methodLabel = method => METHODS.find(m => m.id === method)?.title ?? '';
export const dateLabel = ms => ms ? new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo',
}).format(ms) : '—';

function steps(title, name, options, selected) {
  return `<fieldset class="step"><legend>${title}</legend><div class="choice-grid">${options.map(o => `<button type="button"
    class="choice${selected === o.id ? ' selected' : ''}" data-${name}="${o.id}" aria-pressed="${selected === o.id}">
    <span class="choice-icon">${icon(o.icon)}</span><strong>${o.title}</strong><small>${o.detail}</small></button>`).join('')}</div></fieldset>`;
}

function meterFill(value, from = value) {
  const motion = from < value ? ` class="meter-growing" style="--meter-from:${from}%;width:${value}%"` : ` style="width:${value}%"`;
  return `<i${motion}></i>`;
}

export function masteryBar(progress, from = progress.bar) {
  const value = progress.bar;
  return `<div class="mastery ${progress.mastered ? 'mastered' : ''}">
    <span class="meter" role="meter" aria-label="習得度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}">${meterFill(value, from)}</span>
    ${progress.mastered ? `<span class="flame" title="習得済み">${icon('flame', 19)}<span class="sr-only">習得済み</span></span>` : ''}
    <span class="mastery-value">${value}<span class="sr-only">ポイント</span></span>
  </div>`;
}

function stats(state, now) {
  const t = totals(state, state.settings.method, now);
  const goal = state.settings.goal;
  const pct = goal ? Math.min(100, (t.today * 100) / goal) : 0;
  return `<div class="stats-grid">
    <article class="card stat primary-stat"><span class="stat-icon">${icon('calendar', 20)}</span><div>
      <p class="muted">今日の学習</p><div class="stat-value">${number(t.today)}<small> ${goal ? '/ ' + number(goal) : ''} 語分</small></div>
      <div class="meter" role="meter" aria-label="今日の目標進捗" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></div></article>
    <article class="card stat"><span class="stat-icon yellow">${icon('flame', 20)}</span><div><p class="muted">習得済み</p>
      <div class="stat-value">${number(t.mastered)}<small> 語</small></div><div class="stat-note">${h(methodLabel(state.settings.method))}</div></div></article>
    <article class="card stat"><span class="stat-icon purple">${icon('chart', 20)}</span><div><p class="muted">累計の学習</p>
      <div class="stat-value">${number(t.count)}<small> 語分</small></div><div class="stat-note">レベル ${number(t.level)}</div></div></article>
  </div>`;
}

function goalForm(state, onboarding = false, locked = false) {
  return `<form id="${onboarding ? 'goal-setup' : 'settings-form'}" class="goal-form">
    ${numeric('goal', state.settings.goal ?? 50, MAX_GOAL, '1日に学習したい語数')}
    ${onboarding ? '' : `<label class="check-row"><input type="checkbox" name="autoplay"${state.settings.autoplay ? ' checked' : ''}>発音を自動再生する</label>`}
    <button class="btn primary" type="submit"${disabled(locked)}>${onboarding ? '目標を設定' : '設定を保存'}</button>
  </form>`;
}

export function home(state, spec, poolSize, now, locked) {
  const isRecommended = spec.mode === 'recommended';
  const normal = spec.mode === 'normal';
  const active = inProgress(state.session);
  const left = remainingToday(state, now);
  const count = spec.count ?? (isRecommended ? left : 20);
  const ready = normal ? spec.start <= spec.end && spec.end <= poolSize : count > 0;
  const resume = active ? `<aside class="card resume"><div class="resume-title">${icon('clock')}<div><strong>途中の学習</strong>
    <p>${h(methodLabel(state.session.method))} · ${number(state.session.correct)} / ${number(state.session.ids.length)} 語 正解済み</p></div></div>
    <div class="actions">${button('続きから', 'resume', 'primary', '', locked)}${button('セットを破棄', 'discard', 'soft', '', locked)}</div></aside>` : '';
  return `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-content">
      <span class="hero-tag">${icon('book', 17)} TOEIC 英単語</span>
      <h1 id="hero-title">英単語を、<br>今日の習慣に。</h1>
      <p>覚える・思い出す・入力する。<br class="desktop-break">3つの方法で、毎日少しずつ。</p>
      ${button(active ? '続きから学習する' : '学習をはじめる', active ? 'resume' : 'scroll-setup', 'hero-button', active ? 'clock' : 'book', locked && active)}
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="art-orbit"></div><div class="art-paper art-paper-back"></div><div class="art-paper art-paper-mid"></div>
      <div class="art-paper art-paper-front"><span class="paper-icon">${icon('book', 22)}</span>
        <span class="paper-pos">動詞</span><strong lang="en">recall</strong><span class="paper-jp">思い出す</span>
        <span class="paper-line"></span><span class="paper-caption">${icon('volume', 16)} <span>英単語の発音</span></span></div>
      <div class="art-total"><span class="art-star">${icon('sparkles', 23)}</span><div><strong>4,111</strong><span> 収録語</span></div></div>
    </div>
  </section>
  ${stats(state, now)}${resume}
  <section id="setup" class="study-setup" aria-labelledby="setup-title">
    <div class="section-head"><div><h2 id="setup-title">学習をはじめる</h2><p class="muted">回答方法と出題範囲を選んでください。</p></div></div>
    ${state.settings.goal === null ? `<div class="card onboarding"><div><h3>今日からの目標</h3><p>まず1日に学習したい語数を設定してください。</p></div>${goalForm(state, true, locked)}</div>` : ''}
    <form id="start-form" class="card setup-card">
      ${steps('回答方法', 'method', METHODS, state.settings.method)}
      ${steps('学習モード', 'mode', MODES, spec.mode)}
      <fieldset class="step range"><legend>出題する単語</legend>
        <div class="field-grid">
          ${select('リスト', 'category', categoryOptions, spec.category)}
          ${spec.category !== 'SUPPLEMENTARY' ? select('重要度', 'stars', starOptions, spec.stars) : ''}
          ${!isRecommended ? select('順序', 'order', [['registered', '登録順'], ['random', 'ランダム']], spec.order) : ''}
        </div>
        ${normal ? `<div class="field-grid number-range">${numeric('start', spec.start, Math.max(1, poolSize), '開始番号')}
          ${numeric('end', spec.end, Math.max(1, poolSize), '終了番号')}</div>
          <p class="help">選択したリストと重要度で絞り込んだ後の登録順です。1〜${number(poolSize)}番から指定できます。</p>` :
          `<div class="field-grid count-range">${numeric('count', count || '', MAX_GOAL, '学習する語数')}</div>
          ${isRecommended ? `<label class="check-row"><input name="includeEarly" type="checkbox"${spec.includeEarly ? ' checked' : ''}>復習予定前の既習語も含める</label>
          <p class="help">${left ? '今日の目標まであと ' + number(left) + ' 語分。' : (state.settings.goal ? '今日の目標は達成済みです。' : '')}
            復習予定を迎えた単語から選び、足りない分を未学習語で補います。</p>` :
            '<p class="help">手動で苦手タグを付けた単語が対象です。指定より少ない場合は対象全語を出題します。</p>'}`}
      </fieldset>
      <div class="setup-actions"><p><strong id="pool-count">${number(poolSize)}</strong> 語が対象
        <span class="help">${spec.category ? h(spec.category) : '全リスト'}${spec.stars ? ' · 重要度 ' + '★'.repeat(spec.stars) : ''}</span></p>
        ${isRecommended && !left && state.settings.goal && spec.count === null
          ? button('追加で学習する', 'extra-study', 'primary', 'book', locked)
          : `<button class="btn primary" id="start-button" type="submit"${disabled(locked || !ready || poolSize === 0 || state.settings.goal === null)}>${icon('book', 19)} この設定で開始</button>`}
      </div>
      <div id="setup-error" class="form-error" role="status"></div>
    </form>
  </section>`;
}

function posClass(pos) {
  if (pos === 'noun' || pos === 'proper noun') return 'pos-n';
  if (pos === 'verb' || pos === 'auxiliary verb') return 'pos-v';
  if (pos === 'adjective') return 'pos-adj';
  if (pos === 'adverb') return 'pos-adv';
  return 'pos-other';
}

export function meanings(word, withAlternatives = false) {
  const byPos = new Map();
  for (const sense of word.senses) {
    if (!byPos.has(sense.pos)) byPos.set(sense.pos, []);
    byPos.get(sense.pos).push(sense);
  }
  const rows = [...byPos.values()].map(senses => {
    const { pos, label } = senses[0];
    const text = senses.map(s => `<span id="${h(s.displayId)}">${h(s.japanese)}${s.supplement
      ? `<small class="meaning-note">（${h(s.supplement)}）</small>` : ''}</span>`).join('・');
    return `<dt><span class="pos ${posClass(pos)}">${h(label)}</span></dt><dd class="meaning-text">${text}</dd>`;
  });
  const alternatives = withAlternatives ? word.alts : [];
  const items = alternatives.map(({ text, scopes }) => {
    const needsScope = word.senses.length > 1 || scopes[0].japanese !== word.senses[0].japanese;
    const scope = needsScope ? scopes.map(ref => {
      const sense = word.senses.find(s => s.displayId === ref.displayId);
      return `<span>${h(sense.label)}「${h(ref.japanese)}」</span>`;
    }).join(' ') : '';
    return `<li><b lang="en">${h(text)}</b>${scope ? `<small>${scope}</small>` : ''}</li>`;
  });
  return `<div class="meanings"><dl class="meaning-rows">${rows.join('')}</dl>
    ${items.length ? `<div class="alternatives"><span>今回は使わない表現</span><ul>${items.join('')}</ul></div>` : ''}
  </div>`;
}

export function pronunciation(word, buttons = true) {
  const { status, candidates } = word.pronunciation;
  const labels = {
    original: '原本の発音', dictionary_candidate: 'CMUdict · 米語', multiple_candidates: '読みの候補 · 語義との対応未確認',
    needs_sense_review: '発音候補 · 語義との対応未確認', missing: 'IPAは未収録',
  };
  return `<div class="pronunciation"><div>${candidates.length ? `<span class="ipa">${candidates.map(c => '/' + h(c.ipa) + '/').join(' · ')}</span>` : ''}
    <small>${h(labels[status])}</small></div>
    ${buttons ? `<button class="icon-button audio" type="button" data-speak="${h(word.id)}" aria-label="発音を聴く" title="発音を聴く">${icon('volume')}</button>` : ''}
  </div>`;
}

function canonicalText(result) {
  return result.differences.map(({ canonical, changed }) => changed && canonical ? `<mark>${h(canonical)}</mark>` : h(canonical)).join('');
}

function typedText(result) {
  const diff = result.accepted ? result.differences : answerDiff(result.input, result.canonical);
  return diff.map(({ input, changed }) => {
    if (!input) return '';
    if (changed) return result.accepted ? `<mark>${h(input)}</mark>` : h(input);
    return input.replace(/(\p{Script=Latin}[\p{Script=Latin}\p{Mark}]*)|([^\p{Script=Latin}]+)/gu,
      (_, letters, other) => letters ? `<mark class="letter-match">${h(letters)}</mark>` : h(other));
  }).join('');
}

export function lesson(word, session, revealed, feedback, state, typingDraft, locked, animateAnswer = false) {
  const englishFirst = session.method === 'en-ja';
  const typing = session.method === 'typing';
  const retrying = (feedback?.index ?? session.cursor) >= session.ids.length;
  const completed = !inProgress(session);
  const answerVisible = englishFirst || revealed || feedback;
  const typed = feedback?.input !== null && feedback?.input !== undefined ? grade(word, feedback.input) : null;
  const variant = typed?.accepted && typed.differences.some(p => p.changed);
  const progress = effectiveProgress(state.progress[progressKey(word.id, session.method)]);
  const beforeCount = animateAnswer && feedback?.correct ? session.correct - 1 : session.correct;
  const countPercent = count => count * 100 / session.ids.length;
  const gained = feedback?.correct && feedback.afterBar > feedback.beforeBar;
  const streak = gained && progress.streak >= 2 ? progress.streak : 0;
  return `<section class="quiz-shell" aria-labelledby="question-title">
    <div class="quiz-top"><a href="#home" class="text-button">学習を中断</a><span>${h(methodLabel(session.method))}</span></div>
    <div class="quiz-progress">
      <strong>${number(session.correct)} <small>/ ${number(session.ids.length)} 語 正解${retrying ? ' · 解き直し' : ''}</small></strong>
      <span class="meter" role="progressbar" aria-label="正解した単語" aria-valuemax="${session.ids.length}" aria-valuenow="${session.correct}">${meterFill(countPercent(session.correct), countPercent(beforeCount))}</span>
    </div>
    <article class="card quiz-card">
      <p class="quiz-task">${englishFirst ? '日本語の意味を思い出そう' : typing ? '英単語を入力しよう' : '英単語を思い出そう'}</p>
      ${!answerVisible ? '<h1 id="question-title" class="sr-only">日本語の意味</h1>' : ''}
      ${!englishFirst ? meanings(word, !answerVisible) : ''}
      ${answerVisible ? `<div class="quiz-word"><h1 id="question-title" lang="en">${variant ? canonicalText(typed) : h(word.lemma)}</h1>
        ${pronunciation(word)}<div class="audio-status" data-audio-status role="status"></div>
        ${typed ? `<p class="typed-answer"><span>入力</span><b lang="en">${typedText(typed)}</b></p>` : ''}
        ${variant ? '<p class="spelling-note">黄色は許容された表記差</p>' : ''}</div>` : ''}
      ${englishFirst && (revealed || feedback) ? meanings(word) : ''}
      ${feedback ? `<div class="feedback ${feedback.correct ? 'correct' : 'incorrect'}" role="status">
        <div class="feedback-label">${icon(feedback.correct ? 'check' : 'close', 22)}<strong>${feedback.correct ? '正解' : '不正解'}</strong></div>
        ${!feedback.correct ? '<p class="retry-note">この単語はセットの末尾でもう一度出題します。</p>' : ''}
        <div class="feedback-bar"><div class="feedback-summary"><span>習得度 ${feedback.beforeBar} → ${feedback.afterBar}</span>
        ${streak ? `<span class="streak-badge" title="連続正解 ${number(streak)} 回">${icon('bolt', 16)}<span class="sr-only">連続正解 </span>${number(streak)}<span class="sr-only"> 回</span></span>` : ''}</div>
        ${masteryBar(progress, animateAnswer && gained ? feedback.beforeBar : progress.bar)}</div>
        </div>
        <div class="quiz-actions">${button(state.tags[word.id] ? '苦手タグを外す' : '苦手にする', 'tag-quiz', 'secondary', 'bookmark', locked)}
        ${button(completed ? '結果を見る' : '次の問題', completed ? 'finish' : 'next', 'primary', '', locked)}</div>` :
        typing ? `<form id="typing-form" class="typing-form">
          <label class="sr-only" for="typing-input">英単語</label><input id="typing-input" name="answer" lang="en" placeholder="英単語を入力"
            inputmode="text" maxlength="180" value="${h(typingDraft)}" autocapitalize="none" autocomplete="off" spellcheck="false"${disabled(locked)}>
          <button class="btn primary" type="submit"${disabled(locked)}>回答を送信</button>
        </form><div class="quiz-actions">${button('分からない・答えを見る', 'give-up', 'text-button', '', locked)}</div>`
        : revealed ? `<div class="quiz-actions">${button('不正解', 'mark-wrong', 'secondary', 'close', locked)}
          ${button('正解', 'mark-right', 'primary', 'check', locked)}</div>`
          : `<div class="quiz-actions">${button('答えを見る', 'reveal', 'primary', '', locked)}</div>`}
      <div id="answer-error" class="form-error" role="status"></div>
    </article>
  </section>`;
}

export function result(session, byId) {
  const wrong = session.cursor - session.correct;
  return `<section class="result-shell card"><span class="result-icon">${icon('check', 36)}</span>
    <h1>学習完了</h1><p class="muted">${h(methodLabel(session.method))} のセットを終えました。</p>
    <div class="result-metrics"><div><strong>${number(session.correct)}</strong><span>語分 学習</span></div>
      <div><strong>${number(session.cursor)}</strong><span>回答回数</span></div><div><strong>${number(wrong)}</strong><span>不正解回数</span></div></div>
    <div class="actions centered"><a class="btn primary" href="#home">学習に戻る</a><a class="btn secondary" href="#records">学習記録</a></div>
    ${session.wrongIds.length ? `<details class="result-wrong"><summary>間違えた単語（${number(session.wrongIds.length)}語）</summary><ul>${session.wrongIds.map(id =>
      `<li><a href="#word/${h(id)}" lang="en">${h(byId.get(id)?.lemma ?? id)}</a></li>`).join('')}</ul></details>` : ''}
  </section>`;
}

export function wordsPage(filters, selectedMethod) {
  return `<section class="listing">
    <div class="section-head"><div><h1>単語一覧</h1><p class="muted">英語・日本語で検索し、習得状況と苦手タグを確認できます。</p></div></div>
    <form id="word-filters" class="card filter-card">
      <label class="search-field">${icon('search', 22)}<span class="sr-only">単語を検索</span>
        <input type="search" name="query" placeholder="単語・日本語訳を検索" value="${h(filters.query)}" autocomplete="off"></label>
      <div class="field-grid">${select('リスト', 'category', categoryOptions, filters.category)}
        ${select('重要度', 'stars', starOptions, filters.stars, filters.category === 'SUPPLEMENTARY' ? 'disabled' : '')}
        ${select('習得状況', 'status', [['', 'すべて'], ['mastered', '習得済み'], ['learning', '学習中'], ['new', '未学習'], ['difficult', '苦手タグ']], filters.status)}
        ${select('表示する回答方法', 'viewMethod', METHODS.map(m => [m.id, m.title]), selectedMethod)}
      </div>
    </form><div id="word-results"></div></section>`;
}

export function wordResults(words, state, page, size, locked, now) {
  const pages = Math.max(1, Math.ceil(words.length / size));
  const sub = words.slice((page - 1) * size, page * size);
  return `<div class="word-results-head">
    <div id="word-list-count" class="word-count muted" role="status" tabindex="-1">${number(words.length)} 語 <small>· 登録順</small>
      ${pages > 1 ? `<span class="sr-only">、${pages} ページ中 ${page} ページ目</span>` : ''}</div>
    ${pages > 1 ? `<form id="word-page-jump" class="page-jump">
      <label><span class="sr-only">移動先のページ番号</span>
        <input type="number" name="page" value="${page}" min="1" max="${pages}" step="1" inputmode="numeric" required></label>
      <span>/ ${pages} ページ</span><button type="submit" class="btn secondary">移動</button>
    </form>` : ''}</div>
    ${sub.length ? `<ul class="word-results">${sub.map(word => {
      const m = word.memberships[0];
      const p = effectiveProgress(state.progress[progressKey(word.id, state.settings.method)], now);
      return `<li class="card word-row"><span class="word-no">${number(word.order)}</span><div class="word-main">
        <a href="#word/${h(word.id)}" lang="en">${h(word.lemma)}</a><p>${word.senses.map(s => h(s.japanese)).join(' / ')}</p></div>
        <div class="word-meta"><span>${h(m.category)}</span>${m.stars ? `<span class="stars" aria-label="重要度 ${m.stars}">${'★'.repeat(m.stars)}</span>` : ''}</div>
        <div class="word-progress">${masteryBar(p)}<small>${p.mastered ? '習得済み' : p.lastAnswered === null ? '未学習' : '学習中'}</small></div>
        <button type="button" class="icon-button tag ${state.tags[word.id] ? 'tagged' : ''}" data-tag="${word.id}"
          aria-label="${h(word.lemma)} の苦手タグ" aria-pressed="${Boolean(state.tags[word.id])}" title="苦手タグ"${disabled(locked)}>${icon('bookmark', 20)}</button></li>`;
    }).join('')}</ul>` : '<p class="card empty">条件に一致する単語がありません。</p>'}
    ${pages > 1 ? `<div class="pagination">${button('前のページ', 'page-prev', 'secondary', '', page <= 1)}
      <span>${page} / ${pages}</span>${button('次のページ', 'page-next', 'secondary', '', page >= pages)}</div>` : ''}`;
}

export function wordDetail(word, state, now, locked) {
  const progress = effectiveProgress(state.progress[progressKey(word.id, state.settings.method)], now);
  const probability = recall(progress, now);
  return `<section class="detail-shell"><p><a class="text-button" href="#words">単語一覧に戻る</a></p>
    <article class="card word-detail"><div class="word-detail-top"><div><h1 lang="en">${h(word.lemma)}</h1>
      <p class="muted">${word.memberships.map(m => h(m.category) + (m.rank ? ' · 頻度順位 ' + number(m.rank) : '')).join(' / ')}</p></div>
      <button class="btn secondary" data-tag="${word.id}" aria-pressed="${Boolean(state.tags[word.id])}"${disabled(locked)}>${icon('bookmark', 19)}
        ${state.tags[word.id] ? '苦手タグを外す' : '苦手にする'}</button></div>
    ${pronunciation(word)}<p class="audio-status" data-audio-status role="status"></p>${meanings(word, true)}
    <div class="detail-stats"><h2>学習状態 <small>${h(methodLabel(state.settings.method))}</small></h2>
      ${masteryBar(progress)}
      <p>正解 ${number(progress.correct)} 回 / 不正解 ${number(progress.incorrect)} 回</p>
      <p>次の復習 ${h(dateLabel(progress.due))}</p>
      ${probability === null ? '' : `<p class="help">推定の想起確率 ${Math.round(probability * 100)}%</p>`}</div>
    <details id="word-sources"><summary>この単語の出典</summary><div id="word-attribution"></div></details></article></section>`;
}

export function calendar(state, month, day) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = studyDay();
  const blanks = Array.from({ length: first.getUTCDay() }, () => '<span></span>').join('');
  const cells = Array.from({ length: count }, (_, i) => {
    const stamp = month + '-' + String(i + 1).padStart(2, '0');
    const done = state.days[stamp] ?? 0;
    return `<button type="button" class="calendar-day ${done ? 'studied' : ''} ${stamp === today ? 'today' : ''}" data-day="${stamp}"
      aria-label="${stamp}、${done}語分学習" aria-pressed="${stamp === day}"><span>${i + 1}</span>${done ? `<small>${number(done)}</small>` : ''}</button>`;
  }).join('');
  return `<div class="calendar-head"><h2>${y}年 ${m}月</h2><div class="actions">${button('前月', 'previous-month', 'soft')}${button('翌月', 'next-month', 'soft')}</div></div>
    <div class="calendar">${['日', '月', '火', '水', '木', '金', '土'].map(s => '<span class="weekday">' + s + '</span>').join('')}${blanks}${cells}</div>
    <p class="calendar-detail" role="status">${h(day)} · ${number(state.days[day] ?? 0)} 語分学習</p>`;
}

export function records(state, month, day, now) {
  return `<section><div class="section-head"><div><h1>学習記録</h1><p class="muted">正解した分の学習量と、習得済みの単語を確認できます。</p></div>
    ${select('習得済みを集計する回答方法', 'viewMethod', METHODS.map(m => [m.id, m.title]), state.settings.method)}</div>
    ${stats(state, now)}<div class="card calendar-card" id="calendar-card">${calendar(state, month, day)}</div>
    <p class="help">学習日は日本時間の午前5時に切り替わります。レベルは累計の学習量が ${LEVEL_ANSWERS} 語分増えるごとに上がります。</p>
    <p><a class="btn secondary" href="#words">単語ごとの習得度を見る</a></p></section>`;
}

export function settings(state, account, configured, locked) {
  return `<section class="settings-shell"><div class="section-head"><div><h1>設定</h1><p class="muted">学習目標・発音・保存先を管理します。</p></div></div>
    <article class="card settings-card"><h2>${icon('settings')} 学習設定</h2>${goalForm(state, false, locked)}
    <p class="help">発音は米語です。自動再生を使うには学習開始時などに操作が必要です。</p></article>
    <article class="card settings-card"><h2>${icon('cloud')} 保存先</h2>
    ${account ? `<p><strong>Googleアカウント</strong> ${h(account.email ?? '')}</p>
      <p class="help">学習記録をアカウントに保存します。保存待ちがある場合は再試行できます。</p>
      <div class="actions">${button('同期を再試行', 'retry-sync', 'secondary', '', false)}${button('ログアウト', 'logout', 'secondary', '', locked)}</div>`
      : `<p><strong>ゲスト</strong></p><p>進捗と設定はこのブラウザに保存します。ブラウザのデータを削除すると消え、別端末には引き継がれません。</p>
      ${configured ? button('Googleでログイン', 'login', 'secondary', '', locked) : '<p class="help">Googleログインは接続設定後に利用できます。</p>'}`}</article>
  </section>`;
}

const sourceHref = url => {
  try { return ['https:', 'http:'].includes(new URL(url).protocol) ? url : ''; } catch { return ''; }
};
const sourceLink = (url, name) => sourceHref(url) ? `<a href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(name)}</a>` : '';

export function sources(data) {
  const credit = data ? `<ul class="credits-list">${Object.entries(data.notices).filter(([, text]) => typeof text === 'string')
    .map(([, text]) => '<li>' + h(text) + '</li>').join('')}</ul>
    <ul class="credits-list">${data.licenses.map(l => `<li>${sourceLink(l.url, l.name)}${l.text ? `<details><summary>ライセンス全文</summary><pre>${h(l.text)}</pre></details>` : ''}</li>`).join('')}
    ${(data.notices.license_information_urls ?? []).map(u => '<li>' + sourceLink(u, u) + '</li>').join('')}</ul>`
    : '<p class="muted" role="status">出典を読み込んでいます…</p>';
  return `<section><div class="section-head"><div><h1>出典・ライセンス</h1><p class="muted">単語、訳、発音の出典。</p></div></div>
    <article class="card settings-card"><h2>英単語と日本語訳</h2>${credit}
      <p>リスト内の頻度順位から重要度を追加しています。各語の使用版・改変区分は単語一覧の詳細から確認できます。</p>
      <p><a href="./data/attribution.json">全単語の出典データ（JSON）</a></p></article>
    <article class="card settings-card"><h2>発音</h2>
      <p>PhoneticのCMUdict変換を利用しています。複数の読みと意味の対応は、候補として表示します。</p>
      <p>米語の発声はPhonetic同梱のPicoVoxを使用します。</p>
      <ul class="credits-list"><li><a href="./vendor/phonetic/CMUdict-LICENSE.txt">CMUdictライセンス</a></li>
        <li><a href="./vendor/phonetic/english-voice-LICENSE.txt">PicoVoxライセンス</a></li></ul></article>
  </section>`;
}

export function attribution(word, data) {
  const item = data.words[word.id];
  const row = id => {
    const r = data.registry[id];
    if (!r) return '';
    const license = data.licenses.find(l => l.id === r.license_id);
    return `<li><strong>${h(r.title)}</strong> ${h(r.authors?.join('、') || '')}
      ${sourceLink(r.url, '原項目')} ${sourceLink(r.revision_url, '使用版')} ${sourceLink(r.history_url, '改訂履歴')} ${license ? sourceLink(license.url, license.id) : ''}
      ${r.text ? '<small>' + h(r.text) + '</small>' : ''}</li>`;
  };
  const origins = {
    user_supplied: 'ユーザー指定', dictionary_adopted: '辞書の訳を採用', dictionary_adapted: '辞書の訳を編集',
    ai_generated: 'AIによる訳', AI_display_edit_of_existing_sense: '表示をAIで編集',
    dictionary_supported_AI_display_revision: '出典確認のうえ表示をAIで編集',
  };
  return `<h3>リストの出典</h3><ul class="credits-list">${item.memberships.flatMap(m => m.sourceIds).map(row).join('')}</ul>
    ${item.senses.map(s => `<h3>${h(s.japanese)}</h3><p class="help">${h(origins[s.origin] ?? s.origin)}${origins[s.displayOrigin] && s.origin !== s.displayOrigin ? ' · ' + h(origins[s.displayOrigin]) : ''}</p>
      <ul class="credits-list">${s.sourceIds.map(row).join('')}</ul>`).join('')}`;
}
