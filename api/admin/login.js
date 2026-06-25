// 어드민 로그인 — 이메일+비밀번호 검증 후 세션 토큰 발급.
// POST /api/admin/login  { email, password }  → { ok, token }
import { clientIp, rateLimit } from '../_supa.js';
import { adminConfigured, checkCredentials, issueToken } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!adminConfigured()) { res.status(503).json({ error: 'admin not configured' }); return; }

  // 브루트포스 완화 — IP당 10분 20회
  const rl = await rateLimit('adminlogin', clientIp(req), 20, 600);
  if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); res.status(429).json({ error: 'rate limited' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  if (!checkCredentials(b.email, b.password)) { res.status(401).json({ error: 'invalid credentials' }); return; }

  res.status(200).json({ ok: true, token: issueToken() });
}
