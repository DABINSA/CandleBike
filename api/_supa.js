// 서버 전용 Supabase 헬퍼 (service_role) — 클라이언트에서 import 금지.
// PostgREST 에 직접 fetch (의존성 0). RLS 를 우회하므로 쓰기 정책 없이도 동작.
//
// 필요한 Vercel 환경변수:
//   SUPABASE_URL                = https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   = (Supabase Settings → API → service_role, 절대 NEXT_PUBLIC_ 금지)
//
// 레이트리밋용 테이블(app_kv)은 db/security.sql 참고.

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function supaReady() {
  return !!(SUPABASE_URL && SERVICE_KEY);
}

// PostgREST 호출. path 예: "scores?symbol=eq.AAPL&select=*"
export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return r;
}

// 신뢰 가능한 클라 IP — Vercel 이 세팅한 x-forwarded-for 의 최좌측만 사용.
// (클라가 임의로 보낸 XFF 를 그대로 믿으면 IP 스푸핑으로 레이트리밋 우회됨)
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// DB 고정윈도우 레이트리밋 (서버리스라 공유 메모리 없음 → app_kv 테이블).
// 레이스 약간 허용(지속 남용은 확실히 차단). service_role 이라 RLS 우회.
// 반환: { ok: boolean, retryAfter: 초 }
export async function rateLimit(name, ip, max, windowSec) {
  if (!supaReady()) return { ok: true, retryAfter: 0 }; // 미설정 시 통과(로컬/데모)
  const key = `rl:${name}:${ip}`;
  const now = Date.now();
  try {
    const r = await sb(`app_kv?k=eq.${encodeURIComponent(key)}&select=v`);
    const rows = r.ok ? await r.json() : [];
    let count = 0;
    let resetAt = now + windowSec * 1000;
    if (rows[0] && rows[0].v && typeof rows[0].v.resetAt === 'number') {
      if (rows[0].v.resetAt > now) {
        count = rows[0].v.count || 0;
        resetAt = rows[0].v.resetAt;
      }
    }
    if (count >= max) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
    }
    await sb('app_kv', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: { k: key, v: { count: count + 1, resetAt }, updated_at: new Date().toISOString() },
    });
    return { ok: true, retryAfter: 0 };
  } catch (e) {
    // 레이트리밋 인프라 장애가 정상 요청을 막지 않게 — 통과시키되 로깅
    console.warn('rateLimit error', e);
    return { ok: true, retryAfter: 0 };
  }
}
