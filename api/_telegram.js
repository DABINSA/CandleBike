// 텔레그램 알림 공용 헬퍼 — 신규 유저(/api/hit)·완주(/api/score) 등에서 재사용.
// env 설정 시에만 동작(미설정/실패해도 호출부 로직엔 영향 0). 공개 레포라 토큰은 env로만.
//   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

export function tgConfigured() { return !!(TG_TOKEN && TG_CHAT); }

// HTML parse_mode 용 이스케이프(유저 입력 닉 등 안전 처리).
export function tgEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// 텔레그램 메시지 전송(HTML). best-effort — 실패/타임아웃해도 조용히 무시.
export async function tgNotify(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);   // 응답/핸들러 지연 방지
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
  } catch { /* 알림 실패는 조용히 무시 */ }
}

// 한국시간 문자열.
export function kstNow() {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}
