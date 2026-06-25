// og.svg → assets/og.png (1200×630) 재생성. og.svg 수정 후 실행:
//   node scripts/cap/render-og.mjs
// 로컬 Chrome + puppeteer 로 렌더(한글/이모지 폰트 정상). sharp 보다 텍스트 렌더 안정적.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = 'd:/Project/Stock Game';
const svg = readFileSync(`${ROOT}/assets/og.svg`, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0}html,body{width:1200px;height:630px;overflow:hidden;background:#070a10}svg{display:block}</style>
</head><body>${svg}</body></html>`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
try { await page.evaluate(() => document.fonts.ready); } catch {}
const el = await page.$('svg');
await el.screenshot({ path: `${ROOT}/assets/og.png` });
await browser.close();
console.log('saved assets/og.png');
