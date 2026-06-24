// ===================================================================
//  설정 — 실서비스 전환 시 이 파일만 바꾸면 됩니다.
// ===================================================================

export const CONFIG = {
  // ---- 주식 데이터 공급자 ----
  // 'yahoo'      : 야후 파이낸스 실데이터 (키 불필요, CORS 프록시 경유) ★기본
  // 'mock'       : 키 없이 즉시 플레이 (가짜 3년 차트 생성, 실제와 다름)
  // 'twelvedata' : 무료 키 발급 후 실데이터 (https://twelvedata.com, CORS 지원)
  // 'proxy'      : 직접 만든 서버리스/Supabase 함수로 Yahoo/Stooq 프록시
  STOCK_PROVIDER: 'yahoo',

  // yahoo 모드 CORS 우회 프록시. 동일 도메인 Vercel 서버리스 함수(/api/yahoo)를 사용 → 안정적.
  // (비우면 공개 프록시들을 순서대로 시도하나 불안정)
  CORS_PROXY: '/api/yahoo?url=',

  // ---- 코스 캐싱 / 갱신 주기 ----
  // 'week' 또는 'month' — 같은 기간 동안은 DB에 저장된 코스를 그대로 사용(즉시 로드).
  // 최초 1명이 플레이할 때만 실데이터를 받아 DB(Supabase courses)에 저장됨.
  COURSE_UPDATE: 'week',

  // twelvedata 모드에서 사용 (무료 800 req/day)
  // ⚠ 보안: 이 키는 클라이언트 번들에 그대로 노출됩니다. 실서비스에서 twelvedata 모드를
  //    쓰려면 야후처럼 서버 라우트(/api/*)로 키를 숨겨 프록시하세요. (현재는 yahoo 모드라 미사용)
  TWELVEDATA_KEY: 'YOUR_TWELVEDATA_KEY',

  // proxy 모드에서 사용 — /search?q=, /history?symbol= 를 제공하는 엔드포인트
  PROXY_BASE: 'https://your-proxy.example.com',

  // 불러올 과거 데이터 기간(년)
  HISTORY_YEARS: 3,

  // ---- 리더보드 (Supabase) ----
  // 비워두면 자동으로 localStorage(기기 내) 순위로 동작합니다.
  SUPABASE_URL: 'https://qcaeqfdhlshdmvtycapw.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjYWVxZmRobHNoZG12dHljYXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MjAyOTUsImV4cCI6MjA5Njk5NjI5NX0._zSqzrDUYXJIq24wNkRAEJkwpTsgSSWMM6Xwongfw2c',

  // ---- 광고 ----
  // 'house'  : "여기에 광고하세요" 자체 안내(이메일 문의 유도) — 자리 선점/광고주 유치용 ★기본
  // 'adsense': 실제 Google AdSense (승인 후 전환)
  // 'off'    : 광고/리워드 게이트 모두 끔 (순수 테스트)
  AD_MODE: 'house',
  AD_CONTACT_EMAIL: 'withusts@gmail.com',   // 광고 문의받을 이메일 (바꾸세요)
  ADSENSE_CLIENT: 'ca-pub-XXXXXXXXXXXXXXXX',
  REWARD_AD_SECONDS: 5,      // 결과 보기 전 강제 시청 시간(초)

  // 토스 인앱 배너 광고 그룹 ID (WebView SDK). 🔴 광고그룹 발급 후 실 ID로 교체.
  // 그 전엔 토스 제공 테스트 ID(미집계). 토스 환경에서만 동작(웹 영향 0).
  TOSS_BANNER_AD_GROUP: 'ait-ad-test-banner-id',

  // ---- 게임 튜닝 ----
  GAME: {
    fuelSeconds: 60,         // 연료(시간) 한도 — 빠듯하게(near-miss 자극)
    flipMeters: 50,          // 공중 1회전(플립) 보너스 거리(m)
    flipTimeBonus: 2,        // 플립 성공 시 +시간(초) — 실력 기반으로 완주 연장
    checkpoints: [0.2, 0.5, 0.8],  // 코스 진행률 체크포인트
    checkpointTime: 3,       // 체크포인트 통과 시 +시간(초)
    crashEvents: true,       // 실제 대폭락 날짜에 '폭락 캔들' 보스 구간 (false로 끄기)
    cameraZoom: 1.0,
  },
};
