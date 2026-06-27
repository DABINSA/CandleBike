// 한국 전 종목(코드+한글명) 로컬 즉시 검색 — 네트워크 없이 기기에서 바로 필터.
// 데이터: assets/symbols-kr.json (scripts/build-symbols.mjs 로 생성). 코드는 거의 안 바뀜.

let loadPromise = null;
let DATA = null;

// 최초 1회만 로드(결과 캐시). 검색 진입 전 미리 호출해 두면 첫 검색도 즉시.
export function loadSymbols() {
  if (loadPromise) return loadPromise;
  loadPromise = fetch('/assets/symbols-kr.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => { DATA = Array.isArray(list) ? list : []; return DATA; })
    .catch(() => { DATA = []; return DATA; });
  return loadPromise;
}

// 코드 → 한글명 즉시 조회(로드돼 있을 때만). 종목별 1위 표시 등에서 사용.
let NAME_MAP = null;
export function krNameOf(symbol) {
  if (!DATA) return null;
  if (!NAME_MAP || NAME_MAP.size !== DATA.length) {
    NAME_MAP = new Map();
    for (const it of DATA) NAME_MAP.set(it.s, it.n);
  }
  return NAME_MAP.get(symbol) || null;
}

// 한국 종목 즉시 검색 → [{ symbol, name }] (최대 limit개). 매칭 없으면 [].
export async function searchKr(q, limit = 8) {
  const list = DATA || (await loadSymbols());
  const s = (q || '').trim();
  if (!s) return [];
  const low = s.toLowerCase();
  const digits = s.replace(/[^0-9]/g, '');
  const isCode = /^\d{1,6}$/.test(digits) && digits.length >= 2;

  const scored = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const code = it.s.split('.')[0];
    const name = it.n;
    const nameLow = name.toLowerCase();
    let rank = -1;
    if (isCode && code.startsWith(digits)) rank = code === digits ? 0 : 1;
    else if (nameLow === low) rank = 0;          // 정확히 일치
    else if (nameLow.startsWith(low)) rank = 2;  // 접두 일치
    else if (nameLow.includes(low)) rank = 3;    // 부분 일치
    if (rank >= 0) scored.push({ symbol: it.s, name, _r: rank, _i: i });
  }
  // 랭크 → 시가총액 순(_i: 배열이 시총 내림차순) → 대표 종목이 위로
  scored.sort((a, b) => a._r - b._r || a._i - b._i);
  return scored.slice(0, limit).map(({ symbol, name }) => ({ symbol, name }));
}
