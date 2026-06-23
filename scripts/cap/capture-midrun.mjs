// 세로 플레이 스크린샷을 "주행 중반"(코스 ~30-45%)으로 캡처. 가속(ArrowRight) 유지.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE = 'https://candlebike.vercel.app/';
const OUT = 'd:/Project/Stock Game/assets/toss/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--disable-features=Translate'],
});

async function newTossPage() {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.evaluateOnNewDocument(() => { window.__APPS_IN_TOSS__ = true; });
  await page.setViewport({ width: 636, height: 1048, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  return page;
}

async function startCourse(page) {
  await page.waitForSelector('#symbol-input', { visible: true });
  await page.click('#symbol-input');
  await page.type('#symbol-input', 'AAPL', { delay: 90 });
  await page.waitForSelector('#search-results li', { visible: true, timeout: 15000 });
  await page.click('#search-results li');
  await page.waitForFunction(() => { const b = document.querySelector('#btn-start'); return b && !b.disabled; }, { timeout: 8000 });
  await page.click('#btn-start');
  await page.waitForFunction(() => document.querySelector('#screen-play')?.classList.contains('active'), { timeout: 30000 });
  await sleep(1200);
}

function readHud(page) {
  return page.evaluate(() => {
    const play = document.querySelector('#screen-play')?.classList.contains('active');
    const p = document.querySelector('#hud-progress')?.textContent || '';
    const d = document.querySelector('#hud-distance')?.textContent || '';
    const m = p.match(/(\d+)/);
    return { play, pct: m ? +m[1] : 0, d, p };
  });
}

let ok = false;
for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
  const page = await newTossPage();
  try {
    await page.goto(SITE, { waitUntil: 'networkidle2', timeout: 60000 });
    await startCourse(page);
    // 펄스 가속: 눌렀다 떼며 굴려 공중 백플립(넘어져 보임)을 줄이고 지면 주행 유지
    let last = { pct: 0, d: '', play: true };
    for (let i = 0; i < 40 && last.play && last.pct < 30; i++) {
      await page.keyboard.down('ArrowRight');
      await sleep(650);
      await page.keyboard.up('ArrowRight');
      await sleep(450);                  // 잠깐 떼어 바퀴 착지
      const h = await readHud(page);
      last = h;
    }
    // 목표 도달 → 가속 떼고 착지·주행한 프레임 캡처
    await page.keyboard.up('ArrowRight').catch(() => {});
    await sleep(900);
    const settled = await readHud(page);
    if (settled.play && settled.pct >= 18) {
      await page.screenshot({ path: `${OUT}/p2-play.png` });
      console.log(`saved p2-play  (attempt ${attempt}, 코스 ${settled.pct}%, 거리 ${settled.d})`);
      ok = true;
    } else {
      console.log(`attempt ${attempt} 실패 (play=${settled.play}, pct=${settled.pct}) → 재시도`);
    }
  } catch (e) {
    console.log(`attempt ${attempt} error: ${e.message}`);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(ok ? 'DONE' : 'FAILED');
