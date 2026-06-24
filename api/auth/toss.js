// 토스 인앱 '라이트' 로그인 — 셸 appLogin()이 준 인가코드를 서버가 mTLS로 교환해
// 안정적 사용자 식별자(user_key)만 얻는다(이름/휴대폰 등 PII 복호화·세션 없음).
// 그 user_key 에 묶인 '계정 기본 닉네임'을 돌려주고(있으면), 닉 저장용 서명 토큰을 발급한다.
//
// 🔴 토스 로그인 REST(경로/필드)는 공개문서에 명세가 없어, 샌드박스에서 실값을 확인해야 한다.
//    → 엔드포인트/필드명을 env로 덮어쓸 수 있게 했고, TOSS_DEBUG=1 이면 원응답을 로깅한다.
//    (플레이북 방식: verifyTossIapOrder 처럼 실측으로 경로·필드 확정 후 로그 제거)
//
// 필요한 Vercel 환경변수:
//   TOSS_LOGIN_MTLS_CERT / TOSS_LOGIN_MTLS_KEY   (콘솔 발급 PEM — BEGIN/END 헤더 포함 전체)
//   TOSS_NICK_SECRET                              (닉 저장 토큰 서명용 임의 시크릿)
//   (선택) TOSS_TOKEN_URL / TOSS_ME_URL / TOSS_ME_METHOD / TOSS_USERKEY_FIELD  — 샌드박스 확인 후 교정
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY      (닉 조회/저장)
// 미설정 시 503 (fail-closed — 웹 영향 0).

import https from 'node:https';
import crypto from 'node:crypto';
import { sb, supaReady } from '../_supa.js';

// PEM 정규화: env에 \n 이스케이프/ BOM 섞여도 복원 (플레이북 PEM·BOM 함정 회피)
function pem(v) {
  return String(v || '').replace(/^﻿/, '').replace(/\\n/g, '\n').trim();
}
const CERT = pem(process.env.TOSS_LOGIN_MTLS_CERT);
const KEY = pem(process.env.TOSS_LOGIN_MTLS_KEY);
const NICK_SECRET = process.env.TOSS_NICK_SECRET || '';

const API_BASE = 'https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss';
// 🔴 기본값은 추정 — 샌드박스 실측 후 env로 교정할 것.
const TOKEN_URL = process.env.TOSS_TOKEN_URL || `${API_BASE}/oauth2/login/generate-token`;
const ME_URL = process.env.TOSS_ME_URL || `${API_BASE}/oauth2/login/login-me`;
const ME_METHOD = (process.env.TOSS_ME_METHOD || 'POST').toUpperCase();
const DEBUG = process.env.TOSS_DEBUG === '1';

function ready() {
  return !!(CERT && KEY && NICK_SECRET);
}

// node:https 로 mTLS 요청 (네이티브 fetch는 클라이언트 인증서 미지원)
function mtls(url, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body != null ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        cert: CERT,
        key: KEY,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* keep raw */ }
          resolve({ status: res.statusCode || 0, json, raw: data });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// { resultType, success: {...} } 래핑이면 success 를 꺼낸다.
function unwrap(json) {
  if (json && typeof json === 'object' && 'success' in json) return json.success;
  return json;
}

// 응답에서 user_key 추정 — 실측 확정 전까지 흔한 후보들을 순서대로 시도.
function pickUserKey(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const field = process.env.TOSS_USERKEY_FIELD;
  if (field && obj[field]) return String(obj[field]);
  for (const k of ['userKey', 'user_key', 'userId', 'user_id', 'sub', 'ci', 'id']) {
    if (obj[k]) return String(obj[k]);
  }
  return '';
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signToken(userKey) {
  const sig = crypto.createHmac('sha256', NICK_SECRET).update(userKey).digest('base64url');
  return `${b64u(userKey)}.${sig}`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!ready()) { res.status(503).json({ error: 'not configured' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const authorizationCode = String(b.authorizationCode || '').trim();
  if (!authorizationCode) { res.status(400).json({ error: 'no authorizationCode' }); return; }

  try {
    // 1) 인가코드 → 액세스 토큰
    const tok = await mtls(TOKEN_URL, { method: 'POST', body: { authorizationCode } });
    if (DEBUG) console.log('[toss/login] token', tok.status, tok.raw?.slice(0, 500));
    const tokData = unwrap(tok.json) || {};
    const accessToken = tokData.accessToken || tokData.access_token || '';
    if (!accessToken) { res.status(502).json({ error: 'no accessToken', status: tok.status }); return; }

    // 2) 액세스 토큰 → 사용자 식별자(user_key)  (PII 복호화는 하지 않음)
    const me = await mtls(ME_URL, {
      method: ME_METHOD,
      headers: { Authorization: `Bearer ${accessToken}` },
      body: ME_METHOD === 'POST' ? {} : undefined,
    });
    if (DEBUG) console.log('[toss/login] me', me.status, me.raw?.slice(0, 800));
    const meData = unwrap(me.json) || {};
    const userKey = pickUserKey(meData);
    if (!userKey) { res.status(502).json({ error: 'no userKey', status: me.status }); return; }

    // 3) 계정 기본 닉네임 조회(있으면) + 닉 저장용 서명 토큰 발급
    let nick = '';
    if (supaReady()) {
      try {
        const r = await sb(`toss_users?user_key=eq.${encodeURIComponent(userKey)}&select=nick`);
        const rows = r.ok ? await r.json() : [];
        if (rows[0]?.nick) nick = rows[0].nick;
      } catch (e) { console.warn('[toss/login] nick lookup', e); }
    }

    res.status(200).json({ ok: true, token: signToken(userKey), nick });
  } catch (e) {
    console.error('[toss/login] error', e);
    res.status(502).json({ error: String(e?.message || e) });
  }
}
