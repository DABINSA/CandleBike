// 앱인토스(토스 인앱) 환경 감지.
// granite 셸이 페이지 로드 전 window.__APPS_IN_TOSS__=true 를 주입하고,
// WebView UA 에 'AppsInTossWebView' 마커를 붙인다 → 둘 중 하나로 감지.
//
// 앱인토스는 외부 이동형 광고(AdSense 등)를 금지한다. 그래서 토스 안에서는
// 광고/리워드 게이트를 'off' 로 강제한다(외부광고 위반 방지 + 결과 즉시 공개).
export const IS_TOSS = (() => {
  try {
    if (typeof window !== 'undefined' && window.__APPS_IN_TOSS__ === true) return true;
    if (typeof navigator !== 'undefined' && /AppsInTossWebView/i.test(navigator.userAgent || '')) return true;
  } catch (e) { /* noop */ }
  return false;
})();

// 토스에서는 'off', 그 외엔 설정한 모드 그대로.
export function effectiveAdMode(configMode) {
  return IS_TOSS ? 'off' : configMode;
}
