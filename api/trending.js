// Vercel 서버리스 — 추천 종목(급등주/거래대금) 한국+미국 통합 1개 함수(함수 수 절약).
//   ?market=kr → 네이버 금융(KOSPI+KOSDAQ), ?market=us → 야후 screener.
//   ?type=volume → 거래대금 상위, 그 외 → 급등(상승률) 상위.
// 서버에서 한 번 받아 '엣지 캐시'로 전 유저가 공유 → 유저가 많아도 업스트림 호출은 캐시 창당 1회.

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
async function withTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(to); }
}
// 야후: 서버 직접호출 → 실패하면 공개 프록시 폴백
async function yget(url) {
  const enc = encodeURIComponent(url);
  for (const u of [url, `https://api.allorigins.win/raw?url=${enc}`, `https://api.codetabs.com/v1/proxy/?quest=${enc}`]) {
    try {
      const r = await withTimeout(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 6000);
      if (!r.ok) throw new Error('http ' + r.status);
      return JSON.parse(await r.text());
    } catch (e) { /* 다음 소스 */ }
  }
  throw new Error('yahoo all sources failed');
}

// ── 미국(야후) ──
async function usTrending(isVol) {
  const scr = isVol ? 'most_actives' : 'day_gainers';
  const j = await yget(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=25&scrIds=${scr}`);
  const quotes = (j.finance && j.finance.result && j.finance.result[0] && j.finance.result[0].quotes) || [];
  if (isVol) {
    return pickUsMajor(quotes).map((x) => {
      const chg = x.regularMarketChangePercent != null ? +(+x.regularMarketChangePercent).toFixed(1) : null;
      const val = (+x.regularMarketPrice || 0) * (+x.regularMarketVolume || 0);
      return { symbol: x.symbol, name: x.shortName || x.longName || x.symbol, change: chg, hot: false, volText: fmtUsd(val), _val: val };
    }).sort((a, b) => b._val - a._val).slice(0, 8).map(({ _val, ...x }) => x);
  }
  return pickUsMajor(quotes).slice(0, 8).map((x) => {
    const chg = x.regularMarketChangePercent != null ? +(+x.regularMarketChangePercent).toFixed(1) : null;
    return { symbol: x.symbol, name: x.shortName || x.longName || x.symbol, change: chg, hot: (chg || 0) >= 5 };
  });
}

// ── 한국(네이버) ──
async function krTrending(isVol) {
  const sort = isVol ? 'quantTop' : 'up';
  const hdr = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    Referer: 'https://m.stock.naver.com/',
  };
  async function market(cat) {
    const r = await withTimeout(`https://m.stock.naver.com/api/stocks/${sort}/${cat}?page=1&pageSize=12`, { headers: hdr }, 6000);
    const j = await r.json();
    return (j.stocks || [])
      .filter((s) => !isVol || s.stockEndType === 'stock')
      .map((s) => {
        const chg = parseFloat(s.fluctuationsRatio);
        return {
          symbol: s.itemCode + (s.sosok === '1' ? '.KQ' : '.KS'),
          name: s.stockName,
          change: isFinite(chg) ? chg : null,
          hot: isFinite(chg) && chg >= 10,
          volText: s.accumulatedTradingValueKrwHangeul || null,
          _v: +(s.accumulatedTradingValueRaw || 0),
        };
      });
  }
  const [kospi, kosdaq] = await Promise.all([market('KOSPI'), market('KOSDAQ')]);
  let all = [...kospi, ...kosdaq];
  if (isVol) all = all.sort((a, b) => b._v - a._v).slice(0, 12);
  else all = all.filter((x) => x.change != null).sort((a, b) => b.change - a.change).slice(0, 12);
  return all.map(({ _v, ...x }) => x);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  const isVol = q.type === 'volume';
  const isUs = q.market === 'us';
  try {
    const list = isUs ? await usTrending(isVol) : await krTrending(isVol);
    if (!list || !list.length) throw new Error('empty');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 엣지 캐시: 30분 신선 + 1일 stale-while-revalidate
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.status(200).json(list);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
