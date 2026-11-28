export const METHODS = [
  { id: 'en-ja', title: '英語 → 日本語', detail: '英単語を見て、意味を思い出す', icon: 'languages' },
  { id: 'ja-en', title: '日本語 → 英語', detail: '日本語から、英単語を思い出す', icon: 'repeat' },
  { id: 'typing', title: 'タイピング', detail: '日本語から、英単語を入力する', icon: 'keyboard' },
];

export const MODES = [
  { id: 'normal', title: '通常学習', detail: '範囲を指定して学ぶ', icon: 'layers' },
  { id: 'difficult', title: '苦手優先', detail: '苦手タグの付いた単語を学ぶ', icon: 'bookmark' },
  { id: 'recommended', title: 'おすすめ', detail: '復習時期を迎えた単語から学ぶ', icon: 'sparkles' },
];

export const CATEGORIES = [
  { id: 'SUPPLEMENTARY', title: 'SUPPLEMENTARY', detail: '曜日・数詞など' },
  { id: 'NGSL', title: 'NGSL', detail: '基本英単語' },
  { id: 'TSL', title: 'TSL', detail: 'TOEIC対策語' },
];

export const DAY = 86_400_000;
export const MASTERY_EXPIRY_MS = 30 * DAY;
export const LEVEL_ANSWERS = 100;
export const EXTRA_STUDY_COUNT = 10;
export const MAX_GOAL = 4111;

// All scheduling values are in seconds. These are hand-set, not fitted coefficients.
export const REVIEW = Object.freeze({
  firstCorrectHalfLife: 86_400,
  cumulativeCorrectWeight: 0.32,
  cumulativeIncorrectWeight: 0.20,
  correctStreakWeight: 0.52,
  evidenceCap: 512,
  correctStreakCap: 8,
  incorrectBaseHalfLife: 2700,
  incorrectStreakFactor: 0.62,
  incorrectStreakCap: 8,
  minHalfLife: 1200,
  maxHalfLife: 180 * 86_400,
  targetRecall: 0.80,
  minInterval: 300,
  maxInterval: 30 * 86_400,
});

export const DEFAULT_SETTINGS = Object.freeze({ goal: null, method: 'en-ja', autoplay: true, updatedAt: 0 });
