// 결과별 공유 미리보기 이미지 (1200×630 PNG) — 카카오/메신저 OG 카드에 박힌다.
// /api/s 가 og:image 로 이 URL 을 가리킨다.
//
// 폰트: Satori 기본 폰트(Inter)는 한글이 깨지므로 이미지엔 라틴/숫자만 쓴다(점수·종목·브랜드).
//       한글 후크("이 기록 깰 수 있어?")는 /api/s 의 og:title/description 에 두어 메신저가
//       시스템 한글 폰트로 렌더하게 한다.
//
// JSX/빌드가 없는 프로젝트라 ImageResponse 에 '리액트 엘리먼트 모양'의 순수 객체를 넘긴다.

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const el = (type, props) => ({ type, props });
const ascii = (s) => String(s || '').replace(/[^\x20-\x7E]/g, '').trim();

export default function handler(req) {
  const { searchParams } = new URL(req.url);
  const c = ascii(searchParams.get('c')).slice(0, 15) || 'STOCK';
  // 기록: "1,128m" 또는 "42.3초" → 한글 단위만 라틴으로 치환
  let rec = String(searchParams.get('r') || '').replace(/초/g, 's').replace(/분/g, 'm');
  rec = ascii(rec).slice(0, 16) || '—';
  const name = ascii(searchParams.get('n')).slice(0, 40); // 한글 종목명은 비게 됨(의도)
  const rankNum = (String(searchParams.get('rank') || '').match(/\d+/) || [])[0];

  // 네온 차트 라인 (SVG 데이터 URI)
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const x = (i / 14) * 1200;
    const y = 160 + Math.sin(i * 0.8) * 70 + (i % 4) * 16;
    pts.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320">` +
    `<polyline points="${pts.join(' ')}" fill="none" stroke="#2ce6c4" stroke-width="6" ` +
    `stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const chart = `data:image/svg+xml;base64,${btoa(svg)}`;

  const txt = (children, style) => el('div', { style, children });

  return new ImageResponse(
    el('div', {
      style: {
        width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg,#0e1828,#070a10)', color: '#e6f0f0',
        fontFamily: 'sans-serif', position: 'relative', padding: '72px',
      },
      children: [
        el('img', { src: chart, width: 1200, height: 320, style: { position: 'absolute', left: 0, bottom: 64, opacity: 0.5 } }),
        txt('CANDLEBIKE', { fontSize: 34, fontWeight: 700, color: '#9fb0bd', letterSpacing: 5 }),
        txt(name ? `${c}  |  ${name}` : c, { fontSize: 58, fontWeight: 800, color: '#2ce6c4', marginTop: 26 }),
        txt(rec, { fontSize: 200, fontWeight: 800, color: '#ffffff', lineHeight: 1, marginTop: 6 }),
        txt(rankNum ? `RANK #${rankNum}` : 'CAN YOU BEAT THIS?', { fontSize: 46, fontWeight: 700, color: '#ffd34d', marginTop: 22 }),
        txt('candlebike.vercel.app', { position: 'absolute', bottom: 44, left: 72, fontSize: 34, fontWeight: 700, color: '#cfe9e2' }),
      ],
    }),
    {
      width: 1200,
      height: 630,
      headers: { 'cache-control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800' },
    }
  );
}
