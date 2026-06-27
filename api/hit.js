// 방문 비콘 — 클라(src/analytics/beacon.js)가 페이지 로드 시 1회 호출.
// POST /api/hit  { v: 방문자ID(익명 UUID), toss: bool }  → 204
// 익명 방문자ID로 일별 방문/고유방문자 집계(record_visit). PII 저장 안 함.
// record_visit 가 '신규 유저(전체 첫 방문)' 면 true 반환 → 텔레그램 실시간 핑(초반 성장 모니터).
import { sb, supaReady, clientIp, rateLimit } from './_supa.js';
import { tgNotify, kstNow } from './_telegram.js';

const VID_RE = /^[A-Za-z0-9._-]{1,64}$/;

// 신규 유저(전체 첫 방문) 텔레그램 핑 — 제목 bold + 빈 줄.
function notifyNewUser(toss) {
  return tgNotify(`🎉 <b>캔들라이더 신규 유저</b>\n\n· 경로: ${toss ? '토스 인앱' : '웹'}\n· 시각: ${kstNow()}`);
}

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
    const r = await sb('rpc/record_visit', { method: 'POST', body: { p_visitor: vid, p_toss: toss } });
    if (r.ok) {
      const isNew = (await r.json()) === true;   // 전체 기간 첫 방문 = 신규 유저
      if (isNew) await notifyNewUser(toss);
    }
  } catch { /* 집계/알림 실패는 조용히 무시 */ }
  res.status(204).end();
}
