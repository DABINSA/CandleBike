import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\David\\AppData\\Local\\Temp\\claude\\d--Project-Stock-Game\\1fb0636e-f7cf-4ca4-bcb8-3248f3ca07ef\\scratchpad';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const p = await b.newPage();
p.on('dialog', (d) => d.accept().catch(() => {}));
await p.setViewport({ width: 636, height: 1048, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await p.goto('https://candlebike.vercel.app/?tune=1', { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
await p.click('#tp-test');
await p.waitForFunction(() => document.querySelector('#screen-play')?.classList.contains('active'), { timeout: 30000 });
await p.keyboard.down('ArrowUp');
await sleep(8000);                 // 8초 주행 — 일반 모드면 연료(60s 중 상당) 줄어듦, 테스트면 안 줆
await p.keyboard.up('ArrowUp');
const st = await p.evaluate(() => ({
  play: document.querySelector('#screen-play')?.classList.contains('active'),
  fuel: document.querySelector('#fuel-fill')?.style.width,
  dist: document.querySelector('#hud-distance')?.textContent,
  prog: document.querySelector('#hud-progress')?.textContent,
}));
await p.screenshot({ path: `${OUT}\\testmode.png` });
console.log(JSON.stringify(st));
await b.close();
