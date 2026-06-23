// Vercel 서버리스 함수 — 야후 파이낸스 동일 도메인 프록시 (CORS 없음, 안정적)
// 클라이언트: fetch('/api/yahoo?url=' + encodeURIComponent(yahooUrl))
// 야후 도메인만 허용(오픈 프록시 남용 방지) + IP 레이트리밋.
//
// 🔴 안정성: 야후는 클라우드 IP에 간헐적으로 429/빈응답을 준다. 그래서
//   - 성공 응답만 엣지 캐시(s-maxage)에 넣고, 실패는 절대 캐시하지 않는다(실패 1시간 박힘 방지).
//   - query1↔query2 호스트를 번갈아 재시도(브라우저 UA + 타임아웃).
import { clientIp, rateLimit } from './_supa.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 응답이 '진짜 데이터'인지 — 2xx + JSON 형태 + 야후 에러객체가 아님
function looksOk(status, body) {
  if (status < 200 || status >= 300) return false;
  const b = (body || '').trim();
  if (b.length < 2 || (b[0] !== '{' && b[0] !== '[')) return false;
  // 야후가 200으로 주는 에러 케이스 걸러내기 (chart.error / 빈 result)
  if (/"error"\s*:\s*\{[^}]*"code"/.test(b)) return false;
  return true;
}

async function fetchOnce(url, ms = 6000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    const body = await r.text();
    return { status: r.status, body };
  } finally { clearTimeout(to); }
}

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

  // query1 → query2 호스트로 번갈아 재시도(같은 경로). 둘 다 야후 도메인이라 SSRF 허용범위 유지.
  const alt = target.replace('://query1.', '://query2.');
  const attempts = target.includes('://query1.') ? [target, alt, target] : [target];

  let last = { status: 502, body: '{"error":"upstream"}' };
  for (const url of attempts) {
    try {
      const r = await fetchOnce(url);
      last = r;
      if (looksOk(r.status, r.body)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        // ✅ 성공만 캐시: 1시간 신선 + 하루 stale 허용 → 야후 호출 최소화
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        res.status(200).send(r.body);
        return;
      }
    } catch (e) { last = { status: 502, body: `{"error":${JSON.stringify(String(e))}}` }; }
  }

  // 🔴 실패는 캐시 금지 — 다음 요청이 새로 시도하도록(실패가 굳지 않게)
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 2xx인데 데이터가 아니면(야후 200-에러) 클라가 다음 폴백 프록시를 쓰도록 502로 내린다.
  const code = (last.status >= 400 && last.status < 600) ? last.status : 502;
  res.status(code).send(last.body);
}
