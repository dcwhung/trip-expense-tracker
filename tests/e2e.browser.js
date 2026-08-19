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
    ['add', 'list', 'stats', 'export', 'settings']
      .filter((v) => !document.getElementById('view-' + v).hidden)[0]);

  section('first run with no trip dates');
  check('opens on Settings', (await visibleView()) === 'settings', await visibleView());

  dialogs.length = 0;
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  check('tapping Expense raises an alert', dialogs.some((d) => d.type === 'alert'),
    JSON.stringify(dialogs));
  check('and leaves you on Settings rather than a dead Expense screen',
    (await visibleView()) === 'settings', await visibleView());
  check('there is no blocked-state panel any more',
    (await page.locator('#add-blocked').count()) === 0);


  section('nothing but the dates before a trip exists');
  await page.click('.tab[data-view="settings"]');
  await page.waitForTimeout(150);
  check('the Accounts card is hidden', await page.locator('#accounts-card').isHidden());
  check('Reset is hidden', await page.locator('#reset-settings').isHidden());
  for (const v of ['list', 'stats', 'export']) {
    check('the ' + v + ' tab is hidden',
      await page.locator(`.tab[data-view="${v}"]`).isHidden());
  }
  check('Expense and Settings stay reachable',
    !(await page.locator('.tab[data-view="add"]').isHidden()) &&
    !(await page.locator('.tab[data-view="settings"]').isHidden()));

  section('trip date validation');
  await page.fill('#set-start', '2026-08-28');
  await page.fill('#set-end', '2026-08-22');
  await page.waitForTimeout(120);
  check('reversed range is called out',
    /before the start/.test(await page.textContent('#range-state')),
    await page.textContent('#range-state'));
  await page.click('#save-settings');
  await page.waitForTimeout(150);
  check('reversed range is not saved',
    await page.evaluate(() => !JSON.parse(localStorage.getItem('tripspend.settings.v1') || '{}').tripStart));
  check('Save does not repeat the message that is already on screen',
    await page.locator('#toast').isHidden());

  await page.fill('#set-start', '2026-08-22');
  await page.fill('#set-end', '2026-08-28');
  await page.waitForTimeout(120);
  check('valid range shows the day count',
    (await page.textContent('#range-state')) === '22/8 → 28/8 · 7 days',
    await page.textContent('#range-state'));
  await page.click('#save-settings');
  await page.waitForTimeout(200);
  check('range is persisted', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tripspend.settings.v1')).tripEnd === '2026-08-28'));
  check('one Save stores the dates and leaves accounts unnamed', await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('tripspend.settings.v1'));
    return s.tripStart === '2026-08-22' && s.accounts[0] === '' && s.accounts[1] === '';
  }));
  check('the rest of the app unlocks', await page.evaluate(() =>
    ['list', 'stats', 'export'].every((v) =>
      !document.querySelector(`.tab[data-view="${v}"]`).hidden)));
  check('the Accounts card and Reset appear',
    !(await page.locator('#accounts-card').isHidden()) &&
    !(await page.locator('#reset-settings').isHidden()));

  section('accounts are optional');
  check('both name fields start empty',
    (await page.inputValue('#set-acct-0')) === '' &&
    (await page.inputValue('#set-acct-1')) === '');
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  check('with no names, the Account picker is hidden',
    await page.locator('#field-account').isHidden());

  await page.click('.tab[data-view="settings"]');
  await page.fill('#set-acct-0', 'Donald');
  await page.waitForTimeout(120);
  check('one name alone is not an error', await page.locator('#accounts-state').isHidden());
  await page.click('#save-settings');
  await page.waitForTimeout(200);
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  check('one named account still hides the picker',
    await page.locator('#field-account').isHidden());

  await page.click('.tab[data-view="settings"]');
  await page.fill('#set-acct-1', 'Donald');
  await page.waitForTimeout(120);
  check('duplicate names are flagged inline',
    /different names/.test(await page.textContent('#accounts-state')),
    await page.textContent('#accounts-state'));
  await page.fill('#set-acct-1', 'Kwan');
  await page.waitForTimeout(120);
  check('the inline account error clears once fixed',
    await page.locator('#accounts-state').isHidden());
  await page.click('#save-settings');
  await page.waitForTimeout(200);
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  check('two names bring the Account picker back',
    !(await page.locator('#field-account').isHidden()));

  section('date strip');
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  check('form is usable now', !(await page.locator('#entry-form').isHidden()));
  check('one button per trip day plus Today',
    (await page.locator('#date-strip .date-chip').count()) === 8,
    String(await page.locator('#date-strip .date-chip').count()));
  check('Today sits first', (await page.locator('#date-strip .date-chip').first()
    .textContent()) === 'Today');
  check('Today is enabled', !(await page.locator('#date-today').isDisabled()));
  check('labels read like 22/8',
    (await page.locator('#date-strip .date-chip[data-value]').first().textContent()) === '22/8');
  check("today inside the trip is preselected by default",
    (await page.locator('#date-strip .date-chip[data-value][aria-pressed="true"]')
      .textContent()) === '23/8');
  check('Today reads as selected too',
    (await page.locator('#date-today').getAttribute('aria-pressed')) === 'true');
  check('Day badge follows the selection',
    (await page.textContent('#day-badge')) === 'Day 2', await page.textContent('#day-badge'));
  await page.click('#date-strip .date-chip[data-value="2026-08-24"]');
  await page.waitForTimeout(120);
  check('picking 24/8 shows Day 3', (await page.textContent('#day-badge')) === 'Day 3',
    await page.textContent('#day-badge'));
  check('Today deselects when another day is picked',
    (await page.locator('#date-today').getAttribute('aria-pressed')) === 'false');
  await page.click('#date-today');
  await page.waitForTimeout(120);
  check('Today jumps back to the current day',
    (await page.textContent('#day-badge')) === 'Day 2', await page.textContent('#day-badge'));
  await page.click('#date-strip .date-chip[data-value="2026-08-24"]');
  await page.waitForTimeout(120);

  const budget = async (i) => (await page.locator('.budget-card').nth(i).textContent()).trim();
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('a fresh account card shows both figures at zero',
    (await budget(0)).includes('Topped up:') && (await budget(0)).includes('Spent:') &&
    (await budget(0)).includes('€0.00'), await budget(0));
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
  check('spent reads -€47.30', (await page.textContent('#sum-total')) === '-€47.30',
    await page.textContent('#sum-total'));
  check('day head carries Day 3',
    (await page.textContent('#list .day-head')).includes('Day 3'),
    await page.textContent('#list .day-head'));
  check('trip progress line',
    (await page.textContent('#sum-day')).includes('7 days · Day 2 of 7'),
    await page.textContent('#sum-day'));

  section('budgets from top-ups');
  check('spend with no top-up shows label-first lines',
    /Topped up:€0\.00/.test(await budget(0)) && /Spent:-€17\.30/.test(await budget(0)),
    await budget(0));
  check('Donald starts negative on spend alone',
    (await budget(0)).includes('-€17.30'), await budget(0));
  check('spend with no top-up is red', (await page.locator('.budget-card').nth(0)
    .getAttribute('class')).includes('is-low'));

  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(150);
  await page.click('#cat-grid .chip[data-value="__topup"]');
  await page.waitForTimeout(120);
  check('top-up mode hides Payment', await page.locator('#field-payment').isHidden());
  check('top-up mode hides Description', await page.locator('#field-description').isHidden());
  check('top-up mode hides Remarks', await page.locator('#field-remarks').isHidden());
  check('the button reads Confirm',
    (await page.textContent('#submit-btn')) === 'Confirm', await page.textContent('#submit-btn'));
  await page.fill('#amount', '500');
  await page.click('#acct-grid .chip[data-value="Donald"]');
  await page.click('#submit-btn');
  await page.waitForTimeout(250);
  check('the form returns to expense mode', !(await page.locator('#field-payment').isHidden()));
  check('the button reads Save again',
    (await page.textContent('#submit-btn')) === 'Save', await page.textContent('#submit-btn'));

  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('Donald has €482.70 left', (await budget(0)).includes('€482.70'), await budget(0));
  check('Donald is green', (await page.locator('.budget-card').nth(0)
    .getAttribute('class')).includes('is-ok'));
  check('Kwan is untouched by Donald’s top-up',
    (await budget(1)).includes('-€30.00'), await budget(1));
  check('spend total still excludes the top-up',
    (await page.textContent('#sum-total')) === '-€47.30', await page.textContent('#sum-total'));
  check('the Top-ups section shows a running total',
    (await page.textContent('#topup-total')) === '+€500.00', await page.textContent('#topup-total'));
  check('the summary reports budget left on the left',
    (await page.textContent('#sum-left')) === '€452.70', await page.textContent('#sum-left'));
  check('and spent as a red negative on the right',
    (await page.textContent('#sum-total')) === '-€47.30' &&
    (await page.locator('#sum-total').getAttribute('class')).includes('is-debit-on-dark'),
    await page.textContent('#sum-total'));
  check('Spent on a budget card is negative and marked as a debit',
    await page.evaluate(() => {
      const lines = document.querySelectorAll('.budget-card .budget-line');
      const spent = lines[1].querySelectorAll('span')[1];
      return spent.textContent.startsWith('-') && spent.className.includes('is-debit');
    }));
  check('Topped up stays plain',
    await page.evaluate(() => {
      const v = document.querySelectorAll('.budget-card .budget-line')[0].querySelectorAll('span')[1];
      return !v.textContent.startsWith('-') && !v.className.includes('is-debit');
    }));

  check('expense rows carry no sign',
    !(await page.locator('#list .row-amt').first().textContent()).startsWith('-'),
    await page.locator('#list .row-amt').first().textContent());
  check('the day subtotal is the one that goes negative',
    (await page.locator('#list .day-total').first().textContent()).startsWith('-'),
    await page.locator('#list .day-total').first().textContent());
  check('and it is marked as a debit',
    (await page.locator('#list .day-total').first().getAttribute('class')).includes('is-debit'));
  check('top-up rows carry no sign and no credit colour', await page.evaluate(() => {
    const el = document.querySelector('#topup-list .row-amt');
    return el && !el.textContent.startsWith('+') && !el.className.includes('is-credit');
  }));




  section('low-balance colour');
  await page.click('.tab[data-view="add"]');
  await add('400.00', 'Shopping', 'Big one', 'Donald');
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('Donald now has €82.70 left', (await budget(0)).includes('€82.70'), await budget(0));
  check('under €100 turns red', (await page.locator('.budget-card').nth(0)
    .getAttribute('class')).includes('is-low'));

  section('top-up can be edited or removed');
  check('top-up section is visible', !(await page.locator('#topup-list-wrap').isHidden()));
  await page.click('#topup-list .row');
  await page.waitForTimeout(250);
  check('tapping a top-up opens it for editing',
    (await page.textContent('#add-title')) === 'Edit top-up', await page.textContent('#add-title'));
  check('its amount is prefilled', (await page.inputValue('#amount')) === '500.00',
    await page.inputValue('#amount'));
  check('the category grid is hidden while editing a top-up',
    await page.locator('#field-category').isHidden());
  check('the button reads Update',
    (await page.textContent('#submit-btn')) === 'Update', await page.textContent('#submit-btn'));
  check('Delete and Cancel are offered',
    !(await page.locator('#delete-btn').isHidden()) && !(await page.locator('#cancel-btn').isHidden()));

  await page.fill('#amount', '600');
  await page.click('#submit-btn');
  await page.waitForTimeout(250);
  check('editing the amount moves the budget',
    (await budget(0)).includes('€182.70'), await budget(0));
  check('editing does not create a second top-up',
    (await page.locator('#topup-list .row').count()) === 1,
    String(await page.locator('#topup-list .row').count()));

  await page.click('#topup-list .row');
  await page.waitForTimeout(200);
  await page.click('#delete-btn');
  await page.waitForTimeout(250);
  check('deleting from the edit form takes the budget back down',
    (await budget(0)).includes('-€417.30'), await budget(0));
  check('the top-up list empties', await page.locator('#topup-list-wrap').isHidden());

  // Put it back for the remaining tests.
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(150);
  await page.click('#cat-grid .chip[data-value="__topup"]');
  await page.fill('#amount', '500');
  await page.click('#acct-grid .chip[data-value="Donald"]');
  await page.click('#submit-btn');
  await page.waitForTimeout(250);

  section('Top Up is not offered when editing an expense');
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  await page.click('#list .row');
  await page.waitForTimeout(200);
  check('the expense edit form is open',
    (await page.textContent('#add-title')) === 'Edit', await page.textContent('#add-title'));
  check('the Top Up chip is hidden',
    await page.locator('#cat-grid .chip[data-value="__topup"]').isHidden());
  check('the real categories are still there',
    !(await page.locator('#cat-grid .chip[data-value="Food"]').isHidden()));
  await page.click('#cancel-btn');
  await page.waitForTimeout(200);
  // Cancel lands on Records, and an element inside a hidden view counts as
  // hidden — so come back to Add before asking.
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  check('Top Up comes back once the edit is cancelled',
    !(await page.locator('#cat-grid .chip[data-value="__topup"]').isHidden()));
  check('the form is back to Expense',
    (await page.textContent('#add-title')) === 'Expense', await page.textContent('#add-title'));

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
  check('everything is gone', (await page.textContent('#sum-total')) === '€0.00',
    await page.textContent('#sum-total'));
  check('nothing left to spend either', (await page.textContent('#sum-left')) === '€0.00',
    await page.textContent('#sum-left'));
  check('top-up section hides when empty', await page.locator('#topup-list-wrap').isHidden());

  await page.click('.tab[data-view="export"]');
  await page.fill('#import-box', backup);
  await page.click('#import-btn');
  await page.waitForTimeout(300);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('spend total restored', (await page.textContent('#sum-total')) === '-€447.30',
    await page.textContent('#sum-total'));
  check('budget left restored alongside it',
    (await page.textContent('#sum-left')) === '€52.70', await page.textContent('#sum-left'));
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
  await page.click('#save-settings');
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
    (await page.textContent('#sum-total')) === '-€459.64', await page.textContent('#sum-total'));

  section('pre-trip bookings and top-ups');
  const pre = await ctx.newPage();
  const preErrors = [];
  pre.on('pageerror', (e) => preErrors.push(e.message));
  pre.on('dialog', (d) => d.accept());
  await pre.addInitScript(() => {
    const Real = Date;
    const fixed = new Real('2026-08-18T10:00:00');   // four days before the trip
    class FakeDate extends Real {
      constructor(...a) { return a.length ? new Real(...a) : new Real(fixed); }
      static now() { return fixed.getTime(); }
    }
    window.Date = FakeDate;
  });
  await pre.goto(URL, { waitUntil: 'networkidle' });
  await pre.click('.tab[data-view="add"]');
  await pre.waitForTimeout(250);

  check('Today stays enabled before the trip starts',
    !(await pre.locator('#date-today').isDisabled()));
  check('nothing is preselected when today is outside the trip',
    (await pre.locator('#date-strip .date-chip[aria-pressed="true"]').count()) === 0,
    String(await pre.locator('#date-strip .date-chip[aria-pressed="true"]').count()));
  check('no Day badge with nothing picked', (await pre.textContent('#day-badge')) === '');

  await pre.click('#date-today');
  await pre.waitForTimeout(150);
  check('picking Today outside the trip shows the date instead of a Day number',
    (await pre.textContent('#day-badge')) === '18/8', await pre.textContent('#day-badge'));

  const beforeCount = await pre.evaluate(() =>
    JSON.parse(localStorage.getItem('tripspend.entries.v1')).length);
  await pre.fill('#amount', '250');
  await pre.click('#cat-grid .chip[data-value="Transportation"]');
  await pre.fill('#description', 'Flights');
  await pre.click('#submit-btn');
  await pre.waitForTimeout(250);
  const booking = await pre.evaluate(() =>
    JSON.parse(localStorage.getItem('tripspend.entries.v1')).find((e) => e.description === 'Flights'));
  check('a pre-trip booking is logged on today’s date',
    booking && booking.date === '2026-08-18' && booking.amountMinor === 25000,
    JSON.stringify(booking));
  check('it really is a new entry', await pre.evaluate((n) =>
    JSON.parse(localStorage.getItem('tripspend.entries.v1')).length === n + 1, beforeCount));

  await pre.click('#cat-grid .chip[data-value="__topup"]');
  await pre.waitForTimeout(120);
  await pre.click('#date-today');
  await pre.fill('#amount', '300');
  await pre.click('#submit-btn');
  await pre.waitForTimeout(250);
  const preTop = await pre.evaluate(() =>
    JSON.parse(localStorage.getItem('tripspend.topups.v1')).find((t) => t.date === '2026-08-18'));
  check('a top-up before departure is accepted',
    preTop && preTop.amountMinor === 30000, JSON.stringify(preTop));

  await pre.click('.tab[data-view="list"]');
  await pre.waitForTimeout(250);
  const headings = await pre.locator('#list .day-head').allTextContents();
  check('the pre-trip day is listed without a Day number',
    headings.some((h) => h.includes('2026-08-18') && !h.includes('Day ')),
    JSON.stringify(headings));
  check('no errors on the pre-trip page', preErrors.length === 0, preErrors.join('; '));
  await pre.close();

  section('offline');
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(200);
  check('loads and keeps its data with the network off',
    (await page.textContent('#sum-total')) === '-€709.64', await page.textContent('#sum-total'));
  await page.screenshot({ path: OUT + '/04-offline.png', fullPage: true });
  await ctx.setOffline(false);

  section('row label: description, remarks, or both');
  const logLabelled = async (amt, desc, remarks) => {
    await page.click('.tab[data-view="add"]');
    await page.waitForTimeout(150);
    await page.click('#date-strip .date-chip[data-value="2026-08-26"]');
    await page.click('#cat-grid .chip[data-value="Food"]');
    await page.fill('#amount', amt);
    await page.fill('#description', desc);
    await page.fill('#remarks', remarks);
    await page.click('#submit-btn');
    await page.waitForTimeout(180);
  };
  await logLabelled('1.00', 'Desc only', '');
  await logLabelled('2.00', '', 'Remarks only');
  await logLabelled('3.00', 'Bar Centrale', 'two coffees');
  await logLabelled('4.00', '', '');

  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(250);
  const labels = await page.locator('#list .row-desc').allTextContents();
  check('description alone is shown', labels.includes('Desc only'), JSON.stringify(labels));
  check('remarks alone stand in for a missing description',
    labels.includes('Remarks only'), JSON.stringify(labels));
  check('both are joined with a pipe',
    labels.includes('Bar Centrale | two coffees'), JSON.stringify(labels));
  const subs = await page.locator('#list .row-sub').allTextContents();
  check('remarks no longer duplicated on the sub line',
    !subs.some((t) => t.includes('two coffees')), JSON.stringify(subs.slice(0, 4)));
  check('an entry with neither shows no placeholder',
    !labels.some((t) => /No description/i.test(t)), JSON.stringify(labels));
  // The account was renamed earlier in this run, so match the shape rather
  // than a fixed name.
  check('it falls back to the category line instead',
    labels.some((t) => /^Food · \S+ · Global Money$/.test(t)), JSON.stringify(labels));

  section('statistics');
  await page.click('.tab[data-view="stats"]');
  await page.waitForTimeout(250);
  check('Statistics is its own section, not a modal',
    (await visibleView()) === 'stats', await visibleView());
  check('no modal is involved',
    (await page.locator('#stats-modal').count()) === 0);
  check('the donut is gone', (await page.locator('#stats-body .donut').count()) === 0);
  check('the table is gone', (await page.locator('#stats-body .viz-table').count()) === 0);

  const catsWithSpend = await page.evaluate(() => {
    const seen = new Set();
    JSON.parse(localStorage.getItem('tripspend.entries.v1')).forEach((e) => seen.add(e.category));
    return seen.size;
  });
  check('one bar per category that has spend',
    (await page.locator('#stats-body .bar-row').count()) === catsWithSpend,
    (await page.locator('#stats-body .bar-row').count()) + ' vs ' + catsWithSpend);
  check('the headline matches the Records total', await page.evaluate(async () => {
    const shown = document.querySelector('.stats-total').textContent;
    const entries = JSON.parse(localStorage.getItem('tripspend.entries.v1'));
    const total = entries.reduce((t, e) => t + e.amountMinor, 0);
    return shown === '€' + (total / 100).toLocaleString('en-GB',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }));

  check('bars are sorted largest first', await page.evaluate(() => {
    const w = Array.from(document.querySelectorAll('#stats-body .bar-fill'))
      .map((el) => parseFloat(el.style.width));
    return w.every((v, i) => i === 0 || w[i - 1] >= v);
  }));
  check('the largest bar is full width', await page.evaluate(() =>
    parseFloat(document.querySelector('#stats-body .bar-fill').style.width) === 100));
  check('every bar is labelled with its amount and share', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#stats-body .bar-value'))
      .every((el) => /€[\d,.]+\s+·\s+\d+%/.test(el.textContent))));

  // Colour follows the category, not its position in the sorted list.
  check('each category keeps its own fixed colour', await page.evaluate(() => {
    const want = { Food: 'rgb(235, 104, 52)', Shopping: 'rgb(232, 123, 164)' };
    const rows = Array.from(document.querySelectorAll('#stats-body .bar-row'));
    return Object.keys(want).every((cat) => {
      const row = rows.find((r) => r.querySelector('.bar-name').textContent.includes(cat));
      return row && row.querySelector('.bar-fill').style.background === want[cat];
    });
  }));

  await page.screenshot({ path: OUT + '/05-stats.png', fullPage: true });

  section('reset');
  const before = await page.evaluate(() => ({
    entries: JSON.parse(localStorage.getItem('tripspend.entries.v1')).length,
    topups: JSON.parse(localStorage.getItem('tripspend.topups.v1')).length,
  }));
  await page.click('.tab[data-view="settings"]');
  await page.waitForTimeout(200);
  await page.click('#reset-settings');
  await page.waitForTimeout(300);

  check('the trip dates are cleared', await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('tripspend.settings.v1'));
    return !s.tripStart && !s.tripEnd && s.accounts.every((a) => a === '');
  }));
  check('it lands on Settings', (await visibleView()) === 'settings', await visibleView());
  for (const v of ['list', 'stats', 'export']) {
    check('the ' + v + ' tab is hidden again',
      await page.locator(`.tab[data-view="${v}"]`).isHidden());
  }
  check('only the trip dates are on offer',
    (await page.locator('#accounts-card').isHidden()) &&
    (await page.locator('#reset-settings').isHidden()));
  check('entries and top-ups survive the reset', await page.evaluate((b) => {
    const e = JSON.parse(localStorage.getItem('tripspend.entries.v1')).length;
    const t = JSON.parse(localStorage.getItem('tripspend.topups.v1')).length;
    return e === b.entries && t === b.topups;
  }, before));

  section('single pot after a reset');
  await page.fill('#set-start', '2026-08-22');
  await page.fill('#set-end', '2026-08-28');
  await page.click('#save-settings');
  await page.waitForTimeout(250);
  await page.click('.tab[data-view="list"]');
  await page.waitForTimeout(250);

  check('the data is back', await page.evaluate((b) =>
    document.querySelectorAll('#list .row').length === b.entries, before));
  check('there is one budget card, not two',
    (await page.locator('.budget-card').count()) === 1,
    String(await page.locator('.budget-card').count()));
  check('it carries no account name',
    (await page.locator('.budget-card .budget-name').count()) === 0);
  check('the single pot totals everything regardless of old labels',
    await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('tripspend.entries.v1'))
        .reduce((t, x) => t + x.amountMinor, 0);
      const t = JSON.parse(localStorage.getItem('tripspend.topups.v1'))
        .reduce((a, x) => a + x.amountMinor, 0);
      const shown = document.querySelector('.budget-left').textContent;
      const want = (t - e) / 100;
      return shown === (want < 0 ? '-' : '') + '€' + Math.abs(want)
        .toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }));
  check('expense rows drop the account name', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#list .row-sub'))
      .every((el) => el.textContent.split(' · ').length === 2)));
  check('a top-up row reads simply Top-up', await page.evaluate(() => {
    const el = document.querySelector('#topup-list .row-desc');
    return !el || el.textContent === 'Top-up';
  }));
  await page.click('.tab[data-view="add"]');
  await page.waitForTimeout(200);
  check('the Account picker stays hidden',
    await page.locator('#field-account').isHidden());

  check('no page errors', errors.length === 0, errors.join('; '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
