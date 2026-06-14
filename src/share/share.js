// 공유 — 결과 카드를 캔버스로 그려 이미지 생성 후 웹 공유(인스타 등) / 저장.
//
// 인스타그램은 웹에서 "이미지+캡션 자동 포스팅" API를 일반 공개하지 않으므로,
// 모바일에서는 navigator.share(파일 첨부)로 인스타 스토리/포스트 공유 시트를 띄우고,
// 데스크톱에서는 이미지 다운로드 + 캡션 복사로 처리한다. (가장 현실적인 방식)

import { t } from '../i18n.js';

const W = 1080, H = 1350;

export function drawResultCard({ symbol, name, distance, rank, percentile }) {
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
  ctx.fillText(`${distance.toLocaleString()}m`, W / 2, 450);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#ffd34d';
  ctx.font = '700 52px sans-serif';
  ctx.fillText(t.cardRank(rank, percentile), W / 2, 540);

  ctx.fillStyle = '#6b7d8a';
  ctx.font = '700 40px sans-serif';
  ctx.fillText(t.cardBrand, W / 2, H - 90);

  return cv;
}

function canvasToBlob(cv) {
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

export async function shareResult(result) {
  const cv = drawResultCard(result);
  const blob = await canvasToBlob(cv);
  const file = new File([blob], 'candlebike.png', { type: 'image/png' });
  const caption = t.shareCaption(result.symbol, result.distance, result.rank);

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption, title: 'CandleBike' });
      return 'shared';
    } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }

  // 폴백: 다운로드 + 캡션 클립보드 복사
  saveCard(result);
  try { await navigator.clipboard.writeText(caption); } catch {}
  return 'downloaded';
}

export async function saveCard(result) {
  const cv = drawResultCard(result);
  const blob = await canvasToBlob(cv);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `candlebike_${result.symbol}_${result.distance}m.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
