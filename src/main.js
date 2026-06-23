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
import { quickDifficulty } from './difficulty.js';
import { MOCK_SYMBOLS } from './stock/mockData.js';
import * as audio from './audio.js';
import { effectiveAdMode } from './toss.js';

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
    if (getLastCourseSource() === 'demo' && CONFIG.STOCK_PROVIDER !== 'mock' && !demoWarned) {
      demoWarned = true;
      alert(t.demoAlert);
    }
    startGame(series, item.symbol, item.name);
  } catch (e) {
    console.error(e);
    alert(t.courseFail + '\n' + e.message);
    show('home');
  }
}
let demoWarned = false;
$('btn-start').onclick = () => launch(selected);

// ---------------- 실시간 추천 종목 ----------------
async function renderTrending() {
  const el = $('trending-list');
  // 열린 장에 맞춰 헤더 표시 (한국장/미국장)
  const headEl = $('trending-head-label');
  if (headEl && CONFIG.STOCK_PROVIDER === 'yahoo') {
    headEl.textContent = activeMarket() === 'kr' ? t.trendingKr : t.trendingUs;
  }
  try {
    const list = await getTrending();
    el.innerHTML = '';
    list.forEach((item) => {
      rememberName(item.symbol, item.name);
      const up = (item.change ?? 0) >= 0;
      const chg = item.change != null ? `${up ? '+' : ''}${item.change}%` : '';
      const div = document.createElement('div');
      div.className = 'trend-chip';
      div.innerHTML =
        `<div class="tc-main">` +
        `<div class="tc-sym">${escapeHtml(item.symbol)}${item.hot ? ' <span class="tc-fire">🔥</span>' : ''}</div>` +
        `<div class="tc-name">${escapeHtml(item.name || '')}</div>` +
        `<div class="tc-diff">${diffBadge(item.symbol)}</div></div>` +
        `<div class="tc-chg ${up ? 'up' : 'down'}">${chg}</div>`;
      div.onclick = () => launch(item);
      el.appendChild(div);
    });
    if (!list.length) el.innerHTML = `<div class="trending-skeleton">${t.noTrending}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="trending-skeleton">${t.trendingFail}</div>`;
  }
}

function startGame(series, symbol, name) {
  show('play');
  initPlayBanner();
  const canvas = $('game-canvas');
  game = new Game(canvas);
  game.start(series, symbol, name, onGameEnd);
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

let regPromise = null;
async function showResult(result) {
  show('result');
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
  if (r === 'downloaded') alert(t.savedAlert);
};
$('btn-save-card').onclick = async () => {
  if (!lastResult) return;
  if (regPromise) { try { await regPromise; } catch {} }
  saveCard(lastResult);
};

// ---------------- 네비게이션 ----------------
$('btn-retry').onclick = () => {
  if (!selected) return show('home');
  launch(selected);
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
