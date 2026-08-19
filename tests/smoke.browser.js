const { chromium, devices } = require('playwright');
const OUT = process.env.SHOT_DIR || '/tmp';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());

  await page.addInitScript(() => {
    const Real = Date;
    const fixed = new Real('2026-08-24T14:00:00');
    class FakeDate extends Real {
      constructor(...a) { return a.length ? new Real(...a) : new Real(fixed); }
      static now() { return fixed.getTime(); }
    }
    window.Date = FakeDate;
  });
  await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'networkidle' });

  await page.screenshot({ path: OUT + '/00-settings-empty.png', fullPage: true });

  await page.fill('#set-start', '2026-08-22');
  await page.fill('#set-end', '2026-08-28');
  await page.click('#save-settings');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '/04-settings.png', fullPage: true });

  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  await page.click('#topup-open');
  await page.waitForTimeout(150);
  await page.fill('#topup-amount', '500');
  await page.click('#topup-save');
  await page.waitForTimeout(200);

  const rows = [
    ['4.50', 'Food', 'Gelato Roma', '2026-08-22'],
    ['48.00', 'Food', 'Trattoria da Enzo', '2026-08-23'],
    ['1.50', 'Transportation', 'Metro', '2026-08-24'],
    ['32.00', 'Shopping', 'Mercato', '2026-08-24'],
  ];
  for (const [amt, cat, desc, date] of rows) {
    await page.click(`#date-strip .date-chip[data-value="${date}"]`);
    await page.click(`#cat-grid .chip[data-value="${cat}"]`);
    await page.fill('#amount', amt);
    await page.fill('#description', desc);
    await page.click('#submit-btn');
    await page.waitForTimeout(120);
  }
  await page.screenshot({ path: OUT + '/01-add.png' });

  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + '/02-list.png', fullPage: true });

  await page.click('.tab[data-view="export"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '/03-export.png', fullPage: true });

  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  console.log(JSON.stringify({
    errors,
    total: await page.textContent('#sum-total'),
    meta: await page.textContent('#sum-meta'),
    progress: await page.textContent('#sum-day'),
    budget: (await page.locator('.budget-card').nth(0).textContent()).trim(),
    serviceWorker: await page.evaluate(() =>
      (navigator.serviceWorker.controller ? 'active' : 'none')),
  }, null, 2));

  await browser.close();
})();
