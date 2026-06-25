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

// 토스 리워드 광고 — 셸 showFullScreenAd 요청 → { rewarded: boolean }(끝까지 봤는지).
export function requestTossRewardAd(adGroupId, timeoutMs = 120000) {
  return callBridge('showRewardedAd', { adGroupId }, timeoutMs);
}

// 셸이 리워드 광고 브리지를 지원하는지(=새 .ait). 구버전 셸이면 false → 웹은 즉시지급 폴백.
export const IS_TOSS_REWARD_READY = (() => {
  try { return typeof window !== 'undefined' && window.__APPS_IN_TOSS_REWARD__ === true; }
  catch { return false; }
})();

// 토스 공유 리워드(contactsViral) — 셸이 친구 공유 시트를 띄움 → { shared: boolean }(공유 완료 여부).
export function requestTossShareReward(moduleId, timeoutMs = 120000) {
  return callBridge('shareReward', { moduleId }, timeoutMs);
}

// 셸이 공유 리워드 브리지를 지원하는지(=새 .ait). 구버전 셸이면 false → 공유 버튼 숨김.
export const IS_TOSS_SHARE_READY = (() => {
  try { return typeof window !== 'undefined' && window.__APPS_IN_TOSS_SHARE__ === true; }
  catch { return false; }
})();

// ─── 핵심지표(분석) 커스텀 이벤트 ─────────────────────────────────────────
// 토스 「분석>이벤트」로 보낼 전환 이벤트. 셸이 Analytics.Impression(on-mount)로 1회 발사.
// best-effort: 토스 인앱일 때만, 실패는 조용히 무시(웹/구버전 셸 영향 0).
//   대표(핵심) 전환 = game_complete(완주). 보조 = game_start / item_get / share.
export function logTossEvent(name, params) {
  if (!IS_TOSS || !name) return;
  try { callBridge('logEvent', { name, params }, 8000).catch(() => {}); } catch { /* noop */ }
}
