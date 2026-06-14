// 변동성 → 난이도. 차트가 급등락할수록(주간 수익률 표준편차↑) 코스가 험해 어렵다.
import { t } from './i18n.js';
import { CONFIG } from './config.js';
import { generateMockHistory } from './stock/mockData.js';

const COLORS = ['#2ce67a', '#7dd86a', '#ffd34d', '#ff9f45', '#ff4d6d'];

// 주간 수익률의 표준편차 (대략 0.02 ~ 0.15)
export function volatility(series) {
  if (!series || series.length < 10) return 0;
  const step = 5; // 주간
  const rets = [];
  for (let i = step; i < series.length; i += step) {
    const a = series[i - step].close, b = series[i].close;
    if (a > 0) rets.push((b - a) / a);
  }
  if (!rets.length) return 0;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varc = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length;
  return Math.sqrt(varc);
}

export function difficulty(series) {
  const v = volatility(series);
  let level;
  if (v < 0.04) level = 1;
  else if (v < 0.06) level = 2;
  else if (v < 0.085) level = 3;
  else if (v < 0.12) level = 4;
  else level = 5;
  return {
    level,
    vol: v,
    volPct: +(v * 100).toFixed(1),     // 주간 변동성 %
    label: t.diffLabels[level - 1],
    color: COLORS[level - 1],
    stars: '★'.repeat(level) + '☆'.repeat(5 - level),
  };
}

// 검색/추천 목록용 — 시리즈 없이 빠르게 추정 (mock 모드에서만 계산 가능)
export function quickDifficulty(symbol) {
  if (CONFIG.STOCK_PROVIDER === 'mock') {
    return difficulty(generateMockHistory(symbol, CONFIG.HISTORY_YEARS));
  }
  return null; // 실데이터 모드: 코스를 받기 전엔 알 수 없음
}
