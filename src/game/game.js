// 게임 엔진 — Matter 물리 + 커스텀 네온 렌더러 + 카메라 + 점수/연료/종료 판정.

import Matter from 'https://esm.sh/matter-js@0.20.0';
import { CONFIG } from '../config.js';
import { t } from '../i18n.js';
import { difficulty } from '../difficulty.js';
import { eventName } from '../events.js';
import { buildTerrain } from './terrain.js';
import { createBike } from './bike.js';
import * as audio from '../audio.js';

const PX_PER_METER = 9;
const FLIP_METERS = CONFIG.GAME.flipMeters ?? 50;
const FLIP_TIME = CONFIG.GAME.flipTimeBonus ?? 2;
const CP_TIME = CONFIG.GAME.checkpointTime ?? 3;
const CHECKPOINTS = CONFIG.GAME.checkpoints ?? [0.2, 0.5, 0.8];
const EVENT_WARN_DIST = 760;    // 폭락 이벤트 '사전 경고' 토스트가 뜨는 거리(px) — 미리 대비
const EVENT_SPAWN_DIST = 440;   // 폭락 캔들 장애물이 생성·노출되는 거리(px) — 화면에 보이며 다가옴

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.running = false;
    this._raf = null;
    this._onEnd = null;
  }

  start(series, symbol, name, onEnd, opts = {}) {
    this._onEnd = onEnd;
    this.testMode = !!opts.test;   // ?tune=1 테스트: 무제한(연료/완주/크래시 종료 끔)
    this.symbol = symbol;
    this.stockName = (name || '').split('·')[0].trim();   // 거래소 꼬리표 제거
    this.diff = difficulty(series);                        // 변동성 기반 난이도
    const hd = document.getElementById('hud-diff');
    if (hd) { hd.textContent = `${this.diff.stars} ${this.diff.label}`; hd.style.color = this.diff.color; }
    this._resize();
    this._resizeHandler = () => { this._resize(); if (this.terrain) this._initMinimap(); };
    window.addEventListener('resize', this._resizeHandler);

    // 물리 세계
    this.engine = Matter.Engine.create();
    this.engine.gravity.y = 1.0;
    this.world = this.engine.world;

    this.terrain = buildTerrain(this.world, series);
    const sp = this.terrain.startPoint;
    this.startX = sp.x;
    this.maxX = sp.x;
    this.bike = createBike(this.world, sp.x + 40, sp.y - 80);
    this._initMinimap();

    // 상태
    this.distanceM = 0;
    this.flips = 0;
    this.flipBonusM = 0;   // 플립 거리 보너스(백플립 가중) 누적
    this.fuel = CONFIG.GAME.fuelSeconds;
    this.lastTs = performance.now();
    this.groundedThisStep = false;
    this._crashTimer = 0;
    this._cpHit = new Set();   // 통과한 체크포인트
    this._events = (CONFIG.GAME.crashEvents === false ? [] : (this.terrain.events || [])).map((e) => ({ ...e, done: false }));
    // 테스트 모드: 실제 코스 이벤트 대신 일정 간격마다 점프 장애물 배치
    if (this.testMode) {
      const pts = this.terrain.points;
      this._events = [];
      for (let x = 1200; x < this.terrain.worldWidth - 500; x += 820) {
        let y = pts[pts.length - 1].y;
        for (let i = 1; i < pts.length; i++) { if (pts[i].x >= x) { y = pts[i].y; break; } }
        this._events.push({ x, y, event: { emoji: '🚧', test: true }, done: false });
      }
    }
    this._eventBodies = [];    // 활성 장애물
    this._flash = 0;           // 붉은 화면 효과
    this._shake = 0;           // 화면 흔들림
    this.ended = false;
    this.startTime = performance.now();
    this.graceSec = 1.8;          // 시작 직후 종료 판정 유예(착지 대기)

    // 지면 접촉 감지
    Matter.Events.on(this.engine, 'collisionActive', (ev) => {
      for (const p of ev.pairs) {
        const labels = [p.bodyA.label, p.bodyB.label];
        if (labels.includes('ground') && (labels.includes('wheel-rear') || labels.includes('wheel-front'))) {
          this.groundedThisStep = true;
        }
        // 머리(차체)가 지면에 닿으면 크래시 타이머
        if (labels.includes('ground') && labels.includes('chassis')) {
          this._chassisTouching = true;
        }
        // 장애물에 부딪힘 표시 → 깔끔히 넘은 보너스 판정에 사용
        if (labels.includes('event-wall')) {
          (p.bodyA.label === 'event-wall' ? p.bodyA : p.bodyB)._hit = true;
        }
      }
    });

    this._bindInput();
    this._showControlsHint();
    audio.startBgm();
    audio.startEngine();
    this.running = true;
    this._loop();
  }

  _showControlsHint() {
    const el = document.getElementById('controls-hint');
    if (!el) return;
    const touch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
    el.textContent = touch ? t.hintTouch : t.hintKeys;
    el.classList.add('show');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  // ---------- 입력 ----------
  _bindInput() {
    const set = (k, v) => { if (this.bike) this.bike.input[k] = v; };

    this._press = (el, k) => {
      if (!el) return;
      const down = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); set(k, true); };
      const up = (e) => { e.preventDefault(); set(k, false); };
      const ctx = (e) => e.preventDefault();   // 모바일 롱프레스 메뉴 차단
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', ctx);
      el._handlers = { down, up, ctx };
    };
    // 모바일 4버튼: 윌리(앞들기) · 앞숙임 · 점프 · 가속
    this._press(document.getElementById('btn-wheelie'), 'leanBack');
    this._press(document.getElementById('btn-nose'), 'leanFwd');
    this._press(document.getElementById('btn-jump'), 'jump');
    this._press(document.getElementById('btn-gas'), 'gas');

    // 키보드: Up/W=가속, Left/A=앞들기(윌리), Right/D=앞숙임, Space=점프, Down/S=브레이크
    this._key = (e) => {
      const down = e.type === 'keydown';
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowUp' || k === 'w') { e.preventDefault(); set('gas', down); }
      if (e.key === 'ArrowLeft' || k === 'a') set('leanBack', down);
      if (e.key === 'ArrowRight' || k === 'd') set('leanFwd', down);
      if (e.key === ' ') { e.preventDefault(); set('jump', down); }
      if (e.key === 'ArrowDown' || k === 's') set('brake', down);
    };
    window.addEventListener('keydown', this._key);
    window.addEventListener('keyup', this._key);
  }

  // ---------- 메인 루프 ----------
  _loop() {
    if (!this.running) return;
    const now = performance.now();
    let dt = (now - this.lastTs) / 1000;
    this.lastTs = now;
    dt = Math.min(dt, 0.05);

    // 물리 스텝
    this.groundedThisStep = false;
    this._chassisTouching = false;
    this.bike.applyControls(this._lastGrounded ?? true, dt);
    Matter.Engine.update(this.engine, dt * 1000);
    const grounded = this.groundedThisStep;
    this._lastGrounded = grounded;

    // 점프 — 버퍼(누른 직후 잠깐 기억) + 코요테(땅 떠난 직후 잠깐 허용)로 씹힘 방지.
    //   가속 중 범프로 바퀴가 잠깐 떠도, 상승 램프 끝에서 눌러도 점프가 확실히 발동한다.
    const jumpEdge = this.bike.input.jump && !this._prevJump;
    if (jumpEdge) this._jumpBuf = 0.16;
    else this._jumpBuf = Math.max(0, (this._jumpBuf || 0) - dt);
    this._coyote = grounded ? 0.12 : Math.max(0, (this._coyote || 0) - dt);
    if (this._jumpBuf > 0 && this._coyote > 0) {
      this.bike.jump(); audio.sfx.jump();
      this._jumpBuf = 0; this._coyote = 0;
    }
    this._prevJump = this.bike.input.jump;
    audio.setThrottle(!!this.bike.input.gas);

    // 트릭 / 착지 판정 — 깨끗이(바퀴로) 착지하면 보너스, 등·머리로 착지하면 패널티
    const trick = this.bike.trackTrick(grounded);
    const flips = trick.n;
    const justLanded = grounded && this._wasAir;
    let badLand = false;
    if (justLanded) {
      let a = this.bike.chassis.angle % (2 * Math.PI);
      if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI;
      badLand = Math.abs(a) > 2.0;     // ~115°+ 기울어진 채 착지 = 등/머리로 떨어짐
    }
    this._badLandCd = Math.max(0, (this._badLandCd || 0) - dt);
    if (badLand) {
      if (this._badLandCd <= 0) {      // 쿨다운: 착지 실패 1회 후 2.5초간은 재패널티 없음(튕김 연타 방지)
        this.fuel = Math.max(0, this.fuel - 3);   // 착지 실패 패널티: -3초 (트릭 보너스 없음)
        this._toast(`🙃 ${t.badLand} -3s`, '#ff5d6e');
        audio.sfx.crash();
        this._badLandCd = 2.5;
      }
    } else if (flips > 0) {
      // 플립 성공(깨끗한 착지) = 거리 보너스. 뒷구르기(백플립)는 더 어려우니 1.6배.
      this.flips += flips;
      this.flipBonusM = (this.flipBonusM || 0) + Math.round(flips * FLIP_METERS * (trick.back ? 1.6 : 1));
      this._showTrick(flips, trick.back);
      audio.sfx.flip();
    }
    this._wasAir = !grounded;

    // 거리 / 연료
    this.maxX = Math.max(this.maxX, this.bike.position.x);
    this.distanceM = Math.max(0, Math.floor((this.maxX - this.startX) / PX_PER_METER)) + (this.flipBonusM || 0);
    if (!this.testMode) this.fuel -= dt;   // 테스트 모드: 연료 무제한

    // 체크포인트(20/50/80%) 통과 시 +시간
    const totalW = this.terrain.worldWidth - this.startX;
    const prog = (this.maxX - this.startX) / totalW;
    for (const cp of CHECKPOINTS) {
      if (prog >= cp && !this._cpHit.has(cp)) {
        this._cpHit.add(cp);
        this.fuel += CP_TIME;
        this._toast(`🚩 ${t.checkpoint} ${Math.round(cp * 100)}%  +${CP_TIME}s`, '#2ce6c4');
        audio.sfx.checkpoint();
      }
    }

    // 장애물 — ① 사전 경고 토스트 → ② 화면에 보이게 점프 장애물 생성 (피할 시간 확보)
    const evLabel = (ev) => (ev.event && ev.event.test ? t.obstacle : eventName(ev.event));
    const bx = this.bike.position.x;
    for (const ev of this._events) {
      if (ev.done) continue;
      const dist = ev.x - bx;
      if (!ev.warned && dist <= EVENT_WARN_DIST && dist > 0) {
        ev.warned = true;
        this._toast(`${ev.event.emoji} ${t.eventWarn(evLabel(ev))}`, '#ffd34d');
      }
      if (dist <= EVENT_SPAWN_DIST) { ev.done = true; this._triggerEvent(ev); }
    }
    // 효과 감쇠 / 지나간 장애물 제거 (+ 깔끔히 넘으면 보너스)
    this._flash = Math.max(0, this._flash - dt * 1.4);
    this._shake = Math.max(0, this._shake - dt * 1.8);
    const tnow = performance.now();
    this._eventBodies = this._eventBodies.filter((eb) => {
      // 벽 중심을 지나는 순간, 차체가 벽 위로 넘어갔는지 기록(터널링/관통은 보너스 제외)
      if (!eb._crossed && bx >= eb.x) {
        eb._crossed = true;
        eb._over = this.bike.position.y < eb.y - eb.h * 0.4;
      }
      const passed = bx > eb.x + 95;
      if (passed || tnow - eb.born > 14000) {
        if (passed && eb._over && !eb.body._hit) {   // 부딪힘 없이 '점프로 깔끔히' 넘음 → +2초 보너스
          this.fuel = Math.min(CONFIG.GAME.fuelSeconds, this.fuel + 2);
          this._toast(`✨ ${t.cleared} +2s`, '#2ce6c4');
          audio.sfx.checkpoint();
        }
        Matter.Composite.remove(this.world, eb.body);
        return false;
      }
      return true;
    });

    // 전복 판정: 차체가 '뒤집힌 채' 멈춰 있을 때만 (가만히 서 있는 건 전복 아님)
    const speed = Math.hypot(this.bike.chassis.velocity.x, this.bike.chassis.velocity.y);
    const inverted = Math.cos(this.bike.angle) < -0.2;   // 차체가 대략 100° 이상 기울어짐
    if (inverted && speed < 1.6 && (grounded || this._chassisTouching)) this._crashTimer += dt;
    else this._crashTimer = Math.max(0, this._crashTimer - dt * 2);

    this._updateHud();
    this._render();
    this._checkEnd();

    this._raf = requestAnimationFrame(() => this._loop());
  }

  _checkEnd() {
    if (this.ended) return;
    const elapsed = (performance.now() - this.startTime) / 1000;
    if (elapsed < this.graceSec) return;   // 시작 직후 유예
    let reason = null;
    if (this.bike.position.y > this.terrain.maxY + 700) reason = 'fell';   // 지형보다 한참 아래 = 추락(테스트도 안전상 유지)
    else if (this.testMode) reason = null;   // 테스트 모드: 연료/완주/크래시 종료 없음(무제한 주행)
    else if (this.fuel <= 0) reason = 'fuel';
    else if (this.bike.position.x >= this.terrain.worldWidth - 120) reason = 'finish';
    else if (this._crashTimer > 2.5) reason = 'crash';
    if (reason) { console.log('[게임오버]', reason); this._end(reason); }
  }

  _end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.running = false;
    cancelAnimationFrame(this._raf);
    const completed = reason === 'finish';
    const timeMs = Math.round(performance.now() - this.startTime);   // 완주 시간(ms) — 완주자만 순위 기준
    audio.stopEngine();
    audio.stopBgm();
    audio.sfx[completed ? 'finish' : 'gameover']();
    this._cleanupInput();
    window.removeEventListener('resize', this._resizeHandler);
    if (this._onEnd) {
      this._onEnd({
        symbol: this.symbol,
        name: this.stockName,
        distance: this.distanceM,
        flips: this.flips,
        completed,
        timeMs,
        reason,
        diff: this.diff,
      });
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    audio.stopEngine();
    audio.stopBgm();
    this._cleanupInput();
    window.removeEventListener('resize', this._resizeHandler);
  }

  _cleanupInput() {
    if (this._key) {
      window.removeEventListener('keydown', this._key);
      window.removeEventListener('keyup', this._key);
    }
    ['btn-gas', 'btn-wheelie', 'btn-nose', 'btn-jump'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el._handlers) {
        el.removeEventListener('pointerdown', el._handlers.down);
        el.removeEventListener('pointerup', el._handlers.up);
        el.removeEventListener('pointercancel', el._handlers.up);
        el.removeEventListener('lostpointercapture', el._handlers.up);
        el.removeEventListener('contextmenu', el._handlers.ctx);
        el._handlers = null;
      }
    });
  }

  // ---------- HUD ----------
  _updateHud() {
    document.getElementById('hud-distance').textContent = `${this.distanceM.toLocaleString()} m`;
    document.getElementById('hud-symbol').textContent =
      this.stockName ? `${this.stockName} (${this.symbol})` : this.symbol;
    const pct = Math.max(0, Math.min(100, (this.fuel / CONFIG.GAME.fuelSeconds) * 100));
    document.getElementById('fuel-fill').style.width = `${pct}%`;

    // 코스 진행률 + 미니맵
    const total = this.terrain.worldWidth - this.startX;
    const frac = Math.max(0, Math.min(1, (this.bike.position.x - this.startX) / total));
    document.getElementById('hud-progress').textContent = t.course(Math.floor(frac * 100));
    this._drawMinimap(frac);
  }

  // ---------- 미니맵 ----------
  _initMinimap() {
    const cv = document.getElementById('minimap');
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || (window.innerWidth - 24);
    const h = cv.clientHeight || 54;
    cv.width = w * dpr; cv.height = h * dpr;
    const pts = this.terrain.points;
    const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
    const ys = pts.map((p) => p.y);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const padX = 6, padY = 9;
    const scaled = pts.map((p) => ({
      x: padX + ((p.x - x0) / (x1 - x0 || 1)) * (w - 2 * padX),
      y: padY + ((p.y - yMin) / (yMax - yMin || 1)) * (h - 2 * padY),
    }));
    this._mm = { cv, ctx: cv.getContext('2d'), w, h, dpr, scaled, padX };
  }

  _drawMinimap(frac) {
    const m = this._mm;
    if (!m) return;
    const { ctx, w, h, dpr, scaled, padX } = m;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const markerX = padX + frac * (w - 2 * padX);

    // 전체 차트(흐리게)
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(44,230,196,0.3)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    scaled.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();

    // 지나온 구간(밝게) — markerX 까지 클립
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, markerX, h); ctx.clip();
    ctx.strokeStyle = '#2ce6c4';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(44,230,196,0.8)'; ctx.shadowBlur = 6;
    ctx.beginPath();
    scaled.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();

    // 현재 위치 마커
    let yAt = scaled[0].y;
    for (let i = 1; i < scaled.length; i++) {
      if (scaled[i].x >= markerX) {
        const a = scaled[i - 1], b = scaled[i];
        const t = (markerX - a.x) / (b.x - a.x || 1);
        yAt = a.y + (b.y - a.y) * t;
        break;
      }
    }
    ctx.strokeStyle = 'rgba(255,211,77,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(markerX, 4); ctx.lineTo(markerX, h - 4); ctx.stroke();
    ctx.fillStyle = '#ffd34d';
    ctx.shadowColor = 'rgba(255,211,77,0.9)'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(markerX, yAt, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  _showTrick(n, back) {
    const name = back ? t.backflip : t.frontflip;
    const label = n >= 2 ? `${n}x ${name}` : name;
    const m = Math.round(n * FLIP_METERS * (back ? 1.6 : 1));
    this._toast(`${back ? '🔄 ' : ''}${label}! +${m}m`, back ? '#ffd34d' : '#5b8cff');
  }

  _triggerEvent(ev) {
    const isTest = ev.event && ev.event.test;
    if (!isTest) { this._flash = 0.85; this._shake = 1; audio.sfx.crash(); }   // 실제 폭락만 충격 효과
    this._toast(`${ev.event.emoji} ${isTest ? t.obstacle : eventName(ev.event)}`, isTest ? '#ffd34d' : '#ff4d6d');
    // 점프로 넘어야 하는 장애물 — 높고(점프 강제) 넓게(고속 터널링 방지)
    const h = 74, w = 46;
    const wall = Matter.Bodies.rectangle(ev.x, ev.y - h / 2, w, h, {
      isStatic: true, friction: 1, label: 'event-wall', render: { visible: false },
    });
    Matter.Composite.add(this.world, wall);
    this._eventBodies.push({ body: wall, x: ev.x, y: ev.y, h, event: ev.event, born: performance.now() });
  }

  _toast(text, color) {
    let el = document.getElementById('trick-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'trick-toast';
      el.className = 'trick-toast';
      document.getElementById('screen-play').appendChild(el);
    }
    el.textContent = text;
    el.style.color = color || '';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ---------- 렌더 ----------
  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.dpr = dpr;
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    // 화면이 작을수록(모바일) 더 축소해서 코스를 넓게 보여줌
    const base = Math.min(this.vw, this.vh);
    this.zoom = Math.max(0.5, Math.min(1.05, base / 720));
  }

  _render() {
    const ctx = this.ctx;
    const { vw, vh, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    // 배경
    const bg = ctx.createLinearGradient(0, 0, 0, vh);
    bg.addColorStop(0, '#0d1320'); bg.addColorStop(1, '#070a10');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, vw, vh);

    // 카메라 (줌 적용) — 바이크를 화면 앵커 지점에 두고 zoom 배율로 축소/확대
    const zoom = this.zoom || 1;
    const bp = this.bike.position;
    const anchorX = vw * 0.33, anchorY = vh * 0.5;
    const worldW = vw / zoom, worldH = vh / zoom;   // 보이는 월드 크기
    const camX = bp.x - anchorX / zoom;
    const camY = bp.y - anchorY / zoom;

    const sh = this._shake || 0;
    const sx = (Math.random() - 0.5) * sh * 16;
    const sy = (Math.random() - 0.5) * sh * 16;

    ctx.save();
    ctx.translate(anchorX + sx, anchorY + sy);
    ctx.scale(zoom, zoom);
    ctx.translate(-bp.x, -bp.y);

    this._drawGrid(ctx, camX, camY, worldW, worldH);
    this._drawTerrain(ctx, camX, worldW);
    this._drawLabels(ctx, camX, worldW);
    this._drawEvents(ctx);
    this._drawBike(ctx);

    ctx.restore();

    // 붉은 화면 플래시 (폭락 충격)
    if (this._flash > 0) {
      ctx.fillStyle = `rgba(255,40,60,${this._flash * 0.4})`;
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  _drawEvents(ctx) {
    for (const eb of this._eventBodies) {
      const x = eb.x, top = eb.y - eb.h;
      const isTest = eb.event && eb.event.test;
      const col = isTest ? '#ffd34d' : '#ff4d6d';                 // 실제=폭락 빨강 / 테스트=장애물 노랑
      ctx.fillStyle = col;
      ctx.shadowColor = isTest ? 'rgba(255,211,77,0.8)' : 'rgba(255,77,109,0.85)'; ctx.shadowBlur = 16;
      this._roundRect(ctx, x - 23, top, 46, eb.h, 6); ctx.fill();   // 벽 폭(46)에 맞춤
      ctx.shadowBlur = 0;
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, top - 14); ctx.lineTo(x, top); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = '26px sans-serif';
      ctx.fillText(eb.event.emoji, x, top - 22);
      ctx.font = '800 13px sans-serif'; ctx.fillStyle = isTest ? '#ffe9a8' : '#ff8da0';
      ctx.fillText(isTest ? t.obstacle : eventName(eb.event), x, top - 48);
    }
  }

  _drawGrid(ctx, camX, camY, vw, vh) {
    ctx.strokeStyle = 'rgba(44,230,196,0.05)';
    ctx.lineWidth = 1;
    const step = 120;
    const x0 = Math.floor(camX / step) * step;
    for (let x = x0; x < camX + vw; x += step) {
      ctx.beginPath(); ctx.moveTo(x, camY); ctx.lineTo(x, camY + vh); ctx.stroke();
    }
    const y0 = Math.floor(camY / step) * step;
    for (let y = y0; y < camY + vh; y += step) {
      ctx.beginPath(); ctx.moveTo(camX, y); ctx.lineTo(camX + vw, y); ctx.stroke();
    }
  }

  _drawTerrain(ctx, camX, vw) {
    const pts = this.terrain.points;
    // 가시 범위만
    const left = camX - 200, right = camX + vw + 200;

    // 라인 아래 채움
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      if (p.x < left || p.x > right) { if (started && p.x > right) break; if (p.x < left) continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(Math.min(right, last.x), 4000);
    ctx.lineTo(left, 4000);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, 1400);
    fill.addColorStop(0, 'rgba(44,230,196,0.10)');
    fill.addColorStop(1, 'rgba(44,230,196,0)');
    ctx.fillStyle = fill; ctx.fill();

    // 네온 라인
    ctx.shadowColor = 'rgba(44,230,196,0.9)';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = '#2ce6c4';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    started = false;
    for (const p of pts) {
      if (p.x < left || p.x > right + 200) { if (p.x < left) { continue; } }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _drawLabels(ctx, camX, vw) {
    const left = camX - 60, right = camX + vw + 60;
    ctx.font = '700 15px sans-serif';
    ctx.textAlign = 'center';
    for (const l of this.terrain.labels) {
      if (l.x < left || l.x > right) continue;
      const up = l.pct >= 0;
      const txt = `${up ? '▲' : '▼'} ${up ? '+' : ''}${l.pct.toFixed(1)}% · $${l.price.toFixed(0)}`;
      const w = ctx.measureText(txt).width + 18;
      const y = l.y - 34;
      ctx.fillStyle = up ? 'rgba(44,230,122,0.15)' : 'rgba(255,77,109,0.15)';
      ctx.strokeStyle = up ? 'rgba(44,230,122,0.6)' : 'rgba(255,77,109,0.6)';
      ctx.lineWidth = 1;
      this._roundRect(ctx, l.x - w / 2, y - 13, w, 24, 8);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = up ? '#7dffb0' : '#ff8da0';
      ctx.fillText(txt, l.x, y + 4);
    }
  }

  _drawBike(ctx) {
    const { chassis, rear, front } = this.bike;
    const WR = 24;
    const rx = -44, fx = 44, wy = 26;  // 로컬 바퀴 위치

    // 부스트 스피드 라인 (뒤로 흐르는 잔상)
    const boost = this.bike._boost || 0;
    if (boost > 0.4) {
      ctx.strokeStyle = `rgba(44,230,196,${(boost - 0.4) * 0.7})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      const bx = chassis.position.x, by = chassis.position.y;
      for (let i = 0; i < 5; i++) {
        const oy = by - 26 + i * 13;
        ctx.beginPath();
        ctx.moveTo(bx - 55 - i * 6, oy);
        ctx.lineTo(bx - 100 - boost * 70 - i * 6, oy);
        ctx.stroke();
      }
    }

    // 바퀴는 프레임 고정 위치에 그려 항상 붙어 보이게 (회전각만 물리에서 가져옴)
    const c = Math.cos(chassis.angle), s = Math.sin(chassis.angle);
    const toWorld = (lx, ly) => ({
      x: chassis.position.x + lx * c - ly * s,
      y: chassis.position.y + lx * s + ly * c,
    });
    const wheels = [
      { pos: toWorld(rx, wy), ang: rear.angle },
      { pos: toWorld(fx, wy), ang: front.angle },
    ];

    // ---- 바퀴 — 오프로드 너클 타이어 ----
    for (const w of wheels) {
      ctx.save();
      ctx.translate(w.pos.x, w.pos.y);
      ctx.rotate(w.ang);
      // 너클(트레드 블록)
      ctx.fillStyle = '#161d27';
      for (let i = 0; i < 14; i++) {
        ctx.save();
        ctx.rotate((i / 14) * Math.PI * 2);
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(WR - 4, -2.6, 7, 5.2, 2) : ctx.rect(WR - 4, -2.6, 7, 5.2);
        ctx.fill();
        ctx.restore();
      }
      // 타이어 본체
      ctx.fillStyle = '#0c1117';
      ctx.beginPath(); ctx.arc(0, 0, WR, 0, Math.PI * 2); ctx.fill();
      // 림(네온)
      ctx.strokeStyle = '#2ce6c4'; ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(44,230,196,0.7)'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(0, 0, WR - 8, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      // 스포크 + 허브
      ctx.strokeStyle = 'rgba(160,180,200,0.5)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const a = (i * 2 * Math.PI) / 6;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * (WR - 8), Math.sin(a) * (WR - 8)); ctx.stroke();
      }
      ctx.fillStyle = '#cfe9e2';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ---- 프레임 + 플라스틱 + 라이더 (차체 로컬 좌표) ----
    ctx.save();
    ctx.translate(chassis.position.x, chassis.position.y);
    ctx.rotate(chassis.angle);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 배기 파이프 (뒤로 빠지는 머플러)
    ctx.strokeStyle = '#8693a6'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(2, 2); ctx.quadraticCurveTo(-26, 0, -44, 8); ctx.stroke();

    // 스윙암(뒤)
    ctx.strokeStyle = '#3a4a5e'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-12, 6); ctx.lineTo(rx, wy); ctx.stroke();
    // 리어 쇼크
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(-26, 12); ctx.stroke();

    // 앞 서스펜션 포크 (두 줄 + 트리플 클램프)
    ctx.strokeStyle = '#c4d0dc'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(28, -8); ctx.lineTo(fx + 2, wy); ctx.stroke();
    ctx.strokeStyle = '#7d8ba0'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(24, -8); ctx.lineTo(fx - 4, wy); ctx.stroke();

    // 엔진 블록
    ctx.fillStyle = '#2a3645';
    this._roundRect(ctx, -16, -2, 30, 16, 4); ctx.fill();
    ctx.strokeStyle = '#46586e'; ctx.lineWidth = 1;
    for (let i = -12; i < 12; i += 4) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 12); ctx.stroke(); }

    // 앞 흙받이(프론트 펜더)
    ctx.fillStyle = '#eef3f7';
    ctx.beginPath();
    ctx.moveTo(30, -18); ctx.quadraticCurveTo(48, -22, 58, -12);
    ctx.lineTo(54, -8); ctx.quadraticCurveTo(46, -16, 32, -13);
    ctx.closePath(); ctx.fill();

    // 메인 플라스틱 (샤우드+탱크+시트) — 네온 틸 투톤
    ctx.shadowColor = 'rgba(44,230,196,0.5)'; ctx.shadowBlur = 14;
    const body = ctx.createLinearGradient(0, -24, 0, 8);
    body.addColorStop(0, '#39f0d4'); body.addColorStop(1, '#10b89c');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-46, -8);                     // 리어 펜더 끝
    ctx.quadraticCurveTo(-44, -20, -30, -19);// 시트 뒤 융기
    ctx.lineTo(-8, -17);                      // 시트
    ctx.quadraticCurveTo(6, -26, 20, -18);   // 연료탱크/샤우드
    ctx.lineTo(30, -14);
    ctx.quadraticCurveTo(40, -12, 40, -4);   // 프론트 넘버플레이트 베이스
    ctx.lineTo(20, -6);
    ctx.lineTo(-12, -8);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    // 흰색 시트 패드
    ctx.fillStyle = '#eef3f7';
    this._roundRect(ctx, -30, -20, 26, 6, 3); ctx.fill();
    // 플라스틱 하이라이트 라인
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-6, -15); ctx.quadraticCurveTo(8, -22, 26, -13); ctx.stroke();

    // 프론트 넘버 플레이트
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.moveTo(36, -16); ctx.lineTo(50, -12); ctx.lineTo(48, 0); ctx.lineTo(36, -2); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a1208'; ctx.font = '800 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('7', 43, -5);

    // 핸들바 + 그립
    ctx.strokeStyle = '#39485c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(26, -16); ctx.lineTo(33, -28); ctx.stroke();
    ctx.fillStyle = '#1d2735';
    ctx.beginPath(); ctx.arc(34, -29, 3, 0, Math.PI * 2); ctx.fill();

    // ---- 라이더 (공격적 라이딩 자세) ----
    const hipX = -10, hipY = -18, shX = 14, shY = -34, handX = 33, handY = -27;
    // 뒷다리
    ctx.strokeStyle = '#1c2740'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(-2, -4); ctx.lineTo(8, 6); ctx.stroke();
    // 부츠
    ctx.strokeStyle = '#e8edf2'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(8, 6); ctx.lineTo(16, 8); ctx.stroke();
    // 몸통 (저지)
    ctx.strokeStyle = '#22406e'; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();
    // 어깨 패드 하이라이트
    ctx.strokeStyle = '#2ce6c4'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(hipX + 4, hipY - 5); ctx.lineTo(shX - 2, shY + 3); ctx.stroke();
    // 팔
    ctx.strokeStyle = '#2c4a78'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(handX, handY); ctx.stroke();
    // 헬멧
    ctx.fillStyle = '#eef3f7';
    ctx.beginPath(); ctx.arc(shX + 5, shY - 7, 9.5, 0, Math.PI * 2); ctx.fill();
    // 헬멧 바이저(챙)
    ctx.fillStyle = '#1d2735';
    ctx.beginPath(); ctx.moveTo(shX + 12, shY - 12); ctx.lineTo(shX + 19, shY - 11); ctx.lineTo(shX + 13, shY - 7); ctx.closePath(); ctx.fill();
    // 고글
    ctx.fillStyle = '#2ce6c4';
    this._roundRect(ctx, shX + 7, shY - 9, 8, 4, 2); ctx.fill();

    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
