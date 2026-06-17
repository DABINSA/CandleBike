// 코스 미리 받기(워밍) — 인기 종목의 3년 차트를 서버가 미리 받아 courses 캐시에 넣어둔다.
// 최초 플레이어도 즉시 로드되도록(특히 홈 화면에서 자주 누르는 종목).
//   - Vercel Cron 이 하루 1회 호출(아래 vercel.json crons). 주간 캐시라 하루 1회면 충분.
//   - 수동 실행: GET /api/warm-courses?secret=<CRON_SECRET>
// 보호: CRON_SECRET 환경변수. Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 로 호출.
import { sb, supaReady } from './_supa.js';

const HISTORY_YEARS = 3;
// 인기 종목(시총/거래대금 상위) — 홈에서 가장 많이 눌리는 축. 필요시 가감.
const KR = [
  '005930.KS','000660.KS','373220.KS','207940.KS','005380.KS','000270.KS','068270.KS','035420.KS',
  '035720.KS','005490.KS','105560.KS','006400.KS','051910.KS','012330.KS','055550.KS','028260.KS',
  '096770.KS','012450.KS','329180.KS','034020.KS','247540.KQ','086520.KQ','196170.KQ','323410.KS',
  '259960.KS','032830.KS','066570.KS','005935.KS',
];
const US = ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO','NFLX','AMD','PLTR','COIN','INTC','JPM','V'];

function currentPeriod() {
  const mode = process.env.COURSE_UPDATE || 'week';
  const d = new Date();
  if (mode === 'month') return d.toISOString().slice(0, 7);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function fetchHistory(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const p1 = Math.floor(now - HISTORY_YEARS * 365.25 * 86400);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${now}&interval=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CandleBike/1.0)' } });
  const j = await r.json();
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error('no data');
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

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // 인증: Vercel Cron(Bearer) 또는 수동(?secret=)
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const qsecret = req.query && req.query.secret;
  if (secret && auth !== `Bearer ${secret}` && qsecret !== secret) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  if (!supaReady()) { res.status(503).json({ error: 'not configured' }); return; }

  const period = currentPeriod();
  const symbols = [...KR, ...US];

  // 이미 이번 기간에 캐시된 종목은 건너뜀
  let cached = new Set();
  try {
    const inList = symbols.map((s) => `"${s}"`).join(',');
    const r = await sb(`courses?select=symbol&period=eq.${encodeURIComponent(period)}&symbol=in.(${encodeURIComponent(inList)})`);
    if (r.ok) cached = new Set((await r.json()).map((x) => x.symbol));
  } catch { /* 조회 실패해도 전체 워밍으로 진행 */ }

  const result = { period, warmed: [], skipped: [], failed: [] };
  for (const symbol of symbols) {
    if (cached.has(symbol)) { result.skipped.push(symbol); continue; }
    try {
      const series = await fetchHistory(symbol);
      if (!series || series.length < 30) throw new Error('too short');
      const up = await sb('courses', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: { symbol, period, series, updated_at: new Date().toISOString() },
      });
      if (!up.ok) throw new Error('upsert ' + up.status);
      result.warmed.push(symbol);
    } catch (e) {
      result.failed.push({ symbol, error: String(e && e.message || e) });
    }
    await new Promise((r) => setTimeout(r, 120));   // 야후 예의상 텀
  }

  res.status(200).json({
    period, total: symbols.length,
    warmed: result.warmed.length, skipped: result.skipped.length, failed: result.failed.length,
    failedList: result.failed,
  });
}
