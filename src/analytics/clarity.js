// Microsoft Clarity (히트맵 / 세션 리플레이) 로더.
// 토스 인앱은 외부 스크립트를 금지 → 웹(비-토스)에서만, 그리고 Project ID 가 있을 때만 로드.
// ID 가 비어 있으면 완전 no-op (번들에 부작용 없음).

import { CONFIG } from '../config.js';
import { IS_TOSS } from '../toss.js';

let loaded = false;

export function initClarity() {
  if (loaded) return;
  if (IS_TOSS) return;                      // 토스 인앱: 외부 스크립트 금지
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const id = (CONFIG.CLARITY_PROJECT_ID || '').trim();
  if (!id) return;                          // ID 미설정: 로드 안 함

  loaded = true;
  // Clarity 공식 스니펫 (수동 설치와 동일). c[a] 큐를 만들고 t.js 를 비동기 주입.
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', id);
}
