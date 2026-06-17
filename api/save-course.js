// 코스 캐시 저장 (서버 검증 + 레이트리밋) — 클라 anon 직접 upsert 금지, 이 라우트만 사용.
// POST /api/save-course  { symbol, period, series:[{date,close}] }  → { ok: true }
//
// 누구나 임의 종목 차트를 덮어쓰는 캐시 오염 / 대용량 jsonb 비용폭탄을 차단.
import { sb, supaReady, clientIp, rateLimit } from './_supa.js';

const SYMBOL_RE = /^[A-Z0-9.\-]{1,15}$/;
const PERIOD_RE = /^\d{4}-(W\d{2}|\d{2})$/;        // 2026-W24 또는 2026-06
const MAX_POINTS = 2000;                           // 3년 일봉 ≈ 750. 넉넉히 상한.

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!supaReady()) { res.status(503).json({ error: 'not configured' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  const symbol = typeof b.symbol === 'string' ? b.symbol.trim().toUpperCase() : '';
  if (!SYMBOL_RE.test(symbol)) { res.status(400).json({ error: 'bad symbol' }); return; }

  const period = typeof b.period === 'string' ? b.period.trim() : '';
  if (!PERIOD_RE.test(period)) { res.status(400).json({ error: 'bad period' }); return; }

  // ---- series 형식/크기 검증 ----
  const raw = Array.isArray(b.series) ? b.series : null;
  if (!raw || raw.length < 30 || raw.length > MAX_POINTS) { res.status(400).json({ error: 'bad series' }); return; }
  const series = [];
  for (const p of raw) {
    if (!p || typeof p.date !== 'string' || p.date.length > 10) { res.status(400).json({ error: 'bad point' }); return; }
    const close = Number(p.close);
    if (!Number.isFinite(close)) { res.status(400).json({ error: 'bad point' }); return; }
    series.push({ date: p.date, close });
  }

  // ---- 레이트리밋 (IP당 1시간에 60회) ----
  const ip = clientIp(req);
  const rl = await rateLimit('course', ip, 60, 3600);
  if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); res.status(429).json({ error: 'rate limited' }); return; }

  try {
    const r = await sb('courses', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: { symbol, period, series, updated_at: new Date().toISOString() },
    });
    if (!r.ok) { res.status(502).json({ error: 'upsert failed' }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
