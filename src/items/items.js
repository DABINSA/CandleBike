// 아이템 — 탈것(영구·외형) + 소모품(1회용·완주보조). 게스트=localStorage(같은 기기 영구),
// 로그인(토스 user_key/구글)=클라우드 귀속. 경제: 1단계 직접지급(광고 1회→1개), 코인제는 추후.
import { LANG } from '../i18n.js';

// ── 카탈로그 ───────────────────────────────────────────────
// accent: 차체/림/라이더에 칠하는 고정 네온 틸(색상 선택 기능은 없앰).
export const ACCENT = '#2ce6c4';
// 토큰 보상: 완주 1회 / 리워드 광고 1회
export const FINISH_REWARD = 10;
export const AD_REWARD = 100;

// 탈것: 외형 + 매 판 무료 '기본 퍽'(perk: 소모품 효과). cost=희귀도/매력도+퍽 강함 순(영구).
// perk 는 차고에서 산 소모품과 합산되어 적용된다(game.js).
export const VEHICLES = [
  { id: 'moto',     ko: '오토바이',     en: 'Motorcycle', emoji: '🏍️', free: true, cost: 0,   perk: {} },
  { id: 'horse',    ko: '말',           en: 'Horse',      emoji: '🐎', cost: 40,  perk: { boost: 1 } },
  { id: 'giraffe',  ko: '기린',         en: 'Giraffe',    emoji: '🦒', cost: 70,  perk: { softland: 1 } },
  { id: 'ostrich',  ko: '타조',         en: 'Ostrich',    emoji: '🦤', cost: 110, perk: { fuel: 1 } },
  { id: 'camel',    ko: '낙타',         en: 'Camel',      emoji: '🐪', cost: 140, perk: { dbljump: 1 } },
  { id: 'lion',     ko: '사자',         en: 'Lion',       emoji: '🦁', cost: 220, perk: { boost: 1, phase: 1 } },
  { id: 'elephant', ko: '코끼리',       en: 'Elephant',   emoji: '🐘', cost: 280, perk: { fuel: 1, softland: 1 } },
  { id: 'dino',     ko: '공룡',         en: 'Dinosaur',   emoji: '🦖', cost: 400, perk: { dbljump: 1, revive: 1 } },
];
// 소모품: '완주(클리어)' 보조 위주. 가져가면(사용) 소모. cost=게임 내 이득이 큰 순(클수록 비쌈).
export const CONSUMABLES = [
  { id: 'boost',    ko: '시작 부스터', en: 'Starter Boost', emoji: '🚀', koDesc: '출발 직후 가속',      enDesc: 'Burst at the start',      cost: 8 },
  { id: 'fuel',     ko: '연료 +5초',   en: 'Fuel +5s',      emoji: '⛽', koDesc: '시작 연료 +5초',      enDesc: '+5s starting fuel',       cost: 14 },
  { id: 'softland', ko: '착지 보호',   en: 'Soft Landing',  emoji: '🪂', koDesc: '나쁜 착지 1회 무효',   enDesc: 'Ignore one bad landing',  cost: 18 },
  { id: 'phase',    ko: '장애물 통과', en: 'Phase Through', emoji: '👻', koDesc: '폭락 캔들 1회 통과',    enDesc: 'Pass one crash candle',   cost: 24 },
  { id: 'dbljump',  ko: '더블 점프',   en: 'Double Jump',   emoji: '⏫', koDesc: '한 판 내내 공중 점프', enDesc: 'Double jump all run',     cost: 35 },
  { id: 'revive',   ko: '추가 이어가기', en: 'Extra Revive', emoji: '❤️', koDesc: '광고 없이 1회 부활',   enDesc: 'Revive once, no ad',      cost: 50 },
];

export function itemName(it) { return LANG === 'en' ? it.en : it.ko; }
// 탈것 id → 이모지(순위표 표시용). 미지정/구기록은 ''.
export function vehicleEmoji(id) { const v = VEHICLES.find((x) => x.id === id); return v ? v.emoji : ''; }
// 소모품 id → 이모지(어드민 표시용).
export function consumEmoji(id) { const c = CONSUMABLES.find((x) => x.id === id); return c ? c.emoji : ''; }
export function itemDesc(it) { return LANG === 'en' ? it.enDesc : it.koDesc; }

// ── 인벤토리 ───────────────────────────────────────────────
const LS = 'candlebike_items';
const DEFAULT = { vehicles: ['moto'], vehicle: 'moto', consum: {}, equipped: [], tokens: 0 };
function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS)) || {}; } catch { s = {}; }
  return { ...DEFAULT, ...s };
}
let state = load();
function persist() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch {} }

// accent 색(고정) — 색상 선택 기능 삭제, 항상 네온 틸.
export function equippedColor() { return ACCENT; }

// ── 토큰(보상 재화) ────────────────────────────────────────
export function getTokens() { return state.tokens || 0; }
export function addTokens(n) { state.tokens = (state.tokens || 0) + Math.max(0, n | 0); persist(); return state.tokens; }
export function spendTokens(n) { n = Math.max(0, n | 0); if ((state.tokens || 0) < n) return false; state.tokens -= n; persist(); return true; }

// 탈것(영구)
export function ownsVehicle(id) { const v = VEHICLES.find((x) => x.id === id); return !!v && (v.free || state.vehicles.includes(id)); }
export function grantVehicle(id) { if (!state.vehicles.includes(id)) { state.vehicles.push(id); persist(); } }
export function equipVehicle(id) { if (ownsVehicle(id)) { state.vehicle = id; persist(); } }
export function equippedVehicle() { return ownsVehicle(state.vehicle) ? state.vehicle : 'moto'; }
// 장착 탈것의 기본 퍽(매 판 무료 적용될 소모품 효과맵). moto 등 없으면 {}.
export function equippedPerk() { const v = VEHICLES.find((x) => x.id === equippedVehicle()); return (v && v.perk) ? { ...v.perk } : {}; }
// 토큰 구매(영구) — 미보유 & 토큰 충분하면 차감 후 지급. true=성공.
export function buyVehicle(id) {
  const v = VEHICLES.find((x) => x.id === id);
  if (!v || ownsVehicle(id)) return false;
  if (!spendTokens(v.cost || 0)) return false;
  grantVehicle(id);
  return true;
}

// 소모품(1회용)
export function consumCount(id) { return state.consum[id] || 0; }
export function grantConsum(id) { state.consum[id] = (state.consum[id] || 0) + 1; persist(); }
// 토큰 구매 — 토큰 충분하면 차감 후 1개 지급. true=성공.
export function buyConsum(id) {
  const c = CONSUMABLES.find((x) => x.id === id);
  if (!c) return false;
  if (!spendTokens(c.cost || 0)) return false;
  grantConsum(id);
  return true;
}
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
    tokens: Math.max(state.tokens || 0, cloud.tokens || 0),   // 토큰: 손실 방지로 큰 쪽
  };
  persist();
}
