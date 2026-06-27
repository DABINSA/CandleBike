// 앱 흐름(화면 상태머신)을 묶는 진입점.
// 홈 → (검색/선택) → 로딩 → 플레이 → 리워드광고 → 결과/순위

import { CONFIG } from './config.js';
import { t, applyStatic, LANG, setLang, ANON_NICKS, randomNick } from './i18n.js';
import { searchSymbols, getTrending, getProvider, activeMarket } from './stock/provider.js';
import { getCourse, getLastCourseSource, currentPeriod } from './courseCache.js';
import { Game } from './game/game.js';
import { initPlayBanner, showRewardedAd, renderHouseAd, tossPreResultGate } from './ads/ads.js';
import { submitScore, topScores, getNick, setNick, isRemote } from './leaderboard/leaderboard.js';
import { startRankTicker, registerTicker, showLocalRankEvent, showGhostRankEvent, repaintTicker } from './leaderboard/rankTicker.js';
import { shareResult, saveCard } from './share/share.js';
import * as Items from './items/items.js';
import { drawPreview } from './game/vehicles.js';
import { getClient } from './supabaseClient.js';
import { pickGhostNames } from './game/ghosts.js';
import { quickDifficulty } from './difficulty.js';
import { MOCK_SYMBOLS } from './stock/mockData.js';
import * as audio from './audio.js';
import { IS_TOSS, effectiveAdMode, requestTossLogin, requestTossRewardAd, IS_TOSS_REWARD_READY, requestTossShareReward, IS_TOSS_SHARE_READY, logTossEvent } from './toss.js';
import { initClarity } from './analytics/clarity.js';
import { recordVisit } from './analytics/beacon.js';
import { refreshTossAdSlots, showTossBanner, hideTossBanner } from './tossAds.js';   // 토스 배너(고정/이미지)
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
  repaintTicker();        // 새로 보이는 화면의 1위 띠를 정확한 폭으로 다시 그림(플레이 전환 시 누락 방지)
  refreshTossAdSlots();   // 결과 보기 전 이미지 배너(좌표 오버레이) 재통지
  if (IS_TOSS) {
    // 자리별 하단 고정 배너 — 화면당 1개, 스크롤 추적 안 함(깜빡임 없음).
    // 'ad'(결과 보기 전)은 자체 큰 이미지 배너가 있어 하단 배너는 숨김.
    if (name === 'home') showTossBanner(CONFIG.TOSS_AD?.bannerHome, { position: 'bottom', height: 64 });
    else if (name === 'play') showTossBanner(CONFIG.TOSS_AD?.bannerPlay, { position: 'bottom', height: 64 });
    else if (name === 'result') showTossBanner(CONFIG.TOSS_AD?.bannerResult, { position: 'bottom', height: 64 });
    else hideTossBanner();
  }
}

let selected = null;     // { symbol, name }
let gameMode = 'single'; // 'single' | 'multi'(가짜 AI 경쟁)
let game = null;
let lastResult = null;    // { symbol, distance, flips, score }
let multiGhostRows = [];  // 멀티 결과 순위표에 표시용으로 합칠 고스트 기록(완주자) — DB엔 저장 안 함

applyStatic();           // 정적 텍스트를 접속 언어로 채움
initClarity();           // Microsoft Clarity (웹에서만, 토스 인앱 제외)
recordVisit();           // 방문 비콘(/api/hit) — 웹+토스 방문/고유방문자 집계

// 1위 달성 알림 띠 — 홈/결과 화면에 마운트 후 최근 이벤트 조회 + 실시간 구독 시작.
registerTicker($('rank-ticker-home'));
registerTicker($('rank-ticker-result'));
registerTicker($('rank-ticker-play'));
startRankTicker({ nameOf: lookupName });   // 도전 문구 종목명 예쁘게(코드→기업명)
// 토스 인앱: 토스 헤더가 상단을 차지하므로 페이지 상단 safe-area 여백을 0으로(이중 여백 제거).
if (IS_TOSS) { document.documentElement.style.setProperty('--sat', '0px'); document.body.classList.add('in-toss'); }

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

// ---------------- 닉네임 ----------------
// 홈 칩에 현재 닉 표시(기본 익명닉이면 '닉네임 설정' 안내). 클릭 시 언제든 변경.
function updateNickButton() {
  const el = $('nick-val');
  if (!el) return;
  const n = getNick();
  el.textContent = (n && !ANON_NICKS.includes(n)) ? n : t.nickSet;
}
// 닉 저장 — 로컬 저장 + (토스 로그인 상태면) 계정 기본닉으로 서버에도 반영.
function saveNick(n) {
  setNick(n);
  updateNickButton();
  const token = localStorage.getItem(TOSS_TOKEN_LS);
  if (IS_TOSS && token) {
    fetch('/api/toss-nick', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, nick: n }),
    }).catch((e) => console.warn('닉 저장 실패', e));
  }
  syncPush();   // 닉을 계정 인벤토리(토스/구글)에도 동기화
}
// 홈 닉네임 칩(변경)은 '로그인 상태'에서만 노출 — 토스(자동) 또는 구글 로그인. 게스트는 숨김(완주 시 입력).
let googleUser = null;   // Supabase auth user (구글 로그인 시) — 닉칩/동기화 분기에 사용
$('btn-nick').onclick = () => promptNick((n) => saveNick(n), { prefill: getNick() });
function refreshNickChip() {
  const visible = IS_TOSS || !!googleUser;
  $('btn-nick').style.display = visible ? '' : 'none';
  if (visible) updateNickButton();
}
refreshNickChip();

// ---------------- 인벤토리 계정 동기화 (토스) ----------------
// 토스 토큰이 있으면 아이템을 클라우드(계정)에 저장/병합 → 재설치·기기변경에도 유지.
// 게스트(토큰 없음)는 호출 안 함 → localStorage(같은 기기 영구)만.
let invToken = null;
function invPush() {
  if (!invToken) return;
  fetch('/api/inventory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invToken, data: { ...Items.exportState(), nick: getNick() } }),
  }).catch(() => {});
}
async function invPull(token) {
  if (!token) return;
  invToken = token;
  try {
    const r = await fetch('/api/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.data && Object.keys(j.data).length) {
        Items.mergeFrom(j.data);
        if (j.data.nick && !getNick()) { setNick(j.data.nick); }   // 계정 닉 복원(로컬 비어있을 때)
        updateNickButton();
      }
    }
  } catch { /* 동기화 실패는 조용히 — 게스트처럼 계속 동작 */ }
  invPush();   // 병합 결과(또는 첫 바인딩)를 클라우드에 반영
}

// ---------------- 구글 로그인 (Supabase Auth) — 웹/원스토어 영구 귀속 ----------------
// 토스는 위 토스 토큰 경로를 쓰므로 구글 로그인은 비-토스에서만. (googleUser 는 닉 섹션에서 선언)
async function initGoogleAuth() {
  if (IS_TOSS) return;
  const supa = await getClient();
  if (!supa) return;
  try {
    const { data } = await supa.auth.getSession();
    googleUser = data?.session?.user || null;
    if (googleUser) await googlePull();
    supa.auth.onAuthStateChange((_e, session) => {
      const was = googleUser?.id;
      googleUser = session?.user || null;
      updateGarageLogin();
      refreshNickChip();
      if (googleUser && googleUser.id !== was) googlePull();
    });
  } catch (e) { console.warn('구글 인증 초기화', e); }
  updateGarageLogin();
  refreshNickChip();
}
async function googlePull() {
  const supa = await getClient(); if (!supa || !googleUser) return;
  const owner = 'google:' + googleUser.id;
  try {
    const { data } = await supa.from('inventory').select('data').eq('owner', owner).maybeSingle();
    if (data?.data && Object.keys(data.data).length) {
      Items.mergeFrom(data.data);
      if (data.data.nick && !getNick()) setNick(data.data.nick);   // 계정 닉 복원(로컬 비어있을 때)
      updateNickButton(); refreshNickChip();
    }
  } catch (e) { console.warn('인벤토리 조회', e); }
  await googlePush();   // 병합/첫 바인딩 반영
}
async function googlePush() {
  const supa = await getClient(); if (!supa || !googleUser) return;
  try {
    await supa.from('inventory').upsert({ owner: 'google:' + googleUser.id, data: { ...Items.exportState(), nick: getNick() }, updated_at: new Date().toISOString() });
  } catch (e) { console.warn('인벤토리 저장', e); }
}
async function googleLogin() {
  const supa = await getClient(); if (!supa) { showToast(t.loginUnavailable); return; }
  try {
    await supa.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  } catch (e) { console.warn('구글 로그인', e); showToast(t.loginUnavailable); }
}
async function googleLogout() {
  const supa = await getClient(); if (!supa) return;
  try { await supa.auth.signOut(); } catch {}
  googleUser = null; updateGarageLogin(); refreshNickChip();
}

// 변경분을 활성 계정(토스/구글)에 반영. 게스트면 아무것도 안 함(localStorage만).
function syncPush() { if (invToken) invPush(); else if (googleUser) googlePush(); }

// 차고 로그인 행 렌더 (토스는 계정 자동이라 숨김)
function updateGarageLogin() {
  const row = $('garage-login-row');
  if (!row) return;
  // 게스트 경고는 '로그인 안 된 상태'에서만 (토스=계정 자동귀속, 구글 로그인 시 숨김)
  const loggedIn = IS_TOSS || !!googleUser;
  const warn = $('garage-warn');
  if (warn) warn.style.display = loggedIn ? 'none' : '';
  if (IS_TOSS) { row.classList.remove('show'); row.innerHTML = ''; return; }
  row.classList.add('show');
  if (googleUser) {
    row.innerHTML = `<div class="login-status">${escapeHtml(t.loginedAs(googleUser.email || 'Google'))} · <button id="g-logout" class="link-btn"></button></div>`;
    $('g-logout').textContent = t.logout;
    $('g-logout').onclick = () => googleLogout();
  } else {
    row.innerHTML = `<button class="btn btn-primary" id="g-login"></button>`;
    $('g-login').textContent = t.loginSave;
    $('g-login').onclick = () => googleLogin();
  }
}

// ---------------- 차고 / 아이템 ----------------
const garageModal = $('garage-modal');
let garageTab = 'consum';   // 기본 탭: 소모품 먼저
let acquiring = false;

// 탈것 기본 퍽 → 소모품 이모지+이름 '개별 배지'(2개 이상이면 줄바꿈으로 카드 안에 정렬)
function perkBadges(perk) {
  const items = Object.keys(perk || {}).map((id) => {
    const c = Items.CONSUMABLES.find((x) => x.id === id);
    return c ? `${c.emoji} ${escapeHtml(Items.itemName(c))}` : '';
  }).filter(Boolean);
  const inner = items.length
    ? items.map((s) => `<span class="item-perk">${s}</span>`).join('')
    : '<span class="item-perk">&nbsp;</span>';
  return `<div class="item-perks">${inner}</div>`;
}
// 토큰 잔액 칩 + 광고 버튼 라벨 갱신
function updateTokenUI() {
  const n = $('garage-tok-n'); if (n) n.textContent = Items.getTokens();
  const ad = $('garage-ad-tokens');
  if (ad) ad.innerHTML = `🎬 ${t.adGet} <span class="coin"></span> +${Items.AD_REWARD}`;
}
// 카드 안 탈것 캔버스 썸네일을 실제 게임 아트로 그림
function paintVehicleThumbs() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  document.querySelectorAll('#garage-body .veh-thumb').forEach((cv) => {
    const W = 118, H = 80;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { drawPreview(ctx, cv.dataset.veh, Items.equippedColor(), W, H); } catch {}
  });
}
function renderGarage() {
  const body = $('garage-body');
  updateTokenUI();
  if (garageTab === 'vehicles') {
    body.innerHTML = Items.VEHICLES.map((v) => {
      const owned = Items.ownsVehicle(v.id);
      const on = Items.equippedVehicle() === v.id;
      const afford = Items.getTokens() >= (v.cost || 0);
      const btn = owned
        ? `<button class="item-btn ${on ? 'ghost' : 'primary'}" data-eqveh="${v.id}" ${on ? 'disabled' : ''}>${on ? t.equipped : t.equip}</button>`
        : `<button class="item-btn buy-btn" data-buyveh="${v.id}" ${afford ? '' : 'disabled'}><span class="coin"></span> ${v.cost}</button>`;
      return `<div class="item-card ${on ? 'on' : ''}">
        <canvas class="veh-thumb" data-veh="${v.id}"></canvas>
        <span class="item-name">${escapeHtml(Items.itemName(v))}</span>
        ${perkBadges(v.perk)}
        <div class="item-actions">${btn}</div></div>`;
    }).join('');
  } else {
    body.innerHTML = Items.CONSUMABLES.map((c) => {
      const cnt = Items.consumCount(c.id);
      const eq = Items.isEquipped(c.id);
      const afford = Items.getTokens() >= (c.cost || 0);
      const bringBtn = cnt > 0
        ? `<button class="item-btn ${eq ? 'primary' : 'ghost'}" data-bring="${c.id}">${eq ? t.bringing : t.bring}</button>`
        : '';
      return `<div class="item-card ${eq ? 'on' : ''}">
        <span class="item-emoji">${c.emoji}</span>
        <span class="item-name">${escapeHtml(Items.itemName(c))}</span>
        <span class="item-sub">${escapeHtml(Items.itemDesc(c))} · ${t.haveN(cnt)}</span>
        <div class="item-actions">${bringBtn}
        <button class="item-btn buy-btn" data-buyconsum="${c.id}" ${afford ? '' : 'disabled'}><span class="coin"></span> ${c.cost}</button></div></div>`;
    }).join('');
  }
  // 공유 리워드 — 토스 + 공유 브리지 + 오늘 미수령일 때만, 차고 상단에.
  if (shareRewardAvailable()) {
    body.insertAdjacentHTML('afterbegin',
      `<button class="item-btn primary" id="share-reward-btn" style="grid-column:1/-1">${t.shareReward}</button>`);
    const srb = $('share-reward-btn');
    if (srb) srb.onclick = () => doShareReward();
  }
  if (garageTab === 'vehicles') paintVehicleThumbs();
}
function openGarage(tab) {
  garageTab = tab || garageTab;
  document.querySelectorAll('.garage-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === garageTab));
  updateGarageLogin();
  updateTokenUI();
  renderGarage();
  garageModal.classList.add('active');
}
function closeGarage() { garageModal.classList.remove('active'); }

// ── 공유 리워드(토스 contactsViral) ───────────────────────────────────────
// 친구에게 공유 완료 시 토큰 지급(일 1회). 토스 + 새 .ait(공유 브리지)에서만 노출.
// 토큰 경제와 일치 — 받은 토큰으로 차고에서 원하는 아이템을 산다(콘솔 단위 '토큰'/수량과 동일).
const SHARE_DAY_KEY = 'cr_share_reward_day';
function todayStr() { return new Date().toISOString().slice(0, 10); }
function shareRewardClaimedToday() { try { return localStorage.getItem(SHARE_DAY_KEY) === todayStr(); } catch { return false; } }
function shareRewardAvailable() {
  return IS_TOSS && IS_TOSS_SHARE_READY && !!CONFIG.TOSS_SHARE?.reward && !shareRewardClaimedToday();
}
function shareRewardTokens() { return CONFIG.TOSS_SHARE?.tokens || Items.AD_REWARD; }
// 친구 공유 → 성공 시 토큰 지급(일 1회).
async function doShareReward() {
  if (acquiring || !CONFIG.TOSS_SHARE?.reward) return;
  if (shareRewardClaimedToday()) { showToast(t.shareRewardDone); return; }
  acquiring = true;
  let shared = false;
  try {
    const r = await requestTossShareReward(CONFIG.TOSS_SHARE.reward);
    shared = !!(r && r.shared);
  } catch (e) { console.warn('공유 리워드', e); }
  acquiring = false;
  if (!shared) return;   // 공유 안 함/취소 → 보상 없음(조용히)
  try { localStorage.setItem(SHARE_DAY_KEY, todayStr()); } catch {}
  const amount = shareRewardTokens();
  Items.addTokens(amount);
  logTossEvent('share_reward', { tokens: amount });
  renderGarage(); syncPush();
  celebrateTokens(amount, t.coinShare);
}

// 리워드 광고 보고 토큰 적립 — 토스: 실제 리워드 광고(끝까지 봐야 지급), 웹/원스토어: 5초 게이트.
async function watchAdForTokens() {
  if (acquiring) return;
  acquiring = true;
  if (IS_TOSS && IS_TOSS_REWARD_READY && CONFIG.TOSS_AD?.reward) {
    try {
      const r = await requestTossRewardAd(CONFIG.TOSS_AD.reward);
      if (!r || !r.rewarded) { showToast(t.adNotComplete); acquiring = false; return; }
    } catch (e) { console.warn('리워드 광고', e); showToast(t.adFailed); acquiring = false; return; }
    Items.addTokens(Items.AD_REWARD);
    renderGarage();
  } else if (!IS_TOSS && AD_MODE !== 'off') {
    closeGarage();
    show('ad');
    try { await showRewardedAd(); } catch {}
    Items.addTokens(Items.AD_REWARD);
    show('home');
    openGarage();
  } else {
    // 광고 off(토스 구버전/미설정) → 즉시 지급(임시)
    Items.addTokens(Items.AD_REWARD);
    renderGarage();
  }
  syncPush();
  logTossEvent('ad_tokens', { amount: Items.AD_REWARD });
  acquiring = false;
  celebrateTokens(Items.AD_REWARD, t.coinAd);
}

// 토큰으로 구매(탈것/소모품). 부족하면 안내.
function buyVehicle(id) {
  const v = Items.VEHICLES.find((x) => x.id === id);
  if (!v) return;
  if (!Items.buyVehicle(id)) { showToast(t.notEnoughTokens); return; }
  renderGarage(); syncPush();
  logTossEvent('buy_vehicle', { id, cost: v.cost });
  showToast(t.bought(Items.itemName(v)));
  if (!IS_TOSS && !googleUser) setTimeout(() => showToast(t.loginHint), 1600);   // 영구=로그인 보관 안내
}
function buyConsumable(id) {
  const c = Items.CONSUMABLES.find((x) => x.id === id);
  if (!c) return;
  if (!Items.buyConsum(id)) { showToast(t.notEnoughTokens); return; }
  renderGarage(); syncPush();
  logTossEvent('buy_consum', { id, cost: c.cost });
  showToast(t.bought(Items.itemName(c)));
}

$('garage-body').addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.dataset.eqveh) { Items.equipVehicle(el.dataset.eqveh); renderGarage(); syncPush(); return; }
  if (el.dataset.bring) { Items.toggleEquip(el.dataset.bring); renderGarage(); syncPush(); return; }
  if (el.dataset.buyveh) { buyVehicle(el.dataset.buyveh); return; }
  if (el.dataset.buyconsum) { buyConsumable(el.dataset.buyconsum); return; }
});
$('garage-ad-tokens').onclick = () => watchAdForTokens();
$('btn-garage').onclick = () => openGarage('consum');
$('garage-close').onclick = closeGarage;
document.querySelectorAll('.garage-tab').forEach((b) => { b.onclick = () => openGarage(b.dataset.tab); });

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
  if (item && item.symbol) logTossEvent('game_start', { symbol: item.symbol, mode: gameMode });
  if (gameMode === 'multi') return launchMulti(item);
  return launch(item);
}

// 멀티(가짜) — 2~4명 더미와 매칭되는 척 → 코스 로드 → 고스트와 경주.
async function launchMulti(item) {
  if (!item) return;
  selected = item;
  const count = 3 + Math.floor(Math.random() * 4);     // 3~6명(사람 많아 보이게)
  const ghostNames = pickGhostNames(count);
  const myNick = getNick() || t.you;   // 닉 없으면(게스트/미완주) '나'로 표시(익명라이더 X)
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
// 토스 로그인 → user_key 귀속(toss_users) + 계정 기본닉 동기화.
// 반환: 'has'(닉 보유·귀속완료) 'set'(계정닉 적용) 'prompted'(닉 모달) 'none'(실패) 'skip'(토스 아님).
// 🔴 닉이 있어도 매 진입 시 로그인을 거친다 — 그래야 기존 유저도 toss_users 에 귀속되어 '가입'으로 잡힘.
async function tossLoginFlow() {
  if (!IS_TOSS) return 'skip';
  try {
    const login = await requestTossLogin();                 // 셸 appLogin → { authorizationCode, referrer }
    if (!login?.authorizationCode) return 'none';           // 브리지 없음/구셸 → 폴백
    const res = await fetch('/api/auth/toss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorizationCode: login.authorizationCode, referrer: login.referrer }),
    });
    if (!res.ok) { console.warn('토스 로그인 API', res.status); return 'none'; }
    const data = await res.json();
    if (data.token) { localStorage.setItem(TOSS_TOKEN_LS, data.token); invPull(data.token); }
    let localNick = getNick();
    // 차단된 로컬 닉이면 비우고 강제 재입력으로 유도(아래 promptNick)
    if (localNick && !(await nickAllowed(localNick))) {
      setNick(''); updateNickButton(); showToast(t.nickForced, { top: true }); localNick = '';
    }
    const acctOk = data.nick && (await nickAllowed(data.nick));
    // 계정닉이 멀쩡하고 로컬엔 없으면 → 계정닉 채택
    if (acctOk && !localNick) { setNick(data.nick); updateNickButton(); return 'set'; }
    // 로컬 닉이 있고 계정엔 없거나 다르면 → 계정에 저장(=toss_users 적재/갱신). 토큰 있을 때만.
    if (localNick && data.token && data.nick !== localNick) { saveNick(localNick); }
    if (localNick) return 'has';
    // 로컬·계정 둘 다 (멀쩡한) 닉 없음 → 닉 입력(저장 시 toss_users 적재)
    promptNick((n) => saveNick(n));
    return 'prompted';
  } catch (e) {
    console.warn('토스 로그인 생략', e);                     // 브리지 없음/타임아웃 등 → 폴백
    return 'none';
  }
}
// 최초 1회 닉 입력 — '토스(로그인 진입)'에서만. 웹/원스토어는 첫 진입 프롬프트 없이
// 완주 시점에 닉을 입력받는다(아래 결과 처리). 변경은 토스 홈의 닉네임 칩에서.
async function firstRunNick() {
  if (!IS_TOSS) { enforceNickBan(); return; }   // 웹/원스토어: 차단된 닉이면 강제 변경
  const r = await tossLoginFlow();
  if (r === 'has' || r === 'set' || r === 'prompted') return;
  if (!getNick()) promptNick((n) => saveNick(n));   // 토스 로그인 브리지/API 실패 폴백
}
firstRunNick();
// 재방문 토스 유저(이미 로그인됨): 저장된 토큰으로 인벤토리 클라우드 동기화.
if (IS_TOSS) { try { const _tk = localStorage.getItem(TOSS_TOKEN_LS); if (_tk) invPull(_tk); } catch {} }
else initGoogleAuth();   // 웹/원스토어: 구글 로그인 세션 복원 + 인벤토리 동기화

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
  // 아이템 — 장착 소모품(여기서 1회 소모) + 탈것 기본 퍽을 합산해 적용. 재시작 시 중복 소모 방지(_items).
  if (!opts.test && !opts._items) {
    const used = Items.consumeEquipped();   // {id:true} — 장착 소모품 소모
    const perk = Items.equippedPerk();      // {id:count} — 탈것 기본 퍽(무료)
    const consum = {};
    for (const id in used) consum[id] = (consum[id] || 0) + 1;
    for (const id in perk) consum[id] = (consum[id] || 0) + (perk[id] || 0);
    opts = { ...opts, _items: true, skinColor: Items.equippedColor(), vehicle: Items.equippedVehicle(), consum };
    syncPush();   // 소모품 사용분 클라우드 반영
  }
  playCtx = { series, symbol, name, opts };
  $('pause-menu')?.classList.remove('active');
  try { history.pushState({ play: 1 }, ''); } catch {}   // 뒤로가기 가로채기용 버퍼
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
// 토스: '이어하기' 리워드 광고(네이티브 전면) — 끝까지 봐야 부활. 웹/원스토어: 하우스 리워드 스텁(screen-ad).
async function watchRewardForRevive() {
  if (IS_TOSS && IS_TOSS_REWARD_READY && CONFIG.TOSS_AD?.revive) {
    try {
      const r = await requestTossRewardAd(CONFIG.TOSS_AD.revive);
      logTossEvent('revive_ad', { rewarded: !!(r && r.rewarded) });
      return !!(r && r.rewarded);
    } catch (e) { console.warn('이어하기 광고', e); return false; }
  }
  show('ad');
  let ok = false;
  try { ok = await showRewardedAd(); } catch { ok = false; }
  show('play');
  return ok;
}

// 플레이 중 재시작 — 같은 코스를 다시. 멀티는 바로 재시작하면 가짜 티가 나므로
// '다른 라이더 찾는 중' 매칭 연출을 다시 거치고(새 경쟁자) 시작한다.
async function restartPlay() {
  if (!playCtx) return;
  if (playCtx.opts && playCtx.opts.multi) {
    if (game) { try { game.stop(); } catch {} }
    const count = 3 + Math.floor(Math.random() * 4);
    const ghostNames = pickGhostNames(count);
    const myNick = getNick() || t.you;   // 닉 없으면(게스트/미완주) '나'로 표시(익명라이더 X)
    await runMatchmaking(myNick, ghostNames);
    startGame(playCtx.series, playCtx.symbol, playCtx.name,
      { multi: true, nick: myNick, ghostCount: count, ghostNames });
    return;
  }
  startGame(playCtx.series, playCtx.symbol, playCtx.name, playCtx.opts);
}

// 게임 중 일시정지/메뉴 — 톱니 버튼 또는 모바일 뒤로가기로 연다.
// 멀티는 라이브라 일시정지(계속하기) 없이 다시 하기 / 다른 종목만 노출.
function openPauseMenu() {
  const menu = $('pause-menu');
  if (menu.classList.contains('active')) return;
  $('pm-resume').style.display = (game && game.multi) ? 'none' : '';
  menu.classList.add('active');
  if (game && !game.multi) game.pause();
}
function closePauseMenu(resume) {
  $('pause-menu').classList.remove('active');
  if (resume && game && !game.multi) game.resume();   // 일시정지는 싱글만
}
function togglePauseMenu() {
  if ($('pause-menu').classList.contains('active')) closePauseMenu(true);
  else openPauseMenu();
}
$('btn-pause')?.addEventListener('click', togglePauseMenu);
$('pm-resume')?.addEventListener('click', () => closePauseMenu(true));
$('pm-restart')?.addEventListener('click', () => { closePauseMenu(false); restartPlay(); });
$('pm-quit')?.addEventListener('click', () => {
  closePauseMenu(false);
  if (game) { try { game.stop(); } catch {} }
  show('home');
});

// 모바일 뒤로가기 → 그냥 나가지 말고 일시정지 메뉴(플레이 중일 때만 가로채기).
window.addEventListener('popstate', () => {
  if (!$('screen-play').classList.contains('active')) return;
  history.pushState({ play: 1 }, '');   // 뒤로가기 소비를 막고 다음에도 가로채게 재무장
  togglePauseMenu();
});

// ?tune=1 테스트 코스 — 다양한 지형(직진·상승·하락·횡보·램프·범프) 무제한 주행
if (new URLSearchParams(location.search).get('tune') === '1') {
  window.__candleStartTest = () => startGame(genTestCourse(), 'TEST', '테스트 코스', { test: true });
  window.__candleGame = () => game;   // 튜닝 패널이 현재 플레이 중인 게임에 아이템을 라이브 적용
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
  // 핵심지표 — game_complete(완주)가 대표 전환. game_end는 보조(완주율 분모).
  logTossEvent('game_end', { symbol: result.symbol, completed: !!result.completed });
  if (result.completed) logTossEvent('game_complete', { symbol: result.symbol });
  // 완주 보상 — 토큰 적립(한 게임당 1회). 클라우드 동기화. 연출은 결과 화면에서(아래 showResult).
  if (result.completed && !result._rewarded) {
    result._rewarded = true;
    Items.addTokens(Items.FINISH_REWARD);
    syncPush();
  }
  if (IS_TOSS && CONFIG.TOSS_AD?.bannerPre) {
    show('ad');
    await tossPreResultGate();   // 토스: 결과 보기 전 배너(이미지 강조) + 2초
  } else if (AD_MODE !== 'off') {
    show('ad');
    await showRewardedAd();      // 웹: 결과 보기 전 5초 하우스 광고
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
      `<span class="mr-name">${escapeHtml(e.name)}${e.isPlayer && e.name !== t.you ? ` <b>${t.you}</b>` : ''}</span>` +
      `<span class="mr-stat">${stat}</span>`;
    ol.appendChild(li);
  });
}

let regPromise = null;
async function showResult(result) {
  show('result');
  $('lb-back').hidden = true;   // 일반 결과 화면에선 전체순위 전용 뒤로가기 숨김
  // 완주 보상 연출 — 폭죽 + "+10" 카운트업(한 번만)
  if (result.completed && !result._celebrated) {
    result._celebrated = true;
    setTimeout(() => celebrateTokens(Items.FINISH_REWARD), 250);
  }
  renderHouseAd($('ad-result'), 'result');   // 결과 화면 배너(토스: 토스 배너 / 웹: 하우스·애드센스)
  renderMultiResult(result);                 // 멀티면 등수 표시
  // 멀티: 완주한 고스트를 순위표에 함께 표시(진짜 같이 한 것처럼). DB엔 저장 안 함.
  multiGhostRows = (result.multi && result.standings)
    ? result.standings.filter((e) => !e.isPlayer && e.finished)
        .map((e) => ({ nick: e.name, symbol: result.symbol, score: Math.round(e.finishTime * 1000), id: null }))
    : [];
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
      promptNick(async (n) => { saveNick(n); regPromise = registerAndRender(result, n); await regPromise; });
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
    rankInfo = await submitScore({ nick, symbol: result.symbol, timeMs: result.timeMs, name: result.name || lookupName(result.symbol) || '' });
  } catch (e) { console.warn('순위 등록 실패', e); }

  lastResult.rank = rankInfo.rank;
  lastResult.percentile = rankInfo.percentile;
  lastResult.myId = rankInfo.id;
  $('rc-rank-line').innerHTML = t.rankLine(rankInfo.rank, rankInfo.percentile);

  // 1위 알림 띠 — 결과 화면에 즉시 표시(실시간 왕복 없이).
  //  · 멀티: 고스트가 나보다 빠르고 실제 기록까지 제쳤으면 '고스트가 1위'(화면에만, 실재감).
  //  · 그 외 내가 진짜 1위(rank===1)면 '내가 1위'. 둘은 동시에 뜨지 않음(순위표와 일관).
  const dispName = result.name || lookupName(result.symbol) || '';
  const myMs = result.completed ? Math.round(result.timeMs) : Infinity;
  let realBest = Infinity;
  try { const top = await topScores(result.symbol, 1); if (top && top[0]) realBest = top[0].score; } catch {}
  const topGhost = (result.multi && multiGhostRows.length)
    ? multiGhostRows.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  const ghostIsTop = !!topGhost && topGhost.score < realBest && topGhost.score < myMs;

  if (ghostIsTop) {
    showGhostRankEvent({ nick: topGhost.nick, symbol: result.symbol, name: dispName });
  } else if (rankInfo.rank === 1) {
    showLocalRankEvent({ nick, symbol: result.symbol, name: dispName });
  }

  await renderLeaderboard(result.symbol, rankInfo.id);
}

async function renderLeaderboard(symbol, myId) {
  // 제목도 종목명 + 코드로 (이름 알 때). 예: "금호건설 (002990.KS) 순위"
  const titleNm = symbol ? lookupName(symbol) : null;
  $('lb-title').textContent = t.leaderboardTitle(symbol ? (titleNm ? `${titleNm} (${symbol})` : symbol) : null);
  let list = await topScores(symbol, 20);
  // 멀티: 완주한 고스트 기록을 합쳐 같은 순위표에 보이게(표시 전용)
  if (symbol && multiGhostRows.length) {
    list = [...list, ...multiGhostRows].sort((a, b) => a.score - b.score).slice(0, 20);
  }
  const ol = $('leaderboard-list');
  ol.innerHTML = '';
  list.forEach((row, i) => {
    const li = document.createElement('li');
    if (row.id === myId) li.classList.add('me');
    const nm = lookupName(row.symbol);
    const symHtml = nm
      ? `${escapeHtml(nm)} <span class="lb-code">${escapeHtml(row.symbol)}</span>`
      : escapeHtml(row.symbol);
    // 기본 익명 닉은 저장 시점 언어로 박혀 있으므로(예: '익명라이더') 보는 언어로 치환.
    const dispNick = ANON_NICKS.includes(row.nick) ? t.anon : row.nick;
    li.innerHTML =
      `<span class="lb-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>` +
      `<span class="lb-nick">${escapeHtml(dispNick)}</span>` +
      `<span class="lb-sym">${symHtml}</span>` +
      `<span class="lb-score">${t.timeFmt(row.score)}</span>`;
    ol.appendChild(li);
  });
  if (list.length === 0) ol.innerHTML = `<li style="justify-content:center;color:var(--muted)">${t.noRecords}</li>`;
}

// ---------------- 닉네임 모달 ----------------
function promptNick(onSave, { prefill = '' } = {}) {
  const modal = $('nick-modal');
  const inp = $('nick-input');
  // 빈 닉이면 '익명' 대신 랜덤 더미닉을 미리 채워 제안(우선 적용, 사용자가 바꿔도 됨)
  inp.value = prefill && !ANON_NICKS.includes(prefill) ? prefill : randomNick();
  modal.classList.add('active');
  inp.focus();
  $('nick-save').onclick = async () => {
    const n = inp.value.trim() || randomNick();   // 비우고 저장해도 랜덤 닉 적용
    // 금지어 검증(banned_words 직접 조회). 막히면 모달 유지 + 안내.
    // 조회 실패 시엔 통과 — 서버(/api/score·/api/toss-nick)가 백스톱으로 막음.
    const btn = $('nick-save');
    btn.disabled = true;
    const allowed = await nickAllowed(n);
    btn.disabled = false;
    if (!allowed) { showToast(t.nickBanned, { top: true }); return; }
    modal.classList.remove('active');
    onSave(n);
  };
}

// ── 닉네임 금지어(클라 즉시 검사) — 서버 _moderation.normalize 와 동일 기준 ──
function normNick(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[^0-9a-z가-힣ㄱ-ㆎ]/g, '');
}
let _bannedWords = null;
async function loadBannedWords() {
  if (_bannedWords) return _bannedWords;
  _bannedWords = [];
  try {
    const c = await getClient();
    if (c) {
      const { data } = await c.from('banned_words').select('word');
      if (Array.isArray(data)) _bannedWords = data.map((x) => normNick(x.word)).filter(Boolean);
    }
  } catch (e) { console.warn('banned_words 조회', e); }
  return _bannedWords;
}
let _nickBans = null;
async function loadNickBans() {
  if (_nickBans) return _nickBans;
  _nickBans = new Set();
  try {
    const c = await getClient();
    if (c) {
      const { data } = await c.from('nick_bans').select('nick');
      if (Array.isArray(data)) _nickBans = new Set(data.map((x) => normNick(x.nick)).filter(Boolean));
    }
  } catch (e) { console.warn('nick_bans 조회', e); }
  return _nickBans;
}
// 금지어(부분일치) 또는 차단닉(정확일치)이면 불가
async function nickAllowed(nick) {
  const n = normNick(nick);
  if (!n) return false;
  const words = await loadBannedWords();
  if (words.some((w) => w && n.includes(w))) return false;
  const bans = await loadNickBans();
  return !bans.has(n);
}
// 현재 닉이 더는 허용되지 않으면(금지어 추가/직접 차단) → 로컬 닉 비우고 강제 재입력.
async function enforceNickBan() {
  const cur = getNick();
  if (!cur) return false;
  if (await nickAllowed(cur)) return false;
  setNick('');
  updateNickButton();
  showToast(t.nickForced, { top: true });
  promptNick((n) => saveNick(n), { prefill: '' });
  return true;
}

// ---------------- 공유 / 저장 ----------------
// 결과 공유 보상 — 친구에게 기록 공유 시 금화 지급(바이럴 유도). 어뷰징 방지로 '결과당 1회'.
const SHARE_RESULT_REWARD = 10;
const SHARED_RESULTS_LS = 'cr_shared_results';
function resultKey(r) { return `${r.symbol}|${r.completed ? Math.round(r.timeMs || 0) + 'c' : Math.round(r.distance || 0) + 'm'}`; }
function resultShareClaimed(r) {
  try { return (JSON.parse(localStorage.getItem(SHARED_RESULTS_LS)) || []).includes(resultKey(r)); } catch { return false; }
}
function markResultShared(r) {
  try {
    const a = JSON.parse(localStorage.getItem(SHARED_RESULTS_LS)) || [];
    a.push(resultKey(r));
    localStorage.setItem(SHARED_RESULTS_LS, JSON.stringify(a.slice(-200)));   // 최근 200개만 보관
  } catch {}
}
$('btn-share').onclick = async () => {
  if (!lastResult) return;
  if (regPromise) { try { await regPromise; } catch {} }   // 순위 등록 완료 후 공유 (기록 정확히 반영)
  const r = await shareResult(lastResult);
  const ok = r === 'shared' || r === 'shared-copied';
  if (ok) {
    logTossEvent('share', { symbol: lastResult.symbol });
    if (!resultShareClaimed(lastResult)) {            // 같은 결과 재공유로 토큰 파밍 방지
      markResultShared(lastResult);
      Items.addTokens(SHARE_RESULT_REWARD);
      syncPush();                                     // 토큰 계정 동기화(토스/구글)
      updateTokenUI();
      logTossEvent('share_result_reward', { tokens: SHARE_RESULT_REWARD });
      celebrateTokens(SHARE_RESULT_REWARD, t.coinShare);
    } else if (r === 'shared-copied') showToast(t.shareLinkCopied);
  }
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

// 토큰 보상 연출 — 폭죽(confetti) + 중앙 "+N" 카운트업. ~2.2초 후 사라짐.
// label: 보상 사유(완주/공유/광고). 생략 시 완주 보상.
function celebrateTokens(amount, label) {
  const layer = document.createElement('div');
  layer.className = 'token-cele';
  layer.innerHTML =
    `<canvas class="tc-canvas"></canvas>` +
    `<div class="tc-pop"><span class="coin tc-coin"></span>` +
    `<div class="tc-amt">+0</div><div class="tc-label">${label || t.tokenEarned}</div></div>`;
  document.body.appendChild(layer);
  try { audio.sfx && audio.sfx.boost && audio.sfx.boost(); } catch {}

  // 카운트업 +0 → +amount
  const amtEl = layer.querySelector('.tc-amt');
  const t0 = performance.now(), dur = 700;
  (function countUp() {
    const p = Math.min(1, (performance.now() - t0) / dur);
    amtEl.textContent = '+' + Math.round(p * amount);
    if (p < 1) requestAnimationFrame(countUp);
  })();

  // 폭죽 confetti
  const cv = layer.querySelector('.tc-canvas');
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
  const COLORS = ['#2ce6c4', '#ffd34d', '#ff5d6e', '#a78bfa', '#ffffff', '#5b8cff'];
  const parts = [];
  const burst = (cx, cy, n) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7.5;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3.5,
        c: COLORS[(Math.random() * COLORS.length) | 0], s: 5 + Math.random() * 6,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.45, life: 1 });
    }
  };
  burst(W / 2, H * 0.42, 100);
  setTimeout(() => burst(W * 0.28, H * 0.36, 55), 220);
  setTimeout(() => burst(W * 0.72, H * 0.36, 55), 380);

  let raf; const start = performance.now();
  (function loop() {
    const elapsed = performance.now() - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.vy += 0.16; p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.0075;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.62);
      ctx.restore();
    }
    if (elapsed < 2300) raf = requestAnimationFrame(loop);
  })();

  setTimeout(() => {
    layer.classList.add('out');
    setTimeout(() => { cancelAnimationFrame(raf); layer.remove(); }, 500);
  }, 1900);
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
  // 전체 순위만 — 직전 플레이 결과(카드/공유/멀티 등수/배너)는 모두 숨김
  $('result-card').style.display = 'none';
  document.querySelector('.share-row').style.display = 'none';
  $('multi-result').hidden = true;
  $('ad-result').style.display = 'none';
  $('lb-back').hidden = false;        // 상단 뒤로가기 노출(전체순위 보기 모드)
  await renderLeaderboard(null);
};
// 전체순위 화면 상단 뒤로가기 → 메인으로
$('lb-back').onclick = () => { show('home'); resetResultView(); };

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

// 결과 화면 재진입 시 카드/공유/배너 다시 보이게 + 전체순위 전용 요소 숨김
function resetResultView() {
  $('result-card').style.display = '';
  document.querySelector('.share-row').style.display = '';
  $('ad-result').style.display = '';
  $('lb-back').hidden = true;
}
$('btn-retry').addEventListener('click', resetResultView);
$('btn-home').addEventListener('click', resetResultView);

show('home');
