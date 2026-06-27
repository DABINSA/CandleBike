// 어드민 통계 — 세션 토큰 게이트(로그인은 /api/admin/login). service_role 은 서버 전용.
// GET/POST /api/admin/stats   헤더: Authorization: Bearer <세션토큰>  → 집계 JSON
//
// 필요한 Vercel 환경변수: ADMIN_PASSWORD(+선택 ADMIN_EMAIL), SUPABASE_URL/SERVICE_ROLE_KEY.
// 미설정 시 503(fail-closed). 선행: db/admin.sql 실행.
import { sb, supaReady, clientIp, rateLimit } from '../_supa.js';
import { adminConfigured, verifyToken } from './_auth.js';
import { normalize } from '../_moderation.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!supaReady())       { res.status(503).json({ error: 'not configured' }); return; }
  if (!adminConfigured()) { res.status(503).json({ error: 'admin not configured' }); return; }

  // 브루트포스 완화 — IP당 10분 30회
  const rl = await rateLimit('admin', clientIp(req), 30, 600);
  if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); res.status(429).json({ error: 'rate limited' }); return; }

  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!verifyToken(bearer)) { res.status(401).json({ error: 'unauthorized' }); return; }

  // 금지어 추가/삭제 — POST { wordAction: 'add'|'del', word } (별도 함수 대신 여기서 처리)
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  if (body.wordAction) {
    const word = normalize(body.word);
    if (!word || word.length > 40) { res.status(400).json({ error: 'bad word' }); return; }
    try {
      if (body.wordAction === 'del') {
        const r = await sb(`banned_words?word=eq.${encodeURIComponent(word)}`, { method: 'DELETE' });
        if (!r.ok) { res.status(502).json({ error: 'del failed' }); return; }
      } else {
        const r = await sb('banned_words', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { word } });
        if (!r.ok) { res.status(502).json({ error: 'add failed' }); return; }
      }
      res.status(200).json({ ok: true });
    } catch (e) { res.status(502).json({ error: String(e) }); }
    return;
  }

  // 닉 차단 — ban_nick RPC(차단등록 + 기록을 익명의라이더로 덮어쓰기)
  if (body.banNick) {
    const nick = String(body.banNick).trim().slice(0, 40);
    if (!nick) { res.status(400).json({ error: 'bad nick' }); return; }
    try {
      const r = await sb('rpc/ban_nick', { method: 'POST', body: { p_nick: nick } });
      if (!r.ok) { res.status(502).json({ error: 'ban failed', status: r.status }); return; }
      res.status(200).json({ ok: true });
    } catch (e) { res.status(502).json({ error: String(e) }); }
    return;
  }
  // 닉 차단 해제 — 목록에서만 제거(이미 익명처리된 기록은 복원 안 됨)
  if (body.unbanNick) {
    const nick = String(body.unbanNick).trim().slice(0, 40);
    try {
      const r = await sb(`nick_bans?nick=eq.${encodeURIComponent(nick)}`, { method: 'DELETE' });
      if (!r.ok) { res.status(502).json({ error: 'unban failed' }); return; }
      res.status(200).json({ ok: true });
    } catch (e) { res.status(502).json({ error: String(e) }); }
    return;
  }

  try {
    const r = await sb('rpc/admin_stats', { method: 'POST', body: {} });
    if (!r.ok) { res.status(502).json({ error: 'rpc failed', status: r.status }); return; }
    const data = await r.json();
    // 금지어 + 차단닉 목록도 함께 반환(어드민 UI가 별도 호출 없이 표시)
    try {
      const wr = await sb('banned_words?select=word&order=word.asc');
      if (wr.ok) data.banned_words = (await wr.json()).map((x) => x.word);
    } catch {}
    try {
      const nr = await sb('nick_bans?select=nick&order=created_at.desc');
      if (nr.ok) data.nick_bans = (await nr.json()).map((x) => x.nick);
    } catch {}
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
