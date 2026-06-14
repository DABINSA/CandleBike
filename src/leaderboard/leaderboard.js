// 리더보드 — Supabase 설정이 있으면 전역 순위, 없으면 localStorage(기기 내) 순위.
//
// Supabase 사용 시 SQL:
//   create table scores (
//     id bigint generated always as identity primary key,
//     nick text not null,
//     symbol text not null,
//     score int not null,
//     created_at timestamptz default now()
//   );
//   alter table scores enable row level security;
//   create policy "read"   on scores for select using (true);
//   create policy "insert" on scores for insert with check (true);

import { getClient, isConfigured } from '../supabaseClient.js';

const LS_KEY = 'candlebike_scores';
function lsAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}
function lsSave(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }

export function getNick() { return localStorage.getItem('candlebike_nick') || ''; }
export function setNick(n) { localStorage.setItem('candlebike_nick', n); }

// 점수 등록 → { rank, total, percentile, id } — 같은 '종목' 안에서의 순위
export async function submitScore({ nick, symbol, score }) {
  const client = await getClient();
  if (client) {
    const { data, error } = await client.from('scores').insert({ nick, symbol, score }).select().single();
    if (error) { console.warn('supabase insert 실패, 로컬로 대체', error); return submitLocal({ nick, symbol, score }); }
    const { count } = await client.from('scores').select('*', { count: 'exact', head: true }).eq('symbol', symbol);
    const { count: better } = await client.from('scores').select('*', { count: 'exact', head: true }).eq('symbol', symbol).gt('score', score);
    const total = count || 1;
    const rank = (better || 0) + 1;
    return { rank, total, percentile: Math.max(1, Math.round((rank / total) * 100)), id: data.id };
  }
  return submitLocal({ nick, symbol, score });
}

function submitLocal({ nick, symbol, score }) {
  const all = lsAll();
  const entry = { id: Date.now(), nick, symbol, score, created_at: new Date().toISOString() };
  all.push(entry);
  lsSave(all);
  const sameSym = all.filter((x) => x.symbol === symbol).sort((a, b) => b.score - a.score);
  const rank = sameSym.findIndex((x) => x.id === entry.id) + 1;
  const total = sameSym.length;
  return { rank, total, percentile: Math.max(1, Math.round((rank / total) * 100)), id: entry.id };
}

// 특정 종목의 상위 N개 → [{ nick, symbol, score, id }]
export async function topScores(symbol, limit = 20) {
  const client = await getClient();
  if (client) {
    let q = client.from('scores').select('*').order('score', { ascending: false }).limit(limit);
    if (symbol) q = q.eq('symbol', symbol);
    const { data, error } = await q;
    if (!error && data) return data;
  }
  let arr = lsAll();
  if (symbol) arr = arr.filter((x) => x.symbol === symbol);
  return arr.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function isRemote() { return isConfigured(); }
