const { chromium, devices } = require('playwright');
const OUT = '/tmp/claude-0/-home-user-trip-expense-tracker/187e5590-432f-54c7-91b6-0e370d3a2af8/scratchpad';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle' });

  // Seed a few entries through the real UI.
  const rows = [
    ['4.50',  'Food',           'Gelato Roma'],
    ['12,80', 'Food',           'Trattoria'],
    ['1.50',  'Transportation', 'Metro'],
    ['1234.56','Shopping',      'Bar, "Sport"'],
  ];
  for (const [amt, cat, desc] of rows) {
    await page.fill('#amount', amt);
    await page.click(`#cat-grid .chip[data-value="${cat}"]`);
    await page.fill('#description', desc);
    await page.click('#submit-btn');
    await page.waitForTimeout(120);
  }
  await page.screenshot({ path: OUT + '/01-add.png' });

  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '/02-list.png', fullPage: true });

  await page.click('.tab[data-view="export"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '/03-export.png', fullPage: true });

  // Persistence: reload and confirm the four entries survive.
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  const meta = await page.textContent('#sum-meta');
  const total = await page.textContent('#sum-total');

  // Edit round-trip: open the first row, change the amount, save.
  await page.click('#list .row');
  await page.waitForTimeout(150);
  const editTitle = await page.textContent('#view-add .screen-title');
  await page.fill('#amount', '9.99');
  await page.click('#submit-btn');
  await page.waitForTimeout(200);
  const totalAfterEdit = await page.textContent('#sum-total');

  const sw = await page.evaluate(() => navigator.serviceWorker.controller ? 'active' : 'none');

  console.log(JSON.stringify({
    errors, meta, total, editTitle, totalAfterEdit, serviceWorker: sw,
  }, null, 2));

  await browser.close();
})();
