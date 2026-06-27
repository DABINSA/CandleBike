// 1위 달성 알림 띠 — 누군가 어떤 종목에서 '전체 1위'를 새로 갱신하면
// 화면 상단에 한 줄 텍스트가 오른쪽→왼쪽으로 몇 번 흐른 뒤 사라진다(상시 루프 X).
//
// 모델: 이벤트 '큐'. 한 이벤트가 들어오면 화면을 PASSES 번 가로지른 뒤 다음 이벤트로 넘어가고,
//       큐가 비면 띠가 사라진다. → 자주 떠 있지 않고, 1위가 났을 때만 잠깐 announce.
//
// 데이터원:
//   • 최초 진입: 최근 BACKLOG 건만 한 번 흘려보냄(약간의 생동감).
//   • 실시간: Supabase Realtime(rank_events INSERT)으로 새 1위를 즉시 큐 앞에 넣어 announce.
//   • 내 1위 / 고스트 1위: 결과 화면에서 즉시 큐 앞에 넣어 표시.
//
// 마운트: 홈·결과·플레이 컨테이너 모두에 같은 '현재 이벤트'를 그린다(보이는 화면에서만 의미).
// DB 선행: db/rank-events.sql.
import { getClient, isConfigured } from '../supabaseClient.js';
import { t } from '../i18n.js';

const PASSES = 3;              // 각 이벤트가 화면을 가로지르는 횟수(끝나면 사라짐)
const PASS_MS = 8000;          // 1회 가로지르는 시간(ms)
// 과거 기록은 재생하지 않음(0). 옛 1등 메시지가 로드마다 다시 뜨는 걸 방지 —
// 띠는 '지금 막 난 1위'(실시간) + 내 1위/고스트 만 announce 한다.
const BACKLOG = 0;
const DEDUP_WINDOW_MS = 60000; // 같은 nick|symbol 중복(실시간 echo 등) 억제 창

const mounts = new Set();      // 띠 컨테이너들(홈/결과/플레이)
const queue = [];              // 대기 이벤트 [{nick,symbol,name,mine}]
const recentKeys = new Map();  // 'nick|symbol' → ts (중복 억제)
let playing = null;            // 현재 흐르는 이벤트
let timer = null;
let started = false;

function key(n, s) { return `${n}|${s}`; }
function symLabel(ev) { const nm = (ev.name || '').trim(); return nm || ev.symbol; }

// 내 1위도 닉네임 문구로 통일(예: "OO 님이 △△에서 1위를 달성했습니다"). mine 은 색 강조만.
function itemHTML(ev) {
  return `<span class="rt-item${ev.mine ? ' mine' : ''}">${t.rankAchieved(ev.nick, symLabel(ev))}</span>`;
}

// 한 마운트에 현재 이벤트를 그리고 가로지르기 애니메이션 시작.
function paintMount(el) {
  const move = el.querySelector('.rt-move');
  if (!move) return;
  el.hidden = !playing;
  if (!playing) { move.innerHTML = ''; return; }
  move.innerHTML = itemHTML(playing);
  // 폭 측정(보이는 화면에서만 유효) 후 오른쪽 밖→왼쪽 밖으로 PASSES 회.
  const track = el.querySelector('.rt-track') || el;
  const cw = track.offsetWidth || el.offsetWidth || 320;
  const iw = move.scrollWidth || cw;
  try { move.getAnimations && move.getAnimations().forEach((a) => a.cancel()); } catch {}
  try {
    move.animate(
      [{ transform: `translateX(${cw}px)` }, { transform: `translateX(${-iw}px)` }],
      { duration: PASS_MS, iterations: PASSES, easing: 'linear', fill: 'forwards' }
    );
  } catch {
    move.style.transform = 'translateX(0)';   // WAAPI 미지원 폴백: 그냥 보이기만
  }
}

function renderAll() { mounts.forEach(paintMount); }

function playNext() {
  clearTimeout(timer);
  playing = queue.shift() || null;
  renderAll();
  if (!playing) { mounts.forEach((el) => { el.hidden = true; }); return; }
  timer = setTimeout(playNext, PASS_MS * PASSES + 250);
}

// 이벤트 적재. front=true 면 큐 앞(빠르게 announce). 중복은 무시.
function enqueue(ev, { front = false } = {}) {
  if (!ev || !ev.nick || !ev.symbol) return false;
  const k = key(ev.nick, ev.symbol), now = Date.now();
  const last = recentKeys.get(k);
  if (last && now - last < DEDUP_WINDOW_MS) return false;
  recentKeys.set(k, now);
  const item = { nick: ev.nick, symbol: ev.symbol, name: ev.name || '', mine: !!ev.mine };
  if (front) queue.unshift(item); else queue.push(item);
  if (!playing) playNext();
  return true;
}

// 결과 화면: 내가 1위 — 즉시(우선) 표시.
export function showLocalRankEvent({ nick, symbol, name }) {
  enqueue({ nick, symbol, name, mine: true }, { front: true });
}

// 결과 화면: 고스트(가짜 경쟁자)가 1위 — 화면에만 표시(실재감). 남의 1위와 동일.
export function showGhostRankEvent({ nick, symbol, name }) {
  enqueue({ nick, symbol, name, mine: false }, { front: true });
}

// 컨테이너 등록(홈/결과/플레이). 같은 '현재 이벤트'를 그린다.
export function registerTicker(el) {
  if (!el) return;
  if (!el.querySelector('.rt-track')) {
    el.innerHTML = '<div class="rt-track"><div class="rt-move"></div></div>';
  }
  el.classList.add('rank-ticker');
  el.hidden = !playing;
  mounts.add(el);
  if (playing) paintMount(el);
}

// 최초 조회(소량) + 실시간 구독. 한 번만.
export async function startRankTicker() {
  if (started || !isConfigured()) return;
  started = true;
  const client = await getClient();
  if (!client) return;

  // (과거 기록 재생 안 함 — BACKLOG=0) 새로 INSERT 되는 1위만 실시간 announce.

  // 실시간 — 새 1위 INSERT 즉시 큐 앞에 announce.
  try {
    client
      .channel('rank-events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rank_events' }, (payload) => {
        const r = payload && payload.new;
        if (r) enqueue({ nick: r.nick, symbol: r.symbol, name: r.name || '', mine: false }, { front: true });
      })
      .subscribe();
  } catch (e) { console.warn('rank_events 실시간 구독 실패', e); }
}
