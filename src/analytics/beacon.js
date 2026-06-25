// 방문 비콘 — 페이지 로드 1회 /api/hit 로 익명 방문자ID를 전송해 일별 방문/고유방문자 집계.
// 1st-party(같은 오리진) 요청이라 토스 인앱에서도 안전(외부 스크립트 아님) → 웹+토스 모두 집계.
// 방문자ID는 localStorage 의 익명 UUID 로, 개인 식별정보(PII)가 아니다.

import { IS_TOSS } from '../toss.js';

const VID_KEY = 'cr_vid';

function visitorId() {
  try {
    let id = localStorage.getItem(VID_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem(VID_KEY, id);
    }
    return id;
  } catch { return ''; }
}

let sent = false;
export function recordVisit() {
  if (sent) return;
  sent = true;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  const vid = visitorId();
  if (!vid) return;
  const body = JSON.stringify({ v: vid, toss: IS_TOSS });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/hit', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/hit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body, keepalive: true,
      }).catch(() => {});
    }
  } catch { /* 집계 실패는 조용히 무시 */ }
}
