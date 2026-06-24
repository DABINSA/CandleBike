// 토스 인앱 배너 광고 (WebView SDK: @apps-in-toss/web-framework).
// 셸 작업 불필요 — 웹에서 직접 슬롯에 배너를 부착한다. 토스 환경에서만 동작하고,
// 웹/비토스나 SDK 미지원(구버전 셸)에선 isSupported()=false 라 조용히 no-op(웹 영향 0).
//
// 무빌드 사이트라 SDK 를 ESM CDN(esm.sh)에서 동적 import 한다.
// 🔴 광고그룹 ID: CONFIG.TOSS_BANNER_AD_GROUP (발급 후 실 ID로 교체, 그 전엔 테스트 ID).

import { IS_TOSS } from './toss.js';
import { CONFIG } from './config.js';

const SDK_URL = 'https://esm.sh/@apps-in-toss/web-framework@2.9.2';
const AD_GROUP = CONFIG.TOSS_BANNER_AD_GROUP || 'ait-ad-test-banner-id';

let _initPromise = null;          // TossAds | null
const _attached = new WeakMap();  // el → attach handle

// SDK 로드 + 초기화(1회). 실패/미지원이면 null.
function ensureInit() {
  if (!IS_TOSS) return Promise.resolve(null);
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      const { TossAds } = await import(/* @vite-ignore */ SDK_URL);
      if (!TossAds?.initialize?.isSupported?.()) return null;   // 구버전 셸/웹 → no-op
      const ok = await new Promise((resolve) => {
        TossAds.initialize({
          callbacks: {
            onInitialized: () => resolve(true),
            onInitializationFailed: (e) => { console.warn('TossAds init 실패', e); resolve(false); },
          },
        });
      });
      return ok ? TossAds : null;
    } catch (e) {
      console.warn('TossAds 로드 실패', e);
      return null;
    }
  })();
  return _initPromise;
}

// 슬롯 엘리먼트에 토스 배너 부착. 토스 아니면/미지원이면 false.
export async function attachTossBanner(el) {
  if (!IS_TOSS || !el) return false;
  const TossAds = await ensureInit();
  if (!TossAds) return false;
  detachTossBanner(el);
  el.innerHTML = '';
  el.style.display = '';
  try {
    const handle = TossAds.attachBanner(AD_GROUP, el, {
      theme: 'auto', tone: 'blackAndWhite', variant: 'expanded',
      callbacks: {
        onNoFill: () => {},                                  // 광고 없음 → 빈 슬롯(무해)
        onAdFailedToRender: (p) => console.warn('배너 렌더 실패', p?.error?.message),
      },
    });
    _attached.set(el, handle);
    return true;
  } catch (e) {
    console.warn('attachBanner 실패', e);
    return false;
  }
}

export function detachTossBanner(el) {
  if (!el) return;
  const h = _attached.get(el);
  if (h) { try { h.destroy(); } catch { /* noop */ } _attached.delete(el); }
}
