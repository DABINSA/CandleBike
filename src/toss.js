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

// ─── RN 셸 ↔ 웹 브리지 (클라이언트) ───────────────────────────────────────
// appLogin / 리워드광고 같은 토스 네이티브 기능은 RN 셸만 호출 가능 → postMessage 요청 →
// 셸이 네이티브 호출 후 injectJavaScript 로 회신.
//   웹→셸:  ReactNativeWebView.postMessage(JSON{ type, requestId, params })
//   셸→웹:  window.__onTossBridgeMessage(JSON{ requestId, ok, data?, error? })
const _pending = new Map();
function _ensureDispatcher() {
  if (window.__onTossBridgeMessage) return;
  window.__onTossBridgeMessage = (raw) => {
    let msg;
    try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
    const p = _pending.get(msg.requestId);
    if (!p) return;
    clearTimeout(p.timer);
    _pending.delete(msg.requestId);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error || 'BRIDGE_ERROR'));
  };
}

// 셸 브리지 호출 — 셸이 없으면(웹) NO_BRIDGE 로 reject.
export function callBridge(type, params = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const rn = window.ReactNativeWebView;
    if (!rn || !rn.postMessage) { reject(new Error('NO_BRIDGE')); return; }
    _ensureDispatcher();
    const requestId = `tb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { _pending.delete(requestId); reject(new Error('TIMEOUT')); }, timeoutMs);
    _pending.set(requestId, { resolve, reject, timer });
    rn.postMessage(JSON.stringify({ type, requestId, params }));
  });
}

// 토스 로그인 — 셸 appLogin() 호출 요청 → { authorizationCode, referrer }.
export function requestTossLogin() {
  return callBridge('appLogin');
}
