// 공유 랜딩 — 결과별 OG 카드(클릭 가능한 '초대 링크').
//
// 왜 필요한가: 카카오톡 등은 navigator.share 로 파일(이미지)을 첨부하면 본문 text/url 을
// 버려서 '사진만' 전송된다(링크 유실 → 친구가 눌러 참여 불가). 그래서 이미지를 붙이는 대신
// 이 URL 을 공유하면, 메신저가 아래 OG 태그를 읽어 '점수 카드 미리보기 + 제목 + 클릭→플레이'
// 카드로 펼친다. 사람이 클릭하면 JS 로 게임(/?c=종목)으로 보내고, 스크래퍼는 JS 미실행이라
// OG 메타만 읽어간다.
//
// 쿼리: c=종목코드  n=종목명  r=기록("562m"·"42.3초")  rank="3위"(완주 시)

const SITE = 'https://candlebike.vercel.app';
const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,15}$/;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async function handler(req, res) {
  const q = req.query || {};
  const c = SYMBOL_RE.test(q.c || '') ? q.c : '';
  const name = String(q.n || '').slice(0, 40);
  const rec = String(q.r || '').slice(0, 16); // "562m" 또는 "42.3초"
  const rank = String(q.rank || '').slice(0, 12);
  const rl = String(q.rl || '').slice(0, 40); // "전체 1위 · 상위 100%"

  const title = c
    ? `${name ? name + ' ' : ''}${c}${rec ? ' · ' + rec : ''} 🏍️`
    : '캔들바이크 — 변동성을 버텨라 🏍️📈';
  const desc = c
    ? `${rl ? rl + ' — ' : ''}이 기록 깰 수 있어? 캔들바이크에서 ${c} 차트를 오토바이로 달려봐! 👉 지금 도전`
    : '검색한 주식의 3년 차트가 코스! 변동성을 버티고 순위에 도전.';

  // OG 미리보기 이미지 — 결과별 동적 카드(/api/og). 종목 없으면 기본 og.png.
  const img = c
    ? `${SITE}/api/og?${new URLSearchParams({ c, n: name, r: rec, rl }).toString()}`
    : `${SITE}/assets/og.png`;
  const playUrl = c ? `${SITE}/?c=${encodeURIComponent(c)}` : SITE;
  const shareUrl = `${SITE}/api/s?${new URLSearchParams(q).toString()}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(`<!doctype html><html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="캔들바이크 · CandleBike">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:url" content="${esc(shareUrl)}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<script>location.replace(${JSON.stringify(playUrl)});</script>
</head><body style="background:#0a0e14;color:#cfe9e2;font-family:sans-serif;text-align:center;padding:48px 20px">
<p style="font-size:18px">캔들바이크로 이동 중…</p>
<p><a href="${esc(playUrl)}" style="color:#2ce6c4;font-weight:700">바로 가기 →</a></p>
</body></html>`);
}
