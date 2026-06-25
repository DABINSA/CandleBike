// 아이템 인벤토리 — 계정(토스 user_key) 귀속 저장/조회. 게스트는 호출 안 함(localStorage).
// /api/auth/toss 가 발급한 서명 토큰(HMAC)을 검증해 본인 인벤토리에만 접근.
//   POST { token }            → { data }           (조회)
//   POST { token, data:{...} } → { ok:true }        (저장: upsert)
// 필요한 env: TOSS_NICK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import crypto from 'node:crypto';
import { sb, supaReady } from './_supa.js';

const NICK_SECRET = process.env.TOSS_NICK_SECRET || '';

function verifyToken(token) {
  if (!NICK_SECRET || typeof token !== 'string' || !token.includes('.')) return '';
  const [payload, sig] = token.split('.');
  let userKey = '';
  try { userKey = Buffer.from(payload, 'base64url').toString('utf8'); } catch { return ''; }
  if (!userKey) return '';
  const expect = crypto.createHmac('sha256', NICK_SECRET).update(userKey).digest('base64url');
  const a = Buffer.from(sig || ''); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return '';
  return userKey;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!NICK_SECRET || !supaReady()) { res.status(503).json({ error: 'not configured' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  const userKey = verifyToken(String(b.token || ''));
  if (!userKey) { res.status(401).json({ error: 'bad token' }); return; }
  const owner = `toss:${userKey}`;

  try {
    if (b.data && typeof b.data === 'object') {
      // 저장 — 크기 상한(비용폭탄 방지)
      const json = JSON.stringify(b.data);
      if (json.length > 8000) { res.status(400).json({ error: 'too big' }); return; }
      const r = await sb('inventory', {
        method: 'POST', prefer: 'resolution=merge-duplicates',
        body: { owner, data: b.data, updated_at: new Date().toISOString() },
      });
      if (!r.ok) { res.status(502).json({ error: 'save failed', status: r.status }); return; }
      res.status(200).json({ ok: true });
    } else {
      // 조회
      const r = await sb(`inventory?owner=eq.${encodeURIComponent(owner)}&select=data`);
      const rows = r.ok ? await r.json() : [];
      res.status(200).json({ data: rows[0]?.data || {} });
    }
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
}
