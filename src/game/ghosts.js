// 멀티플레이(가짜) — AI 고스트 라이더. 실제 네트워크 없이 2~4명의 더미 경쟁자가
// 코스 위를 '목표 완주시간' 페이스로 전진한다. 실력은 중간값(par)±편차로 잡아,
// 잘하는 플레이어는 이기고 못하면 지도록(경쟁심+이겼을 때 희열). config로 튜닝.
//
// 고스트는 물리 없이 progress(0..1)만 가진다. 위치/렌더는 game.js가 코스 지형에 매핑.

const NAMES = [
  '질주왕', '캔들고수', '풀악셀', '라이더준', '떡상가즈아', '니트로', '백플립마스터',
  '코스파괴자', '드리프트킹', '폭주기관차', '차트의신', '오토바이러버', '스피드광',
  '월광라이더', '불꽃슈팅', '명품질주', '갓생라이더', '광클러', '존버맨', '한강뷰',
];
const COLORS = ['#ff6b6b', '#ffd34d', '#a78bfa', '#4dabf7', '#ff8cc8', '#69db7c', '#ff922b'];

function pickUnique(arr, n) {
  const pool = arr.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

// 더미 닉네임 n개 (매칭 화면과 레이스 고스트가 같은 이름을 쓰도록 미리 뽑아 공유).
export function pickGhostNames(n) { return pickUnique(NAMES, n); }

// count 명의 고스트 생성. parTime = 중간 실력의 완주 목표시간(초). names 주면 그걸 사용.
export function createGhosts(count, parTime, names) {
  names = (names && names.length) ? names : pickUnique(NAMES, count);
  count = names.length;
  const colors = pickUnique(COLORS, count);
  return names.map((name, i) => ({
    name,
    color: colors[i] || '#ff6b6b',
    // 목표 완주시간 — par보다 빠르게(중간 이상 실력). 편차로 순위 다툼.
    targetTime: parTime * (0.8 + Math.random() * 0.3),    // ≈ par×0.80~1.10 (평균 ~0.95)
    progress: 0,
    finished: false,
    finishTime: null,
    _phase: Math.random() * Math.PI * 2,
    _wob: 0.7 + Math.random() * 0.8,     // 완만한 흔들림 주기
    _speedScale: 1,                       // 지형 반응 속도(내리막↑/오르막↓) — game이 매 프레임 갱신
    // 연출 상태: 장애물 점프 아치(px) / 걸림 감속 / 플레어 백플립
    obAir: 0, flip: 0, flipDur: 0, flipDir: 0, flipTurns: 0, _cool: 0,
    _wallX: null, _wallMiss: false, _stumble: 0,
  }));
}

// 고스트 전진 — 플레이어와 무관한 독립 페이스. 지형 반응(_speedScale)으로 평지·내리막에선 빨라진다.
export function updateGhosts(ghosts, dt, elapsed) {
  for (const g of ghosts) {
    if (g.finished) continue;
    const mul = 1 + 0.1 * Math.sin(elapsed * g._wob + g._phase);   // ±10% 완만한 흔들림
    g.progress += (mul * (g._speedScale || 1) / g.targetTime) * dt;
    if (g.progress >= 1) { g.progress = 1; g.finished = true; g.finishTime = elapsed; }
  }
}
