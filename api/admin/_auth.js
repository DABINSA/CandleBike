// 어드민 계정 인증 헬퍼 (라우트 아님 — '_' 접두사라 Vercel 이 엔드포인트로 노출 안 함).
// 이메일+비밀번호로 로그인 → HMAC 서명 세션 토큰 발급. 이후 요청은 토큰만 검증(비번 재전송 X).
//
// 필요한 Vercel 환경변수:
//   ADMIN_PASSWORD  = 관리자 비밀번호(필수). 미설정 시 어드민 전체 비활성(fail-closed).
//   ADMIN_EMAIL     = 관리자 이메일(선택, 기본 david@2nt4soft.com).
// 토큰 서명키로 ADMIN_PASSWORD 를 재사용 → 비번을 바꾸면 기존 세션 토큰은 자동 무효화.
import crypto from 'node:crypto';

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'david@2nt4soft.com').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TTL_SEC = 7 * 24 * 3600;   // 세션 토큰 유효기간 7일

export function adminConfigured() { return !!ADMIN_PASSWORD; }

// 길이 노출 없는 상수시간 비교(타이밍 공격 완화)
function eq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

export function checkCredentials(email, password) {
  if (!ADMIN_PASSWORD) return false;
  const e = String(email || '').trim().toLowerCase();
  return e === ADMIN_EMAIL && eq(password, ADMIN_PASSWORD);
}

const b64u = (s) => Buffer.from(s).toString('base64url');
function sign(data) { return crypto.createHmac('sha256', ADMIN_PASSWORD).update(data).digest('base64url'); }

export function issueToken() {
  const body = b64u(JSON.stringify({ e: ADMIN_EMAIL, exp: Math.floor(Date.now() / 1000) + TTL_SEC }));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!ADMIN_PASSWORD || !token) return false;
  const i = String(token).lastIndexOf('.');
  if (i < 0) return false;
  const body = String(token).slice(0, i);
  const sig = String(token).slice(i + 1);
  if (!eq(sig, sign(body))) return false;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || p.e !== ADMIN_EMAIL) return false;
    if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch { return false; }
}
