// 공유 — 결과 카드를 캔버스로 그려 이미지 생성 후 웹 공유(인스타 등) / 저장.
//
// 인스타그램은 웹에서 "이미지+캡션 자동 포스팅" API를 일반 공개하지 않으므로,
// 모바일에서는 navigator.share(파일 첨부)로 인스타 스토리/포스트 공유 시트를 띄우고,
// 데스크톱에서는 이미지 다운로드 + 캡션 복사로 처리한다. (가장 현실적인 방식)

import { t, LANG } from '../i18n.js';

const W = 1080, H = 1350;
const SITE_HOST = (typeof location !== 'undefined' && location.host) ? location.host : 'candlerider.2nt4soft.com';
const SITE_URL = (typeof location !== 'undefined' && location.origin && location.origin.startsWith('http'))
  ? location.origin : 'https://candlerider.2nt4soft.com';

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawResultCard({ symbol, name, distance, completed, timeMs, rank, percentile }) {
  // 완주자: 완주 시간(예 42.3초) / 미완주: 거리(예 1,631m)
  const recordText = completed ? t.timeFmt(timeMs) : `${(distance || 0).toLocaleString()}m`;
  const cv = document.getElementById('card-canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // 배경
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0e1828'); g.addColorStop(1, '#070a10');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // 네온 차트 장식
  ctx.strokeStyle = 'rgba(44,230,196,0.5)';
  ctx.lineWidth = 6; ctx.shadowColor = 'rgba(44,230,196,0.8)'; ctx.shadowBlur = 24;
  ctx.beginPath();
  let y = H * 0.62;
  for (let x = 0; x <= W; x += W / 16) {
    y += (Math.sin(x * 0.013) * 38) + (Math.random() - 0.5) * 30;
    y = Math.max(H * 0.4, Math.min(H * 0.78, y));
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#2ce6c4';
  ctx.font = '800 64px sans-serif';
  ctx.fillText(symbol, W / 2, 220);
  if (name) {
    ctx.fillStyle = '#9fb0bd';
    ctx.font = '600 38px sans-serif';
    ctx.fillText(name, W / 2, 270);
  }

  ctx.fillStyle = '#e6f0f0';
  ctx.font = '900 180px sans-serif';
  ctx.shadowColor = 'rgba(44,230,196,0.5)'; ctx.shadowBlur = 40;
  ctx.fillText(recordText, W / 2, 450);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#ffd34d';
  ctx.font = '700 52px sans-serif';
  if (completed && rank != null) ctx.fillText(t.cardRank(rank, percentile), W / 2, 540);
  else if (!completed) ctx.fillText(t.notFinished, W / 2, 540);

  // ---- 도전장 후크: "이 기록 깰 수 있어?" ----
  ctx.font = '800 50px sans-serif';
  const chText = t.cardChallenge;
  const chW = ctx.measureText(chText).width + 90;
  const chY = 660;
  ctx.fillStyle = 'rgba(255,77,109,0.16)';
  roundRectPath(ctx, W / 2 - chW / 2, chY - 56, chW, 84, 42);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,77,109,0.65)'; ctx.lineWidth = 2.5;
  roundRectPath(ctx, W / 2 - chW / 2, chY - 56, chW, 84, 42); ctx.stroke();
  ctx.fillStyle = '#ff8da0';
  ctx.fillText(chText, W / 2, chY);

  return cv;
}

function canvasToBlob(cv) {
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

// 결과별 공유 URL — 이 링크를 공유하면 메신저가 OG 카드(미리보기 + 클릭→플레이)로 펼친다.
// (이미지 파일을 직접 첨부하면 카카오 등이 링크를 버리므로, '링크'를 공유하는 게 핵심.)
function buildShareUrl(result) {
  const rec = result.completed
    ? t.timeFmt(result.timeMs)
    : `${(result.distance || 0).toLocaleString()}m`;
  const p = new URLSearchParams({ c: result.symbol, r: rec, l: LANG });   // l: 카드/랜딩을 보는 언어로 렌더
  if (result.name) p.set('n', result.name);
  if (result.completed && result.rank != null) {
    p.set('rank', String(result.rank));
    p.set('rl', t.cardRank(result.rank, result.percentile));   // "전체 1위 · 상위 100%" / "Rank #1 · Top 100%"
  }
  // 미완주는 순위 줄 생략(이미지엔 거리 + 도전 배지만) — 깔끔하게.
  return `${SITE_URL}/api/s?${p.toString()}`;
}

export async function shareResult(result) {
  const shareUrl = buildShareUrl(result);
  const caption = result.completed
    ? t.shareCaptionTime(result.symbol, t.timeFmt(result.timeMs), result.rank, shareUrl)
    : t.shareCaption(result.symbol, (result.distance || 0).toLocaleString(), '–', shareUrl);

  // 링크를 클립보드에도 복사 — 공유 대상이 url을 무시해도 채팅에 붙여넣어 보낼 수 있다.
  let copied = false;
  try { await navigator.clipboard.writeText(shareUrl); copied = true; } catch {}

  // 링크(url) 공유 — 카카오/메신저가 OG 카드로 펼치고, 친구가 눌러 바로 그 종목에 도전.
  if (navigator.share) {
    try {
      await navigator.share({ title: 'CandleRider', text: caption, url: shareUrl });
      return copied ? 'shared-copied' : 'shared';
    } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }

  // 공유 API 없음(주로 데스크톱) → 링크 복사로 마무리(붙여넣어 초대 가능).
  return copied ? 'shared-copied' : 'failed';
}

export async function saveCard(result) {
  const cv = drawResultCard(result);
  const blob = await canvasToBlob(cv);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const tag = result.completed ? `${(result.timeMs / 1000).toFixed(1)}s` : `${result.distance}m`;
  a.href = url; a.download = `candlerider_${result.symbol}_${tag}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
