// Vercel 서버리스 — 미국 급등주/거래대금 상위 (Yahoo screener).
//   ?type=volume → 거래대금 상위(most_actives 재정렬), 그 외 → 급등주(day_gainers).
// 서버에서 한 번 받아 '엣지 캐시'로 전 유저가 공유 → 유저가 많아도 Yahoo 호출은 캐시 창당 1회.
// (브라우저 직접호출은 CORS로 막혀 프록시가 필요했지만, 서버는 직접 호출 가능. 실패 시 공개 프록시 폴백)
const US_MAJOR = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'NYS']);   // NASDAQ(GS/GM/CM) + NYSE
function fmtUsd(v) {
  v = +v;
  if (!isFinite(v) || v <= 0) return '';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
  return '$' + Math.round(v);
}
function pickUsMajor(quotes) {
  const eq = (quotes || []).filter((x) => x.symbol && x.quoteType === 'EQUITY');
  const major = eq.filter((x) => US_MAJOR.has(x.exchange));
  return major.length >= 4 ? major : eq;
}
// 서버 직접호출 → 실패하면 공개 프록시 순차 폴백. 각 시도 6초 타임아웃.
async function yget(url) {
  const enc = encodeURIComponent(url);
  const tries = [
    url,
    `https://api.allorigins.win/raw?url=${enc}`,
    `https://api.codetabs.com/v1/proxy/?quest=${enc}`,
  ];
  let lastErr;
  for (const u of tries) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
      if (!r.ok) throw new Error('http ' + r.status);
      return JSON.parse(await r.text());
    } catch (e) { lastErr = e; } finally { clearTimeout(to); }
  }
  throw lastErr || new Error('all sources failed');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const isVol = req.query && req.query.type === 'volume';
  const scr = isVol ? 'most_actives' : 'day_gainers';
  try {
    const j = await yget(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=25&scrIds=${scr}`);
    const quotes = (j.finance && j.finance.result && j.finance.result[0] && j.finance.result[0].quotes) || [];
    let list;
    if (isVol) {
      list = pickUsMajor(quotes).map((x) => {
        const chg = x.regularMarketChangePercent != null ? +(+x.regularMarketChangePercent).toFixed(1) : null;
        const val = (+x.regularMarketPrice || 0) * (+x.regularMarketVolume || 0);   // 거래대금 = 가격×거래량
        return { symbol: x.symbol, name: x.shortName || x.longName || x.symbol, change: chg, hot: false, volText: fmtUsd(val), _val: val };
      }).sort((a, b) => b._val - a._val).slice(0, 8).map(({ _val, ...x }) => x);
    } else {
      list = pickUsMajor(quotes).slice(0, 8).map((x) => {
        const chg = x.regularMarketChangePercent != null ? +(+x.regularMarketChangePercent).toFixed(1) : null;
        return { symbol: x.symbol, name: x.shortName || x.longName || x.symbol, change: chg, hot: (chg || 0) >= 5 };
      });
    }
    if (!list.length) throw new Error('empty');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 엣지 캐시: 30분 신선 + 1일간 stale-while-revalidate(만료 후에도 즉시 옛값 주고 뒤에서 갱신)
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.status(200).json(list);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
