const { chromium, devices } = require('playwright');
const fs = require('fs');
const OUT = process.env.SHOT_DIR || '/tmp';
const URL = 'http://127.0.0.1:8099/index.html';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); }
};
const section = (s) => console.log('\n── ' + s + ' ──');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => { dialogs.push({ type: d.type(), message: d.message() }); d.accept(); });

  // Freeze the clock inside the trip, at 21:30, so Day numbers and the
  // 20:00 backup banner are both deterministic.
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

  const visibleView = () => page.evaluate(() =>
    ['add', 'list', 'export', 'settings']
      .filter((v) => !document.getElementById('view-' + v).hidden)[0]);

  section('first run with no trip dates');
  check('opens on Settings', (await visibleView()) === 'settings', await visibleView());

  dialogs.length = 0;
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  check('tapping Add raises an alert', dialogs.some((d) => d.type === 'alert'),
    JSON.stringify(dialogs));
  check('the entry form is hidden', await page.locator('#entry-form').isHidden());
  check('a blocking notice is shown', !(await page.locator('#add-blocked').isHidden()));
  check('Top up is hidden too', await page.locator('#topup-open').isHidden());

  section('trip date validation');
  await page.click('.tab[data-view="settings"]');
  await page.fill('#set-start', '2026-08-28');
  await page.fill('#set-end', '2026-08-22');
  await page.waitForTimeout(120);
  check('reversed range is called out',
    /before the start/.test(await page.textContent('#range-state')),
    await page.textContent('#range-state'));
  await page.click('#save-range');
  await page.waitForTimeout(150);
  check('reversed range is not saved',
    await page.evaluate(() => !JSON.parse(localStorage.getItem('tripspend.settings.v1') || '{}').tripStart));

  await page.fill('#set-start', '2026-08-22');
  await page.fill('#set-end', '2026-08-28');
  await page.waitForTimeout(120);
  check('valid range shows the day count',
    (await page.textContent('#range-state')) === '22/8 → 28/8 · 7 days',
    await page.textContent('#range-state'));
  await page.click('#save-range');
  await page.waitForTimeout(200);
  check('range is persisted', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tripspend.settings.v1')).tripEnd === '2026-08-28'));

  section('date strip');
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  check('form is usable now', !(await page.locator('#entry-form').isHidden()));
  check('one button per trip day', (await page.locator('#date-strip .date-chip').count()) === 7,
    String(await page.locator('#date-strip .date-chip').count()));
  check('labels read like 22/8',
    (await page.locator('#date-strip .date-chip').first().textContent()) === '22/8');
  check("today inside the trip is preselected",
    (await page.locator('#date-strip .date-chip[aria-pressed="true"]').textContent()) === '23/8');
  check('Day badge follows the selection',
    (await page.textContent('#day-badge')) === 'Day 2', await page.textContent('#day-badge'));
  await page.click('#date-strip .date-chip[data-value="2026-08-24"]');
  await page.waitForTimeout(120);
  check('picking 24/8 shows Day 3', (await page.textContent('#day-badge')) === 'Day 3',
    await page.textContent('#day-badge'));

  const budget = async (i) => (await page.locator('.budget-card').nth(i).textContent()).trim();
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('a fresh account card reads "No top-ups yet"',
    (await budget(0)).includes('No top-ups yet'), await budget(0));
  check('a fresh account is green', (await page.locator('.budget-card').nth(0)
    .getAttribute('class')).includes('is-ok'));
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(150);

  section('logging expenses');
  const add = async (amt, cat, desc, account) => {
    await page.fill('#amount', amt);
    await page.click(`#cat-grid .chip[data-value="${cat}"]`);
    if (desc) await page.fill('#description', desc);
    if (account) await page.click(`#acct-grid .chip[data-value="${account}"]`);
    await page.click('#submit-btn');
    await page.waitForTimeout(150);
  };
  await add('4.50', 'Food', 'Gelato', 'Donald');
  check('the selected day stays put after saving',
    (await page.textContent('#day-badge')) === 'Day 3');
  await add('12,80', 'Food', 'Trattoria, "Da Enzo"');
  await add('30.00', 'Shopping', 'Market', 'Kwan');

  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('total is €47.30', (await page.textContent('#sum-total')) === '€47.30',
    await page.textContent('#sum-total'));
  check('day head carries Day 3',
    (await page.textContent('#list .day-head')).includes('Day 3'),
    await page.textContent('#list .day-head'));
  check('trip progress line',
    (await page.textContent('#sum-day')).includes('7 days · Day 2 of 7'),
    await page.textContent('#sum-day'));

  section('budgets from top-ups');
  check('spend with no top-up shows the deduction',
    (await budget(0)).includes('€0.00 topped up · €17.30 spent'), await budget(0));
  check('Donald starts negative on spend alone',
    (await budget(0)).includes('-€17.30'), await budget(0));
  check('spend with no top-up is red', (await page.locator('.budget-card').nth(0)
    .getAttribute('class')).includes('is-low'));

  await page.click('.tab[data-view="add"]');
  await page.click('#topup-open');
  await page.waitForTimeout(150);
  await page.fill('#topup-amount', '500');
  await page.click('#topup-acct .chip[data-value="Donald"]');
  await page.click('#topup-save');
  await page.waitForTimeout(200);
  check('top-up modal closes', await page.locator('#topup-modal').isHidden());

  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('Donald has €482.70 left', (await budget(0)).includes('€482.70'), await budget(0));
  check('Donald is green', (await page.locator('.budget-card').nth(0)
    .getAttribute('class')).includes('is-ok'));
  check('Kwan is untouched by Donald’s top-up',
    (await budget(1)).includes('-€30.00'), await budget(1));
  check('spend total still excludes the top-up',
    (await page.textContent('#sum-total')) === '€47.30', await page.textContent('#sum-total'));

  section('low-balance colour');
  await page.click('.tab[data-view="add"]');
  await add('400.00', 'Shopping', 'Big one', 'Donald');
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('Donald now has €82.70 left', (await budget(0)).includes('€82.70'), await budget(0));
  check('under €100 turns red', (await page.locator('.budget-card').nth(0)
    .getAttribute('class')).includes('is-low'));

  section('top-up can be removed');
  check('top-up section is visible', !(await page.locator('#topup-list-wrap').isHidden()));
  await page.click('#topup-list .row');
  await page.waitForTimeout(250);
  check('removing it takes the budget back down',
    (await budget(0)).includes('-€417.30'), await budget(0));
  // Put it back for the remaining tests.
  await page.click('.tab[data-view="add"]');
  await page.click('#topup-open');
  await page.fill('#topup-amount', '500');
  await page.click('#topup-acct .chip[data-value="Donald"]');
  await page.click('#topup-save');
  await page.waitForTimeout(200);

  section('backup banner at 21:30');
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('banner is showing', !(await page.locator('#banner').isHidden()));
  await page.click('#banner-backup');
  await page.waitForTimeout(250);
  check('banner hides once backed up', await page.locator('#banner').isHidden());
  const backup = await page.evaluate(() => navigator.clipboard.readText());
  check('backup carries entries, top-ups and settings',
    backup.includes('"topups"') && backup.includes('"settings"') && backup.includes('Gelato'));

  section('CSV');
  await page.click('.tab[data-view="export"]');
  await page.waitForTimeout(150);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-export="csv"]'),
  ]);
  const buf = fs.readFileSync(await dl.path());
  const csv = buf.toString('utf8');
  check('named after the trip start',
    dl.suggestedFilename() === 'trip-spend-2026-08-22.csv', dl.suggestedFilename());
  check('UTF-8 BOM bytes EF BB BF', buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
  check('header row', csv.split('\r\n')[0].slice(1) ===
    'Account,Date,Payment,Description,EUR,Category,Remarks');
  check('comma and quotes escaped', csv.includes('"Trattoria, ""Da Enzo"""'));
  check('comma decimal 12,80 stored as 12.80', csv.includes(',12.80,'));
  check('top-ups are absent from the CSV', !csv.includes('500.00'));
  check('four expense rows only', csv.split('\r\n').filter(Boolean).length === 5);

  section('wipe → import round trip');
  await page.fill('#wipe-confirm', 'DELETE');
  await page.click('#wipe-btn');
  await page.waitForTimeout(250);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(150);
  check('everything is gone', (await page.textContent('#sum-meta')) === '0 entries',
    await page.textContent('#sum-meta'));
  check('top-up section hides when empty', await page.locator('#topup-list-wrap').isHidden());

  await page.click('.tab[data-view="export"]');
  await page.fill('#import-box', backup);
  await page.click('#import-btn');
  await page.waitForTimeout(300);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('entries restored', (await page.textContent('#sum-meta')) === '4 entries',
    await page.textContent('#sum-meta'));
  check('spend total restored', (await page.textContent('#sum-total')) === '€447.30',
    await page.textContent('#sum-total'));
  check('top-up restored with it', (await budget(0)).includes('€82.70'), await budget(0));
  const enzo = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tripspend.entries.v1'))
      .find((e) => e.description.indexOf('Enzo') >= 0));
  check('remarks and payment survived',
    enzo && enzo.payment === 'Global Money' && enzo.account === 'Donald',
    JSON.stringify(enzo));

  section('renaming an account migrates its records');
  await page.click('.tab[data-view="settings"]');
  await page.fill('#set-acct-0', 'Don');
  await page.click('#save-accounts');
  await page.waitForTimeout(250);
  const migrated = await page.evaluate(() => ({
    entries: JSON.parse(localStorage.getItem('tripspend.entries.v1')).map((e) => e.account),
    topups: JSON.parse(localStorage.getItem('tripspend.topups.v1')).map((t) => t.account),
  }));
  check('no entry still says Donald', migrated.entries.indexOf('Donald') < 0,
    JSON.stringify(migrated.entries));
  check('top-ups renamed too', migrated.topups.every((a) => a === 'Don'),
    JSON.stringify(migrated.topups));
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('budget follows the new name', (await budget(0)).includes('€82.70'), await budget(0));

  section('three-decimal regression');
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(150);
  await page.fill('#amount', '12.345');
  check('field clamps to two decimals while typing',
    (await page.inputValue('#amount')) === '12.34', await page.inputValue('#amount'));
  await page.click('#cat-grid .chip[data-value="Food"]');
  await page.click('#submit-btn');
  await page.waitForTimeout(200);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(150);
  check('saved as €12.34, not €12,345.00',
    (await page.textContent('#sum-total')) === '€459.64', await page.textContent('#sum-total'));

  section('offline');
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('loads and keeps its data with the network off',
    (await page.textContent('#sum-meta')) === '5 entries', await page.textContent('#sum-meta'));
  await page.screenshot({ path: OUT + '/04-offline.png', fullPage: true });
  await ctx.setOffline(false);

  check('no page errors', errors.length === 0, errors.join('; '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
