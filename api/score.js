// 점수 등록 (서버 검증 + 레이트리밋) — 클라 anon 직접 insert 금지, 이 라우트만 사용.
// POST /api/score  { nick, symbol, score }  → { rank, total, percentile, id }
//
// 검증은 JS 에서, 등록+레이트리밋+순위계산은 DB 함수(submit_score) 한 번 왕복으로 처리(지연 단축).
// 주의: 완전한 안티치트(리플레이/서버 시뮬)는 범위 밖 — 캐주얼 게임 기준 위조·스팸·비용폭탄 차단 수준.
import { sb, supaReady, clientIp } from './_supa.js';
import { tgNotify, tgEscape } from './_telegram.js';
import { checkNick, randomNick } from './_moderation.js';

// score = 완주 시간(ms). 작을수록 빠름(상위). 비현실적 값 차단.
const SCORE_MIN = 3_000;           // 3초 미만 완주는 불가능 → 위조 차단
const SCORE_MAX = 1_000_000;       // 1000초 상한
const NICK_MAX = 6;   // 닉 최대 6자(순위표 줄바꿈 방지)
const SYMBOL_RE = /^[A-Z0-9.\-]{1,15}$/;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!supaReady()) { res.status(503).json({ error: 'not configured' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  // ---- 서버 검증 (프론트 검증은 우회되므로 여기서 재검증) ----
  // 한글·영문·숫자만 허용(특수문자·이모지 제거 — 표시/저장 에러 방지)
  let nick = typeof b.nick === 'string' ? b.nick.replace(/[^0-9A-Za-z가-힣ㄱ-ㆎ]/g, '') : '';
  if (!nick) nick = randomNick();   // 빈 닉이면 '익명' 대신 랜덤 더미닉
  if (nick.length > NICK_MAX) nick = nick.slice(0, NICK_MAX);
  // 금지어/차단닉이면 랜덤 더미닉으로 대체(클라 우회 백스톱) — 순위판 오염 방지
  try { if (!(await checkNick(nick)).ok) nick = randomNick(); } catch {}

  const symbol = typeof b.symbol === 'string' ? b.symbol.trim().toUpperCase() : '';
  if (!SYMBOL_RE.test(symbol)) { res.status(400).json({ error: 'bad symbol' }); return; }

  // 종목명 — 텔레그램 완주 핑 표시용(선택, DB 미저장). 길이 제한 + 트림.
  const name = (typeof b.name === 'string' ? b.name.trim() : '').slice(0, 40);

  const score = Number(b.score);
  if (!Number.isFinite(score) || !Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) {
    res.status(400).json({ error: 'bad score' }); return;
  }

  // 사용 장비 — 탈것 id(예: lion) + 그 판에 발동한 소모품 id(콤마구분, 예: boost,dbljump).
  // 순위표(탈것)·어드민(탈것+소모품) 표시용. 형식만 가볍게 정리(영소문자/콤마).
  const vehicle = (typeof b.vehicle === 'string' ? b.vehicle : '').replace(/[^a-z]/gi, '').slice(0, 16);
  const itemsArr = Array.isArray(b.items) ? b.items : String(b.items || '').split(',');
  const items = itemsArr.map((s) => String(s).replace(/[^a-z]/gi, '')).filter(Boolean).slice(0, 8).join(',');

  try {
    // DB 함수 한 번 호출 = 레이트리밋 + insert + 순위계산
    const r = await sb('rpc/submit_score', {
      method: 'POST',
      // p_name: 종목명(텔레그램용), p_vehicle/p_items: 사용 장비(순위표·어드민 표시).
      body: { p_nick: nick, p_symbol: symbol, p_score: score, p_ip: clientIp(req), p_name: name, p_vehicle: vehicle, p_items: items },
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
    const symTxt = name ? `${tgEscape(name)} (${tgEscape(symbol)})` : tgEscape(symbol);
    await tgNotify(`🏁 <b>캔들라이더 완주!</b>\n\n· 닉: ${tgEscape(nick)}\n· 종목: ${symTxt}\n· 기록: ${sec}초\n· 순위: ${rankTxt}`);
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
