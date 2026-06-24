// 주식 데이터 공급자 — config의 STOCK_PROVIDER 값에 따라 분기.
// 모든 모드는 동일한 형태를 반환:
//   searchSymbols(q)  -> [{ symbol, name }]
//   getHistory(symbol)-> [{ date, close }]  (오래된 → 최신 순)

import { CONFIG } from '../config.js';
import { t, LANG } from '../i18n.js';
import { generateMockHistory, getMockTrending, MOCK_SYMBOLS } from './mockData.js';
import { searchKr, loadSymbols } from './symbols.js';

// 검색창이 뜨기 전에 한국 종목 데이터 미리 로드(첫 검색도 즉시)
loadSymbols();

// ---------------- mock ----------------
function mockSearch(q) {
  const s = q.trim();
  if (!s) return [];
  const low = s.toLowerCase();
  const out = MOCK_SYMBOLS.filter((x) => (x._s || `${x.symbol} ${x.name}`.toLowerCase()).includes(low));
  // 6자리 한국 종목코드는 목록에 없어도 바로 플레이 가능 (사실상 전 종목 커버)
  const m = s.match(/^(\d{6})(\.(KS|KQ))?$/i);
  if (m && !out.some((x) => x.symbol.startsWith(m[1]))) {
    out.unshift({ symbol: m[2] ? s.toUpperCase() : `${m[1]}.KS`, name: t.krStock(m[1]) });
  }
  return out.slice(0, 8);
}
async function mockHistory(symbol) {
  return generateMockHistory(symbol, CONFIG.HISTORY_YEARS);
}
async function mockTrending() {
  return getMockTrending();
}

// ---------------- yahoo (CORS 프록시 경유, 실데이터) ----------------
// 여러 프록시를 순서대로 시도 (자체 워커가 있으면 CONFIG.CORS_PROXY 우선)
function proxyList(url) {
  const enc = encodeURIComponent(url);
  const list = [];
  if (CONFIG.CORS_PROXY) list.push(CONFIG.CORS_PROXY + enc);
  list.push(`https://api.allorigins.win/raw?url=${enc}`);
  list.push(`https://api.codetabs.com/v1/proxy/?quest=${enc}`);
  list.push(`https://thingproxy.freeboard.io/fetch/${url}`);
  return list;
}
async function yfetch(url) {
  let lastErr;
  for (const purl of proxyList(url)) {
    try {
      const r = await fetch(purl);
      if (!r.ok) throw new Error('http ' + r.status);
      return JSON.parse(await r.text());
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all proxies failed');
}
// 미국 + 한국 거래소만 허용
const US_KR_EXCHANGES = new Set([
  'NMS', 'NGM', 'NCM', 'NYQ', 'NYS', 'ASE', 'PCX', 'BATS', 'NAS', // 미국
  'KSC', 'KOE', 'KDQ', 'KOSDAQ', 'KSE',                            // 한국
]);
function isUsOrKr(x) {
  if (/\.(KS|KQ)$/i.test(x.symbol)) return true;                   // 한국 접미사
  if (US_KR_EXCHANGES.has(x.exchange)) return true;
  return false;
}
async function yahooSearch(q) {
  const j = await yfetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`);
  return (j.quotes || [])
    .filter((x) => x.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF') && isUsOrKr(x))
    .map((x) => ({
      symbol: x.symbol,
      name: [x.shortname || x.longname || x.symbol, x.exchange].filter(Boolean).join(' · '),
    }))
    .slice(0, 8);
}
async function yahooHistory(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const p1 = Math.floor(now - CONFIG.HISTORY_YEARS * 365.25 * 86400);
  const j = await yfetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${now}&interval=1d`
  );
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error((j.chart && j.chart.error && j.chart.error.description) || '데이터 없음');
  const ts = res.timestamp || [];
  const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: +c.toFixed(2) });
  }
  return out;
}
// 미국 주요 거래소(나스닥 + 뉴욕증권거래소 = S&P 종목들이 거래되는 무대)만 추림.
// OTC/핑크시트/마이크로캡 제외 → 알 만한 종목 위주. 필터 후 너무 적으면 원본 유지(빈 목록 방지).
const US_MAJOR = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'NYS']); // NASDAQ(GS/GM/CM) + NYSE
function pickUsMajor(quotes) {
  const eq = (quotes || []).filter((x) => x.symbol && x.quoteType === 'EQUITY');
  const major = eq.filter((x) => US_MAJOR.has(x.exchange));
  return major.length >= 4 ? major : eq;   // 슬라이스는 호출부에서
}

async function yahooTrending() {
  // 실제 급등주(당일 상승률 상위) — S&P+나스닥 주요 종목, 변동률 포함
  const j = await yfetch('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=25&scrIds=day_gainers');
  const quotes = (j.finance && j.finance.result && j.finance.result[0] && j.finance.result[0].quotes) || [];
  const list = pickUsMajor(quotes).slice(0, 8).map((x) => {
    const chg = x.regularMarketChangePercent != null ? +(+x.regularMarketChangePercent).toFixed(1) : null;
    return { symbol: x.symbol, name: x.shortName || x.longName || x.symbol, change: chg, hot: (chg || 0) >= 5 };
  });
  if (!list.length) throw new Error('no gainers');
  return list;
}

// 거래대금($) 표기 압축 (2,680,000,000 → $2.7B)
function fmtUsd(v) {
  v = +v;
  if (!isFinite(v) || v <= 0) return '';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
  return '$' + Math.round(v);
}

// 미국 거래대금 상위 (Yahoo most_actives 후보 → 가격×거래량으로 거래대금 재정렬, S&P+나스닥)
async function yahooActives() {
  const j = await yfetch('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=25&scrIds=most_actives');
  const quotes = (j.finance && j.finance.result && j.finance.result[0] && j.finance.result[0].quotes) || [];
  const list = pickUsMajor(quotes)
    .map((x) => {
      const chg = x.regularMarketChangePercent != null ? +(+x.regularMarketChangePercent).toFixed(1) : null;
      const val = (+x.regularMarketPrice || 0) * (+x.regularMarketVolume || 0);   // 거래대금 = 가격×거래량
      return { symbol: x.symbol, name: x.shortName || x.longName || x.symbol, change: chg, hot: false, volText: fmtUsd(val), _val: val };
    })
    .sort((a, b) => b._val - a._val)
    .slice(0, 8)
    .map(({ _val, ...x }) => x);
  if (!list.length) throw new Error('no actives');
  return list;
}

// 현재 '열린 장' 판별 (UTC 기준). 한국장 열리면 kr, 미국장(프리/애프터 포함) 열리면 us.
export function activeMarket() {
  const now = new Date();
  const day = now.getUTCDay();                      // 0 일 ~ 6 토
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const weekday = day >= 1 && day <= 5;
  // 한국장: 09:00–15:30 KST = 00:00–06:30 UTC
  const krOpen = weekday && h >= 0 && h < 6.5;
  // 미국장: 정규장(09:30–16:00 ET)뿐 아니라 프리마켓(04:00 ET)·애프터마켓(~20:00 ET)까지 포함.
  //   EDT 기준 대략 08:00–24:00 UTC(프리 17:00 KST ~ 애프터 익09:00 KST). DST 근사.
  const usOpen = weekday && h >= 8 && h < 24;
  if (usOpen) return 'us';   // 미국 확장장(프리/정규/애프터)이 열려있으면 우선
  if (krOpen) return 'kr';
  // 둘 다 닫힘(주말/장외 공백): 접속 지역 기준 — 한국어 사용자는 한국, 그 외는 미국
  return LANG === 'ko' ? 'kr' : 'us';
}

// 한국 실시간 급등주/거래량 (네이버 금융, 동일 도메인 /api/kr-gainers)
async function krGainers() {
  const r = await fetch('/api/kr-gainers');
  if (!r.ok) throw new Error('kr http ' + r.status);
  return await r.json();
}
async function krVolume() {
  const r = await fetch('/api/kr-gainers?type=volume');
  if (!r.ok) throw new Error('kr vol ' + r.status);
  return await r.json();
}

// 열린 장 + 모드(급등주/거래량)에 맞춰 선택 (실패 시 반대 장으로 폴백)
async function marketTrending(mode = 'gainers') {
  const m = activeMarket();
  const us = mode === 'volume' ? yahooActives : yahooTrending;
  const kr = mode === 'volume' ? krVolume : krGainers;
  const primary = m === 'kr' ? kr : us;
  const secondary = m === 'kr' ? us : kr;
  try { const a = await primary(); if (a && a.length) return a.slice(0, 8); }
  catch (e) { console.warn('primary trending 실패', e); }
  try { const b = await secondary(); if (b && b.length) return b.slice(0, 8); }
  catch (e) { console.warn('secondary trending 실패', e); }
  throw new Error('no trending');
}

// ---------------- twelvedata ----------------
async function tdSearch(q) {
  const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}&outputsize=8`;
  const r = await fetch(url);
  const j = await r.json();
  return (j.data || []).map((x) => ({
    symbol: x.symbol,
    name: `${x.instrument_name} · ${x.exchange}`,
  }));
}
async function tdTrending() {
  // Twelve Data market_movers (플랜에 따라 제한될 수 있음) → 실패 시 mock으로 폴백
  const url = `https://api.twelvedata.com/market_movers/stocks?outputsize=8&apikey=${CONFIG.TWELVEDATA_KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status === 'error' || !Array.isArray(j.values)) throw new Error('no movers');
  return j.values.map((v) => ({
    symbol: v.symbol,
    name: v.name || v.symbol,
    change: parseFloat(v.percent_change),
    volume: v.volume ? +(v.volume / 1e8).toFixed(1) : null,
    hot: Math.abs(parseFloat(v.percent_change)) > 5,
  }));
}
async function tdHistory(symbol) {
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=1day&outputsize=${Math.round(CONFIG.HISTORY_YEARS * 252)}&order=ASC&apikey=${CONFIG.TWELVEDATA_KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status === 'error') throw new Error(j.message || 'twelvedata error');
  return (j.values || []).map((v) => ({ date: v.datetime, close: parseFloat(v.close) }));
}

// ---------------- proxy ----------------
async function proxySearch(q) {
  const r = await fetch(`${CONFIG.PROXY_BASE}/search?q=${encodeURIComponent(q)}`);
  return await r.json();
}
async function proxyHistory(symbol) {
  const r = await fetch(`${CONFIG.PROXY_BASE}/history?symbol=${encodeURIComponent(symbol)}&years=${CONFIG.HISTORY_YEARS}`);
  return await r.json();
}
async function proxyTrending() {
  const r = await fetch(`${CONFIG.PROXY_BASE}/trending`);
  return await r.json();
}

const PROVIDERS = {
  yahoo: { search: yahooSearch, history: yahooHistory, trending: marketTrending, label: '야후 파이낸스 실데이터' },
  mock: { search: async (q) => mockSearch(q), history: mockHistory, trending: mockTrending, label: '데모 데이터(오프라인) 모드' },
  twelvedata: { search: tdSearch, history: tdHistory, trending: tdTrending, label: 'Twelve Data 실시간 모드' },
  proxy: { search: proxySearch, history: proxyHistory, trending: proxyTrending, label: '프록시 서버 모드' },
};

export function getProvider() {
  return PROVIDERS[CONFIG.STOCK_PROVIDER] || PROVIDERS.mock;
}

export async function searchSymbols(q) {
  // 1) 한국 전 종목 로컬 즉시 검색(코드/한글명) — 네트워크 없이 바로 결과
  try {
    const kr = await searchKr(q);
    if (kr.length) return kr;
  } catch (e) { /* 데이터 미로드 등 → 공급자 검색으로 폴백 */ }

  // 2) 폴백: 공급자(야후 등) 검색 — 미국/해외 영문 종목 등
  try {
    return await getProvider().search(q);
  } catch (e) {
    console.warn('search 실패, mock으로 대체', e);
    return mockSearch(q);
  }
}

export async function getHistory(symbol) {
  const data = await getProvider().history(symbol);
  if (!data || data.length < 30) throw new Error('차트 데이터가 부족합니다.');
  return data;
}

export async function getTrending(mode = 'gainers') {
  try {
    const list = await getProvider().trending(mode);
    if (list && list.length) return list;
  } catch (e) {
    console.warn('trending 실패, mock으로 대체', e);
  }
  return getMockTrending();
}
