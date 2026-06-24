// 오토바이 — 차체 + 바퀴 2개 + 서스펜션. 지상에선 가속/브레이크, 공중에선 회전(트릭).

import Matter from 'https://esm.sh/matter-js@0.20.0';

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
    input: { gas: false, brake: false, jump: false },
    _boost: 0,   // 가속 유지 시간 누적 (0~1): 높을수록 빠르고 컨트롤 어려움
    // 트릭 추적
    _airAngleStart: 0,
    _airAccum: 0,
    _wasGrounded: true,

    applyControls(grounded, dt = 1 / 60) {
      const { gas, brake } = this.input;

      // 부스트 누적/감소: 지상에서 가속 유지 시 차오름, 떼거나 공중이면 줄어듦
      if (grounded && gas) this._boost = Math.min(1, this._boost + dt / 2.2);
      else this._boost = Math.max(0, this._boost - dt / 1.8);
      if (brake) this._boost = Math.max(0, this._boost - dt / 0.6);
      const b = this._boost;

      const torque = 0.42 + b * 0.16;  // 가속력(부스트 가산 완화 → 고속에서 과도한 윌리 방지)
      const reverse = 0.32;            // 뒤로 주행 힘 (전진보다 약하게)

      if (grounded) {
        // AWD: 앞·뒤 바퀴를 동일하게 구동 → 급경사(급등)에서 앞이 안 들리고 끌어올림
        if (gas) { rear.torque += torque; front.torque += torque; }
        // 브레이크/뒤로: 후진 토크 (전진 중이면 자연스럽게 감속 후 후진)
        if (brake) { rear.torque -= reverse; front.torque -= reverse * 0.9; }

        // ── 2페달 밸런스(힐클라임식): 가속=뒤로 젖힘(윌리), 뒤로=앞코 숙임 ──
        // 별도 버튼 없이 가속↔뒤로를 조절하며 차체 자세를 직접 잡는 '조작하는 맛'.
        // (Matter: 양의 토크 = 앞코 내림, 음의 토크 = 앞들림)
        const lean = 0.03;
        if (gas) chassis.torque -= lean;         // 앞들림(윌리) — 과하지 않게
        if (brake) chassis.torque += lean * 1.3; // 앞코 숙임(윌리 카운터, 좀 더 잘 듣게)

        // 전진 속도 상한 — 부스트가 차오를수록 점점 빨라짐 (1.5 → 3.7)
        const maxAv = 1.5 + b * 2.2;
        if (rear.angularVelocity > maxAv) Matter.Body.setAngularVelocity(rear, maxAv);
        if (front.angularVelocity > maxAv) Matter.Body.setAngularVelocity(front, maxAv);
        // 후진 속도 상한
        const maxRev = 0.95;
        if (rear.angularVelocity < -maxRev) Matter.Body.setAngularVelocity(rear, -maxRev);
        if (front.angularVelocity < -maxRev) Matter.Body.setAngularVelocity(front, -maxRev);

        // ── 약한 자동 복원(용서) — 입력이 없을 때만 천천히 지형(바퀴선)에 정렬 ──
        // 플레이어가 가속/뒤로로 적극 자세를 잡으면 그 입력이 이긴다(±17° 중립구간은 간섭 0).
        // 전복 직전(±54°↑)에서만 좀 더 당겨 '완전히 뒤집혀 즉사'는 막는다(캐주얼 난이도).
        const wheelAngle = Math.atan2(front.position.y - rear.position.y, front.position.x - rear.position.x);
        let pitch = chassis.angle - wheelAngle;       // 음수 = 앞들림(윌리)
        while (pitch > Math.PI) pitch -= 2 * Math.PI;
        while (pitch < -Math.PI) pitch += 2 * Math.PI;
        const NEUTRAL = 0.22;     // ±~13°: 자유 제어 구간(좁혀서 더 빨리 복원 → 잘 안 뒤집힘)
        const FLIP = 0.8;         // ±~46°: 거의 전복 → 강하게 복원
        if (pitch < -NEUTRAL) {
          const k = pitch < -FLIP ? 1.2 : 0.7;        // 윌리(앞들림) 쪽을 더 강하게 잡아줌
          Matter.Body.setAngularVelocity(chassis, chassis.angularVelocity + Math.min(0.6, (-NEUTRAL - pitch) * k));
        } else if (pitch > NEUTRAL) {
          const k = pitch > FLIP ? 1.0 : 0.5;
          Matter.Body.setAngularVelocity(chassis, chassis.angularVelocity - Math.min(0.5, (pitch - NEUTRAL) * k));
        }

        // 각속도 상한 — 낮춰서 급회전(전복) 억제, 자세 제어는 여전히 가능
        const maxSpin = 0.30 + b * 0.06;
        if (chassis.angularVelocity > maxSpin) Matter.Body.setAngularVelocity(chassis, maxSpin);
        if (chassis.angularVelocity < -maxSpin) Matter.Body.setAngularVelocity(chassis, -maxSpin);
      } else {
        // 공중: 차체 회전 (gas=백플립, brake=프론트플립)
        // 느리게 — 평지 깡총 점프로는 한 바퀴 안 돌고, 진짜 점프대/낙폭에서만 완성
        const flipSpeed = 0.16, accel = 0.028;
        if (gas) Matter.Body.setAngularVelocity(chassis, Math.max(chassis.angularVelocity - accel, -flipSpeed));
        if (brake) Matter.Body.setAngularVelocity(chassis, Math.min(chassis.angularVelocity + accel, flipSpeed));
      }
    },

    // 점프 — 지상에서 위로 임펄스 (차체+바퀴를 함께 띄워 분리 방지)
    jump() {
      const power = 11;
      for (const b of [chassis, rear, front]) {
        Matter.Body.setVelocity(b, { x: b.velocity.x, y: Math.min(b.velocity.y, 0) - power });
      }
    },

    // grounded 변화에 따라 공중 회전 누적 → 착지 시 회전수 반환
    trackTrick(grounded) {
      let completedFlips = 0;
      if (!grounded) {
        if (this._wasGrounded) { this._airAngleStart = chassis.angle; this._airAccum = 0; this._lastAngle = chassis.angle; }
        // 각도 연속 누적 (래핑 보정)
        let d = chassis.angle - this._lastAngle;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        this._airAccum += d;
        this._lastAngle = chassis.angle;
      } else if (this._wasGrounded === false) {
        // 방금 착지
        completedFlips = Math.floor(Math.abs(this._airAccum) / (2 * Math.PI));
        this._airAccum = 0;
      }
      this._wasGrounded = grounded;
      return completedFlips;
    },

    get position() { return chassis.position; },
    get angle() { return chassis.angle; },
  };

  return bike;
}
