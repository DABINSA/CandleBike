// 전체 순위 화면만 재캡처 (p3-leaderboard). 다른 컷은 건드리지 않음.
import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE = 'https://candlebike.vercel.app/';
const OUT = 'd:/Project/Stock Game/assets/toss/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
page.on('dialog', (d) => d.accept().catch(() => {}));
await page.evaluateOnNewDocument(() => { window.__APPS_IN_TOSS__ = true; });
await page.setViewport({ width: 636, height: 1048, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto(SITE, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
await page.click('#btn-leaderboard-home');
await page.waitForFunction(() => document.querySelector('#screen-result')?.classList.contains('active'), { timeout: 10000 });
await page.waitForFunction(() => (document.querySelectorAll('#leaderboard-list li').length >= 6), { timeout: 8000 }).catch(() => {});
await sleep(800);
await page.screenshot({ path: `${OUT}/p3-leaderboard.png` });
console.log('saved p3-leaderboard');
await browser.close();
