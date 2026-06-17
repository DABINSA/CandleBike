// Vercel 서버리스 함수 — 야후 파이낸스 동일 도메인 프록시 (CORS 없음, 안정적)
// 클라이언트: fetch('/api/yahoo?url=' + encodeURIComponent(yahooUrl))
// 야후 도메인만 허용(오픈 프록시 남용 방지) + IP 레이트리밋.
import { clientIp, rateLimit } from './_supa.js';

export default async function handler(req, res) {
  const target = req.query.url;
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!target || !/^https:\/\/[a-z0-9.-]*\.yahoo\.com\//i.test(target)) {
    res.status(400).json({ error: 'bad url' });
    return;
  }

  // 오픈 프록시 남용 방지 — IP당 1분에 120회 (엣지 캐시 뒤라 함수는 캐시미스에만 실행)
  const rl = await rateLimit('yahoo', clientIp(req), 120, 60);
  if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); res.status(429).json({ error: 'rate limited' }); return; }
  try {
    const r = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CandleBike/1.0)' },
    });
    const body = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 엣지 캐시: 1시간 신선, 하루까지 stale 허용 → 야후 호출 최소화
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
