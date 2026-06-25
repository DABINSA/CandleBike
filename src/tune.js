// 물리 튜닝 패널 — candlebike.vercel.app/?tune=1 일 때만 표시.
// 슬라이더를 움직이면 TUNING 값이 즉시 바뀌고 게임에 바로 반영(재배포 불필요).
// 값 확정되면 '복사' 눌러 JSON을 받아 tuning.js 기본값으로 박으면 됨.
import { TUNING } from './game/tuning.js';
import * as Items from './items/items.js';

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
  panel.innerHTML = `<div class="tp-head"><b>🛠 물리 튜닝</b><button id="tp-min">_</button></div>
    <button id="tp-test" class="tp-test">🏁 테스트 코스(무제한)</button>
    <div id="tp-body"></div>
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

  // ── 차고 아이템: 플레이 중에도 바로 적용 ─────────────────────────
  // 탈것/색상 = 즉시 장착(인벤토리 반영 + 현재 게임에 라이브 교체).
  // 소모품 = 현재 게임에 효과 즉시 적용(연료+5·부스트·보호막 등).
  // 항상 보이는 별도 퀵바(좌측 하단) — 패널을 접어도 보이고, 누르면 바로 적용.
  const liveGame = () => (window.__candleGame && window.__candleGame()) || null;
  const items = document.createElement('div');
  items.id = 'tune-quickbar';
  items.innerHTML =
    `<div class="tp-isec"><b>🚗 탈것</b><div class="tp-irow" id="tp-veh"></div></div>` +
    `<div class="tp-isec"><b>🎁 소모품 <em>(즉시 적용)</em></b><div class="tp-irow" id="tp-con"></div></div>`;

  function renderItems() {
    // 개발용 패널이라 사이트 언어와 무관하게 항상 한글(.ko)로 표기.
    items.querySelector('#tp-veh').innerHTML = Items.VEHICLES.map((v) => {
      const on = Items.equippedVehicle() === v.id;
      return `<button class="tp-chip ${on ? 'on' : ''}" data-veh="${v.id}">${v.emoji} ${v.ko}</button>`;
    }).join('');
    items.querySelector('#tp-con').innerHTML = Items.CONSUMABLES.map((c) =>
      `<button class="tp-chip" data-con="${c.id}" title="${c.ko} · ${c.koDesc}">${c.emoji}</button>`
    ).join('');
  }

  items.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const g = liveGame();
    if (b.dataset.veh) {
      Items.grantVehicle(b.dataset.veh); Items.equipVehicle(b.dataset.veh);
      if (g) g.vehicle = Items.equippedVehicle();
      renderItems();
    } else if (b.dataset.con) {
      if (g && g.applyTuneConsum) g.applyTuneConsum(b.dataset.con);
      else alert('플레이 중에만 소모품을 적용할 수 있어요.');
    }
  });

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
  panel.querySelector('#tp-test').addEventListener('click', () => window.__candleStartTest && window.__candleStartTest());

  renderItems();

  function attach() {
    if (document.body) { document.body.appendChild(panel); document.body.appendChild(items); }
    else requestAnimationFrame(attach);
  }
  attach();
}
