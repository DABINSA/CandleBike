// 주가 시계열 → 게임 지형(네온 라인) 변환.
// - 일봉을 주간으로 다운샘플해 '차트 다리(leg)'처럼 읽히게 함
// - 각 점을 월드 좌표(px)로 매핑
// - 인접한 점을 잇는 얇은 회전 사각형 = 충돌 지형(라인 위를 달림)
// - 관절(꼭짓점)에 작은 원을 넣어 바퀴가 걸리지 않게 함
// - 일정 간격마다 등락% / 가격 라벨 메타데이터 생성

import Matter from 'https://esm.sh/matter-js@0.20.0';
import { findEvents } from '../events.js';

const SEG_SPACING = 98;     // 점 사이 가로 간격(px) — 넓힐수록 완만
const AMPLITUDE = 820;      // 세로 진폭(px) — 낮출수록 완만
const MAX_SLOPE = 0.9;      // 세로/가로 기울기 상한 (≈ 42°) — 낮출수록 쉬움
const GROUND_THICK = 18;
const LABEL_EVERY = 7;      // 약 7주마다 라벨 1개

function downsample(series, step = 5) {
  const out = [];
  for (let i = 0; i < series.length; i += step) out.push(series[i]);
  if (out[out.length - 1] !== series[series.length - 1]) out.push(series[series.length - 1]);
  return out;
}

export function buildTerrain(world, series) {
  const data = downsample(series, 5); // 주간
  const closes = data.map((d) => d.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = Math.max(1e-6, max - min);

  // 점 좌표 계산 (y는 화면 좌표계: 위가 작음 → 가격 높을수록 위로)
  const points = [];
  let x = 200;
  let prevY = null;
  for (let i = 0; i < data.length; i++) {
    const norm = (data[i].close - min) / range;       // 0..1
    let y = AMPLITUDE * (1 - norm);                    // 0(고가) .. AMPLITUDE(저가)
    if (prevY !== null) {
      const maxDy = SEG_SPACING * MAX_SLOPE;
      y = Math.max(prevY - maxDy, Math.min(prevY + maxDy, y)); // 기울기 클램프
    }
    points.push({
      x, y,
      close: data[i].close,
      date: data[i].date,
      pct: i === 0 ? 0 : ((data[i].close - data[i - 1].close) / data[i - 1].close) * 100,
    });
    prevY = y;
    x += SEG_SPACING;
  }

  // 시작 평지(활주로) — 첫 데이터가 봉우리/골이어도 바퀴가 끼지 않도록
  const RUN_N = 5;
  const baseX = points[0].x, flatY = points[0].y;
  const f = points[0];
  for (let i = 1; i <= RUN_N; i++) {
    points.unshift({ x: baseX - i * SEG_SPACING, y: flatY, close: f.close, date: f.date, pct: 0 });
  }

  // 충돌 지형: 세그먼트(회전 사각형) + 꼭짓점 원
  const bodies = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) + 2;
    const angle = Math.atan2(dy, dx);
    const seg = Matter.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len, GROUND_THICK, {
      isStatic: true, angle, friction: 1, label: 'ground',
      render: { visible: false },
    });
    bodies.push(seg);
    const joint = Matter.Bodies.circle(a.x, a.y, GROUND_THICK / 2, {
      isStatic: true, friction: 1, label: 'ground', render: { visible: false },
    });
    bodies.push(joint);
  }
  Matter.Composite.add(world, bodies);

  // 라벨 (스파스)
  const labels = [];
  for (let i = LABEL_EVERY; i < points.length; i += LABEL_EVERY) {
    const start = points[i - LABEL_EVERY];
    const p = points[i];
    const legPct = ((p.close - start.close) / start.close) * 100;
    labels.push({ x: p.x, y: p.y, pct: legPct, price: p.close });
  }

  const startPoint = points[0];
  const worldWidth = points[points.length - 1].x;
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const events = findEvents(points);

  return { points, bodies, labels, events, startPoint, worldWidth, minY, maxY, minClose: min, maxClose: max };
}
