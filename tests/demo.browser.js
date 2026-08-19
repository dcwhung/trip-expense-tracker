/* The demo copy shares an origin with the real app, so the thing worth
   testing is that it stays out of the real app's way: its own storage
   keys, no service worker of its own, and real data still there after a
   demo has been shown. Run tools/make-demo.py first.

   Serve the repository root on 8099, then:
     NODE_PATH=$(npm root -g) node tests/demo.browser.js
*/
const { chromium, devices } = require('playwright');

const B = 'http://127.0.0.1:8099';
const OUT = process.env.SHOT_DIR || '/tmp';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const settingsTab = () => page.click('.tab[data-view="settings"]');

  console.log('\n── a real trip, entered in the real app ──');
  await page.goto(B + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#set-start', '2026-08-22');
  await page.fill('#set-end', '2026-08-28');
  await page.click('#save-settings');
  await page.waitForTimeout(200);
  await page.fill('#set-acct-0', 'RealDonald');
  await page.click('#save-settings');
  await page.waitForTimeout(250);
  const realBefore = await page.evaluate(() => {
    const out = {};
    Object.keys(localStorage).filter((k) => !k.startsWith('tripspend.demo.')).sort()
      .forEach((k) => { out[k] = localStorage.getItem(k); });
    return out;
  });
  ok('the real app stored its own trip', /RealDonald/.test(JSON.stringify(realBefore)));

  console.log('\n── the demo, on the same origin ──');
  await page.goto(B + '/demo/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  ok('a DEMO badge on the screen in view', await page.locator('#view-add .demo-pill').isVisible());
  ok('a DEMO badge on all five screens', (await page.locator('.demo-pill').count()) === 5);

  const realAfter = await page.evaluate(() => {
    const out = {};
    Object.keys(localStorage).filter((k) => !k.startsWith('tripspend.demo.')).sort()
      .forEach((k) => { out[k] = localStorage.getItem(k); });
    return out;
  });
  ok('not one real key added, changed or dropped',
    JSON.stringify(realAfter) === JSON.stringify(realBefore));

  const scopes = await page.evaluate(() =>
    navigator.serviceWorker.getRegistrations().then((rs) => rs.map((r) => r.scope)));
  ok('the demo registers no worker of its own (' + scopes.join(', ') + ')',
    scopes.every((s) => !/\/demo\//.test(s)));

  console.log('\n── the sample trip reads well ──');
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(300);
  const cards = (await page.locator('.budget-card').allInnerTexts()).join('\n');
  ok('one budget card per account', (await page.locator('.budget-card').count()) === 2);
  ok('Donald has €466.70 left', /€466\.70/.test(cards));
  ok('Kwan has €69.60 left', /€69\.60/.test(cards));
  ok('and Kwan reads as low', (await page.locator('.budget-card.is-low').count()) === 1);
  ok('the trip is three days in', /Day 3 of 7/.test(await page.locator('#sum-day').innerText()));
  await page.screenshot({ path: OUT + '/demo-records.png', fullPage: true });

  await page.click('.tab[data-view="stats"]');
  await page.waitForTimeout(300);
  ok('every category carries spend', (await page.locator('.bar-fill').count()) === 6);
  await page.screenshot({ path: OUT + '/demo-stats.png', fullPage: true });

  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + '/demo-expense.png', fullPage: true });

  await page.click('.tab[data-view="export"]');
  await page.waitForTimeout(300);
  ok('the export names the demo build',
    /v34-demo/.test(await page.locator('#view-export').innerText()));

  console.log('\n── seeding happens once, and on demand ──');
  await page.goto(B + '/demo/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const count = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('tripspend.demo.entries.v1')).length);
  ok('a reload does not duplicate the sample', (await count()) === 16);

  await page.evaluate(() => localStorage.setItem('tripspend.demo.entries.v1', '[]'));
  await page.goto(B + '/demo/index.html?reseed', { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  ok('?reseed puts the sample back', (await count()) === 16);
  ok('and drops the query so a reload is not a reseed',
    !/reseed/.test(await page.evaluate(() => location.search)));

  console.log('\n── the real app afterwards ──');
  await page.goto(B + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  await settingsTab();
  await page.waitForTimeout(250);
  ok('still holds its own account', (await page.locator('#set-acct-0').inputValue()) === 'RealDonald');
  ok('and none of the demo records', (await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tripspend.entries.v1') || '[]').length)) === 0);

  ok('no page errors (' + errs.join(' | ') + ')', errs.length === 0);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
