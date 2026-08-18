const { chromium, devices } = require('playwright');
const fs = require('fs');
const OUT = '/tmp/claude-0/-home-user-trip-expense-tracker/187e5590-432f-54c7-91b6-0e370d3a2af8/scratchpad';
const URL = 'http://127.0.0.1:8099/index.html';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Pin the clock to 21:00 local so the 20:00 banner rule is testable.
  await page.addInitScript(() => {
    const Real = Date;
    const fixed = new Real('2026-08-23T21:30:00');
    class FakeDate extends Real {
      constructor(...a) { return a.length ? new Real(...a) : new Real(fixed); }
      static now() { return fixed.getTime(); }
    }
    window.Date = FakeDate;
  });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const add = async (amt, cat, desc, remarks) => {
    await page.fill('#amount', amt);
    await page.click(`#cat-grid .chip[data-value="${cat}"]`);
    if (desc) await page.fill('#description', desc);
    if (remarks) await page.fill('#remarks', remarks);
    await page.click('#submit-btn');
    await page.waitForTimeout(100);
  };

  console.log('\n── seed ──');
  await add('4.50', 'Food', 'Gelato', '');
  await add('12,80', 'Food', 'Trattoria, "Da Enzo"', '兩個人');
  await add('1.50', 'Transportation', 'Metro', '');
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(150);
  check('3 entries totalling €18.80',
    (await page.textContent('#sum-total')) === '€18.80',
    await page.textContent('#sum-total'));
  check('Day 2 label shown for 2026-08-23',
    (await page.textContent('#list .day-head')).includes('Day 2'),
    await page.textContent('#list .day-head'));

  console.log('\n── 20:00 backup banner ──');
  check('banner visible at 21:30 with no backup', !(await page.locator('#banner').isHidden()));
  await page.click('#banner-backup');
  await page.waitForTimeout(250);
  check('banner hides after backing up', await page.locator('#banner').isHidden());
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('clipboard holds the JSON backup', clip.includes('"schemaVersion": 1') && clip.includes('Gelato'));

  console.log('\n── CSV download ──');
  await page.click('.tab[data-view="export"]');
  await page.waitForTimeout(150);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-export="csv"]'),
  ]);
  const p = await dl.path();
  const buf = fs.readFileSync(p);
  const csv = buf.toString('utf8');
  check('filename is trip-spend-italy-2026-08.csv',
    dl.suggestedFilename() === 'trip-spend-italy-2026-08.csv', dl.suggestedFilename());
  check('file begins with UTF-8 BOM bytes EF BB BF',
    buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
  check('header row correct',
    csv.split('\r\n')[0].replace('﻿', '') ===
    'Account,Date,Payment,Description,EUR,Category,Remarks');
  check('comma+quote description escaped',
    csv.includes('"Trattoria, ""Da Enzo"""'), csv.split('\r\n')[2]);
  check('comma decimal 12,80 stored as 12.80', csv.includes(',12.80,'));
  check('Chinese remarks survive', csv.includes('兩個人'));

  console.log('\n── wipe → import round trip ──');
  const backup = clip;
  await page.fill('#wipe-confirm', 'DELETE');
  page.once('dialog', (d) => d.accept());
  await page.click('#wipe-btn');
  await page.waitForTimeout(250);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(150);
  check('all data gone after wipe', (await page.textContent('#sum-meta')) === '0 筆');

  await page.click('.tab[data-view="export"]');
  await page.fill('#import-box', backup);
  page.once('dialog', (d) => d.accept());
  await page.click('#import-btn');
  await page.waitForTimeout(250);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(150);
  check('restored 3 entries', (await page.textContent('#sum-meta')) === '3 筆');
  check('restored total €18.80', (await page.textContent('#sum-total')) === '€18.80');
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tripspend.entries.v1')));
  const enzo = restored.find((e) => e.description.includes('Enzo'));
  check('remarks survived the round trip', enzo && enzo.remarks === '兩個人');
  check('payment/account survived', enzo && enzo.account === 'Donald' && enzo.payment === 'Global Money');

  console.log('\n── offline ──');
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(150);
  check('app loads and keeps data with network off',
    (await page.textContent('#sum-meta')) === '3 筆');
  await page.screenshot({ path: OUT + '/04-offline.png', fullPage: true });
  await ctx.setOffline(false);

  console.log('\n── three-decimal regression (reported bug) ──');
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(150);
  await page.fill('#amount', '12.345');
  check('field clamps to two decimals while typing',
    (await page.inputValue('#amount')) === '12.34',
    await page.inputValue('#amount'));
  await page.click('#cat-grid .chip[data-value="Food"]');
  await page.click('#submit-btn');
  await page.waitForTimeout(200);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(150);
  check('saved as €12.34, not €12,345.00',
    (await page.textContent('#sum-total')) === '€31.14',
    await page.textContent('#sum-total'));

  // Same path through edit, which is where the bug was noticed. Target the
  // row by amount: the clock is frozen, so every createdAt is identical and
  // row order within the day is arbitrary.
  await page.click('#list .row:has(.row-amt:text-is("€12.34"))');
  await page.waitForTimeout(150);
  await page.fill('#amount', '9.999');
  check('edit field clamps too', (await page.inputValue('#amount')) === '9.99',
    await page.inputValue('#amount'));
  await page.click('#submit-btn');
  await page.waitForTimeout(200);
  check('edit saved as €9.99', (await page.textContent('#sum-total')) === '€28.79',
    await page.textContent('#sum-total'));

  check('no page errors', errors.length === 0, errors.join('; '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
