// 아이템 — 탈것/색상(영구·외형) + 소모품(1회용·완주보조). 게스트=localStorage(같은 기기 영구),
// 로그인(토스 user_key/구글)=클라우드 귀속. 경제: 1단계 직접지급(광고 1회→1개), 코인제는 추후.
import { LANG } from '../i18n.js';

// ── 카탈로그 ───────────────────────────────────────────────
// 색상: accent 한 색이 차체/림/라이더까지 칠함(게임영향 0). 종류는 적게.
export const COLORS = [
  { id: 'teal',   ko: '네온 틸', en: 'Neon Teal', color: '#2ce6c4', free: true },
  { id: 'red',    ko: '레드',    en: 'Red',        color: '#ff5d6e' },
  { id: 'gold',   ko: '골드',    en: 'Gold',       color: '#ffd34d' },
  { id: 'purple', ko: '퍼플',    en: 'Purple',     color: '#a78bfa' },
];
// 탈것: 외형만 다름(성능 동일). moto=기본.
export const VEHICLES = [
  { id: 'moto',     ko: '오토바이',     en: 'Motorcycle', emoji: '🏍️', free: true },
  { id: 'horse',    ko: '말',           en: 'Horse',      emoji: '🐎' },
  { id: 'giraffe',  ko: '기린',         en: 'Giraffe',    emoji: '🦒' },
  { id: 'ostrich',  ko: '타조',         en: 'Ostrich',    emoji: '🦤' },
  { id: 'camel',    ko: '낙타',         en: 'Camel',      emoji: '🐪' },
  { id: 'lion',     ko: '사자',         en: 'Lion',       emoji: '🦁' },
  { id: 'elephant', ko: '코끼리',       en: 'Elephant',   emoji: '🐘' },
  { id: 'dino',     ko: '공룡',         en: 'Dinosaur',   emoji: '🦖' },
];
// 소모품: '완주(클리어)' 보조 위주. 가져가면(사용) 소모.
export const CONSUMABLES = [
  { id: 'boost',    ko: '시작 부스터', en: 'Starter Boost', emoji: '🚀', koDesc: '출발 직후 가속',    enDesc: 'Burst at the start' },
  { id: 'fuel',     ko: '연료 +5초',   en: 'Fuel +5s',      emoji: '⛽', koDesc: '시작 연료 +5초',    enDesc: '+5s starting fuel' },
  { id: 'softland', ko: '착지 보호',   en: 'Soft Landing',  emoji: '🪂', koDesc: '나쁜 착지 1회 무효', enDesc: 'Ignore one bad landing' },
  { id: 'phase',    ko: '장애물 통과', en: 'Phase Through', emoji: '👻', koDesc: '폭락 캔들 1회 통과',  enDesc: 'Pass one crash candle' },
  { id: 'dbljump',  ko: '더블 점프',   en: 'Double Jump',   emoji: '⏫', koDesc: '공중에서 1회 더 점프', enDesc: 'Extra mid-air jump' },
  { id: 'revive',   ko: '추가 이어가기', en: 'Extra Revive', emoji: '❤️', koDesc: '광고 없이 1회 부활', enDesc: 'Revive once, no ad' },
];

export function itemName(it) { return LANG === 'en' ? it.en : it.ko; }
export function itemDesc(it) { return LANG === 'en' ? it.enDesc : it.koDesc; }

// ── 인벤토리 ───────────────────────────────────────────────
const LS = 'candlebike_items';
const DEFAULT = { colors: ['teal'], color: 'teal', vehicles: ['moto'], vehicle: 'moto', consum: {}, equipped: [] };
function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS)) || {}; } catch { s = {}; }
  if (s.owned && !s.colors) s.colors = s.owned;   // 구버전(스킨=색상) 마이그레이션
  return { ...DEFAULT, ...s };
}
let state = load();
function persist() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch {} }

// 색상(영구)
export function ownsColor(id) { const c = COLORS.find((x) => x.id === id); return !!c && (c.free || state.colors.includes(id)); }
export function grantColor(id) { if (!state.colors.includes(id)) { state.colors.push(id); persist(); } }
export function equipColor(id) { if (ownsColor(id)) { state.color = id; persist(); } }
export function equippedColorId() { return ownsColor(state.color) ? state.color : 'teal'; }
export function equippedColor() { return (COLORS.find((x) => x.id === equippedColorId()) || COLORS[0]).color; }

// 탈것(영구)
export function ownsVehicle(id) { const v = VEHICLES.find((x) => x.id === id); return !!v && (v.free || state.vehicles.includes(id)); }
export function grantVehicle(id) { if (!state.vehicles.includes(id)) { state.vehicles.push(id); persist(); } }
export function equipVehicle(id) { if (ownsVehicle(id)) { state.vehicle = id; persist(); } }
export function equippedVehicle() { return ownsVehicle(state.vehicle) ? state.vehicle : 'moto'; }

// 소모품(1회용)
export function consumCount(id) { return state.consum[id] || 0; }
export function grantConsum(id) { state.consum[id] = (state.consum[id] || 0) + 1; persist(); }
export function useConsum(id) { if ((state.consum[id] || 0) > 0) { state.consum[id] -= 1; persist(); return true; } return false; }
export function isEquipped(id) { return state.equipped.includes(id) && consumCount(id) > 0; }
export function toggleEquip(id) {
  if (state.equipped.includes(id)) state.equipped = state.equipped.filter((x) => x !== id);
  else if (consumCount(id) > 0) state.equipped.push(id);
  persist();
}
export function consumeEquipped() {
  const active = {};
  for (const id of [...state.equipped]) {
    if (useConsum(id)) active[id] = true;
    if (consumCount(id) === 0) state.equipped = state.equipped.filter((x) => x !== id);
  }
  persist();
  return active;
}

// ── 계정 동기화(클라우드) ──────────────────────────────────
export function exportState() { return JSON.parse(JSON.stringify(state)); }
export function mergeFrom(cloud) {
  if (!cloud || typeof cloud !== 'object') return;
  const colors = [...new Set([...(state.colors || []), ...(cloud.colors || cloud.owned || [])])];
  const vehicles = [...new Set([...(state.vehicles || []), ...(cloud.vehicles || [])])];
  const consum = { ...state.consum };
  for (const k in (cloud.consum || {})) consum[k] = Math.max(consum[k] || 0, cloud.consum[k] || 0);
  state = {
    ...state, colors, vehicles, consum,
    color: cloud.color || state.color,
    vehicle: cloud.vehicle || state.vehicle,
    equipped: Array.isArray(cloud.equipped) ? cloud.equipped : state.equipped,
  };
  persist();
}
