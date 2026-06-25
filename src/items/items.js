// 아이템 — 탈것(영구·외형) + 소모품(1회용·완주보조). 게스트=localStorage(같은 기기 영구),
// 로그인(토스 user_key/구글)=클라우드 귀속. 경제: 1단계 직접지급(광고 1회→1개), 코인제는 추후.
import { LANG } from '../i18n.js';

// ── 카탈로그 ───────────────────────────────────────────────
// accent: 차체/림/라이더에 칠하는 고정 네온 틸(색상 선택 기능은 없앰).
export const ACCENT = '#2ce6c4';
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
const DEFAULT = { vehicles: ['moto'], vehicle: 'moto', consum: {}, equipped: [] };
function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS)) || {}; } catch { s = {}; }
  return { ...DEFAULT, ...s };
}
let state = load();
function persist() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch {} }

// accent 색(고정) — 색상 선택 기능 삭제, 항상 네온 틸.
export function equippedColor() { return ACCENT; }

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
  const vehicles = [...new Set([...(state.vehicles || []), ...(cloud.vehicles || [])])];
  const consum = { ...state.consum };
  for (const k in (cloud.consum || {})) consum[k] = Math.max(consum[k] || 0, cloud.consum[k] || 0);
  state = {
    ...state, vehicles, consum,
    vehicle: cloud.vehicle || state.vehicle,
    equipped: Array.isArray(cloud.equipped) ? cloud.equipped : state.equipped,
  };
  persist();
}
