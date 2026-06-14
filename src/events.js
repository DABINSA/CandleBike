// 실제 대폭락/충격 이벤트 — 코스의 해당 날짜 지점에서 짧은 "보스" 연출(폭락 캔들 장애물).
// 로드된 3년 구간 안에 드는 날짜만 코스에 등장한다.
import { LANG } from './i18n.js';

const EVENTS = [
  { date: '2025-04-03', ko: '트럼프 관세 쇼크', en: 'Trump Tariff Shock', emoji: '🐻' },
  { date: '2025-06-13', ko: '이란 분쟁·유가 쇼크', en: 'Iran Conflict Oil Shock', emoji: '🛢️' },
  { date: '2024-08-05', ko: '블랙 먼데이', en: 'Black Monday', emoji: '📉' },
  { date: '2023-10-27', ko: '중동 긴장·금리 발작', en: 'Mideast & Rate Scare', emoji: '💥' },
  { date: '2022-02-24', ko: '러시아·우크라 전쟁', en: 'Russia–Ukraine War', emoji: '💣' },
  { date: '2020-03-16', ko: '코로나 대폭락', en: 'COVID Crash', emoji: '🦠' },
];

export function eventName(e) { return LANG === 'en' ? e.en : e.ko; }

// 코스 점들(weekly)에서 각 이벤트를 ±6일 내 가장 가까운 점에 매핑
export function findEvents(points) {
  const out = [];
  for (const ev of EVENTS) {
    const target = Date.parse(ev.date);
    if (isNaN(target)) continue;
    let best = null, bestDiff = Infinity;
    for (const p of points) {
      const d = Math.abs(Date.parse(p.date) - target);
      if (d < bestDiff) { bestDiff = d; best = p; }
    }
    if (best && bestDiff <= 6 * 86400000) out.push({ x: best.x, y: best.y, event: ev });
  }
  return out;
}
