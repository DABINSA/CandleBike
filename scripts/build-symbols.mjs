// 한국 전 종목(KOSPI+KOSDAQ) 코드+한글명을 네이버에서 받아 정적 JSON 으로 생성.
//   node scripts/build-symbols.mjs   → assets/symbols-kr.json
// 종목 코드는 거의 바뀌지 않으므로 가끔(상장/폐지 시) 다시 돌려 커밋하면 됩니다.
import { writeFile, mkdir } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15';
const HDR = { 'User-Agent': UA, Referer: 'https://m.stock.naver.com/' };
const PAGE = 100;

async function fetchMarket(cat) {
  const out = [];
  for (let page = 1; page <= 60; page++) {
    const url = `https://m.stock.naver.com/api/stocks/marketValue/${cat}?page=${page}&pageSize=${PAGE}`;
    const r = await fetch(url, { headers: HDR });
    if (!r.ok) throw new Error(`${cat} p${page} http ${r.status}`);
    const j = await r.json();
    const stocks = j.stocks || [];
    if (!stocks.length) break;
    for (const s of stocks) {
      const code = s.itemCode;
      const suffix = (s.stockExchangeType && s.stockExchangeType.code) || (cat === 'KOSDAQ' ? 'KQ' : 'KS');
      if (!/^\d{6}$/.test(code)) continue;        // 일반 종목코드만(ETN/선물 등 제외)
      out.push({ s: `${code}.${suffix}`, n: s.stockName });
    }
    if (stocks.length < PAGE) break;
    await new Promise((r) => setTimeout(r, 120));  // 예의상 약간 텀
  }
  return out;
}

const [kospi, kosdaq] = await Promise.all([fetchMarket('KOSPI'), fetchMarket('KOSDAQ')]);
// 중복 제거(코드 기준). 배열 순서 = 시가총액 순(KOSPI→KOSDAQ) → 검색 동점시 대표주 우선.
const map = new Map();
for (const x of [...kospi, ...kosdaq]) if (!map.has(x.s)) map.set(x.s, x);
const list = [...map.values()];

await mkdir('assets', { recursive: true });
await writeFile('assets/symbols-kr.json', JSON.stringify(list));
console.log(`KOSPI ${kospi.length} + KOSDAQ ${kosdaq.length} → unique ${list.length} 종목 저장 (assets/symbols-kr.json)`);
