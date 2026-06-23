// 최소 서비스워커 — PWA 설치/패키징(원스토어용 .aab) 요건 충족용.
// 게임은 온라인 전제라 캐시 없이 통과(네트워크 그대로). 프로덕션 캐싱 영향 0.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// fetch 핸들러 존재 = '설치 가능' 판정 충족. respondWith를 하지 않으면 브라우저 기본 동작(네트워크).
self.addEventListener('fetch', () => {});
