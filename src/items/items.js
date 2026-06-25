// 아이템 — 스킨(영구·외형) + 소모품(1회용·완주보조). 게스트 기준 localStorage 저장
// (같은 기기에선 영구 유지; 데이터삭제·재설치·기기변경 시 소실 → 2단계에서 계정 동기화).
//
// 경제: 1단계는 '직접 지급'(광고 1회 → 아이템 1개). 코인제는 아이템 늘면 2단계 확장.
import { LANG } from '../i18n.js';

// ── 카탈로그 ───────────────────────────────────────────────
// 스킨: accent 색만 바뀌면 차체·림·라이더까지 전부 그 색으로 렌더(게임 영향 0).
export const SKINS = [
  { id: 'teal',   ko: '네온 틸', en: 'Neon Teal', color: '#2ce6c4', free: true },
  { id: 'red',    ko: '레드',    en: 'Red',        color: '#ff5d6e' },
  { id: 'purple', ko: '퍼플',    en: 'Purple',     color: '#a78bfa' },
  { id: 'gold',   ko: '골드',    en: 'Gold',       color: '#ffd34d' },
  { id: 'pink',   ko: '핑크',    en: 'Pink',       color: '#ff8cc8' },
  { id: 'lime',   ko: '라임',    en: 'Lime',       color: '#69db7c' },
  { id: 'blue',   ko: '블루',    en: 'Blue',       color: '#5b8cff' },
];

// 소모품: '완주(클리어)'를 돕되 시간기록을 크게 줄이진 않음. 가져가면(장착) 소모.
export const CONSUMABLES = [
  { id: 'boost',  ko: '시작 부스터', en: 'Starter Boost', emoji: '🚀', koDesc: '출발 직후 가속', enDesc: 'Burst at the start' },
  { id: 'fuel',   ko: '연료 +5초',   en: 'Fuel +5s',      emoji: '⛽', koDesc: '시작 연료 +5초',  enDesc: '+5s starting fuel' },
  { id: 'shield', ko: '보호막',      en: 'Shield',        emoji: '🛡️', koDesc: '충돌/추락 1회 무효', enDesc: 'Survive one crash/fall' },
  { id: 'softland', ko: '착지 보호', en: 'Soft Landing',  emoji: '🪂', koDesc: '나쁜 착지 패널티 무효', enDesc: 'No bad-landing penalty' },
  { id: 'phase',  ko: '장애물 통과', en: 'Phase Through', emoji: '👻', koDesc: '폭락 캔들 그냥 통과',  enDesc: 'Pass through crash candles' },
  { id: 'revive', ko: '추가 이어가기', en: 'Extra Revive', emoji: '❤️', koDesc: '광고 없이 1회 부활',  enDesc: 'Revive once, no ad' },
];

export function itemName(it) { return LANG === 'en' ? it.en : it.ko; }
export function itemDesc(it) { return LANG === 'en' ? it.enDesc : it.koDesc; }

// ── 인벤토리 (localStorage) ────────────────────────────────
const LS = 'candlebike_items';
const DEFAULT = { owned: ['teal'], color: 'teal', consum: {}, equipped: [] };
function load() {
  try { return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(LS)) || {}) }; }
  catch { return { ...DEFAULT }; }
}
let state = load();
function persist() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch {} }

// 스킨(영구)
export function ownsSkin(id) {
  const s = SKINS.find((x) => x.id === id);
  return !!s && (s.free || state.owned.includes(id));
}
export function grantSkin(id) { if (!state.owned.includes(id)) { state.owned.push(id); persist(); } }
export function equipSkin(id) { if (ownsSkin(id)) { state.color = id; persist(); } }
export function equippedSkinId() { return ownsSkin(state.color) ? state.color : 'teal'; }
export function equippedColor() {
  const s = SKINS.find((x) => x.id === equippedSkinId()) || SKINS[0];
  return s.color;
}

// 소모품(1회용)
export function consumCount(id) { return state.consum[id] || 0; }
export function grantConsum(id) { state.consum[id] = (state.consum[id] || 0) + 1; persist(); }
export function useConsum(id) {
  if ((state.consum[id] || 0) > 0) { state.consum[id] -= 1; persist(); return true; }
  return false;
}
// 다음 경기에 가져갈 소모품 토글(보유 0이면 자동 해제)
export function isEquipped(id) { return state.equipped.includes(id) && consumCount(id) > 0; }
export function toggleEquip(id) {
  if (state.equipped.includes(id)) state.equipped = state.equipped.filter((x) => x !== id);
  else if (consumCount(id) > 0) state.equipped.push(id);
  persist();
}
// ── 계정 동기화(클라우드) ──────────────────────────────────
export function exportState() { return JSON.parse(JSON.stringify(state)); }
// 클라우드 데이터와 로컬을 병합(스킨 합집합·소모품 최대치) — 로그인/첫 바인딩 시.
export function mergeFrom(cloud) {
  if (!cloud || typeof cloud !== 'object') return;
  const owned = [...new Set([...(state.owned || []), ...(cloud.owned || [])])];
  const consum = { ...state.consum };
  for (const k in (cloud.consum || {})) consum[k] = Math.max(consum[k] || 0, cloud.consum[k] || 0);
  state = {
    ...state, owned, consum,
    color: cloud.color || state.color,
    equipped: Array.isArray(cloud.equipped) ? cloud.equipped : state.equipped,
  };
  persist();
}

// 경기 시작 시 호출 — 장착된(보유>0) 소모품을 소모하고 { boost, fuel, shield } 반환.
export function consumeEquipped() {
  const active = {};
  for (const id of [...state.equipped]) {
    if (useConsum(id)) active[id] = true;
    if (consumCount(id) === 0) state.equipped = state.equipped.filter((x) => x !== id);
  }
  persist();
  return active;
}
