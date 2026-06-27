// 점수 등록 (서버 검증 + 레이트리밋) — 클라 anon 직접 insert 금지, 이 라우트만 사용.
// POST /api/score  { nick, symbol, score }  → { rank, total, percentile, id }
//
// 검증은 JS 에서, 등록+레이트리밋+순위계산은 DB 함수(submit_score) 한 번 왕복으로 처리(지연 단축).
// 주의: 완전한 안티치트(리플레이/서버 시뮬)는 범위 밖 — 캐주얼 게임 기준 위조·스팸·비용폭탄 차단 수준.
import { sb, supaReady, clientIp } from './_supa.js';
import { tgNotify, tgEscape } from './_telegram.js';

// score = 완주 시간(ms). 작을수록 빠름(상위). 비현실적 값 차단.
const SCORE_MIN = 3_000;           // 3초 미만 완주는 불가능 → 위조 차단
const SCORE_MAX = 1_000_000;       // 1000초 상한
const NICK_MAX = 20;
const SYMBOL_RE = /^[A-Z0-9.\-]{1,15}$/;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!supaReady()) { res.status(503).json({ error: 'not configured' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  // ---- 서버 검증 (프론트 검증은 우회되므로 여기서 재검증) ----
  let nick = typeof b.nick === 'string' ? b.nick.trim().replace(/[ -]/g, '') : '';
  if (!nick) nick = '익명';
  if (nick.length > NICK_MAX) nick = nick.slice(0, NICK_MAX);

  const symbol = typeof b.symbol === 'string' ? b.symbol.trim().toUpperCase() : '';
  if (!SYMBOL_RE.test(symbol)) { res.status(400).json({ error: 'bad symbol' }); return; }

  const score = Number(b.score);
  if (!Number.isFinite(score) || !Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) {
    res.status(400).json({ error: 'bad score' }); return;
  }

  try {
    // DB 함수 한 번 호출 = 레이트리밋 + insert + 순위계산
    const r = await sb('rpc/submit_score', {
      method: 'POST',
      body: { p_nick: nick, p_symbol: symbol, p_score: score, p_ip: clientIp(req) },
    });
    if (!r.ok) { res.status(502).json({ error: 'rpc failed' }); return; }
    const out = await r.json();
    if (out && out.error === 'rate') {
      res.setHeader('Retry-After', String(out.retryAfter || 60));
      res.status(429).json({ error: 'rate limited' });
      return;
    }
    // 완주 핑 — 응답 '전'에 전송(서버리스는 응답 후 작업이 잘릴 수 있어 보장). 누구든 1판 완주 시.
    // tgNotify 는 내부 4초 타임아웃 + 실패 무시라, 알림 때문에 점수 응답이 막히지 않음.
    const sec = (score / 1000).toFixed(1);
    const rankTxt = (out && out.rank)
      ? `전체 ${out.rank}위${out.percentile != null ? ` (상위 ${out.percentile}%)` : ''}`
      : '-';
    await tgNotify(`🏁 <b>캔들라이더 완주!</b>\n\n· 닉: ${tgEscape(nick)}\n· 종목: ${tgEscape(symbol)}\n· 기록: ${sec}초\n· 순위: ${rankTxt}`);
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
