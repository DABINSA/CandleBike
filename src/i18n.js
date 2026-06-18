// 다국어 — 저장된 선택이 있으면 우선, 없으면 접속 브라우저 언어(한국어→ko, 그 외→en).
const LS_LANG = 'candlebike_lang';
const isKo = (navigator.languages || [navigator.language || 'en'])
  .some((l) => (l || '').toLowerCase().startsWith('ko'));

let stored = null;
try { stored = localStorage.getItem(LS_LANG); } catch {}
export const LANG = (stored === 'ko' || stored === 'en') ? stored : (isKo ? 'ko' : 'en');

// 언어 변경 → 저장 후 새로고침(모든 모듈이 t를 다시 로드)
export function setLang(lang) {
  if (lang !== 'ko' && lang !== 'en') return;
  try { localStorage.setItem(LS_LANG, lang); } catch {}
  location.reload();
}

const DICT = {
  ko: {
    docTitle: '캔들바이크 — 변동성을 버텨라',
    logo: '📈🏍️ 캔들바이크',
    tagline: '검색한 주식의 <b>3년 등락 그래프</b>가 코스가 됩니다.<br/>변동성을 버티고 <b>최고 거리</b>에 도전하세요!',
    searchPh: '종목 검색 (예: AAPL, TSLA, 삼성전자)',
    selectStock: '종목을 선택하세요',
    rideChart: (s) => `🏍️ ${s} 그래프 달리기`,
    trendingHead: '🔥 지금 뜨는 종목',
    trendingKr: '🔥 한국장 급등주',
    trendingUs: '🔥 미국장 급등주',
    live: '실시간',
    loadingTrending: '불러오는 중…',
    noTrending: '추천 종목이 없어요.',
    trendingFail: '추천을 불러오지 못했어요.',
    viewLeaderboard: '🏆 전체 순위 보기',
    loadingCourse: (s) => `${s} 코스 불러오는 중…`,
    hudDistance: '거리',
    hudFuel: '연료',
    hudStock: '종목',
    course: (p) => `코스 ${p}%`,
    miniChart: '📊 3년 차트',
    brakeBtn: '◀<br/>뒤로',
    jumpBtn: '⤴<br/>점프',
    gasBtn: '가속<br/>▶',
    hintTouch: '아래 버튼으로 조작 · ◀뒤로  ⤴점프  가속▶ · 공중에서 가속=백플립',
    hintKeys: '← 뒤로 · Space 점프 · → 가속 · 공중에서 →=백플립',
    adTitle: '결과 & 순위를 확인하려면',
    adPlaying: '📺 광고 재생 중…',
    adCountdownSuffix: '초 후 결과를 볼 수 있어요',
    seeResultsLocked: '결과 보기 🔒',
    seeResultsUnlocked: '결과 보기 🔓',
    rankLine: (r, p) => `완주 <b>${r}</b>위 · 상위 <b>${p}</b>%`,
    timeFmt: (ms) => `${(ms / 1000).toFixed(1)}초`,
    timeUnit: '초',
    notFinished: '완주 실패 — 끝까지 달려야 순위에 올라요! 🏁',
    finishToast: '🏁 완주!',
    brand: '📈🏍️ 캔들바이크',
    share: '📲 공유하기',
    saveImg: '🖼️ 결과 이미지 저장',
    leaderboardTitle: (s) => (s ? `🏆 ${s} 순위` : '🏆 전체 순위'),
    noRecords: '아직 기록이 없어요. 첫 주자가 되어보세요!',
    retry: '🔁 다시 도전',
    pickAnother: '🏠 다른 종목 고르기',
    nickTitle: '순위에 기록할 닉네임',
    nickPh: '라이더닉네임',
    nickSave: '저장하고 순위 등록',
    anon: '익명라이더',
    krStock: (code) => `한국 종목 ${code}`,
    diffWord: '난이도',
    diffLabels: ['변동성 낮음', '변동성 보통', '변동성 높음', '변동성 매우높음', '변동성 극심'],
    volWord: '주간 변동성',
    backflip: '백플립',
    flipN: (n) => `${n}x 플립`,
    checkpoint: '체크포인트',
    eventWarn: (name) => `${name} 곧 등장! 점프 준비! ⚠️`,
    dataNote: (data, remote, period) =>
      `데이터: ${data} · 순위: ${remote ? '전체(클라우드)' : '내 기기'} · 코스 캐시: ${remote ? 'DB 공유' : '내 기기'}(${period})`,
    providerYahoo: '야후 파이낸스 실데이터',
    providerMock: '데모 데이터(오프라인) 모드',
    providerTd: 'Twelve Data 실시간',
    providerProxy: '프록시 서버',
    demoAlert: '실시간 데이터를 불러오지 못해 데모 차트로 진행합니다.',
    courseFail: '코스를 불러오지 못했습니다. 다른 종목을 시도해 주세요.',
    savedAlert: '이미지를 저장했어요! 인스타에 올리고 캡션을 붙여넣으세요. (캡션 복사됨)',
    shareCaption: (sym, dist, rank, url) =>
      `🏍️ ${sym} 차트를 달려 ${dist}m! 너도 같이 달려보자 — 누가 더 멀리 가나 🔥\n👉 ${url}\n#캔들바이크 #CandleBike #${sym.replace(/[^A-Za-z0-9]/g, '')}`,
    shareCaptionTime: (sym, time, rank, url) =>
      `🏍️ 나 ${sym} 차트 ${time} 완주, 전체 ${rank}위! 🏁\n이 기록 깰 수 있어? 친구들아 덤벼 😎\n👉 ${url}\n#캔들바이크 #CandleBike #${sym.replace(/[^A-Za-z0-9]/g, '')}`,
    cardChallenge: '🏁 이 기록, 깰 수 있어?',
    cardCta: '👉 지금 같이 도전',
    cardBrand: '📈🏍️ 캔들바이크 — 변동성을 버텨라',
    cardRank: (r, p) => `전체 ${r}위 · 상위 ${p}%`,
    // 하우스 광고 (광고주 유치)
    adSpace: '광고 자리',
    houseTitle: '📢 이 자리, 비어 있어요',
    houseSub: '주식에 진심인 유저에게 바로 노출 — 지금 선점하면 특가',
    houseTitleReward: '📢 가장 주목도 높은 자리',
    houseSubReward: '결과 보기 직전 5초 — 모두가 보는 전면 광고',
    houseTitleResult: '📢 여기에 브랜드를 노출하세요',
    houseSubResult: '게임을 막 끝낸 유저가 보는 자리 — 클릭률이 높아요',
    houseCta: (email) => `광고 문의 → ${email}`,
    mailSubject: '[캔들바이크] 광고 문의',
  },
  en: {
    docTitle: 'CandleBike — Survive the Volatility',
    logo: '📈🏍️ CandleBike',
    tagline: "A stock's <b>3-year price chart</b> becomes your course.<br/>Survive the volatility and chase the <b>longest distance</b>!",
    searchPh: 'Search a stock (e.g. AAPL, TSLA, Samsung)',
    selectStock: 'Select a stock',
    rideChart: (s) => `🏍️ Ride the ${s} chart`,
    trendingHead: '🔥 Trending now',
    trendingKr: '🔥 KR market gainers',
    trendingUs: '🔥 US market gainers',
    live: 'LIVE',
    loadingTrending: 'Loading…',
    noTrending: 'No trending stocks.',
    trendingFail: "Couldn't load trending.",
    viewLeaderboard: '🏆 View leaderboard',
    loadingCourse: (s) => `Loading ${s} course…`,
    hudDistance: 'Distance',
    hudFuel: 'Fuel',
    hudStock: 'Stock',
    course: (p) => `Course ${p}%`,
    miniChart: '📊 3-year chart',
    brakeBtn: '◀<br/>Reverse',
    jumpBtn: '⤴<br/>Jump',
    gasBtn: 'Gas<br/>▶',
    hintTouch: 'Buttons · ◀Reverse  ⤴Jump  Gas▶ · in air Gas=backflip',
    hintKeys: '← Reverse · Space Jump · → Gas · in air →=backflip',
    adTitle: 'To see your result & rank',
    adPlaying: '📺 Ad playing…',
    adCountdownSuffix: ' sec until results',
    seeResultsLocked: 'See results 🔒',
    seeResultsUnlocked: 'See results 🔓',
    rankLine: (r, p) => `Finish <b>#${r}</b> · Top <b>${p}</b>%`,
    timeFmt: (ms) => `${(ms / 1000).toFixed(1)}s`,
    timeUnit: 's',
    notFinished: "Didn't finish — reach the end to make the leaderboard! 🏁",
    finishToast: '🏁 Finished!',
    brand: '📈🏍️ CandleBike',
    share: '📲 Share',
    saveImg: '🖼️ Save image',
    leaderboardTitle: (s) => (s ? `🏆 ${s} Ranking` : '🏆 Leaderboard'),
    noRecords: 'No records yet. Be the first rider!',
    retry: '🔁 Retry',
    pickAnother: '🏠 Pick another',
    nickTitle: 'Nickname for the leaderboard',
    nickPh: 'RiderName',
    nickSave: 'Save & submit',
    anon: 'AnonRider',
    krStock: (code) => `KR Stock ${code}`,
    diffWord: 'Difficulty',
    diffLabels: ['Low vol.', 'Moderate vol.', 'High vol.', 'Very high vol.', 'Extreme vol.'],
    volWord: 'Weekly volatility',
    backflip: 'Backflip',
    flipN: (n) => `${n}x Flip`,
    checkpoint: 'Checkpoint',
    eventWarn: (name) => `${name} incoming! Get ready to jump! ⚠️`,
    dataNote: (data, remote, period) =>
      `Data: ${data} · Ranking: ${remote ? 'Global (cloud)' : 'This device'} · Course cache: ${remote ? 'Shared DB' : 'Local'} (${period})`,
    providerYahoo: 'Yahoo Finance (live)',
    providerMock: 'Demo data (offline)',
    providerTd: 'Twelve Data (live)',
    providerProxy: 'Proxy server',
    demoAlert: 'Live data unavailable — running a demo chart instead.',
    courseFail: "Couldn't load the course. Please try another stock.",
    savedAlert: 'Image saved! Post it and paste the caption. (caption copied)',
    shareCaption: (sym, dist, rank, url) =>
      `🏍️ Rode the ${sym} chart for ${dist}m! Come race me — who goes farther? 🔥\n👉 ${url}\n#CandleBike #${sym.replace(/[^A-Za-z0-9]/g, '')}`,
    shareCaptionTime: (sym, time, rank, url) =>
      `🏍️ I finished the ${sym} chart in ${time} — rank #${rank}! 🏁\nThink you can beat it? Bring it on 😎\n👉 ${url}\n#CandleBike #${sym.replace(/[^A-Za-z0-9]/g, '')}`,
    cardChallenge: '🏁 Can you beat this?',
    cardCta: '👉 Play & race me',
    cardBrand: '📈🏍️ CandleBike — Survive the Volatility',
    cardRank: (r, p) => `Rank #${r} · Top ${p}%`,
    // House ad (advertiser acquisition)
    adSpace: 'AD SPACE',
    houseTitle: '📢 This spot is open',
    houseSub: 'Reach engaged stock-game players — early-bird rates available',
    houseTitleReward: '📢 Prime placement',
    houseSubReward: 'The 5s right before results — a full-screen everyone sees',
    houseTitleResult: '📢 Put your brand here',
    houseSubResult: 'Seen right after a run — high click-through',
    houseCta: (email) => `Advertise → ${email}`,
    mailSubject: '[CandleBike] Advertising inquiry',
  },
};

export const t = DICT[LANG];

// data-i18n / data-i18n-html / data-i18n-ph 속성 채우기
export function applyStatic(root = document) {
  document.documentElement.lang = LANG;
  document.title = t.docTitle;
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = t[el.getAttribute('data-i18n')];
    if (typeof v === 'string') el.textContent = v;
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const v = t[el.getAttribute('data-i18n-html')];
    if (typeof v === 'string') el.innerHTML = v;
  });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const v = t[el.getAttribute('data-i18n-ph')];
    if (typeof v === 'string') el.placeholder = v;
  });
}
