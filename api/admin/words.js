// 어드민 — 닉네임 금지어 목록 관리. 세션 토큰 게이트(로그인은 /api/admin/login).
//   GET    /api/admin/words                 → { words: [...] }
//   POST   /api/admin/words { word }         → 추가
//   POST   /api/admin/words { word, remove } → 삭제
// 헤더: Authorization: Bearer <세션토큰>. 선행: db/moderation.sql.
import { sb, supaReady, clientIp, rateLimit } from '../_supa.js';
import { adminConfigured, verifyToken } from './_auth.js';
import { normalize } from '../_moderation.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!supaReady())       { res.status(503).json({ error: 'not configured' }); return; }
  if (!adminConfigured()) { res.status(503).json({ error: 'admin not configured' }); return; }

  const rl = await rateLimit('admin', clientIp(req), 60, 600);
  if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); res.status(429).json({ error: 'rate limited' }); return; }

  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!verifyToken(bearer)) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    if (req.method === 'GET') {
      const r = await sb('banned_words?select=word&order=word.asc');
      const rows = r.ok ? await r.json() : [];
      res.status(200).json({ words: rows.map((x) => x.word) });
      return;
    }
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
      b = b || {};
      // 저장은 정규화(소문자/공백·기호 제거)해서 — 검사 로직과 동일 기준
      const word = normalize(b.word);
      if (!word || word.length > 40) { res.status(400).json({ error: 'bad word' }); return; }
      if (b.remove) {
        const r = await sb(`banned_words?word=eq.${encodeURIComponent(word)}`, { method: 'DELETE' });
        if (!r.ok) { res.status(502).json({ error: 'del failed' }); return; }
      } else {
        const r = await sb('banned_words', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { word } });
        if (!r.ok) { res.status(502).json({ error: 'add failed' }); return; }
      }
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'method' });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
