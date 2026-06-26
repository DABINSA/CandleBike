// 토스 인앱 네이티브 배너 광고(InlineAd) — 셸 오버레이 방식.
// 🔴 web-framework(TossAds.attachBanner)는 granite 셸 WebView 안에서 동작 안 함
//    (외부 esm.sh 모듈 로드 차단 / 토스 웹 호스트 부재) → 폐기.
// 대신 모두의웨딩 검증 방식: 웹은 placeholder 자리(빈 div)에 높이만 예약하고,
// 그 화면 좌표를 셸에 통지 → 셸이 그 위에 네이티브 InlineAd 를 얹는다(WebShell.tsx).
//   웹→셸 통지(단방향): postMessage(JSON{ type:'adOverlay', scrolling, slots:[{slotId,adGroupId,top,left,width,height,inViewport}] })

import { IS_TOSS } from './toss.js';

// 셸이 배너 오버레이를 처리하는지(=__APPS_IN_TOSS_BANNER_AD__ 마커 든 새 .ait).
// 구버전 셸/웹이면 false → 배너 자리 자체를 숨김(빈칸도 없음).
export const IS_TOSS_BANNER_READY = (() => {
  try { return typeof window !== 'undefined' && window.__APPS_IN_TOSS_BANNER_AD__ != null; }
  catch { return false; }
})();

const slots = new Map();   // slotId -> { el, adGroupId }
let installed = false;
let scrollingNow = false;
let idleTimer = null;
let lastScrollAt = 0;
let lastPayload = '';       // 동일 통지 중복 전송 방지(셸 깜빡임 차단)

function postAdOverlay(scrolling) {
  if (typeof window === 'undefined') return;
  const rn = window.ReactNativeWebView;
  if (!rn || !rn.postMessage) return;
  const vh = window.innerHeight || 0;
  const vw = window.innerWidth || 0;
  const M = 120;   // 뷰포트 여유 — 미세 레이아웃 변동에 inViewport 깜빡임 방지
  const list = [];
  for (const [slotId, s] of slots) {
    const r = s.el.getBoundingClientRect();
    list.push({
      slotId,
      adGroupId: s.adGroupId,
      top: Math.round(r.top),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
      // 화면 밖(다른 screen 이라 display:none → rect 0)이면 false → 셸이 언마운트.
      inViewport: r.width > 0 && r.height > 0 && r.bottom > -M && r.top < vh + M && r.right > 0 && r.left < vw,
    });
  }
  const payload = JSON.stringify({ type: 'adOverlay', scrolling, slots: list });
  if (payload === lastPayload) return;
  lastPayload = payload;
  rn.postMessage(payload);
}

function ensureInstalled() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const onScroll = () => {
    lastScrollAt = Date.now();
    if (!scrollingNow) { scrollingNow = true; postAdOverlay(true); }   // 스크롤 시작=숨김
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { scrollingNow = false; postAdOverlay(false); }, 160);  // 멈춤=재배치
  };
  // capture:true → 내부 overflow 스크롤(홈/결과)도 잡음.
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', () => postAdOverlay(false), { passive: true });
  // 비동기 콘텐츠/이미지 로드로 인한 레이아웃 변동 대비 주기 재스캔(스크롤 중 아닐 때만).
  setInterval(() => { if (!scrollingNow && Date.now() - lastScrollAt > 200) postAdOverlay(false); }, 1000);
}

// 배너 슬롯 설정 — placeholder el 에 높이 예약 + 셸 오버레이 대상에 등록.
// height: 예약/광고 높이(px). 작은 배너 ~76, 이미지형(결과 보기 전) ~280.
// 토스 + 배너셸 + 광고그룹ID 있을 때만 동작. 그 외엔 el 숨김(빈칸 제거).
export function setupTossBanner(el, adGroupId, { height = 76 } = {}) {
  if (!el) return false;
  if (!IS_TOSS || !IS_TOSS_BANNER_READY || !adGroupId) { el.style.display = 'none'; return false; }
  const slotId = el.id || `toss-ad-${slots.size + 1}`;
  el.style.display = '';
  el.style.minHeight = `${height}px`;
  el.classList.add('toss-ad-slot');
  el.innerHTML = '<span class="toss-ad-label">광고</span>';   // 셸 광고 뒤 placeholder(스크롤 중 보임)
  ensureInstalled();
  slots.set(slotId, { el, adGroupId });
  setTimeout(() => postAdOverlay(false), 0);   // 레이아웃 잡힌 뒤 1회 통지
  return true;
}

// 화면 전환(show) 후 좌표 재통지 — 스크롤/리사이즈가 안 나는 screen 전환을 즉시 반영.
export function refreshTossAdSlots() {
  if (!installed) return;
  postAdOverlay(false);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => postAdOverlay(false));
}

// ── 토스 고정 배너(InlineAd) — 화면 상단/하단 고정. 스크롤 추적 안 함 → 깜빡임 없음. ──
// 셸이 position('top'|'bottom') 에 네이티브 InlineAd 를 고정으로 얹는다(WebShell). 화면당 1개.
// 인라인 좌표 오버레이(위)는 '결과 보기 전' 큰 이미지 전용으로만 남기고, 일반 배너는 이걸 쓴다.
export function showTossBanner(adGroupId, { position = 'bottom', height = 64 } = {}) {
  if (typeof window === 'undefined') return;
  const rn = window.ReactNativeWebView;
  if (!rn || !rn.postMessage) return;
  if (!IS_TOSS || !IS_TOSS_BANNER_READY) return;
  rn.postMessage(JSON.stringify({ type: 'tossBanner', adGroupId: adGroupId || '', position, height }));
}
export function hideTossBanner() { showTossBanner('', { position: 'bottom', height: 0 }); }
