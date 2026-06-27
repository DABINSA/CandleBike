// 닉네임 모더레이션 공유 헬퍼 (서버 전용).
// 금지어(banned_words) 부분일치 + 차단닉(nick_bans) 정확일치 검사.
// 클라가 우회해도 막도록 /api/score·/api/toss-nick·/api/nick-check 가 공통으로 사용.
import { sb, supaReady } from './_supa.js';

export const ANON_RIDER = '익명의라이더';   // (레거시) — 이제 빈/차단 닉은 randomNick() 사용

// 닉이 비었거나 차단됐을 때 줄 랜덤 더미닉(시드 스타일). 클라 i18n.randomNick 과 동일 풀.
const RN_A = ['질주', '칼바람', '풀악셀', '변동성', '캔들', '폭주', '야수', '슈퍼', '한방', '도파민',
  '로켓', '칼치기', '백플립', '차트', '불꽃', '번개', '강철', '돌격', '질풍', '폭락장'];
const RN_B = ['라이더', '킹', '마스터', '장인', '헌터', '바이크', '러', '보스', '전설', '괴물',
  '스피드', '윙', '질주', '본능', '대장'];
export function randomNick() {
  return RN_A[Math.floor(Math.random() * RN_A.length)] + RN_B[Math.floor(Math.random() * RN_B.length)];
}

// 정규화: 소문자 + 공백/문장부호 제거(자모·숫자 섞은 우회 일부 차단). 한글 음절+자모, 라틴, 숫자만 유지.
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^0-9a-z가-힣ㄱ-ㆎ]/g, '');
}

let wordCache = { words: [], at: 0 };
const TTL = 60_000;   // 금지어 목록 캐시(콜드스타트당 1분)

async function getBannedWords() {
  const now = Date.now();
  if (wordCache.words.length && now - wordCache.at < TTL) return wordCache.words;
  if (!supaReady()) return wordCache.words;
  try {
    const r = await sb('banned_words?select=word');
    if (r.ok) {
      const rows = await r.json();
      wordCache = { words: rows.map((x) => normalize(x.word)).filter(Boolean), at: now };
    }
  } catch (e) { console.warn('[moderation] banned_words load', e); }
  return wordCache.words;
}

// 차단된 특정 닉(정확일치, 정규화 기준) — Phase 2 강제변경용. 캐시 짧게.
let banCache = { set: new Set(), at: 0 };
async function getNickBans() {
  const now = Date.now();
  if (banCache.set.size && now - banCache.at < TTL) return banCache.set;
  if (!supaReady()) return banCache.set;
  try {
    const r = await sb('nick_bans?select=nick');
    if (r.ok) {
      const rows = await r.json();
      banCache = { set: new Set(rows.map((x) => normalize(x.nick)).filter(Boolean)), at: now };
    }
  } catch (e) { console.warn('[moderation] nick_bans load', e); }
  return banCache.set;
}

// 닉 사용 가능 여부. 반환 { ok, reason: 'empty'|'banned'|'blocked' }
//   banned = 금지어 포함, blocked = 어드민이 직접 차단한 닉
export async function checkNick(nick) {
  const norm = normalize(nick);
  if (!norm) return { ok: false, reason: 'empty' };
  const bans = await getNickBans();
  if (bans.has(norm)) return { ok: false, reason: 'blocked' };
  const words = await getBannedWords();
  for (const w of words) {
    if (w && norm.includes(w)) return { ok: false, reason: 'banned' };
  }
  return { ok: true };
}
