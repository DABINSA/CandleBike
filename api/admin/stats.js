// 어드민 통계 — 세션 토큰 게이트(로그인은 /api/admin/login). service_role 은 서버 전용.
// GET/POST /api/admin/stats   헤더: Authorization: Bearer <세션토큰>  → 집계 JSON
//
// 필요한 Vercel 환경변수: ADMIN_PASSWORD(+선택 ADMIN_EMAIL), SUPABASE_URL/SERVICE_ROLE_KEY.
// 미설정 시 503(fail-closed). 선행: db/admin.sql 실행.
import { sb, supaReady, clientIp, rateLimit } from '../_supa.js';
import { adminConfigured, verifyToken } from './_auth.js';

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

  try {
    const r = await sb('rpc/admin_stats', { method: 'POST', body: {} });
    if (!r.ok) { res.status(502).json({ error: 'rpc failed', status: r.status }); return; }
    res.status(200).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
