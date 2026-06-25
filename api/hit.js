// 방문 비콘 — 클라(src/analytics/beacon.js)가 페이지 로드 시 1회 호출.
// POST /api/hit  { v: 방문자ID(익명 UUID), toss: bool }  → 204
// 익명 방문자ID로 일별 방문/고유방문자 집계(record_visit). PII 저장 안 함.
import { sb, supaReady, clientIp, rateLimit } from './_supa.js';

const VID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  if (!supaReady()) { res.status(204).end(); return; }   // 미설정(로컬/데모): 조용히 통과

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const vid = typeof b.v === 'string' ? b.v : '';
  if (!VID_RE.test(vid)) { res.status(204).end(); return; }
  const toss = b.toss === true;

  // 비콘 남용/비용폭탄 방지 — IP당 1시간 120회
  const rl = await rateLimit('hit', clientIp(req), 120, 3600);
  if (!rl.ok) { res.status(204).end(); return; }

  try {
    await sb('rpc/record_visit', { method: 'POST', body: { p_visitor: vid, p_toss: toss } });
  } catch { /* 집계 실패는 조용히 무시 */ }
  res.status(204).end();
}
