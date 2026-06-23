// 전체 순위를 '활발해 보이게' 시드 — 실제 검증 엔드포인트(/api/score)로 현실적 기록 등록.
// score = 완주 시간(ms, 작을수록 상위). 서버 검증(3초~1000초) 통과 값만.
const API = 'https://candlebike.vercel.app/api/score';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [
  ['질주본능',   'TSLA',       31.4],
  ['차트마스터', 'AAPL',       34.8],
  ['백플립장인', 'NVDA',       37.2],
  ['풀악셀',     '005930.KS',  39.9],
  ['라이더킹',   'AAPL',       42.5],
  ['칼바람',     '000660.KS',  45.1],
  ['도파민러',   'TSLA',       47.8],
  ['한방질주',   'QBTS',       50.3],
  ['야수의심장', 'NVDA',       53.6],
  ['변동성헌터', '373220.KS',  56.9],
  ['슈퍼바이크', 'AAPL',       60.2],
  ['칼치기',     'TSLA',       64.4],
  ['초보라이더', '005930.KS',  70.8],
  ['느긋한주행', 'NVDA',       78.1],
];

let ok = 0;
for (const [nick, symbol, t] of rows) {
  const score = Math.round(t * 1000);
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick, symbol, score }),
    });
    const j = await r.json().catch(() => ({}));
    console.log(r.status, nick, symbol, `${t}s`, j.rank ? `rank ${j.rank}/${j.total}` : JSON.stringify(j));
    if (r.ok) ok++;
  } catch (e) {
    console.log('ERR', nick, e.message);
  }
  await sleep(350);
}
console.log(`DONE ${ok}/${rows.length}`);
