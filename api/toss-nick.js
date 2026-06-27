// 토스 라이트 로그인 — 닉네임을 계정(user_key) 기본값으로 저장.
// /api/auth/toss 가 발급한 서명 토큰(HMAC)을 검증해, 본인의 user_key 에만 저장(위조 차단).
// 닉 저장은 mTLS 불필요 — 토큰 검증만(가벼움).
//
// 필요한 env: TOSS_NICK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import crypto from 'node:crypto';
import { sb, supaReady } from './_supa.js';
import { checkNick } from './_moderation.js';

const NICK_SECRET = process.env.TOSS_NICK_SECRET || '';
const NICK_MAX = 6;   // 닉 최대 6자(순위표 줄바꿈 방지)

const DEBUG = process.env.TOSS_DEBUG === '1';
function verifyToken(token) {
  if (!NICK_SECRET || typeof token !== 'string' || !token.includes('.')) {
    if (DEBUG) console.log('[toss-nick] reject(pre)', { hasSecret: !!NICK_SECRET, secretLen: NICK_SECRET.length, tokType: typeof token, hasDot: typeof token === 'string' && token.includes('.') });
    return '';
  }
  const [payload, sig] = token.split('.');
  let userKey = '';
  try { userKey = Buffer.from(payload, 'base64url').toString('utf8'); } catch { return ''; }
  if (!userKey) return '';
  const expect = crypto.createHmac('sha256', NICK_SECRET).update(userKey).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    if (DEBUG) console.log('[toss-nick] reject(sig)', { secretLen: NICK_SECRET.length, userKeyLen: userKey.length, sigLen: a.length, expLen: b.length, sigPfx: String(sig || '').slice(0, 6), expPfx: expect.slice(0, 6) });
    return '';
  }
  return userKey;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!NICK_SECRET || !supaReady()) { res.status(503).json({ error: 'not configured' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  const userKey = verifyToken(String(b.token || ''));
  if (!userKey) { res.status(401).json({ error: 'bad token' }); return; }

  // 한글·영문·숫자만 허용(특수문자·이모지 제거)
  const nick = String(b.nick || '').replace(/[^0-9A-Za-z가-힣ㄱ-ㆎ]/g, '').slice(0, NICK_MAX);
  if (!nick) { res.status(400).json({ error: 'empty nick' }); return; }
  // 금지어/차단닉 거부 — 클라가 안내 후 다른 닉 입력
  try { if (!(await checkNick(nick)).ok) { res.status(400).json({ error: 'bad nick' }); return; } } catch {}

  try {
    const r = await sb('toss_users', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: { user_key: userKey, nick, updated_at: new Date().toISOString() },
    });
    if (!r.ok) { res.status(502).json({ error: 'save failed', status: r.status }); return; }
    res.status(200).json({ ok: true, nick });
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
}
