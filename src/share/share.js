// 공유 — 결과 카드를 캔버스로 그려 이미지 생성 후 웹 공유(인스타 등) / 저장.
//
// 인스타그램은 웹에서 "이미지+캡션 자동 포스팅" API를 일반 공개하지 않으므로,
// 모바일에서는 navigator.share(파일 첨부)로 인스타 스토리/포스트 공유 시트를 띄우고,
// 데스크톱에서는 이미지 다운로드 + 캡션 복사로 처리한다. (가장 현실적인 방식)

import { t } from '../i18n.js';

const W = 1080, H = 1350;
const SITE_HOST = (typeof location !== 'undefined' && location.host) ? location.host : 'candlebike.vercel.app';
const SITE_URL = (typeof location !== 'undefined' && location.origin && location.origin.startsWith('http'))
  ? location.origin : 'https://candlebike.vercel.app';

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

  // ---- CTA + 도메인 (같이 도전하러 오게) ----
  ctx.fillStyle = '#2ce6c4';
  ctx.font = '800 56px sans-serif';
  ctx.shadowColor = 'rgba(44,230,196,0.5)'; ctx.shadowBlur = 24;
  ctx.fillText(t.cardCta, W / 2, H - 156);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#cfe9e2';
  ctx.font = '800 46px sans-serif';
  ctx.fillText(SITE_HOST, W / 2, H - 92);

  return cv;
}

function canvasToBlob(cv) {
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

export async function shareResult(result) {
  const cv = drawResultCard(result);
  const blob = await canvasToBlob(cv);
  const file = new File([blob], 'candlebike.png', { type: 'image/png' });
  const caption = result.completed
    ? t.shareCaptionTime(result.symbol, t.timeFmt(result.timeMs), result.rank, SITE_URL)
    : t.shareCaption(result.symbol, (result.distance || 0).toLocaleString(), '–', SITE_URL);

  // 🔴 카카오톡 등은 이미지(파일) 첨부 시 본문 텍스트/URL을 버려서 '사진만' 공유된다.
  //    → 공유 직전에 링크(캡션)를 클립보드에 복사해 두면, 채팅에 붙여넣어 링크도 함께 보낼 수 있다.
  let copied = false;
  try { await navigator.clipboard.writeText(caption); copied = true; } catch {}

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      // url 필드도 함께 전달 — 링크를 인식하는 공유 대상에선 클릭 가능한 링크로 붙는다.
      await navigator.share({ files: [file], text: caption, url: SITE_URL, title: 'CandleBike' });
      return copied ? 'shared-copied' : 'shared';
    } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }

  // 파일 공유 불가(주로 데스크톱) → 링크만이라도 공유 시도, 안 되면 이미지 다운로드 + 캡션 복사
  if (navigator.share) {
    try {
      await navigator.share({ text: caption, url: SITE_URL, title: 'CandleBike' });
      return 'shared';
    } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  saveCard(result);
  return 'downloaded';
}

export async function saveCard(result) {
  const cv = drawResultCard(result);
  const blob = await canvasToBlob(cv);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const tag = result.completed ? `${(result.timeMs / 1000).toFixed(1)}s` : `${result.distance}m`;
  a.href = url; a.download = `candlebike_${result.symbol}_${tag}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
