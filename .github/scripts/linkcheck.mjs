// 라이브 main.js 의 모듈 import 가 실제 export 와 맞는지 점검(링크 에러 탐지).
// HTTP 200 이어도 named import 가 누락이면 브라우저에서 모듈 링크 에러로 main.js 가 통째로
// 안 돌아 앱이 죽는다 — HTTP 핑만으론 못 잡는 사각지대를 메운다.
//   사용: node linkcheck.mjs https://candlebike.vercel.app
//   출력: "LINKOK" | "LINKBROKEN <details>" | "CHECKERR <msg>"
const APP = process.argv[2];
const base = APP.replace(/\/+$/, '') + '/src/';

async function get(u) {
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.text();
}
function exportsOf(src) {
  const s = new Set();
  let m;
  let re = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g; while ((m = re.exec(src))) s.add(m[1]);
  re = /export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/g;    while ((m = re.exec(src))) s.add(m[1]);
  re = /export\s*\{([^}]+)\}/g;
  while ((m = re.exec(src))) m[1].split(',').forEach((x) => { const n = x.trim().split(/\s+as\s+/).pop().trim(); if (n) s.add(n); });
  if (/export\s+default/.test(src)) s.add('default');
  return s;
}
(async () => {
  let main;
  try { main = await get(base + 'main.js'); } catch (e) { console.log('CHECKERR main.js ' + e.message); return; }
  const reN = /import\s+(?:[A-Za-z0-9_$]+\s*,\s*)?\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/g;
  const problems = [];
  let m;
  while ((m = reN.exec(main))) {
    const names = m[1], rel = m[2];
    const p = rel.endsWith('.js') ? rel : rel + '.js';
    let url;
    try { url = new URL(p, base + 'main.js').href; } catch { continue; }
    let mod;
    try { mod = await get(url); } catch (e) { problems.push(`${rel}(${e.message})`); continue; }
    const ex = exportsOf(mod);
    names.split(',').forEach((x) => {
      const n = x.trim().split(/\s+as\s+/)[0].trim();
      if (n && !ex.has(n)) problems.push(`${rel}→${n}`);
    });
  }
  console.log(problems.length ? 'LINKBROKEN ' + problems.slice(0, 6).join(', ') : 'LINKOK');
})().catch((e) => console.log('CHECKERR ' + e.message));
