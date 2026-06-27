// 닉네임 사용 가능 여부 검사(공개) — 클라가 닉 저장/진입 시 호출.
// POST /api/nick-check { nick }  → { ok: boolean, reason? }
// 서버가 최종 권위(클라 우회 대비). 미설정/오류 시엔 ok:true 로 통과(점수/토스닉 라우트가 백스톱).
import { checkNick } from './_moderation.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const nick = String(b.nick || '').trim();
  if (!nick) { res.status(200).json({ ok: false, reason: 'empty' }); return; }

  try {
    res.status(200).json(await checkNick(nick));
  } catch (e) {
    // 검사 인프라 장애가 닉 저장을 막지 않게 — 통과(점수/토스닉이 백스톱)
    console.warn('[nick-check]', e);
    res.status(200).json({ ok: true });
  }
}
