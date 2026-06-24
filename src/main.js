// 앱 흐름(화면 상태머신)을 묶는 진입점.
// 홈 → (검색/선택) → 로딩 → 플레이 → 리워드광고 → 결과/순위

import { CONFIG } from './config.js';
import { t, applyStatic, LANG, setLang } from './i18n.js';
import { searchSymbols, getTrending, getProvider, activeMarket } from './stock/provider.js';
import { getCourse, getLastCourseSource, currentPeriod } from './courseCache.js';
import { Game } from './game/game.js';
import { initPlayBanner, showRewardedAd, renderHouseAd } from './ads/ads.js';
import { submitScore, topScores, getNick, setNick, isRemote } from './leaderboard/leaderboard.js';
import { shareResult, saveCard } from './share/share.js';
import { pickGhostNames } from './game/ghosts.js';
import { quickDifficulty } from './difficulty.js';
import { MOCK_SYMBOLS } from './stock/mockData.js';
import * as audio from './audio.js';
import { IS_TOSS, effectiveAdMode, requestTossLogin } from './toss.js';
import './tune.js';   // ?tune=1 일 때만 물리 튜닝 패널 표시

// 토스 인앱에서는 외부광고 금지 → 광고/결과 게이트 'off'(결과 즉시 공개).
const AD_MODE = effectiveAdMode(CONFIG.AD_MODE);

// 종목명 캐시 (코드→기업명): 검색·추천·플레이에서 본 이름을 저장해 순위에 표시
const NAME_LS = 'candlebike_names';
let nameMap = {};
try { nameMap = JSON.parse(localStorage.getItem(NAME_LS)) || {}; } catch {}
MOCK_SYMBOLS.forEach((s) => { if (!nameMap[s.symbol]) nameMap[s.symbol] = s.name; });
function rememberName(symbol, name) {
  const clean = (name || '').split('·')[0].trim();   // 거래소 꼬리표 제거
  if (symbol && clean && nameMap[symbol] !== clean) {
    nameMap[symbol] = clean;
    try { localStorage.setItem(NAME_LS, JSON.stringify(nameMap)); } catch {}
  }
}
function lookupName(symbol) { return nameMap[symbol] || null; }

function diffBadge(symbol) {
  const d = quickDifficulty(symbol);
  if (!d) return '';
  return `<span class="diff-badge" style="color:${d.color}" title="${t.volWord} ${d.volPct}%">${d.stars} ${d.label}</span>`;
}

const $ = (id) => document.getElementById(id);
const screens = ['home', 'loading', 'play', 'ad', 'result'];
function show(name) {
  screens.forEach((s) => $(`screen-${s}`).classList.toggle('active', s === name));
}

let selected = null;     // { symbol, name }
let gameMode = 'single'; // 'single' | 'multi'(가짜 AI 경쟁)
let game = null;
let lastResult = null;    // { symbol, distance, flips, score }

applyStatic();           // 정적 텍스트를 접속 언어로 채움

// ---------------- 사운드 ----------------
// 자동재생 정책: 첫 사용자 제스처에서 오디오 컨텍스트 깨우기
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
const soundBtn = $('btn-sound');
function renderSound() { if (soundBtn) soundBtn.textContent = audio.isMuted() ? '🔇' : '🔊'; }
if (soundBtn) {
  renderSound();
  soundBtn.onclick = () => { audio.unlock(); audio.toggleMuted(); renderSound(); };
}

// 언어 토글
$('lang-ko').classList.toggle('active', LANG === 'ko');
$('lang-en').classList.toggle('active', LANG === 'en');
$('lang-ko').onclick = () => setLang('ko');
$('lang-en').onclick = () => setLang('en');

// ---------------- 홈: 검색 ----------------
const input = $('symbol-input');
const resultsEl = $('search-results');
let searchTimer = null;

input.addEventListener('input', () => {
  selected = null;
  $('btn-start').disabled = true;
  $('btn-start').textContent = t.selectStock;
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (!q) { resultsEl.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const list = await searchSymbols(q);
    renderSearch(list);
  }, 220);
});

function renderSearch(list) {
  resultsEl.innerHTML = '';
  list.forEach((item) => {
    rememberName(item.symbol, item.name);
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="sym">${escapeHtml(item.symbol)}</span>` +
      `<span class="name">${escapeHtml(item.name || '')} ${diffBadge(item.symbol)}</span>`;
    li.onclick = () => {
      selected = item;
      input.value = item.symbol;
      resultsEl.innerHTML = '';
      $('btn-start').disabled = false;
      $('btn-start').textContent = t.rideChart(item.symbol);
    };
    resultsEl.appendChild(li);
  });
}

// ---------------- 시작 ----------------
async function launch(item) {
  if (!item) return;
  selected = item;
  rememberName(item.symbol, item.name);
  show('loading');
  $('loading-text').textContent = t.loadingCourse(item.symbol);
  try {
    const series = await getCourse(item.symbol);     // DB 캐시 우선, 없으면 최초 1회만 fetch
    // 게임은 즉시 시작하고, 실데이터 실패 시 차단 alert 대신 상단에 비차단 토스트로 알린다.
    startGame(series, item.symbol, item.name);
    if (getLastCourseSource() === 'demo' && CONFIG.STOCK_PROVIDER !== 'mock') {
      showToast(t.demoAlert, { top: true });
    }
  } catch (e) {
    console.error(e);
    alert(t.courseFail + '\n' + e.message);
    show('home');
  }
}
$('btn-start').onclick = () => launchMode(selected);

// ---------------- 모드 선택(싱글 / 멀티 가짜 경쟁) ----------------
document.querySelectorAll('.mode-opt').forEach((b) => {
  b.onclick = () => {
    gameMode = b.dataset.mode;
    document.querySelectorAll('.mode-opt').forEach((x) => x.classList.toggle('active', x === b));
  };
});

// 모드에 따라 분기 — 싱글은 바로, 멀티는 매칭 연출 후 시작.
function launchMode(item) {
  if (gameMode === 'multi') return launchMulti(item);
  return launch(item);
}

// 멀티(가짜) — 2~4명 더미와 매칭되는 척 → 코스 로드 → 고스트와 경주.
async function launchMulti(item) {
  if (!item) return;
  selected = item;
  const count = 3 + Math.floor(Math.random() * 4);     // 3~6명(사람 많아 보이게)
  const ghostNames = pickGhostNames(count);
  const myNick = getNick() || t.anon;
  await runMatchmaking(myNick, ghostNames);            // '다른 라이더 찾는 중' 연출
  rememberName(item.symbol, item.name);
  show('loading');
  $('loading-text').textContent = t.loadingCourse(item.symbol);
  try {
    const series = await getCourse(item.symbol);
    startGame(series, item.symbol, item.name, { multi: true, nick: myNick, ghostCount: count, ghostNames });
    if (getLastCourseSource() === 'demo' && CONFIG.STOCK_PROVIDER !== 'mock') showToast(t.demoAlert, { top: true });
  } catch (e) {
    console.error(e); alert(t.courseFail + '\n' + e.message); show('home');
  }
}

// 매칭 연출 — 나 + 더미들이 차례로 '입장'하고 잠시 후 resolve(가짜 대기).
function runMatchmaking(myNick, ghostNames) {
  return new Promise((resolve) => {
    const ov = $('match-overlay'), list = $('match-players'), sub = $('match-sub');
    list.innerHTML = '';
    if (sub) sub.textContent = t.matchSub;
    ov.classList.add('active');
    const addPlayer = (name, me) => {
      const li = document.createElement('li');
      li.className = 'match-player' + (me ? ' me' : '');
      li.innerHTML = `<span class="mp-dot"></span><span class="mp-name">${escapeHtml(name)}</span>${me ? ` <span class="mp-you">${t.you}</span>` : ''}`;
      list.appendChild(li);
    };
    addPlayer(myNick, true);
    let i = 0;
    const tick = () => {
      if (i < ghostNames.length) { addPlayer(ghostNames[i], false); i += 1; setTimeout(tick, 450 + Math.random() * 450); }
      else {
        if (sub) sub.textContent = t.matchReady;
        setTimeout(() => { ov.classList.remove('active'); resolve(); }, 800);
      }
    };
    setTimeout(tick, 500);
  });
}

// ---------------- 토스 인앱 첫 진입: 로그인 + 닉네임 계정 기본값 ----------------
// 토스에서만, '아직 닉이 없을 때만' 자동 로그인(매 실행 나그 방지). 서버에 저장된 계정
// 기본 닉이 있으면 자동 적용 → 순위에 자동으로 그 닉이 들어간다. 없으면 1회 입력받아 저장.
// 실패하면 조용히 넘어가고, 기존 흐름(첫 완주 시 닉 입력)으로 폴백한다.
const TOSS_TOKEN_LS = 'candlebike_toss_token';
async function tossLoginFlow() {
  if (!IS_TOSS || getNick()) return;
  try {
    const login = await requestTossLogin();                 // 셸 appLogin → { authorizationCode }
    const res = await fetch('/api/auth/toss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorizationCode: login?.authorizationCode }),
    });
    if (!res.ok) { console.warn('토스 로그인 API', res.status); return; }
    const data = await res.json();
    if (data.token) localStorage.setItem(TOSS_TOKEN_LS, data.token);
    if (data.nick) setNick(data.nick);                      // 계정 기본 닉 자동 적용
    else promptTossNick(data.token);                        // 첫 로그인 → 닉 1회 입력
  } catch (e) {
    console.warn('토스 로그인 생략', e);                     // 브리지 없음/타임아웃 등 → 폴백
  }
}
// 토스 닉 입력 모달(기존 promptNick 재사용) → 입력 시 계정 기본값으로 서버 저장.
function promptTossNick(token) {
  promptNick(async (n) => {
    setNick(n);
    if (token) {
      try {
        await fetch('/api/toss-nick', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, nick: n }),
        });
      } catch (e) { console.warn('닉 저장 실패', e); }
    }
  });
}
tossLoginFlow();

// ---------------- 공유 링크로 진입 (?c=종목) → 바로 그 종목 도전 ----------------
// 친구가 공유 카드를 눌러 들어오면 해당 종목 코스로 즉시 시작 → 곧장 '같이 도전'.
(function deepLinkStart() {
  const c = new URLSearchParams(location.search).get('c');
  if (!c) return;
  const symbol = c.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) return;
  launch({ symbol, name: lookupName(symbol) });
})();

// ---------------- 실시간 추천 종목 ----------------
let trendingMode = 'gainers';   // 'gainers'(급등주) | 'volume'(거래량)

async function renderTrending() {
  const el = $('trending-list');
  // 열린 장에 맞춰 헤더 표시 (한국장/미국장)
  const headEl = $('trending-head-label');
  if (headEl && CONFIG.STOCK_PROVIDER === 'yahoo') {
    headEl.textContent = activeMarket() === 'kr' ? t.trendingKr : t.trendingUs;
  }
  try {
    const list = await getTrending(trendingMode);
    el.innerHTML = '';
    list.forEach((item) => {
      rememberName(item.symbol, item.name);
      const up = (item.change ?? 0) >= 0;
      const chg = item.change != null ? `${up ? '+' : ''}${item.change}%` : '';
      // 거래량 탭: 우측에 거래량/거래대금, 급등주 탭: 등락률
      const right = trendingMode === 'volume'
        ? `<div class="tc-vol">${escapeHtml(item.volText || '')}</div>`
        : `<div class="tc-chg ${up ? 'up' : 'down'}">${chg}</div>`;
      const div = document.createElement('div');
      div.className = 'trend-chip';
      div.innerHTML =
        `<div class="tc-main">` +
        `<div class="tc-sym">${escapeHtml(item.symbol)}${item.hot ? ' <span class="tc-fire">🔥</span>' : ''}</div>` +
        `<div class="tc-name">${escapeHtml(item.name || '')}</div>` +
        `<div class="tc-diff">${diffBadge(item.symbol)}</div></div>` +
        right;
      div.onclick = () => launchMode(item);
      el.appendChild(div);
    });
    if (!list.length) el.innerHTML = `<div class="trending-skeleton">${t.noTrending}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="trending-skeleton">${t.trendingFail}</div>`;
  }
}

// 급등주 ⇄ 거래량 탭 전환
function setTrendingTab(mode) {
  if (mode === trendingMode) return;
  trendingMode = mode;
  const g = document.getElementById('tab-gainers'), v = document.getElementById('tab-volume');
  if (g) g.classList.toggle('active', mode === 'gainers');
  if (v) v.classList.toggle('active', mode === 'volume');
  $('trending-list').innerHTML = `<div class="trending-skeleton">${t.loadingTrending}</div>`;
  renderTrending();
}
document.getElementById('tab-gainers')?.addEventListener('click', () => setTrendingTab('gainers'));
document.getElementById('tab-volume')?.addEventListener('click', () => setTrendingTab('volume'));

let playCtx = null;   // 재시작용 — 현재 플레이 중인 코스
function startGame(series, symbol, name, opts = {}) {
  playCtx = { series, symbol, name, opts };
  show('play');
  initPlayBanner();
  const canvas = $('game-canvas');
  if (game) { try { game.stop(); } catch {} }   // 이전 게임 정리(재시작 시)
  game = new Game(canvas);
  game._reviveCb = offerRevive;   // 미완주 시 '광고 보고 이어가기' 제안
  game.start(series, symbol, name, onGameEnd, opts);
}

// 부활 제안 — Game이 미완주 종료 직전 호출. true 반환 시 이어가기(연료 회복+복구).
// 광고 보고 이어가기 / 그만하기 / 8초 무응답 자동 포기.
function offerRevive(reason) {
  return new Promise((resolve) => {
    const ov = $('revive-overlay');
    if (!ov) { resolve(false); return; }
    const msg = $('revive-msg');
    if (msg) msg.textContent = reason === 'fuel' ? t.reviveFuel : t.reviveCrash;
    const yes = $('btn-revive-ad'), no = $('btn-revive-skip'), bar = $('revive-bar');
    ov.classList.add('active');
    if (bar) bar.style.width = '100%';

    let done = false;
    let remain = 8;
    const tick = setInterval(() => {
      remain -= 0.1;
      if (bar) bar.style.width = `${Math.max(0, (remain / 8) * 100)}%`;
    }, 100);
    const finish = async (watch) => {
      if (done) return; done = true;
      clearInterval(tick); clearTimeout(to);
      yes.onclick = null; no.onclick = null;
      ov.classList.remove('active');
      if (!watch) { resolve(false); return; }
      resolve(await watchRewardForRevive());
    };
    const to = setTimeout(() => finish(false), 8000);
    yes.onclick = () => finish(true);
    no.onclick = () => finish(false);
  });
}

// 부활용 광고 시청 → 보상(이어가기) 여부.
// 웹: 하우스 리워드 스텁(screen-ad). 토스: 추후 리워드광고 브리지(광고그룹 발급 후 결선).
async function watchRewardForRevive() {
  show('ad');
  let ok = false;
  try { ok = await showRewardedAd(); } catch { ok = false; }
  show('play');
  return ok;
}

// 플레이 중 재시작 — 결과까지 안 기다리고 같은 코스를 즉시 다시
function restartPlay() {
  if (!playCtx) return;
  startGame(playCtx.series, playCtx.symbol, playCtx.name, playCtx.opts);
}
$('btn-restart-play')?.addEventListener('click', restartPlay);

// ?tune=1 테스트 코스 — 다양한 지형(직진·상승·하락·횡보·램프·범프) 무제한 주행
if (new URLSearchParams(location.search).get('tune') === '1') {
  window.__candleStartTest = () => startGame(genTestCourse(), 'TEST', '테스트 코스', { test: true });
}
function genTestCourse() {
  const pts = [];
  let v = 100;
  const push = (val) => pts.push({ date: '2026-01-01', close: +val.toFixed(2) });
  const seg = {
    flat:      (n) => { for (let i = 0; i < n; i++) push(v + Math.sin(i * 0.25) * 0.4); },        // 직진
    up:        (n) => { for (let i = 0; i < n; i++) { v += 0.8; push(v); } },                     // 상승
    down:      (n) => { for (let i = 0; i < n; i++) { v -= 0.8; push(v); } },                     // 하락
    side:      (n) => { for (let i = 0; i < n; i++) push(v + Math.sin(i * 0.5) * 6); },           // 횡보(파도)
    ramp:      (n) => { for (let i = 0; i < n; i++) { v += (i < n / 2 ? 2.4 : -2.4); push(v); } },// 점프대(급상승→급하락)
    bumps:     (n) => { for (let i = 0; i < n; i++) push(v + (i % 6 < 3 ? 4 : -4)); },             // 범프
    steepUp:   (n) => { for (let i = 0; i < n; i++) { v += 1.6; push(v); } },                     // 급상승
    steepDown: (n) => { for (let i = 0; i < n; i++) { v -= 1.6; push(v); } },                     // 급하락
  };
  const plan = [['flat', 60], ['up', 90], ['flat', 40], ['down', 90], ['side', 120], ['ramp', 70],
    ['flat', 50], ['bumps', 60], ['steepUp', 70], ['steepDown', 70], ['side', 100], ['ramp', 80], ['flat', 60]];
  for (let r = 0; r < 6; r++) for (const [k, n] of plan) seg[k](n);   // 길게 반복 → 무제한 느낌
  return pts;
}

// ---------------- 게임 종료 → 리워드 광고 → 결과 ----------------
async function onGameEnd(result) {
  lastResult = result;
  if (AD_MODE !== 'off') {
    show('ad');
    await showRewardedAd();    // 결과 보기 전 5초 강제(하우스 광고)
  }
  await showResult(result);
}

// 멀티 결과 등수 — 플레이어 vs 고스트 최종 순위.
function renderMultiResult(result) {
  const box = $('multi-result');
  if (!box) return;
  if (!result.multi) { box.hidden = true; return; }
  box.hidden = false;
  const rank = result.multiRank, total = result.multiTotal;
  $('mr-headline').textContent = rank === 1 ? `🏆 ${t.multiWin}` : t.multiRankLine(rank, total);
  const ol = $('mr-standings');
  ol.innerHTML = '';
  result.standings.forEach((e) => {
    const li = document.createElement('li');
    if (e.isPlayer) li.classList.add('me');
    const stat = e.finished ? t.timeFmt(Math.round(e.finishTime * 1000)) : `${Math.round(e.progress * 100)}%`;
    li.innerHTML =
      `<span class="mr-rank">${e.rank}</span>` +
      `<span class="mr-dot" style="background:${e.color}"></span>` +
      `<span class="mr-name">${escapeHtml(e.name)}${e.isPlayer ? ` <b>${t.you}</b>` : ''}</span>` +
      `<span class="mr-stat">${stat}</span>`;
    ol.appendChild(li);
  });
}

let regPromise = null;
async function showResult(result) {
  show('result');
  renderHouseAd($('ad-result'), 'result');   // 결과 화면 배너(토스: 토스 배너 / 웹: 하우스·애드센스)
  renderMultiResult(result);                 // 멀티면 등수 표시
  rememberName(result.symbol, result.name);
  $('rc-symbol').textContent = result.name ? `${result.name} (${result.symbol})` : result.symbol;
  if (result.diff) {
    $('rc-diff').innerHTML =
      `<span style="color:${result.diff.color}">${result.diff.stars}</span> ` +
      `${result.diff.label} · ${t.volWord} ${result.diff.volPct}%`;
  }

  // 완주자만 순위(완주 시간) 등록. 미완주(연료소진/추락)는 기록 X — 거리만 표시.
  if (result.completed) {
    $('rc-distance').textContent = (result.timeMs / 1000).toFixed(1);
    $('rc-unit').textContent = t.timeUnit;
    $('rc-rank-line').textContent = '…';
    regPromise = null;
    const nick = getNick();
    if (!nick) {
      promptNick(async (n) => { setNick(n); regPromise = registerAndRender(result, n); await regPromise; });
    } else {
      regPromise = registerAndRender(result, nick);
      await regPromise;
    }
  } else {
    $('rc-distance').textContent = result.distance.toLocaleString();
    $('rc-unit').textContent = 'm';
    $('rc-rank-line').textContent = t.notFinished;
    regPromise = null;
    // 순위 등록은 안 하지만, 목표가 되도록 해당 종목 완주 순위는 보여줌
    await renderLeaderboard(result.symbol, null);
  }
}

async function registerAndRender(result, nick) {
  let rankInfo = { rank: '–', total: 0, percentile: '–', id: null };
  try {
    rankInfo = await submitScore({ nick, symbol: result.symbol, timeMs: result.timeMs });
  } catch (e) { console.warn('순위 등록 실패', e); }

  lastResult.rank = rankInfo.rank;
  lastResult.percentile = rankInfo.percentile;
  lastResult.myId = rankInfo.id;
  $('rc-rank-line').innerHTML = t.rankLine(rankInfo.rank, rankInfo.percentile);

  await renderLeaderboard(result.symbol, rankInfo.id);
}

async function renderLeaderboard(symbol, myId) {
  $('lb-title').textContent = t.leaderboardTitle(symbol);
  const list = await topScores(symbol, 20);
  const ol = $('leaderboard-list');
  ol.innerHTML = '';
  list.forEach((row, i) => {
    const li = document.createElement('li');
    if (row.id === myId) li.classList.add('me');
    const nm = lookupName(row.symbol);
    const symHtml = nm
      ? `${escapeHtml(nm)} <span class="lb-code">${escapeHtml(row.symbol)}</span>`
      : escapeHtml(row.symbol);
    li.innerHTML =
      `<span class="lb-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>` +
      `<span class="lb-nick">${escapeHtml(row.nick)}</span>` +
      `<span class="lb-sym">${symHtml}</span>` +
      `<span class="lb-score">${t.timeFmt(row.score)}</span>`;
    ol.appendChild(li);
  });
  if (list.length === 0) ol.innerHTML = `<li style="justify-content:center;color:var(--muted)">${t.noRecords}</li>`;
}

// ---------------- 닉네임 모달 ----------------
function promptNick(onSave) {
  const modal = $('nick-modal');
  const inp = $('nick-input');
  modal.classList.add('active');
  inp.focus();
  $('nick-save').onclick = () => {
    const n = inp.value.trim() || t.anon;
    modal.classList.remove('active');
    onSave(n);
  };
}

// ---------------- 공유 / 저장 ----------------
$('btn-share').onclick = async () => {
  if (!lastResult) return;
  if (regPromise) { try { await regPromise; } catch {} }   // 순위 등록 완료 후 공유 (기록 정확히 반영)
  const r = await shareResult(lastResult);
  if (r === 'shared-copied') showToast(t.shareLinkCopied);
};

// 가벼운 비차단 토스트(공유 안내·데모 알림 등). top:true 면 상단(플레이 중 하단 조작버튼 회피).
function showToast(msg, { top = false } = {}) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.classList.toggle('toast--top', !!top);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3800);
}
$('btn-save-card').onclick = async () => {
  if (!lastResult) return;
  if (regPromise) { try { await regPromise; } catch {} }
  saveCard(lastResult);
};

// ---------------- 네비게이션 ----------------
$('btn-retry').onclick = () => {
  if (!selected) return show('home');
  launchMode(selected);
};
$('btn-home').onclick = () => { show('home'); input.value = ''; selected = null; $('btn-start').disabled = true; };
$('btn-leaderboard-home').onclick = async () => {
  show('result');
  $('result-card').style.display = 'none';
  document.querySelector('.share-row').style.display = 'none';
  await renderLeaderboard(null);
};

// ---------------- 데이터 모드 안내 ----------------
const PROVIDER_LABELS = { yahoo: t.providerYahoo, mock: t.providerMock, twelvedata: t.providerTd, proxy: t.providerProxy };
$('data-mode-note').textContent = t.dataNote(
  PROVIDER_LABELS[CONFIG.STOCK_PROVIDER] || getProvider().label,
  isRemote(),
  currentPeriod()
);

renderTrending();

// 하우스 광고 — 홈/결과 배너 위치
renderHouseAd($('ad-home'), 'banner');
renderHouseAd($('ad-result'), 'result');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 결과 화면 재진입 시 카드 다시 보이게
$('btn-retry').addEventListener('click', () => { $('result-card').style.display = ''; document.querySelector('.share-row').style.display = ''; });
$('btn-home').addEventListener('click', () => { $('result-card').style.display = ''; document.querySelector('.share-row').style.display = ''; });

show('home');
