// 1위 달성 알림 띠 — 누군가 어떤 종목에서 '전체 1위'를 새로 갱신하면
// 화면 상단에 한 줄 텍스트가 오른쪽→왼쪽으로 몇 번 흐른 뒤 사라진다(상시 루프 X).
//
// 모델: 이벤트 '큐'. 한 이벤트가 들어오면 화면을 PASSES 번 가로지른 뒤 다음 이벤트로 넘어가고,
//       큐가 비면 띠가 사라진다. → 자주 떠 있지 않고, 1위가 났을 때만 잠깐 announce.
//
// 데이터원:
//   • 실시간 '달성': Supabase Realtime(rank_events INSERT) → 새 1위를 즉시 큐 앞에 announce.
//   • 내 1위 / 고스트 1위: 결과 화면에서 즉시 큐 앞에 넣어 표시.
//   • 비는 시간 '도전 문구'(idle): top_holders RPC 의 종목별 현재 챔피언을 순환 표시.
//     (과거 '달성' 기록은 재생하지 않음 — 옛 메시지 반복 방지)
//
// 마운트: 홈·결과·플레이 컨테이너에 같은 '현재 항목'을 그림(보이는 화면에서만 의미).
//   단, 플레이(on-play)에선 idle 도전 문구는 숨기고 실시간 달성만 표시(산만함 방지).
// DB 선행: db/rank-events.sql, db/top-holders.sql.
import { getClient, isConfigured } from '../supabaseClient.js';
import { t } from '../i18n.js';

const PASSES = 3;              // 라이브 1위 이벤트가 화면을 가로지르는 횟수
const IDLE_PASSES = 1;         // 도전 문구(idle)는 1번만 흐르고 다음 종목으로
const PASS_MS = 8000;          // 1회 가로지르는 시간(ms)
// 과거 '달성' 기록은 재생하지 않음. 옛 1등 메시지가 로드마다 다시 뜨는 걸 방지.
// 대신 비는 시간엔 '현재 챔피언 도전 문구'(idle)를 돌려 경쟁 욕구를 유지한다.
const DEDUP_WINDOW_MS = 60000; // 같은 nick|symbol 중복(실시간 echo 등) 억제 창
const CHAMP_REFRESH_MS = 5 * 60 * 1000;  // 챔피언 목록 갱신 주기

const mounts = new Set();      // 띠 컨테이너들(홈/결과/플레이)
const queue = [];              // 라이브 1위 이벤트(우선) [{nick,symbol,name,mine,kind,passes}]
const recentKeys = new Map();  // 'nick|symbol' → ts (중복 억제)
let idlePool = [];             // 종목별 현재 챔피언 [{nick,symbol,name}]
let idleIdx = 0;
let nameOf = null;             // 코드→이름 해석기(선택, main 에서 주입)
let playing = null;            // 현재 흐르는 항목
let timer = null;
let started = false;

function key(n, s) { return `${n}|${s}`; }
function symLabel(ev) {
  const nm = (ev.name || '').trim();
  return nm || (nameOf && nameOf(ev.symbol)) || ev.symbol;
}

// 라이브: "OO 님이 △△에서 1위 달성"(내 1위도 닉네임으로, mine 은 색 강조만).
// idle: "△△ 현재 1위는 OO님 — 도전!"(비는 시간 경쟁 유도).
function itemHTML(ev) {
  const sym = symLabel(ev);
  const txt = ev.kind === 'idle' ? t.rankChallenge(ev.nick, sym) : t.rankAchieved(ev.nick, sym);
  return `<span class="rt-item${ev.mine ? ' mine' : ''}">${txt}</span>`;
}

// 한 마운트에 현재 이벤트를 그리고 가로지르기 애니메이션 시작.
function paintMount(el) {
  const move = el.querySelector('.rt-move');
  if (!move) return;
  // 플레이 화면(on-play)에선 도전 문구(idle)는 숨기고 실시간 '달성'만 표시(게임 중 산만함 방지).
  const showHere = !!playing && !(el.classList.contains('on-play') && playing.kind === 'idle');
  el.hidden = !showHere;
  if (!showHere) { move.innerHTML = ''; return; }
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

// idle(도전 문구) 한 건 — 챔피언 풀에서 순환.
function nextIdleItem() {
  if (!idlePool.length) return null;
  const r = idlePool[idleIdx % idlePool.length];
  idleIdx++;
  return { nick: r.nick, symbol: r.symbol, name: r.name || '', mine: false, kind: 'idle', passes: IDLE_PASSES };
}

function playNext() {
  clearTimeout(timer);
  // 라이브 1위(우선) → 없으면 도전 문구(순환) → 둘 다 없으면 숨김
  playing = queue.shift() || nextIdleItem();
  renderAll();
  if (!playing) { mounts.forEach((el) => { el.hidden = true; }); return; }
  timer = setTimeout(playNext, PASS_MS * (playing.passes || PASSES) + 250);
}

// 라이브 이벤트 적재. front=true 면 큐 앞(빠르게 announce). 중복은 무시.
function enqueue(ev, { front = false } = {}) {
  if (!ev || !ev.nick || !ev.symbol) return false;
  const k = key(ev.nick, ev.symbol), now = Date.now();
  const last = recentKeys.get(k);
  if (last && now - last < DEDUP_WINDOW_MS) return false;
  recentKeys.set(k, now);
  const item = { nick: ev.nick, symbol: ev.symbol, name: ev.name || '', mine: !!ev.mine, kind: 'live', passes: PASSES };
  if (front) queue.unshift(item); else queue.push(item);
  // 지금 아무것도 안 나오면 바로 시작. 무언가(도전 문구 등) 재생 중이면 끊지 않고
  // 현재 항목이 화면 밖으로 다 빠진 뒤(다음 playNext) 라이브를 보여준다.
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

// 종목별 현재 챔피언(도전 문구용) 갱신. RPC(top_holders)가 없으면 조용히 무시(라이브만 동작).
async function refreshChampions(client) {
  try {
    const { data, error } = await client.rpc('top_holders', { p_limit: 14 });
    if (error || !Array.isArray(data)) return;
    idlePool = data.map((r) => ({ nick: r.nick, symbol: r.symbol, name: r.name || '' }));
    // 도전 문구만 떠 있는 상태(라이브 없음)면, 갱신된 풀로 자연스럽게 이어지도록 재생 시작
    if (!playing && idlePool.length) playNext();
  } catch (e) { console.warn('top_holders 조회 실패', e); }
}

// 실시간 구독 + 챔피언(도전 문구) 로드. 한 번만. opts.nameOf: 코드→이름 해석기(선택).
export async function startRankTicker(opts = {}) {
  if (started || !isConfigured()) return;
  started = true;
  if (typeof opts.nameOf === 'function') nameOf = opts.nameOf;
  const client = await getClient();
  if (!client) return;

  // 실시간 — 새 1위 INSERT 즉시 큐 앞에 announce(달성). 과거 기록은 재생하지 않음.
  try {
    client
      .channel('rank-events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rank_events' }, (payload) => {
        const r = payload && payload.new;
        if (r) enqueue({ nick: r.nick, symbol: r.symbol, name: r.name || '', mine: false }, { front: true });
      })
      .subscribe();
  } catch (e) { console.warn('rank_events 실시간 구독 실패', e); }

  // 비는 시간용 '현재 챔피언 도전 문구' — 최초 1회 + 주기 갱신.
  await refreshChampions(client);
  try { setInterval(() => refreshChampions(client), CHAMP_REFRESH_MS); } catch {}
}
