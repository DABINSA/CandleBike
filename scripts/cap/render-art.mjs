// art.html(게임 바이크 복제)을 실제 Chrome 캔버스로 렌더 → 로고/썸네일 PNG.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ART = pathToFileURL('d:/Project/Stock Game/scripts/cap/art.html').href;
const OUT = 'd:/Project/Stock Game/assets/toss';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

async function render(mode, w, h, file){
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(`${ART}?mode=${mode}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__done === true, { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/${file}` });
  await page.close();
  console.log('saved', file);
}

await render('logo', 600, 600, 'logo-600.png');
await render('thumb', 1932, 828, 'thumb-1932x828.png');
await browser.close();
console.log('DONE');
