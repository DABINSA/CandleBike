// 라이브 사이트를 실제 Chrome으로 띄워 앱인토스 심사용 스크린샷 캡처.
// 토스 모드(__APPS_IN_TOSS__=true) 주입 → 광고 off 화면으로 캡처(실제 토스 앱과 일치).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE = 'https://candlebike.vercel.app/';
const OUT = 'd:/Project/Stock Game/assets/toss/shots';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function activeScreen(page, id, timeout = 30000) {
  await page.waitForFunction(
    (sid) => document.querySelector(sid)?.classList.contains('active'),
    { timeout }, id
  );
}

async function startCourse(page) {
  // 종목 검색 → 첫 결과 선택 → 시작 → 코스 로드 대기
  await page.waitForSelector('#symbol-input', { visible: true });
  await page.click('#symbol-input');
  await page.type('#symbol-input', 'AAPL', { delay: 90 });
  await page.waitForSelector('#search-results li', { visible: true, timeout: 15000 });
  await page.click('#search-results li');
  await page.waitForFunction(() => {
    const b = document.querySelector('#btn-start');
    return b && !b.disabled;
  }, { timeout: 8000 });
  await page.click('#btn-start');
  await activeScreen(page, '#screen-play', 30000);
  await sleep(4000); // 코스/바이크 렌더 + 잠깐 주행
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--hide-scrollbars', '--disable-features=Translate', '--no-sandbox'],
});

// 모든 alert/confirm 자동 수락(데모 안내 등으로 멈추지 않게)
async function newTossPage(width, height) {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.evaluateOnNewDocument(() => { window.__APPS_IN_TOSS__ = true; });
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  return page;
}

try {
  // ---------- 세로형 636 x 1048 ----------
  const p = await newTossPage(636, 1048);
  await p.goto(SITE, { waitUntil: 'networkidle2', timeout: 60000 });
  await activeScreen(p, '#screen-home').catch(() => {});
  await sleep(2800); // 추천 종목 로드
  await p.screenshot({ path: `${OUT}/p1-home.png` });
  log('saved p1-home');

  // 리더보드(전역 순위)
  try {
    await p.click('#btn-leaderboard-home');
    await activeScreen(p, '#screen-result', 10000);
    await sleep(1500);
    await p.screenshot({ path: `${OUT}/p3-leaderboard.png` });
    log('saved p3-leaderboard');
    // 홈 복귀
    await p.click('#btn-home').catch(() => {});
    await sleep(800);
  } catch (e) { log('leaderboard skip:', e.message); }

  // 플레이(코스 위 주행)
  try {
    await activeScreen(p, '#screen-home', 5000).catch(() => {});
    await startCourse(p);
    await p.screenshot({ path: `${OUT}/p2-play.png` });
    log('saved p2-play');
  } catch (e) { log('play(portrait) skip:', e.message); }
  await p.close();

  // ---------- 가로형 1504 x 741 ----------
  const l = await newTossPage(1504, 741);
  await l.goto(SITE, { waitUntil: 'networkidle2', timeout: 60000 });
  await activeScreen(l, '#screen-home').catch(() => {});
  await sleep(1500);
  try {
    await startCourse(l);
    await l.screenshot({ path: `${OUT}/L1-play.png` });
    log('saved L1-play');
  } catch (e) {
    log('play(landscape) skip:', e.message);
    await l.screenshot({ path: `${OUT}/L1-home.png` }); // 폴백: 가로 홈
    log('saved L1-home (fallback)');
  }
  await l.close();
} finally {
  await browser.close();
}
log('DONE');
