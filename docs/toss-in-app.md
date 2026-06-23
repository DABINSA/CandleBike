# 캔들바이크 — 앱인토스(토스 인앱) 미니앱

기존 사이트(`https://candlebike.vercel.app`)를 **granite(RN) 셸이 WebView로 로딩**하는 방식.
사이트를 다시 만들지 않는다. 셸은 얇게 — WebView + 뒤로가기 + 토스환경 마커만.

```
토스앱 ──▶ 미니앱(.ait, granite 셸) ──WebView──▶ candlebike.vercel.app
```

- 로그인 ❌ · 인앱결제 ❌ (계정 없는 닉네임 리더보드 게임)
- 토스 안에서는 **광고/결과 게이트 자동 off**(외부광고 AdSense 금지 대응) → 결과 즉시 공개
  - 감지: 셸이 `window.__APPS_IN_TOSS__=true` 주입 + UA `AppsInTossWebView` → `src/toss.js`
  - 적용: `src/ads/ads.js`, `src/main.js` 가 `effectiveAdMode()`로 토스면 'off'

## 구조
```
toss-miniapp/                      granite 셸 (RN, .ait 빌드)
  granite.config.ts                appName=candlebike, scheme=intoss, brand
  src/WebShell.tsx                 WebView + 뒤로가기 + 마커주입 (브리지 없음)
  pages/index.tsx                  '/' → WebShell path="/"
  patches/                         🔴 granite 1.0.32 버그 패치 (없으면 빌드 실패)
.github/workflows/toss-miniapp-build.yml   리눅스에서 .ait 빌드 (Windows 빌드 불가)
src/toss.js                        사이트측 토스 감지 + effectiveAdMode
```

## 빌드 (🔴 Windows 불가 — GitHub Actions에서만)
1. 커밋/푸시 → GitHub **Actions 탭 → "Toss Miniapp Build (.ait)" → Run workflow**
2. 끝나면 아티팩트 `candlebike-toss-build` 다운로드 → `candlebike.ait`
   - 또는 `gh run download <id> -n candlebike-toss-build`

## 콘솔 작업 (사용자가 직접 — 앱인토스 콘솔)
1. **앱 정보**: appName `candlebike`, 소개/카테고리 → 제출(앱 정보 승인)
2. **디자인**: 앱 아이콘 **512 PNG**, 브랜드 컬러 `#2ce6c4`, 스플래시
3. (로그인/결제 없음 → 토스 로그인·mTLS·인앱결제 섹션 건너뜀)
4. **앱 출시**: 버전 추가 → `candlebike.ait` 업로드 → 콘솔 빌드(~10분)
5. **테스트 QR**(`intoss-private://candlebike`)을 **진짜 토스앱**으로 스캔 → 동작 확인
6. **검토 요청** → 승인 메일 → **출시하기**(즉시 100% 공개, 롤백 가능)

## 심사 체크리스트
- [x] 진입 직후 자동 팝업 없음 (게임 홈은 검색창)
- [x] 자체 뒤로가기 버튼 없음 (셸 `useBackHandler`로만)
- [x] 유료 기능 없음 (인앱결제 불필요)
- [x] 외부광고(AdSense/하우스 자리) 토스 모드에서 제거
- [ ] 딥링크: 단일 화면(`/`)이라 기본 진입만 등록

## 🔴 나중에 AdSense를 실제로 켤 때 주의
`index.html <head>` 의 `adsbygoogle` 스크립트 주석을 풀면 **토스 안에서도 외부광고 스크립트가
로드**된다(우리 JS보다 먼저). 그땐 그 `<script>`를 토스 환경에서 막아야 한다 —
예: 인라인으로 `if (!window.__APPS_IN_TOSS__) { /* adsbygoogle script 삽입 */ }`.
현재는 주석 처리 + 토스 AD_MODE off라 위반 없음.
