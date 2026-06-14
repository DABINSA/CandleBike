import { LANG } from '../i18n.js';

// 실제 같은 3년치 일봉 데이터를 결정적(seed)으로 생성.
// 같은 심볼은 항상 같은 차트가 나오도록 심볼을 시드로 사용 → 순위 공정성 확보.

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 심볼별 성격(추세/변동성)을 살짝 다르게
function profileFor(symbol) {
  const s = symbol.toUpperCase();
  if (s.includes('TSLA') || s.includes('NVDA') || s.includes('GME')) return { drift: 0.0009, vol: 0.045, start: 60 };
  if (s.includes('AAPL') || s.includes('MSFT')) return { drift: 0.0007, vol: 0.018, start: 150 };
  if (s.includes('KO') || s.includes('JNJ') || s.includes('삼성')) return { drift: 0.0002, vol: 0.012, start: 70 };
  return { drift: 0.0004, vol: 0.022, start: 100 };
}

export function generateMockHistory(symbol, years = 3) {
  const rnd = mulberry32(hashSeed(symbol.toUpperCase()));
  const { drift, vol, start } = profileFor(symbol);
  const days = Math.round(years * 252); // 거래일 기준
  const out = [];
  let price = start;
  const today = new Date();

  for (let i = days - 1; i >= 0; i--) {
    // 기하 브라운 운동 + 가끔 점프
    const z = (rnd() + rnd() + rnd() - 1.5) * 1.4; // 대략 정규분포
    let ret = drift + vol * z;
    if (rnd() < 0.01) ret += (rnd() - 0.5) * 0.18; // 가끔 큰 갭
    price = Math.max(1, price * (1 + ret));
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), close: +price.toFixed(2) });
  }
  return out;
}

// "오늘의 급등주/거래량 급증" — 날짜를 시드로 매일 바뀜 (실시간 느낌)
export function getMockTrending() {
  const dayKey = new Date().toISOString().slice(0, 10);
  const list = MOCK_SYMBOLS.map((s) => {
    const r = mulberry32(hashSeed(s.symbol + dayKey));
    const change = +(((r() * 2 - 0.5) * 13)).toFixed(1); // 대략 -6.5% ~ +19.5% (상승 편향)
    const volume = +(r() * 4.5 + 0.3).toFixed(1);         // 거래량 0.3~4.8억주
    return { ...s, change, volume, hot: r() > 0.55 };
  });
  // 변동성 + 거래량 가중치로 정렬해 상위 8개
  return list
    .sort((a, b) => (Math.abs(b.change) + b.volume * 3) - (Math.abs(a.change) + a.volume * 3))
    .slice(0, 8);
}

// 종목 마스터 — 한/영 이름 둘 다 보유 (미국 + 한국)
const RAW_SYMBOLS = [
  // 미국 (영문명 그대로)
  ['AAPL', 'Apple Inc.', 'Apple Inc.'],
  ['TSLA', 'Tesla, Inc.', 'Tesla, Inc.'],
  ['NVDA', 'NVIDIA Corporation', 'NVIDIA Corporation'],
  ['MSFT', 'Microsoft Corporation', 'Microsoft Corporation'],
  ['GME', 'GameStop Corp.', 'GameStop Corp.'],
  ['AMZN', 'Amazon.com, Inc.', 'Amazon.com, Inc.'],
  ['GOOGL', 'Alphabet Inc.', 'Alphabet Inc.'],
  ['META', 'Meta Platforms, Inc.', 'Meta Platforms, Inc.'],
  ['AMD', 'Advanced Micro Devices', 'Advanced Micro Devices'],
  ['NFLX', 'Netflix, Inc.', 'Netflix, Inc.'],
  ['KO', 'The Coca-Cola Company', 'The Coca-Cola Company'],
  ['JNJ', 'Johnson & Johnson', 'Johnson & Johnson'],
  // 한국 — KOSPI 대형주  [코드, 한글명, 영문명]
  ['005930.KS', '삼성전자', 'Samsung Electronics'],
  ['000660.KS', 'SK하이닉스', 'SK Hynix'],
  ['373220.KS', 'LG에너지솔루션', 'LG Energy Solution'],
  ['207940.KS', '삼성바이오로직스', 'Samsung Biologics'],
  ['005380.KS', '현대차', 'Hyundai Motor'],
  ['000270.KS', '기아', 'Kia'],
  ['068270.KS', '셀트리온', 'Celltrion'],
  ['035420.KS', 'NAVER', 'NAVER'],
  ['005490.KS', 'POSCO홀딩스', 'POSCO Holdings'],
  ['051910.KS', 'LG화학', 'LG Chem'],
  ['006400.KS', '삼성SDI', 'Samsung SDI'],
  ['035720.KS', '카카오', 'Kakao'],
  ['028260.KS', '삼성물산', 'Samsung C&T'],
  ['012330.KS', '현대모비스', 'Hyundai Mobis'],
  ['105560.KS', 'KB금융', 'KB Financial'],
  ['055550.KS', '신한지주', 'Shinhan Financial'],
  ['066570.KS', 'LG전자', 'LG Electronics'],
  ['003670.KS', '포스코퓨처엠', 'POSCO Future M'],
  ['096770.KS', 'SK이노베이션', 'SK Innovation'],
  ['015760.KS', '한국전력', 'KEPCO'],
  ['034730.KS', 'SK', 'SK Inc.'],
  ['032830.KS', '삼성생명', 'Samsung Life'],
  ['003550.KS', 'LG', 'LG Corp.'],
  ['000810.KS', '삼성화재', 'Samsung Fire & Marine'],
  ['033780.KS', 'KT&G', 'KT&G'],
  ['017670.KS', 'SK텔레콤', 'SK Telecom'],
  ['030200.KS', 'KT', 'KT Corp.'],
  ['009150.KS', '삼성전기', 'Samsung Electro-Mechanics'],
  ['011200.KS', 'HMM', 'HMM'],
  ['010130.KS', '고려아연', 'Korea Zinc'],
  ['259960.KS', '크래프톤', 'Krafton'],
  ['010950.KS', 'S-Oil', 'S-Oil'],
  ['018260.KS', '삼성에스디에스', 'Samsung SDS'],
  ['090430.KS', '아모레퍼시픽', 'Amorepacific'],
  ['051900.KS', 'LG생활건강', 'LG H&H'],
  ['047810.KS', '한국항공우주', 'Korea Aerospace (KAI)'],
  ['012450.KS', '한화에어로스페이스', 'Hanwha Aerospace'],
  ['064350.KS', '현대로템', 'Hyundai Rotem'],
  ['329180.KS', 'HD현대중공업', 'HD Hyundai Heavy Ind.'],
  ['042660.KS', '한화오션', 'Hanwha Ocean'],
  ['010140.KS', '삼성중공업', 'Samsung Heavy Ind.'],
  ['267260.KS', 'HD현대일렉트릭', 'HD Hyundai Electric'],
  ['034020.KS', '두산에너빌리티', 'Doosan Enerbility'],
  ['241560.KS', '두산밥캣', 'Doosan Bobcat'],
  ['000150.KS', '두산', 'Doosan Corp.'],
  ['316140.KS', '우리금융지주', 'Woori Financial'],
  ['138040.KS', '메리츠금융지주', 'Meritz Financial'],
  ['024110.KS', '기업은행', 'IBK'],
  // 한국 — KOSDAQ / 변동성 큰 인기주
  ['247540.KQ', '에코프로비엠', 'Ecopro BM'],
  ['086520.KQ', '에코프로', 'Ecopro'],
  ['028300.KQ', 'HLB', 'HLB'],
  ['196170.KQ', '알테오젠', 'Alteogen'],
  ['348370.KQ', '엔켐', 'Enchem'],
  ['058470.KQ', '리노공업', 'Leeno Industrial'],
  ['240810.KQ', '원익IPS', 'Wonik IPS'],
  ['277810.KQ', '레인보우로보틱스', 'Rainbow Robotics'],
  ['042700.KQ', '한미반도체', 'Hanmi Semiconductor'],
  ['293490.KQ', '카카오게임즈', 'Kakao Games'],
  ['263750.KQ', '펄어비스', 'Pearl Abyss'],
  ['112040.KQ', '위메이드', 'Wemade'],
  ['145020.KQ', '휴젤', 'Hugel'],
  ['035900.KQ', 'JYP Ent.', 'JYP Ent.'],
  ['041510.KQ', '에스엠', 'SM Entertainment'],
];

// 언어에 맞춰 표시 이름 결정 + 검색용 통합 문자열(_s) 부여
export const MOCK_SYMBOLS = RAW_SYMBOLS.map(([symbol, ko, en]) => ({
  symbol,
  name: LANG === 'en' ? en : ko,
  _s: `${symbol} ${ko} ${en}`.toLowerCase(),
}));
