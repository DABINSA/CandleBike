# 📈🏍️ CandleBike

검색한 주식의 3년 차트가 코스가 되는 오토바이 게임 — **차트를 달려라.**


검색한 **주식의 최근 3년 등락 그래프가 코스**가 되는 오토바이 힐클라임 게임.
변동성(차트의 급등락)을 버티며 최대 거리를 달리고, 공중 트릭(백플립)으로 보너스를 얻어
**전체 순위**에 도전합니다.

- 🎮 플레이 중엔 **AdSense 배너** 상시 노출 (수익)
- 🔓 게임 종료 후 **리워드 광고(5초)** 를 봐야 결과/순위 공개
- 🏆 **순위**는 Supabase(무료 BaaS)에 기록 — 미설정 시 자동으로 내 기기(localStorage) 순위
- 📲 결과 카드 이미지 생성 → **인스타/카톡 공유**

---

## ▶️ 실행 (빌드 불필요)

ES 모듈 + CDN이라 **로컬 서버만 있으면** 됩니다. (file:// 직접 열기는 안 됨)

```bash
# 이 폴더에서
npx serve -l 8123 .
# 또는
npx http-server -p 8123
```

브라우저에서 **http://localhost:8123** 접속 → 종목 검색 후 플레이.
모바일 테스트는 같은 와이파이에서 `http://<PC-IP>:8123`.

> 키 없이 바로 플레이됩니다. 데이터는 `mock`(실제 같은 3년 차트 생성),
> 순위는 내 기기에 저장됩니다.

### 조작
- **가속**: 화면 우측 버튼 / `→` `↑` `Space`
- **브레이크·뒤로**: 화면 좌측 버튼 / `←` `↓`
- 공중에서 가속/브레이크로 **회전(백플립)** → 보너스 거리

---

## ⚙️ 실서비스 전환 — `src/config.js` 한 곳만 수정

### 1) 실제 주식 데이터 (기본값: `yahoo`)
키 없이 **야후 파이낸스 실데이터**를 씁니다. 정적 사이트라 브라우저 CORS를
우회해야 하는데, 공개 프록시는 자주 막히므로 **자체 Cloudflare Worker(무료) 권장**:

1. `workers/yahoo-proxy.js` 코드를 Cloudflare Worker로 배포 (파일 상단 주석에 5분 가이드)
2. `config.js`:
```js
STOCK_PROVIDER: 'yahoo',
CORS_PROXY: 'https://<내워커>.workers.dev/?url=',
```
- 비워두면 공개 프록시들을 순서대로 자동 시도(불안정할 수 있음)
- 대안: `STOCK_PROVIDER: 'twelvedata'` + 무료 키 (CORS 지원, 800req/day)

### 2) 코스 캐싱 + 주/월 갱신 (속도 핵심)
매번 차트를 받지 않습니다. **최초 1명이 플레이할 때만** 실데이터를 받아
Supabase `courses` 테이블에 저장하고, 같은 기간(주/월) 동안 다른 사람은 **즉시 로드**합니다.
```js
COURSE_UPDATE: 'week',   // 'week' | 'month' — 이 기간 동안 같은 코스 재사용
```

### 3) 순위(종목별) + 코스 캐시 테이블 (Supabase)
1. supabase.com 무료 프로젝트 생성 → SQL 에디터에서 실행:
```sql
-- 순위 (종목별로 집계됨) — 읽기만 공개, 쓰기는 서버 라우트(/api/score)로만
create table scores (
  id bigint generated always as identity primary key,
  nick text not null,
  symbol text not null,
  score int not null,
  created_at timestamptz default now()
);
alter table scores enable row level security;
create policy "s_read" on scores for select using (true);

-- 코스 캐시 (최초 1회 fetch → 공유) — 읽기만 공개, 쓰기는 /api/save-course 로만
create table courses (
  symbol text primary key,
  period text,
  series jsonb,
  updated_at timestamptz default now()
);
alter table courses enable row level security;
create policy "c_read" on courses for select using (true);
```
> ⚠ **보안:** anon 키는 클라 번들에 노출되므로 `insert/update using(true)` 같은 공개 쓰기
>   정책을 절대 만들지 마세요(점수 위조·캐시 오염). 쓰기는 service_role 서버 라우트만 수행합니다.
>   전체 잠금 + 레이트리밋 KV 테이블(`app_kv`)은 **`db/security.sql`** 한 번 실행으로 적용됩니다.

2. `config.js`에 `SUPABASE_URL` / `SUPABASE_ANON_KEY` 입력(읽기·공유용)
3. **Vercel 환경변수**에 서버 쓰기용 키 등록 (클라엔 노출 안 됨):
   - `SUPABASE_URL` = `https://<ref>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = Supabase Settings → API → **service_role** 키 (절대 `NEXT_PUBLIC_` 금지)
   - 이게 있어야 `/api/score`·`/api/save-course` 가 동작하고 IP 레이트리밋이 켜집니다.

> 순위는 **해당 종목 안에서의 순위**로 표시됩니다(전체 혼합 아님).

### 3) 광고 — 3가지 모드 (`config.js` `AD_MODE`)
- **`house`** (기본): "여기에 광고하세요" 자체 안내 + 이메일 문의 유도. AdSense 승인 전/트래픽
  쌓기 전에 **광고 자리를 미리 보여주고 광고주를 직접 유치**하는 용도.
  - 문의 이메일은 `AD_CONTACT_EMAIL` 로 설정 (CTA가 `mailto:` 로 연결)
- **`adsense`**: 실제 Google AdSense. `index.html <head>` 의 `adsbygoogle` 스크립트 주석 해제 +
  `ca-pub-...` / `data-ad-slot` 입력. 승인되면 배너가 실광고로 전환.
- **`off`**: 광고/리워드 게이트 모두 끔 (순수 테스트).

**광고가 들어가는 위치(4곳):**
| # | 위치 | 형태 | 설명 |
|---|------|------|------|
| ① | 홈 화면 | 배너 | 시작 전 |
| ② | 플레이 중 | 하단 배너 | 게임 내내 노출 |
| ③ | 결과 보기 직전 | **5초 강제 전면** | 가장 주목도 높음(리워드형 게이트) |
| ④ | 결과 화면 | 배너 | 게임 직후, 클릭률 높음 |

> ③ 5초 게이트: 표준 웹 AdSense엔 리워드 API가 없어 "5초 시청 후 결과 해제"로 구현.
> 실제 리워드 보상 SDK를 붙이려면 `src/ads/ads.js`의 `showRewardedAd()` 보상 콜백에서 `resolve()`.

---

## 🚀 배포
정적 사이트라 어디든 됩니다 — **Netlify / Vercel / GitHub Pages / Cloudflare Pages**.
폴더를 드래그&드롭하거나 레포 연결만 하면 끝. (빌드 명령 불필요)

## 📱 SNS 공유 미리보기 (카카오톡/페북/트위터)
- 미리보기 이미지: `assets/og.png` (1200×630, 이미 포함). 원본은 `assets/og.svg`.
- `index.html` `<head>`의 Open Graph 태그에서 **`https://YOUR-DOMAIN` 을 배포 도메인으로 모두 교체**.
  - 카카오톡은 `og:image` 가 **절대 https URL** 이어야 보입니다. (localhost·상대경로 불가)
- 카카오톡은 한 번 긁은 미리보기를 **캐시**합니다. 도메인/이미지를 바꿨으면 캐시 초기화:
  - https://developers.kakao.com/tool/clear/og 에 URL 입력 → 초기화
  - 페북: https://developers.facebook.com/tools/debug/ , 트위터: 카드 검사기
- 이미지 디자인을 바꾸려면 `assets/og.svg` 수정 후:
  `npx -y sharp-cli -i assets/og.svg -o assets -f png` → 생성된 파일을 `og.png` 로 사용

---

## 📁 구조
```
index.html            화면(홈/로딩/플레이/광고/결과) + 광고 슬롯
styles.css            네온 다크 테마
src/
  config.js           ★ 키·모드·튜닝 (여기만 바꾸면 됨)
  main.js             화면 흐름 상태머신
  stock/              데이터 공급자(mock/twelvedata/proxy) + 더미 차트 생성
  game/               terrain(차트→지형) · bike(물리) · game(루프/렌더/점수)
  leaderboard/        Supabase + localStorage 폴백
  ads/                플레이 배너 + 리워드 5초 게이트
  share/              결과 카드 캔버스 + 웹 공유/저장
```

## 🔧 튜닝 포인트
- 난이도: `config.GAME.fuelSeconds`, `terrain.js`의 `MAX_SLOPE`/`AMPLITUDE`/`SEG_SPACING`
- 점수: `config.GAME.flipMeters`, `game.js`의 `PX_PER_METER`
- 비주얼: `styles.css`의 `--neon` 등 CSS 변수
