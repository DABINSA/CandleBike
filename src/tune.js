// 물리 튜닝 패널 — candlebike.vercel.app/?tune=1 일 때만 표시.
// 슬라이더를 움직이면 TUNING 값이 즉시 바뀌고 게임에 바로 반영(재배포 불필요).
// 값 확정되면 '복사' 눌러 JSON을 받아 tuning.js 기본값으로 박으면 됨.
import { TUNING } from './game/tuning.js';

if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('tune') === '1') {
  // [key, min, max, step, 설명]
  const ROWS = [
    ['torque', 0.1, 1.2, 0.01, '가속력'],
    ['boostTorque', 0, 0.5, 0.01, '부스트 가산'],
    ['leanBack', 0, 0.2, 0.005, '앞들기(윌리) 힘'],
    ['leanFwd', 0, 0.2, 0.005, '앞숙임 힘'],
    ['neutral', 0.05, 0.8, 0.01, '자유구간(클수록 자유·뒤집힘↑)'],
    ['recover', 0.1, 2.5, 0.05, '복원 강도'],
    ['recoverFlip', 0.2, 3, 0.05, '전복직전 복원'],
    ['flip', 0.4, 1.4, 0.05, '전복 임계'],
    ['recoverCap', 0.2, 1.2, 0.05, '복원 상한'],
    ['maxSpin', 0.1, 1.0, 0.02, '회전 상한(작을수록 안정)'],
    ['boostSpin', 0, 0.3, 0.01, '부스트 회전 가산'],
    ['maxAv', 0.8, 4, 0.1, '전진 속도(구동 상한)'],
    ['boostAv', 0, 4, 0.1, '부스트 속도'],
    ['rollCapMult', 1, 4, 0.1, '내리막 모멘텀(램프 점프 탄력)'],
    ['maxRev', 0.3, 2, 0.05, '후진 속도'],
    ['jump', 6, 18, 0.5, '점프 힘'],
  ];

  const panel = document.createElement('div');
  panel.id = 'tune-panel';
  panel.innerHTML = `<div class="tp-head"><b>🛠 물리 튜닝</b><button id="tp-min">_</button></div><div id="tp-body"></div>
    <div class="tp-foot"><button id="tp-copy">📋 값 복사</button><button id="tp-reset">되돌리기</button></div>`;
  const body = panel.querySelector('#tp-body');
  const DEFAULTS = { ...TUNING };

  ROWS.forEach(([key, min, max, step, desc]) => {
    const row = document.createElement('label');
    row.className = 'tp-row';
    row.innerHTML =
      `<span class="tp-k">${key}<em>${desc}</em></span>` +
      `<input type="range" min="${min}" max="${max}" step="${step}" value="${TUNING[key]}">` +
      `<span class="tp-v">${TUNING[key]}</span>`;
    const input = row.querySelector('input');
    const val = row.querySelector('.tp-v');
    input.addEventListener('input', () => {
      TUNING[key] = +input.value;
      val.textContent = input.value;
    });
    row.dataset.key = key;
    body.appendChild(row);
  });

  function syncSliders() {
    body.querySelectorAll('.tp-row').forEach((row) => {
      const key = row.dataset.key;
      row.querySelector('input').value = TUNING[key];
      row.querySelector('.tp-v').textContent = TUNING[key];
    });
  }

  panel.querySelector('#tp-copy').addEventListener('click', async () => {
    const json = JSON.stringify(TUNING, null, 2);
    try { await navigator.clipboard.writeText(json); alert('TUNING 값 복사됨! 붙여넣어 전달하세요.'); }
    catch { prompt('아래 값을 복사하세요:', json); }
  });
  panel.querySelector('#tp-reset').addEventListener('click', () => {
    Object.assign(TUNING, DEFAULTS);
    syncSliders();
  });
  panel.querySelector('#tp-min').addEventListener('click', () => panel.classList.toggle('min'));

  function attach() { if (document.body) document.body.appendChild(panel); else requestAnimationFrame(attach); }
  attach();
}
