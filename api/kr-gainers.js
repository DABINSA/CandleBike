// Vercel 서버리스 — 한국 실시간 급등주 (네이버 금융 모바일 API, KOSPI+KOSDAQ 상승률 상위)
// 장중엔 실시간, 장 마감 후엔 당일 최종 급등주. 동일 도메인이라 CORS 없음.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const hdr = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    Referer: 'https://m.stock.naver.com/',
  };
  async function market(cat) {
    const r = await fetch(`https://m.stock.naver.com/api/stocks/up/${cat}?page=1&pageSize=12`, { headers: hdr });
    const j = await r.json();
    return (j.stocks || []).map((s) => {
      const chg = parseFloat(s.fluctuationsRatio);
      return {
        symbol: s.itemCode + (s.sosok === '1' ? '.KQ' : '.KS'),
        name: s.stockName,
        change: isFinite(chg) ? chg : null,
        hot: isFinite(chg) && chg >= 10,
      };
    });
  }
  try {
    const [kospi, kosdaq] = await Promise.all([market('KOSPI'), market('KOSDAQ')]);
    const all = [...kospi, ...kosdaq]
      .filter((x) => x.change != null)
      .sort((a, b) => b.change - a.change)
      .slice(0, 12);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=300');
    res.status(200).json(all);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
