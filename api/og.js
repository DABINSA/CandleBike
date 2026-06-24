// 결과별 공유 미리보기 이미지 (1200×630 PNG) — 카카오/메신저 OG 카드에 박힌다.
// /api/s 가 og:image 로 이 URL 을 가리킨다.
//
// 한글 렌더: Satori 기본 폰트엔 한글이 없으므로, '렌더할 글자만' Google Fonts 에서
// 서브셋 TTF 로 받아와(파일 커밋 없이 수 KB) 폰트로 넘긴다. 폰트 로드 실패 시엔
// 라틴/숫자만 남기는 영문 폴백으로 안전하게 그린다.
//
// JSX/빌드가 없는 프로젝트라 ImageResponse 에 '리액트 엘리먼트 모양'의 순수 객체를 넘긴다.

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const el = (type, props) => ({ type, props });
const ascii = (s) => String(s || '').replace(/[^\x20-\x7E]/g, '').trim();

// 렌더할 텍스트에 필요한 글자만 골라 Google Fonts 서브셋(TTF)을 받아온다.
// Windows 7 UA → css2 가 woff2 대신 truetype URL 을 준다(Satori 는 woff2 미지원).
async function loadKoreanFont(text) {
  const chars = Array.from(new Set((text + 'candlebike.vercel.app 0123456789.,%·').split(''))).join('');
  const api =
    `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(chars)}`;
  const css = await (await fetch(api, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36' },
  })).text();
  const m = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:opentype|truetype)'\)/);
  if (!m) throw new Error('no ttf url in css');
  return await (await fetch(m[1])).arrayBuffer();
}

export default async function handler(req) {
  const u = new URL(req.url);
  const { searchParams } = u;
  const host = u.host || 'candlebike.vercel.app';   // 이미지 하단 도메인 — 요청 호스트 따라감
  const c = (searchParams.get('c') || 'STOCK').slice(0, 15);
  const r = String(searchParams.get('r') || '').slice(0, 16) || '—';       // "35.9초" · "1,128m"
  const n = String(searchParams.get('n') || '').slice(0, 40);              // 종목명(한글 가능)
  const rl = String(searchParams.get('rl') || '').slice(0, 40);           // "전체 1위 · 상위 100%" / 미완주 안내
  const challenge = '이 기록, 깰 수 있어?';

  // 한글 폰트 로드 시도 → 실패하면 라틴만 남겨 안전하게 렌더
  let fontData = null;
  try {
    fontData = await loadKoreanFont([c, r, n, rl, challenge].join(' '));
  } catch {
    fontData = null;
  }
  const ko = !!fontData;
  const sym = c;
  const name = ko ? n : ascii(n);
  const rec = ko ? r : (ascii(r.replace(/초/g, 's')) || '—');
  const rankLine = ko ? rl : ascii(rl);
  const chText = ko ? challenge : 'CAN YOU BEAT THIS?';

  // 네온 차트 라인 (SVG 데이터 URI)
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const x = (i / 14) * 1200;
    const y = 120 + Math.sin(i * 0.8) * 56 + (i % 4) * 12;
    pts.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="260">` +
    `<polyline points="${pts.join(' ')}" fill="none" stroke="#2ce6c4" stroke-width="6" ` +
    `stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const chart = `data:image/svg+xml;base64,${btoa(svg)}`;

  const txt = (children, style) => el('div', { style: { display: 'flex', ...style }, children });

  const children = [
    el('img', { src: chart, width: 1200, height: 260, style: { position: 'absolute', left: 0, top: 372, opacity: 0.32 } }),
    txt(sym, { fontSize: 56, fontWeight: 700, color: '#2ce6c4', marginTop: 4 }),
  ];
  if (name) children.push(txt(name, { fontSize: 36, fontWeight: 700, color: '#9fb0bd', marginTop: 8 }));
  children.push(txt(rec, { fontSize: 150, fontWeight: 700, color: '#ffffff', lineHeight: 1.05, marginTop: 10 }));
  if (rankLine) children.push(txt(rankLine, { fontSize: 44, fontWeight: 700, color: '#ffd34d', marginTop: 10 }));
  children.push(
    txt(chText, {
      fontSize: 40, fontWeight: 700, color: '#ff8da0', marginTop: 22,
      padding: '12px 36px', borderRadius: 44,
      background: 'rgba(255,77,109,0.16)', border: '2px solid rgba(255,77,109,0.6)',
    }),
  );
  children.push(txt(host, { position: 'absolute', bottom: 38, fontSize: 32, fontWeight: 700, color: '#cfe9e2' }));

  return new ImageResponse(
    el('div', {
      style: {
        width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-start',
        background: 'linear-gradient(180deg,#0e1828,#070a10)', color: '#e6f0f0',
        fontFamily: ko ? 'NotoKR' : 'sans-serif', position: 'relative', padding: '52px',
      },
      children,
    }),
    {
      width: 1200,
      height: 630,
      fonts: ko ? [{ name: 'NotoKR', data: fontData, weight: 700, style: 'normal' }] : undefined,
      headers: { 'cache-control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800' },
    },
  );
}
