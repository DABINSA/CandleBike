# 캔들라이더 — 앱인토스(토스 인앱) 미니앱

> 토스 미니앱 이름/정체성은 **캔들라이더(appName `candlerider`)**. 웹사이트는 그대로 **CandleBike(candlebike.vercel.app)** — 셸이 이 사이트를 로딩한다.

기존 사이트(`https://candlebike.vercel.app`)를 **granite(RN) 셸이 WebView로 로딩**하는 방식.
사이트를 다시 만들지 않는다. 셸은 얇게 — WebView + 뒤로가기 + 토스환경 마커만.

```
토스앱 ──▶ 미니앱(.ait, granite 셸) ──WebView──▶ candlebike.vercel.app
```

- 토스 라이트 로그인 ✅(mTLS, user_key+닉만 — PII 복호화/세션 없음) · 인앱결제 ❌(무료 게임)
- 토스 안에서는 **광고/결과 게이트 자동 off**(외부광고 AdSense 금지 대응) → 결과 즉시 공개
  - 감지: 셸이 `window.__APPS_IN_TOSS__=true` 주입 + UA `AppsInTossWebView` → `src/toss.js`
  - 적용: `src/ads/ads.js`, `src/main.js` 가 `effectiveAdMode()`로 토스면 'off'

## 구조
```
toss-miniapp/                      granite 셸 (RN, .ait 빌드)
  granite.config.ts                appName=candlerider, displayName=캔들라이더, scheme=intoss
  src/WebShell.tsx                 WebView + 뒤로가기 + 마커주입 (브리지 없음)
  pages/index.tsx                  '/' → WebShell path="/"
  patches/                         🔴 granite 1.0.32 버그 패치 (없으면 빌드 실패)
.github/workflows/toss-miniapp-build.yml   리눅스에서 .ait 빌드 (Windows 빌드 불가)
src/toss.js                        사이트측 토스 감지 + effectiveAdMode
```

## 빌드 (🔴 Windows 불가 — GitHub Actions에서만)
1. 커밋/푸시 → GitHub **Actions 탭 → "Toss Miniapp Build (.ait)" → Run workflow**
2. 끝나면 아티팩트 `candlerider-toss-build` 다운로드 → `candlerider.ait`
   - 또는 `gh run download <id> -n candlerider-toss-build`

## 콘솔 작업 (사용자가 직접 — 앱인토스 콘솔)
1. **앱 정보**: appName `candlerider`(표시이름 `캔들라이더`), 소개/카테고리 → 제출(앱 정보 승인)
2. **디자인**: 앱 아이콘 **512 PNG**, 브랜드 컬러 `#2ce6c4`, 스플래시
3. (로그인/결제 없음 → 토스 로그인·mTLS·인앱결제 섹션 건너뜀)
4. **앱 출시**: 버전 추가 → `candlerider.ait` 업로드 → 콘솔 빌드(~10분)
5. **테스트 QR**(`intoss-private://candlerider`)을 **진짜 토스앱**으로 스캔 → 동작 확인
6. **검토 요청** → 승인 메일 → **출시하기**(즉시 100% 공개, 롤백 가능)

## 심사 체크리스트
- [x] 진입 직후 자동 팝업 없음 (게임 홈은 검색창)
- [x] 자체 뒤로가기 버튼 없음 (셸 `useBackHandler`로만)
- [x] 유료 기능 없음 (인앱결제 불필요)
- [x] 외부광고(AdSense/하우스 자리) 토스 모드에서 제거
- [ ] 딥링크: 단일 화면(`/`)이라 기본 진입만 등록

## 성장 레버 — mTLS 로그인 · 공유 리워드 · 스마트 발송 · 핵심지표

코드는 모두 결선됨(아래). 남은 건 **콘솔 발급값을 `src/config.js`/Vercel env 에 넣고 새 `.ait` 빌드·출시**.
모든 토스 기능은 **버전 게이트 + best-effort** — 콘솔값이 비었거나 구버전 셸이면 자동 숨김/무동작(웹 영향 0).

### 1) mTLS 인증서 (토스 라이트 로그인)
- 코드: `api/auth/toss.js`(인가코드→mTLS `generate-token`→`login-me`→user_key) + `src/main.js` `requestTossLogin()`.
- **콘솔**: 「토스 로그인」에서 scope(최소: 안정적 식별자) + 약관 + 연결끊기 콜백 등록 → 「mTLS 인증서」에서 **cert+key(PEM) 발급**.
- **Vercel env**(미설정 시 503 fail-closed — 웹 영향 0):
  - `TOSS_LOGIN_MTLS_CERT` / `TOSS_LOGIN_MTLS_KEY` — PEM **BEGIN/END 헤더 포함 전체**(🔴 헤더 빠지면 `no start line`, BOM 섞이면 `ByteString` 에러).
  - `TOSS_NICK_SECRET` — 닉 저장 토큰 서명용 임의 시크릿.
  - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — 닉 조회/저장.
- 🔴 토스 로그인 REST 경로/필드는 공개문서에 없음 → **샌드박스에서 `TOSS_DEBUG=1`로 원응답 확인** 후 `TOSS_TOKEN_URL`/`TOSS_ME_URL`/`TOSS_USERKEY_FIELD` env로 교정.

### 2) 공유 리워드 (contactsViral, 무료 바이럴)
- 코드: 셸 `shareReward` 핸들러(`toss-miniapp/src/WebShell.tsx`) + `src/toss.js` `requestTossShareReward()` + `src/main.js` `doShareReward()`(차고 상단 버튼).
- 동작: 차고 버튼 → 친구 공유 완료(`sendViral`) 시 **토큰 지급 / 하루 1회**(`cr_share_reward_day`) → 받은 토큰으로 차고에서 원하는 아이템 구매.
- 금액: `CONFIG.TOSS_SHARE.tokens`(기본 100, 광고 보상과 동일). **콘솔 리워드 단위 `토큰`/수량 `100` 과 일치**시킬 것.
- 토큰 경제(`src/items.js`: 완주 +10, 광고 +100, 탈것/소모품 토큰 구매)와 통일 — 별도 아이템 선택 UI 없음.
- **콘솔**: 「마케팅>공유 리워드」에서 리워드 생성 → **리워드 ID(UUID)** 발급(예산 충전 불필요 — 우리 인앱 재화만).
- **설정**: `src/config.js` → `TOSS_SHARE.reward = '<UUID>'`. 비우면 버튼 숨김.
- 셸 마커 `__APPS_IN_TOSS_SHARE__` 가 있는 **새 `.ait`** 에서만 노출(구버전 셸 자동 숨김).

### 3) 스마트 발송 (광고성 푸시) — 콘솔 전용, 코드 불필요
- 「마케팅>스마트 발송」에서 등록(현재 수수료 면제). **신규 유입 + 재방문** 2섹션. 딥링크 URL = `intoss://candlerider/`(현재 단일 화면).
- 🔴 소재 규칙(어기면 반려, 검수 2~3일): 제목 **7자**/본문 **25자**, **해요체**, **"토스에서" 포함**, `~요`로 끝나면 마침표(.), 과장(역대급/초특가) 금지.
- 타겟: 광고성=**세그먼트만**(재방문은 조건 1개 이상 필수). 소재 미니앱당 최대 4개 → **2목적×A/B** 권장.
- 예시 소재(검수 통과형):
  - 신규: 제목 `토스에서 주식 레이스` / 본문 `내 종목으로 달려보고 순위 겨뤄봐요.`
  - 재방문: 제목 `오늘의 코스 도착` / 본문 `새 종목 코스가 토스에서 기다려요.`

### 4) 핵심지표 (분석 커스텀 이벤트)
- 코드: 셸 `logEvent` 핸들러(Analytics.Impression `impression="on-mount"` 1회 발사) + `src/toss.js` `logTossEvent()` + `src/main.js` 결선.
- 발사 이벤트: **`game_complete`(완주=대표 전환)**, 보조 `game_start`·`game_end`·`item_get`·`share`·`share_reward`.
- **콘솔**: `.ait` 빌드+폰 테스트 후 **다음날 「분석>이벤트」에 도착 확인** → 핵심지표 「직접 조합」에서 `game_complete` 를 **대표 전환**으로, `game_start`/`share` 를 보조로 지정.
- 🔴 Analytics.Impression 프로퍼티 모양은 공개문서 불명 → **폰에서 도착 확인 필수**. 안 뜨면 web-framework 직접 호출 폴백 검토(`WebShell.tsx` 주석).

> ⚠️ 공유 리워드/핵심지표/리워드 광고는 모두 **셸(.ait) 변경** → GitHub Actions 재빌드 + 콘솔 재업로드·출시해야 활성. config(UUID)만 바꾼 건 사이트 재배포로 충분하나, **마커/핸들러가 든 새 .ait가 먼저 깔려 있어야** 동작.

## 🔴 나중에 AdSense를 실제로 켤 때 주의
`index.html <head>` 의 `adsbygoogle` 스크립트 주석을 풀면 **토스 안에서도 외부광고 스크립트가
로드**된다(우리 JS보다 먼저). 그땐 그 `<script>`를 토스 환경에서 막아야 한다 —
예: 인라인으로 `if (!window.__APPS_IN_TOSS__) { /* adsbygoogle script 삽입 */ }`.
현재는 주석 처리 + 토스 AD_MODE off라 위반 없음.
