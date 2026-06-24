// Vercel 서버리스 — 한국 실시간 급등주/거래량 상위 (네이버 금융 모바일 API, KOSPI+KOSDAQ)
//   ?type=volume → 거래량 상위(quantTop), 그 외 → 상승률 상위(up).
// 장중엔 실시간, 장 마감 후엔 당일 최종값. 동일 도메인이라 CORS 없음.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const isVol = req.query && req.query.type === 'volume';
  const sort = isVol ? 'quantTop' : 'up';
  const hdr = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    Referer: 'https://m.stock.naver.com/',
  };
  async function market(cat) {
    const r = await fetch(`https://m.stock.naver.com/api/stocks/${sort}/${cat}?page=1&pageSize=12`, { headers: hdr });
    const j = await r.json();
    return (j.stocks || [])
      .filter((s) => !isVol || s.stockEndType === 'stock')   // 거래량 탭은 ETF/ETN 제외, 실제 종목만
      .map((s) => {
      const chg = parseFloat(s.fluctuationsRatio);
      return {
        symbol: s.itemCode + (s.sosok === '1' ? '.KQ' : '.KS'),
        name: s.stockName,
        change: isFinite(chg) ? chg : null,
        hot: isFinite(chg) && chg >= 10,
        volText: s.accumulatedTradingValueKrwHangeul || null,  // 거래대금 텍스트(예: "27.1억원")
        _v: +(s.accumulatedTradingValueRaw || 0),
      };
    });
  }
  try {
    const [kospi, kosdaq] = await Promise.all([market('KOSPI'), market('KOSDAQ')]);
    let all = [...kospi, ...kosdaq];
    if (isVol) all = all.sort((a, b) => b._v - a._v).slice(0, 12);
    else all = all.filter((x) => x.change != null).sort((a, b) => b.change - a.change).slice(0, 12);
    all = all.map(({ _v, ...x }) => x);   // 내부 정렬키 제거
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=300');
    res.status(200).json(all);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
