// 오토바이 — 차체 + 바퀴 2개 + 서스펜션. 지상에선 가속/브레이크, 공중에선 회전(트릭).

import Matter from 'https://esm.sh/matter-js@0.20.0';
import { TUNING } from './tuning.js';

const WHEEL_R = 24;
const CHASSIS_W = 116;
const CHASSIS_H = 26;

export function createBike(world, x, y) {
  const group = Matter.Body.nextGroup(true); // 자기 부품끼리 충돌 무시

  const chassis = Matter.Bodies.rectangle(x, y, CHASSIS_W, CHASSIS_H, {
    collisionFilter: { group }, density: 0.0011, friction: 0.4, label: 'chassis',
    chamfer: { radius: 10 },
  });

  // 바퀴를 무겁게 → 무게중심이 낮아져 윌리(앞들림)/뒤집힘이 줄어듦
  const wheelOpts = {
    collisionFilter: { group }, friction: 1.4, frictionStatic: 2.4, density: 0.0017, restitution: 0.02,
    label: 'wheel',
  };
  const rear = Matter.Bodies.circle(x - 44, y + 26, WHEEL_R, { ...wheelOpts, label: 'wheel-rear' });
  const front = Matter.Bodies.circle(x + 44, y + 26, WHEEL_R, { ...wheelOpts, label: 'wheel-front' });

  const stiffness = 0.5, damping = 0.25;
  const susRear = Matter.Constraint.create({
    bodyA: chassis, pointA: { x: -44, y: 14 }, bodyB: rear, stiffness, damping, length: 12,
  });
  const susFront = Matter.Constraint.create({
    bodyA: chassis, pointA: { x: 44, y: 14 }, bodyB: front, stiffness, damping, length: 12,
  });
  // 바퀴가 옆으로 흐르지 않도록 보조 축
  const axleRear = Matter.Constraint.create({
    bodyA: chassis, pointA: { x: -44, y: 14 }, bodyB: rear, pointB: { x: 0, y: 0 }, stiffness: 0.9, length: 12,
  });
  const axleFront = Matter.Constraint.create({
    bodyA: chassis, pointA: { x: 44, y: 14 }, bodyB: front, pointB: { x: 0, y: 0 }, stiffness: 0.9, length: 12,
  });

  Matter.Composite.add(world, [chassis, rear, front, susRear, susFront, axleRear, axleFront]);

  const bike = {
    chassis, rear, front,
    parts: [chassis, rear, front],
    // gas=전진, brake=감속/후진, leanBack=앞들기(윌리), leanFwd=앞숙임, jump=점프
    input: { gas: false, brake: false, leanBack: false, leanFwd: false, jump: false },
    _boost: 0,   // 가속 유지 시간 누적 (0~1): 높을수록 빠르고 컨트롤 어려움
    // 트릭 추적
    _airAngleStart: 0,
    _airAccum: 0,
    _wasGrounded: true,

    applyControls(grounded, dt = 1 / 60) {
      const T = TUNING;
      const { gas, brake, leanBack, leanFwd } = this.input;

      // 부스트 누적/감소: 지상에서 가속 유지 시 차오름, 떼거나 공중이면 줄어듦
      if (grounded && gas) this._boost = Math.min(1, this._boost + dt / 2.2);
      else this._boost = Math.max(0, this._boost - dt / 1.8);
      if (brake) this._boost = Math.max(0, this._boost - dt / 0.6);
      const b = this._boost;

      const torque = T.torque + b * T.boostTorque;
      const reverse = 0.32;

      if (grounded) {
        // 구동: 바퀴가 '구동 상한' 미만일 때만 가속 토크 추가 → 그 이상 속도는 모멘텀에 맡긴다.
        //       (가속이 빠른 내리막 속도를 깎지 않음 → 하락 구간에서 탄력↑ → 다음 램프에서 점프)
        const driveCap = T.maxAv + b * T.boostAv;
        if (gas) {
          if (rear.angularVelocity < driveCap) rear.torque += torque;
          if (front.angularVelocity < driveCap) front.torque += torque;
        }
        // 후진: 브레이크(키 ↓) 또는 '가속 안 누른 채 앞들기'(멈춰서 뒤로 빠져나오기)
        if (brake || (leanBack && !gas)) { rear.torque -= reverse; front.torque -= reverse * 0.9; }

        // ── 분리된 자세 제어(Stock Rider식): 윌리=앞들기, 앞숙임 ──
        // (Matter: 음의 토크 = 앞들림, 양의 토크 = 앞코 내림)
        if (leanBack) chassis.torque -= T.leanBack;
        if (leanFwd) chassis.torque += T.leanFwd;

        // 절대 상한만(전복/무한 가속 방지) — 내리막 모멘텀은 rollCap 까지 허용해 램프 점프 탄력 확보
        const rollCap = driveCap * T.rollCapMult;
        if (rear.angularVelocity > rollCap) Matter.Body.setAngularVelocity(rear, rollCap);
        if (front.angularVelocity > rollCap) Matter.Body.setAngularVelocity(front, rollCap);
        if (rear.angularVelocity < -T.maxRev) Matter.Body.setAngularVelocity(rear, -T.maxRev);
        if (front.angularVelocity < -T.maxRev) Matter.Body.setAngularVelocity(front, -T.maxRev);

        // 약한 자동 복원(용서) — 중립구간 밖에서만 지형(바퀴선)에 천천히 정렬, 전복 직전엔 강하게
        const wheelAngle = Math.atan2(front.position.y - rear.position.y, front.position.x - rear.position.x);
        let pitch = chassis.angle - wheelAngle;       // 음수 = 앞들림(윌리)
        while (pitch > Math.PI) pitch -= 2 * Math.PI;
        while (pitch < -Math.PI) pitch += 2 * Math.PI;
        if (pitch < -T.neutral) {
          const k = pitch < -T.flip ? T.recoverFlip : T.recover;
          Matter.Body.setAngularVelocity(chassis, chassis.angularVelocity + Math.min(T.recoverCap, (-T.neutral - pitch) * k));
        } else if (pitch > T.neutral) {
          const k = pitch > T.flip ? T.recoverFlip : T.recover;
          Matter.Body.setAngularVelocity(chassis, chassis.angularVelocity - Math.min(T.recoverCap, (pitch - T.neutral) * k));
        }

        // 각속도 상한
        const maxSpin = T.maxSpin + b * T.boostSpin;
        if (chassis.angularVelocity > maxSpin) Matter.Body.setAngularVelocity(chassis, maxSpin);
        if (chassis.angularVelocity < -maxSpin) Matter.Body.setAngularVelocity(chassis, -maxSpin);
      } else {
        // 공중: 윌리=백플립, 앞숙임=프론트플립
        const flipSpeed = 0.16, accel = 0.028;
        if (leanBack) Matter.Body.setAngularVelocity(chassis, Math.max(chassis.angularVelocity - accel, -flipSpeed));
        if (leanFwd) Matter.Body.setAngularVelocity(chassis, Math.min(chassis.angularVelocity + accel, flipSpeed));
      }
    },

    // 점프 — 지상에서 위로 임펄스 (차체+바퀴를 함께 띄워 분리 방지)
    jump() {
      const power = TUNING.jump;
      for (const b of [chassis, rear, front]) {
        Matter.Body.setVelocity(b, { x: b.velocity.x, y: Math.min(b.velocity.y, 0) - power });
      }
    },

    // grounded 변화에 따라 공중 회전 누적 → 착지 시 { n: 회전수, back: 뒷구르기(백플립) 여부 } 반환
    trackTrick(grounded) {
      let n = 0, back = false;
      if (!grounded) {
        if (this._wasGrounded) { this._airAngleStart = chassis.angle; this._airAccum = 0; this._lastAngle = chassis.angle; }
        // 각도 연속 누적 (래핑 보정)
        let d = chassis.angle - this._lastAngle;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        this._airAccum += d;
        this._lastAngle = chassis.angle;
      } else if (this._wasGrounded === false) {
        // 방금 착지 — 음수 누적 = 뒤로 돈 것(백플립/뒷구르기)
        n = Math.floor(Math.abs(this._airAccum) / (2 * Math.PI));
        back = this._airAccum < 0;
        this._airAccum = 0;
      }
      this._wasGrounded = grounded;
      return { n, back };
    },

    get position() { return chassis.position; },
    get angle() { return chassis.angle; },
  };

  return bike;
}
