// 리더보드 — Supabase 설정이 있으면 전역 순위, 없으면 localStorage(기기 내) 순위.
//
// 🔴 보안: anon 키는 클라 번들에 노출된다. scores 에 anon 'insert' 정책을 절대 열지 말 것
//    (점수 위조·스팸 가능). 읽기만 공개하고, 쓰기는 service_role 서버 라우트(/api/score)로만.
//    전체 잠금/레이트리밋은 db/security.sql 한 번 실행으로 적용된다.
//
// Supabase 사용 시 SQL(읽기 공개 / 쓰기는 서버 라우트만):
//   create table scores (
//     id bigint generated always as identity primary key,
//     nick text not null,
//     symbol text not null,
//     score int not null,
//     created_at timestamptz default now()
//   );
//   alter table scores enable row level security;
//   create policy "s_read" on scores for select using (true);
//   -- ❌ insert 정책은 만들지 않는다. /api/score 가 service_role(RLS 우회)로 수행.
//   -- 이어서 반드시 db/security.sql 도 실행(잠금 검증 + app_kv 레이트리밋 + submit_score RPC).

import { getClient, isConfigured } from '../supabaseClient.js';

const LS_KEY = 'candlebike_scores';
function lsAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}
function lsSave(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }

export function getNick() { return localStorage.getItem('candlebike_nick') || ''; }
export function setNick(n) { localStorage.setItem('candlebike_nick', n); }

// 완주 시간 등록 → { rank, total, percentile, id } — 같은 '종목' 안에서 빠를수록 상위.
// score 컬럼은 '완주 시간(ms)' 을 담는다(작을수록 좋음). 완주자만 호출됨.
// 쓰기는 반드시 서버 라우트(/api/score, service_role)를 경유 — 클라 anon 직접 insert 금지.
// (anon 키는 클라 번들에 노출되므로 직접 쓰기를 열면 기록 위조·스팸이 가능)
export async function submitScore({ nick, symbol, timeMs, name, vehicle, items }) {
  const score = Math.round(timeMs);   // DB score = 완주 시간(ms)
  if (isConfigured()) {
    try {
      const r = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // name: 종목명(표시용). vehicle/items: 사용 장비(순위표·어드민 표시).
        body: JSON.stringify({ nick, symbol, score, name, vehicle, items }),
      });
      if (r.ok) return await r.json();
      console.warn('score API 실패, 로컬로 대체', r.status);
    } catch (e) {
      console.warn('score API 오류, 로컬로 대체', e);
    }
  }
  return submitLocal({ nick, symbol, score });
}

function submitLocal({ nick, symbol, score }) {
  const all = lsAll();
  const entry = { id: Date.now(), nick, symbol, score, created_at: new Date().toISOString() };
  all.push(entry);
  lsSave(all);
  const sameSym = all.filter((x) => x.symbol === symbol).sort((a, b) => a.score - b.score); // 시간 오름차순
  const rank = sameSym.findIndex((x) => x.id === entry.id) + 1;
  const total = sameSym.length;
  return { rank, total, percentile: Math.max(1, Math.round((rank / total) * 100)), id: entry.id };
}

// 특정 종목의 완주 시간 상위 N개(빠른 순) → [{ nick, symbol, score, id }]
export async function topScores(symbol, limit = 20) {
  const client = await getClient();
  if (client) {
    let q = client.from('scores').select('*').order('score', { ascending: true }).limit(limit);
    if (symbol) q = q.eq('symbol', symbol);
    const { data, error } = await q;
    if (!error && data) return data;
  }
  let arr = lsAll();
  if (symbol) arr = arr.filter((x) => x.symbol === symbol);
  return arr.sort((a, b) => a.score - b.score).slice(0, limit);
}

export function isRemote() { return isConfigured(); }
