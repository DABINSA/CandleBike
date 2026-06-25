// 어드민 통계 — 비밀 토큰 게이트. service_role 은 서버에만, 클라엔 절대 노출 안 함.
// GET/POST /api/admin/stats   헤더: Authorization: Bearer <ADMIN_TOKEN>  → 집계 JSON
//
// 필요한 Vercel 환경변수:
//   ADMIN_TOKEN  = 충분히 긴 임의 시크릿(예: openssl rand -base64 32)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (집계 조회)
// 미설정 시 503(fail-closed). 선행: db/admin.sql 실행.
import crypto from 'node:crypto';
import { sb, supaReady, clientIp, rateLimit } from '../_supa.js';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// 길이 노출 없이 상수시간 비교(타이밍 공격 완화)
function tokenOk(provided) {
  if (!ADMIN_TOKEN || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(ADMIN_TOKEN);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!supaReady())   { res.status(503).json({ error: 'not configured' }); return; }
  if (!ADMIN_TOKEN)   { res.status(503).json({ error: 'admin not configured' }); return; }

  // 브루트포스 완화 — IP당 10분 30회
  const rl = await rateLimit('admin', clientIp(req), 30, 600);
  if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); res.status(429).json({ error: 'rate limited' }); return; }

  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const provided = bearer || req.headers['x-admin-token'] || '';
  if (!tokenOk(provided)) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    const r = await sb('rpc/admin_stats', { method: 'POST', body: {} });
    if (!r.ok) { res.status(502).json({ error: 'rpc failed', status: r.status }); return; }
    res.status(200).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
