// 탈것(스킨) 렌더 — 색(accent)만 바뀌는 외형. 게임 물리엔 영향 0.
// moto(기본 오토바이)는 game.js 의 상세 렌더를 그대로 쓰고, 여기선 '다른 탈것'과
// 차고 미리보기를 담당한다. drawVehicle(ctx, type, pose, accent, alpha).
//   pose = { px, py, ang }  (차체 중심/각도) — 다리/바퀴는 로컬좌표로 그린다.

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

// 작은 라이더(공통) — 탈것 위 로컬좌표(앉는 지점 sx,sy)
function rider(ctx, accent, sx, sy) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#22406e'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 8, sy - 16); ctx.stroke();   // 몸통
  ctx.strokeStyle = '#2c4a78'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(sx + 8, sy - 16); ctx.lineTo(sx + 20, sy - 8); ctx.stroke(); // 팔
  ctx.strokeStyle = '#1c2740'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 10, sy + 8); ctx.stroke();   // 다리
  ctx.fillStyle = '#eef3f7';                                                        // 헬멧
  ctx.beginPath(); ctx.arc(sx + 10, sy - 22, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = accent;                                                           // 고글
  rr(ctx, sx + 13, sy - 24, 6, 3, 1.5); ctx.fill();
}

// 다리 4개 — 달리는 느낌으로 위상차. phase = 진행에 따른 보행 사이클(라디안)
function legs(ctx, color, xs, footY, phase) {
  ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = 'round';
  xs.forEach((x, i) => {
    const sw = Math.sin(phase + i * 1.7) * 6;   // 앞뒤 스윙
    ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x + sw, footY); ctx.stroke();
    ctx.fillStyle = '#1d2735';                  // 발굽
    ctx.beginPath(); ctx.arc(x + sw, footY, 3, 0, Math.PI * 2); ctx.fill();
  });
}

function drawBike(ctx, accent, phase) {
  const WR = 22, rx = -40, fx = 40, wy = 28;
  // 바퀴(얇은 스포크)
  [rx, fx].forEach((wx) => {
    ctx.save(); ctx.translate(wx, wy); ctx.rotate(phase);
    ctx.fillStyle = '#0c1117'; ctx.beginPath(); ctx.arc(0, 0, WR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, WR - 4, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(170,190,210,.55)'; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * (WR - 4), Math.sin(a) * (WR - 4)); ctx.stroke(); }
    ctx.restore();
  });
  // 다이아몬드 프레임(accent)
  ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(rx, wy); ctx.lineTo(-6, -6); ctx.lineTo(20, -8); ctx.lineTo(fx, wy);
  ctx.moveTo(-6, -6); ctx.lineTo(2, wy); ctx.lineTo(rx, wy);
  ctx.moveTo(2, wy); ctx.lineTo(20, -8); ctx.stroke();
  // 안장 + 핸들
  ctx.fillStyle = '#1d2735'; rr(ctx, -12, -12, 16, 5, 2); ctx.fill();
  ctx.strokeStyle = '#39485c'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(20, -8); ctx.lineTo(30, -18); ctx.stroke();
  // 페달
  ctx.fillStyle = '#cfe9e2'; ctx.beginPath(); ctx.arc(2, wy, 4, 0, Math.PI * 2); ctx.fill();
  rider(ctx, accent, -6, -10);
}

function drawHorse(ctx, accent, phase) {
  const C = '#8a5a36';
  legs(ctx, '#6b4a2f', [-24, -12, 16, 28], 34, phase);
  // 몸통
  ctx.fillStyle = C;
  ctx.beginPath(); ctx.ellipse(0, 4, 36, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shade(C, -22);
  ctx.beginPath(); ctx.ellipse(-2, 10, 32, 8, 0, 0, Math.PI * 2); ctx.fill();
  // 목 (어깨 → 머리)
  ctx.fillStyle = C;
  ctx.beginPath(); ctx.moveTo(18, -6); ctx.lineTo(34, -30); ctx.lineTo(46, -28); ctx.lineTo(30, 2); ctx.closePath(); ctx.fill();
  // 머리(주둥이) + 귀 + 눈
  ctx.save(); ctx.translate(42, -30); ctx.rotate(-0.5);
  ctx.fillStyle = C; rr(ctx, -7, -7, 24, 13, 5); ctx.fill();
  ctx.fillStyle = shade(C, -18); rr(ctx, 11, -2, 8, 7, 3); ctx.fill();
  ctx.fillStyle = C; ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(-8, -15); ctx.lineTo(1, -8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1d2735'; ctx.beginPath(); ctx.arc(3, -1, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 갈기 + 꼬리 (accent)
  ctx.strokeStyle = accent; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(20, -2); ctx.lineTo(34, -28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-34, -2); ctx.quadraticCurveTo(-48, 4, -44, 22); ctx.stroke();
  rider(ctx, accent, -4, -12);
}

function drawGiraffe(ctx, accent, phase) {
  legs(ctx, '#c9962f', [-24, -12, 14, 26], 36, phase);
  // 몸통
  ctx.fillStyle = '#e6b84a';
  ctx.beginPath(); ctx.ellipse(0, 4, 34, 16, 0, 0, Math.PI * 2); ctx.fill();
  // 긴 목
  ctx.fillStyle = '#e6b84a';
  ctx.beginPath(); ctx.moveTo(18, -6); ctx.lineTo(30, -54); ctx.lineTo(42, -52); ctx.lineTo(30, 2); ctx.closePath(); ctx.fill();
  // 머리
  ctx.beginPath(); ctx.ellipse(40, -58, 9, 6, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b4a1f';  // 뿔
  ctx.fillRect(34, -68, 2.5, 7); ctx.fillRect(40, -69, 2.5, 7);
  ctx.fillStyle = '#1d2735'; ctx.beginPath(); ctx.arc(44, -59, 1.6, 0, Math.PI * 2); ctx.fill();
  // 반점(accent)
  ctx.fillStyle = accent;
  [[-16, 2], [-2, 8], [12, 0], [-22, 8], [22, 6], [26, -28], [33, -44]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill();
  });
  rider(ctx, accent, -2, -12);
}

// type: 'bike' | 'horse' | 'giraffe' (moto 는 game.js 상세 렌더 사용)
export function drawVehicle(ctx, type, pose, accent, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(pose.px, pose.py);
  ctx.rotate(pose.ang || 0);
  const phase = pose.phase || 0;
  if (type === 'horse') drawHorse(ctx, accent, phase);
  else if (type === 'giraffe') drawGiraffe(ctx, accent, phase);
  else drawBike(ctx, accent, phase);
  ctx.restore();
}

// 차고 미리보기 — canvas 중앙에 정지 포즈로 1대 그린다.
export function drawPreview(ctx, type, accent, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2 + 8);
  const s = Math.min(w, h) / 130;
  ctx.scale(s, s);
  if (type === 'moto') drawPreviewMoto(ctx, accent);
  else drawVehicle(ctx, type, { px: 0, py: 0, ang: 0, phase: 0.6 }, accent, 1);
  ctx.restore();
}

// 미리보기용 간이 오토바이(인게임 상세본과 비슷한 실루엣)
function drawPreviewMoto(ctx, accent) {
  const WR = 20, rx = -38, fx = 38, wy = 16;
  // 포크/스윙암(바퀴-차체 연결)
  ctx.strokeStyle = '#7d8ba0'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(rx, wy); ctx.moveTo(22, -8); ctx.lineTo(fx, wy); ctx.stroke();
  [rx, fx].forEach((wx) => {
    ctx.save(); ctx.translate(wx, wy);
    ctx.fillStyle = '#0c1117'; ctx.beginPath(); ctx.arc(0, 0, WR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, WR - 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  });
  // 차체
  ctx.fillStyle = shade(accent, -10);
  ctx.beginPath();
  ctx.moveTo(-40, -8); ctx.quadraticCurveTo(-38, -20, -24, -19); ctx.lineTo(-4, -17);
  ctx.quadraticCurveTo(10, -26, 24, -16); ctx.lineTo(32, -8); ctx.lineTo(18, -4); ctx.lineTo(-10, -6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#eef3f7'; rr(ctx, -26, -20, 22, 5, 2); ctx.fill();
  // 핸들
  ctx.strokeStyle = '#39485c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(24, -16); ctx.lineTo(31, -26); ctx.stroke();
  rider(ctx, accent, -6, -12);
}
