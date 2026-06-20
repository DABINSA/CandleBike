// 효과음 + BGM — Web Audio API 로 직접 합성. 외부 음원/라이선스/네트워크 불필요(100% 자체 생성).
// 신스웨이브 톤으로 네온 테마와 매칭. 음소거 상태는 localStorage 에 저장.

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('candlebike_muted') === '1'; } catch {}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}

// 브라우저 자동재생 정책: 사용자 제스처(클릭/탭) 안에서 호출해 오디오 컨텍스트를 깨운다.
export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('candlebike_muted', muted ? '1' : '0'); } catch {}
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
  if (muted) stopBgm();
}
export function toggleMuted() { setMuted(!muted); return muted; }

// ---------- 단발 효과음 ----------
function tone({ type = 'sine', freq = 440, dur = 0.15, gain = 0.3, attack = 0.005, to = null, when = 0, filterFreq = null }) {
  const c = ensure(); if (!c || muted) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  let node = o;
  if (filterFreq) {
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
    o.connect(f); node = f;
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.03);
}

function noiseBurst({ dur = 0.3, gain = 0.4, when = 0, freq = 800 }) {
  const c = ensure(); if (!c || muted) return;
  const t0 = c.currentTime + when;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur);
}

export const sfx = {
  jump()       { tone({ type: 'square', freq: 300, to: 760, dur: 0.18, gain: 0.22, filterFreq: 1800 }); },
  flip()       { [0, 0.07, 0.14].forEach((w, i) => tone({ type: 'triangle', freq: 520 + i * 190, dur: 0.13, gain: 0.2, when: w })); },
  checkpoint() { tone({ type: 'sine', freq: 660, dur: 0.12, gain: 0.25 }); tone({ type: 'sine', freq: 990, dur: 0.2, gain: 0.22, when: 0.1 }); },
  crash()      { noiseBurst({ dur: 0.5, gain: 0.5, freq: 700 }); tone({ type: 'sawtooth', freq: 180, to: 55, dur: 0.55, gain: 0.35, filterFreq: 500 }); },
  finish()     { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.32, gain: 0.26, when: i * 0.12, filterFreq: 3500 })); },
  gameover()   { tone({ type: 'sawtooth', freq: 330, to: 98, dur: 0.7, gain: 0.3, filterFreq: 900 }); },
  click()      { tone({ type: 'square', freq: 540, dur: 0.06, gain: 0.14, filterFreq: 2200 }); },
};

// ---------- 엔진음 (가속 중) ----------
let eng = null;
export function startEngine() {
  const c = ensure(); if (!c || eng) return;
  const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 72;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
  const g = c.createGain(); g.gain.value = 0.0;
  o.connect(f); f.connect(g); g.connect(master);
  o.start();
  eng = { o, f, g, on: null };
}
export function setThrottle(on) {
  if (!eng || !ctx) return;
  if (eng.on === on) return;           // 상태 바뀔 때만 갱신
  eng.on = on;
  const t = ctx.currentTime;
  eng.g.gain.setTargetAtTime(muted ? 0 : (on ? 0.06 : 0.022), t, 0.12);
  eng.o.frequency.setTargetAtTime(on ? 138 : 76, t, 0.18);
  eng.f.frequency.setTargetAtTime(on ? 950 : 380, t, 0.18);
}
export function stopEngine() {
  if (!eng || !ctx) { eng = null; return; }
  try {
    eng.g.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    const o = eng.o; setTimeout(() => { try { o.stop(); } catch {} }, 250);
  } catch {}
  eng = null;
}

// ---------- BGM (신스웨이브 루프, 제너러티브) ----------
let bgm = null;
const CHORDS = [            // Am – F – C – G (각 4스텝)
  [220.0, 261.6, 329.6],
  [174.6, 220.0, 261.6],
  [261.6, 329.6, 392.0],
  [196.0, 246.9, 293.7],
];
const BASS = [110.0, 87.3, 130.8, 98.0];
const BEAT = 60 / 108;     // 108 BPM

export function startBgm() {
  const c = ensure(); if (!c || muted || bgm) return;
  const out = c.createGain(); out.gain.value = 0.0001; out.connect(master);
  out.gain.setTargetAtTime(0.5, c.currentTime, 1.2);   // 페이드 인

  let step = 0;
  let nextTime = c.currentTime + 0.12;
  const obj = { timer: 0, out };

  function schedule(time) {
    const ci = Math.floor(step / 4) % CHORDS.length;
    const chord = CHORDS[ci];
    // 아르페지오 (8분음표)
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.value = chord[step % 3] * 2;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.16, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + BEAT * 0.9);
    o.connect(f); f.connect(g); g.connect(out);
    o.start(time); o.stop(time + BEAT);
    // 베이스 (코드마다 1회)
    if (step % 4 === 0) {
      const bo = c.createOscillator(); bo.type = 'sawtooth';
      bo.frequency.value = BASS[ci];
      const bf = c.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 480;
      const bg = c.createGain();
      bg.gain.setValueAtTime(0.0001, time);
      bg.gain.linearRampToValueAtTime(0.2, time + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.0001, time + BEAT * 2);
      bo.connect(bf); bf.connect(bg); bg.connect(out);
      bo.start(time); bo.stop(time + BEAT * 2);
    }
    step++;
  }

  obj.timer = setInterval(() => {
    if (!bgm) return;
    while (nextTime < c.currentTime + 0.2) { schedule(nextTime); nextTime += BEAT / 2; }
  }, 40);
  bgm = obj;
}

export function stopBgm() {
  if (!bgm) return;
  clearInterval(bgm.timer);
  const out = bgm.out;
  try { if (ctx) out.gain.setTargetAtTime(0, ctx.currentTime, 0.2); } catch {}
  setTimeout(() => { try { out.disconnect(); } catch {} }, 700);
  bgm = null;
}
