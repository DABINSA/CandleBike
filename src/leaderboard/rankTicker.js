// 1위 달성 알림 띠 — 누군가 어떤 종목에서 '전체 1위'를 새로 갱신하면
// 화면 상단에 한 줄 텍스트가 오른쪽→왼쪽으로 흘러간다(마퀴).
//
// 데이터원:
//   • 최초 진입: rank_events 최근 N건 조회로 띠를 채움.
//   • 실시간: Supabase Realtime(rank_events INSERT 구독)으로 새 1위를 즉시 받아 앞에 삽입 + flash.
//   • 내 1위: 결과 화면에서 rank===1 이면 실시간 왕복을 기다리지 않고 즉시 표시(showLocalRankEvent).
//
// DB 선행: db/rank-events.sql (테이블 + submit_score 갱신 + Realtime 발행).
import { getClient, isConfigured } from '../supabaseClient.js';
import { t } from '../i18n.js';

const MAX_ITEMS = 12;          // 띠에 유지할 최근 이벤트 수
const FETCH_LIMIT = 12;        // 최초 조회 건수
const DEDUP_WINDOW_MS = 12000; // 내 즉시표시 ↔ 실시간 echo 중복 제거 창

let events = [];               // [{ nick, symbol, name, mine }] (최신이 앞)
const mounts = new Set();      // 띠를 그릴 컨테이너들(홈/결과)
const recentKeys = new Map();  // 'nick|symbol' → ts (최근 추가). 중복(실시간 echo) 제거용.
let started = false;

function key(nick, symbol) { return `${nick}|${symbol}`; }

// 종목 표시: 이름 있으면 이름, 없으면 코드.
function symLabel(ev) {
  const nm = (ev.name || '').trim();
  return nm || ev.symbol;
}

function itemHTML(ev) {
  const html = ev.mine
    ? t.rankAchievedMe(ev.nick, symLabel(ev))
    : t.rankAchieved(ev.nick, symLabel(ev));
  return `<span class="rt-item${ev.mine ? ' mine' : ''}">${html}<span class="rt-dot">●</span></span>`;
}

// 동일 목록 2벌 → translateX(-50%) 로 끊김 없이 무한 루프.
function trackHTML() {
  const one = events.map(itemHTML).join('');
  return one + one;
}

function renderAll(flash = false) {
  const has = events.length > 0;
  const inner = has ? trackHTML() : '';
  mounts.forEach((el) => {
    el.hidden = !has;
    if (!has) return;
    const move = el.querySelector('.rt-move');
    if (move) move.innerHTML = inner;
    if (flash) {
      el.classList.remove('flash');
      void el.offsetWidth;   // 리플로우 → 애니메이션 재시작
      el.classList.add('flash');
    }
  });
}

// 이벤트 추가(최신을 앞에). 중복(같은 nick|symbol 최근) 은 무시.
function addEvent(ev, { flash = false } = {}) {
  if (!ev || !ev.nick || !ev.symbol) return false;
  const k = key(ev.nick, ev.symbol);
  const now = Date.now();
  const last = recentKeys.get(k);
  if (last && now - last < DEDUP_WINDOW_MS) return false;   // 실시간 echo / 중복 무시
  recentKeys.set(k, now);
  events.unshift({ nick: ev.nick, symbol: ev.symbol, name: ev.name || '', mine: !!ev.mine });
  if (events.length > MAX_ITEMS) events.length = MAX_ITEMS;
  renderAll(flash);
  return true;
}

// 결과 화면에서 내가 1위를 달성했을 때 — 즉시(로컬) 표시.
export function showLocalRankEvent({ nick, symbol, name }) {
  addEvent({ nick, symbol, name, mine: true }, { flash: true });
}

// 고스트(가짜 경쟁자)가 이번 판에서 1위를 차지했을 때 — 화면에만 즉시 표시(실재감).
// '남의 1위'와 동일 스타일/문구. DB엔 저장하지 않음(전역 순위 오염·모순 방지).
export function showGhostRankEvent({ nick, symbol, name }) {
  addEvent({ nick, symbol, name, mine: false }, { flash: true });
}

// 컨테이너 등록(홈/결과). 같은 데이터로 양쪽을 동일하게 그린다.
export function registerTicker(el) {
  if (!el) return;
  // 내부 구조가 없으면 생성
  if (!el.querySelector('.rt-track')) {
    el.innerHTML = '<div class="rt-track"><div class="rt-move"></div></div>';
  }
  el.classList.add('rank-ticker');
  el.hidden = events.length === 0;
  mounts.add(el);
  if (events.length) renderAll(false);
}

// 최초 조회 + 실시간 구독. 한 번만.
export async function startRankTicker() {
  if (started || !isConfigured()) return;
  started = true;
  const client = await getClient();
  if (!client) return;

  // 최근 이벤트로 채우기(오래된→최신 순서로 unshift 하면 최신이 앞)
  try {
    const { data } = await client
      .from('rank_events')
      .select('nick,symbol,name,created_at')
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT);
    if (Array.isArray(data)) {
      events = data.map((r) => ({ nick: r.nick, symbol: r.symbol, name: r.name || '', mine: false }));
      // 최초 로드분은 dedup 창에 등록(직후 동일건 echo 방지)
      const now = Date.now();
      events.forEach((e) => recentKeys.set(key(e.nick, e.symbol), now));
      renderAll(false);
    }
  } catch (e) { console.warn('rank_events 조회 실패', e); }

  // 실시간 구독 — 새 1위 INSERT 즉시 수신
  try {
    client
      .channel('rank-events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rank_events' }, (payload) => {
        const r = payload?.new;
        if (r) addEvent({ nick: r.nick, symbol: r.symbol, name: r.name || '', mine: false }, { flash: true });
      })
      .subscribe();
  } catch (e) { console.warn('rank_events 실시간 구독 실패', e); }
}
