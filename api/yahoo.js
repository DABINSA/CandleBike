// Vercel 서버리스 함수 — 야후 파이낸스 동일 도메인 프록시 (CORS 없음, 안정적)
// 클라이언트: fetch('/api/yahoo?url=' + encodeURIComponent(yahooUrl))
export default async function handler(req, res) {
  const target = req.query.url;
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!target || !/^https:\/\/[a-z0-9.-]*\.yahoo\.com\//i.test(target)) {
    res.status(400).json({ error: 'bad url' });
    return;
  }
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
