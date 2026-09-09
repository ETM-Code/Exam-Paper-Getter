// Debug variant: persists cookies, dumps the results frame, waits for real downloads.
const puppeteer = require('puppeteer-extra');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const SCR = process.env.SCR;
const COOKIES = path.join(SCR, 'regexam-cookies.json');
const CODE = process.env.CODE || 'EE450';
const NAME = process.env.NAME || 'Power Systems';
const folderPath = path.join(__dirname, NAME);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await fs.mkdir(folderPath, { recursive: true });
  let browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  let page = await browser.newPage();
  const haveCookies = fsSync.existsSync(COOKIES);
  if (haveCookies) {
    const cookies = JSON.parse(fsSync.readFileSync(COOKIES, 'utf8'));
    await page.setCookie(...cookies);
    console.log('Loaded saved cookies');
  }
  await page.goto('https://regexam.nuigalway.ie/regexam/paper_index_search_main_menu.asp#');
  if (!haveCookies) {
    console.log('>>> LOG IN NOW in the Chrome window. Waiting up to 150 s for the search frame.');
  }
  let searchFrame = null;
  for (let i = 0; i < 60; i++) {
    searchFrame = page.frames().find(f => f.name() === 'search_pane');
    if (searchFrame) { try { await searchFrame.waitForSelector('input[name="module"]', { timeout: 2000 }); break; } catch {} }
    await sleep(2500);
  }
  if (!searchFrame) throw new Error('Search frame not found');
  const cookies = await page.cookies();
  fsSync.writeFileSync(COOKIES, JSON.stringify(cookies));
  console.log('Cookies saved');

  await searchFrame.type('input[name="module"]', CODE);
  await searchFrame.click('input[type="submit"][value="Search"]');
  await sleep(4000);
  const resultsFrame = page.frames().find(f => f.name() === 'results_pane');
  if (!resultsFrame) throw new Error('Results frame not found');
  const html = await resultsFrame.content();
  fsSync.writeFileSync(path.join(SCR, 'results.html'), html);
  const links = await resultsFrame.$$eval('a', as => as.map(a => ({ href: a.href, text: a.textContent.trim() })));
  console.log('LINKS', JSON.stringify(links, null, 1));
  const dl = links.filter(l => l.href.includes('paper_index_download'));
  console.log(`Download links: ${dl.length}`);

  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(folderPath) });
  for (const l of dl) {
    const before = new Set(fsSync.readdirSync(folderPath));
    console.log('Downloading', l.href);
    const p = await browser.newPage();
    const c = await p.target().createCDPSession();
    await c.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(folderPath) });
    p.goto(l.href).catch(() => {});
    let got = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const now = fsSync.readdirSync(folderPath).filter(f => !before.has(f) && !f.endsWith('.crdownload'));
      if (now.length) { got = now; break; }
    }
    console.log(got ? `  -> ${got.join(', ')}` : '  -> NO FILE');
    await p.close();
  }
  await browser.close();
  console.log('DEBUG DONE');
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
