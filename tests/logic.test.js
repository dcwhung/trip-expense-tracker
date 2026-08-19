const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function el() {
  const e = {
    children: [], dataset: {}, style: {}, hidden: false, value: '',
    textContent: '', innerHTML: '', disabled: false, className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, focus() {}, blur() {}, click() {},
    select() {}, setSelectionRange() {}, scrollIntoView() {},
    querySelector() { return el(); }, querySelectorAll() { return []; },
  };
  return e;
}

const store = new Map();
const ctx = {
  console,
  document: {
    querySelector: () => el(),
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener() {},
    hidden: false,
    body: el(),
  },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  },
  navigator: {},
  setTimeout, clearTimeout, URL, Map, Blob: class {}, File: class {},
  confirm: () => true, alert: () => {},
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.window.crypto = { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) };
ctx.window.addEventListener = () => {};
ctx.window.scrollTo = () => {};

const src = fs.readFileSync('app.js', 'utf8') + `
globalThis.__T = {
  parseAmount, normaliseAmountInput, toCSV, toText, dayNumber, money, plain, csvCell,
  rangeError, tripDates, tripLength, tripConfigured, shortDate,
  accountStats, balanceIsLow, CURRENCY,
  setEntries: (v) => { entries = v; },
  setTopups: (v) => { topups = v; },
  setSettings: (v) => { settings = v; },
};`;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const T = ctx.__T;

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// Tests that change settings must not leak into the next one.
function checkWithTrip(name, fn) {
  check(name, () => { try { fn(); } finally { T.setSettings(ITALY); } });
}

const ITALY = { tripStart: '2026-08-22', tripEnd: '2026-08-28', accounts: ['Donald', 'Kwan'] };
T.setSettings(ITALY);

console.log('\n── parseAmount ──');
[
  ['12.50', 1250], ['12,50', 1250], ['1234.56', 123456], ['1,234.56', 123456],
  ['1.234,56', 123456], ['0', 0], ['0.01', 1], ['.5', 50], ['5.', 500],
  ['1.5', 150], ['€12.50', 1250], [' 12.50 ', 1250], ['1234', 123400],
  ['', null], ['abc', null],
  // Regression: a third decimal digit must never be read as thousands
  // grouping. "12.345" once became €12,345.00 — a 1000x error.
  ['12.345', 1234], ['12,345', 1234], ['0.005', 0], ['9.999', 999],
  ['1.2.3', 1230], ['1234.567', 123456],
].forEach(([input, want]) => {
  check(JSON.stringify(input) + ' → ' + want, () =>
    assert.strictEqual(T.parseAmount(input), want));
});

console.log('\n── normaliseAmountInput (typing filter) ──');
[
  ['12.345', '12.34'], ['12.3456', '12.34'], ['12,345', '12,34'],
  ['12.34', '12.34'], ['12', '12'], ['12.', '12.'], ['.5', '.5'],
  ['1,234.56', '1234.56'], ['1.234,56', '1234,56'],
  ['12a.3b4', '12.34'], ['', ''],
].forEach(([input, want]) => {
  check(JSON.stringify(input) + ' → ' + JSON.stringify(want), () =>
    assert.strictEqual(T.normaliseAmountInput(input), want));
});

console.log('\n── rangeError (trip date validation) ──');
check('both missing', () => assert.ok(T.rangeError('', '')));
check('start only', () => assert.ok(T.rangeError('2026-08-22', '')));
check('end before start', () =>
  assert.ok(/before the start/.test(T.rangeError('2026-08-28', '2026-08-22'))));
check('same day is valid', () => assert.strictEqual(T.rangeError('2026-08-22', '2026-08-22'), ''));
check('normal range is valid', () => assert.strictEqual(T.rangeError('2026-08-22', '2026-08-28'), ''));
check('absurdly long range rejected', () =>
  assert.ok(T.rangeError('2026-01-01', '2027-01-01')));

console.log('\n── trip length & days ──');
check('22→28 Aug is 7 days', () => assert.strictEqual(T.tripLength(), 7));
check('tripDates lists 7 ISO dates', () => {
  const d = T.tripDates();
  assert.strictEqual(d.length, 7);
  assert.strictEqual(d[0], '2026-08-22');
  assert.strictEqual(d[6], '2026-08-28');
});
checkWithTrip('single-day trip', () => {
  T.setSettings({ tripStart: '2026-08-22', tripEnd: '2026-08-22', accounts: ['Donald', 'Kwan'] });
  assert.strictEqual(T.tripLength(), 1);
  assert.deepStrictEqual(Array.from(T.tripDates()), ['2026-08-22']);
  T.setSettings(ITALY);
});
checkWithTrip('a range spanning a month boundary', () => {
  T.setSettings({ tripStart: '2026-08-30', tripEnd: '2026-09-02', accounts: ['Donald', 'Kwan'] });
  assert.deepStrictEqual(Array.from(T.tripDates()),
    ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  T.setSettings(ITALY);
});
checkWithTrip('unconfigured trip has no days', () => {
  T.setSettings({ tripStart: '', tripEnd: '', accounts: ['Donald', 'Kwan'] });
  assert.strictEqual(T.tripConfigured(), false);
  assert.deepStrictEqual(Array.from(T.tripDates()), []);
  assert.strictEqual(T.dayNumber('2026-08-24'), null);
  T.setSettings(ITALY);
});

console.log('\n── dayNumber ──');
T.setSettings(ITALY);
check('start = Day 1', () => assert.strictEqual(T.dayNumber('2026-08-22'), 1));
check('mid = Day 3', () => assert.strictEqual(T.dayNumber('2026-08-24'), 3));
check('end = Day 7', () => assert.strictEqual(T.dayNumber('2026-08-28'), 7));
check('before trip = null', () => assert.strictEqual(T.dayNumber('2026-08-21'), null));
check('after trip = null', () => assert.strictEqual(T.dayNumber('2026-08-29'), null));
check('no date = null', () => assert.strictEqual(T.dayNumber(null), null));

console.log('\n── shortDate ──');
check('2026-08-24 → 24/8', () => assert.strictEqual(T.shortDate('2026-08-24'), '24/8'));
check('2026-09-02 → 2/9', () => assert.strictEqual(T.shortDate('2026-09-02'), '2/9'));

console.log('\n── money ──');
check('1250 → €12.50', () => assert.strictEqual(T.money(1250), '€12.50'));
check('0 → €0.00', () => assert.strictEqual(T.money(0), '€0.00'));
check('123456 → €1,234.56', () => assert.strictEqual(T.money(123456), '€1,234.56'));
check('negative shows a minus before the symbol', () =>
  assert.strictEqual(T.money(-4550), '-€45.50'));

console.log('\n── budgets ──');
const mkEntry = (account, amountMinor, date) => ({
  id: 'e' + amountMinor + account, date: date || '2026-08-22', amountMinor: amountMinor,
  currency: 'EUR', account: account, payment: 'Cash', category: 'Food',
  description: '', remarks: '', createdAt: '2026-08-22T10:00:00Z',
});
const mkTop = (account, amountMinor) => ({
  id: 't' + amountMinor + account, date: '2026-08-22', amountMinor: amountMinor,
  currency: 'EUR', account: account, createdAt: '2026-08-22T09:00:00Z',
});

check('top-ups minus spend is what is left', () => {
  T.setTopups([mkTop('Donald', 50000)]);
  T.setEntries([mkEntry('Donald', 12345)]);
  const st = T.accountStats('Donald');
  assert.strictEqual(st.toppedUp, 50000);
  assert.strictEqual(st.spent, 12345);
  assert.strictEqual(st.left, 37655);
});
check("one account's spend does not touch the other", () => {
  T.setTopups([mkTop('Donald', 50000), mkTop('Kwan', 20000)]);
  T.setEntries([mkEntry('Donald', 12345), mkEntry('Kwan', 5000)]);
  assert.strictEqual(T.accountStats('Kwan').left, 15000);
  assert.strictEqual(T.accountStats('Donald').left, 37655);
});
check('top-ups accumulate — the first one is just the initial budget', () => {
  T.setTopups([mkTop('Donald', 50000), { ...mkTop('Donald', 20000), id: 't2' }]);
  T.setEntries([]);
  assert.strictEqual(T.accountStats('Donald').toppedUp, 70000);
});

console.log('\n── low balance colour rule ──');
check('over €100 left → not low', () => {
  T.setTopups([mkTop('Donald', 50000)]);
  T.setEntries([mkEntry('Donald', 10000)]);
  assert.strictEqual(T.balanceIsLow(T.accountStats('Donald')), false);
});
check('under €100 left → low', () => {
  T.setTopups([mkTop('Donald', 50000)]);
  T.setEntries([mkEntry('Donald', 40500)]);
  assert.strictEqual(T.balanceIsLow(T.accountStats('Donald')), true);
});
check('exactly €100 left → not low', () => {
  T.setTopups([mkTop('Donald', 50000)]);
  T.setEntries([mkEntry('Donald', 40000)]);
  assert.strictEqual(T.balanceIsLow(T.accountStats('Donald')), false);
});
check('nothing deducted yet → not low even on a small budget', () => {
  T.setTopups([mkTop('Donald', 5000)]);
  T.setEntries([]);
  assert.strictEqual(T.balanceIsLow(T.accountStats('Donald')), false);
});
check('overspent → low', () => {
  T.setTopups([mkTop('Donald', 5000)]);
  T.setEntries([mkEntry('Donald', 9000)]);
  const st = T.accountStats('Donald');
  assert.strictEqual(st.left, -4000);
  assert.strictEqual(T.balanceIsLow(st), true);
});

console.log('\n── CSV ──');
T.setSettings(ITALY);
T.setTopups([mkTop('Donald', 50000)]);
T.setEntries([
  { id: 'a', date: '2026-08-22', amountMinor: 450, currency: 'EUR', account: 'Donald',
    payment: 'Cash', category: 'Food', description: 'Gelato', remarks: '',
    createdAt: '2026-08-22T10:00:00Z' },
  { id: 'b', date: '2026-08-22', amountMinor: 123456, currency: 'EUR', account: 'Kwan',
    payment: 'Global Money', category: 'Shopping', description: 'Bar, "Sport"',
    remarks: 'two of them\nsecond line', createdAt: '2026-08-22T11:00:00Z' },
  { id: 'c', date: '2026-08-23', amountMinor: 900, currency: 'EUR', account: 'Donald',
    payment: 'Credit Card', category: 'Transportation', description: '', remarks: '',
    createdAt: '2026-08-23T09:00:00Z' },
]);
const csv = T.toCSV();
const lines = csv.split('\r\n');

check('starts with UTF-8 BOM', () => assert.strictEqual(csv.charCodeAt(0), 0xFEFF));
check('header exact', () => assert.strictEqual(lines[0].slice(1),
  'Account,Date,Payment,Description,EUR,Category,Remarks'));
check('plain row', () => assert.strictEqual(lines[1],
  'Donald,2026-08-22,Cash,Gelato,4.50,Food,'));
check('quotes + comma escaped', () => assert.ok(lines[2].includes('"Bar, ""Sport"""')));
check('newline in remarks quoted', () => assert.ok(csv.includes('"two of them\nsecond line"')));
check('amount 123456 → 1234.56 with no separator', () => assert.ok(lines[2].includes(',1234.56,')));
check('sorted by date then createdAt', () => {
  const dates = lines.slice(1).filter(Boolean).map((l) => l.split(',')[1]);
  assert.deepStrictEqual(dates.slice(0, 2), ['2026-08-22', '2026-08-22']);
  assert.strictEqual(dates[dates.length - 1], '2026-08-23');
});
check('empty description stays empty', () => assert.ok(
  lines.some((l) => l.startsWith('Donald,2026-08-23,Credit Card,,9.00,Transportation,'))));
check('top-ups are NOT in the CSV', () => {
  assert.strictEqual(lines.filter(Boolean).length, 4);        // header + 3 expenses
  assert.ok(!csv.includes('500.00'));
});
check('trailing CRLF', () => assert.ok(csv.endsWith('\r\n')));

console.log('\n── text summary ──');
const txt = T.toText();
check('header line', () => assert.ok(txt.startsWith('Trip Spend · 2026-08-22 → 2026-08-28')));
check('total excludes top-ups', () => assert.ok(txt.includes('Total €1,248.06 · 3 entries')));
check('Day 1 subtotal', () => assert.ok(txt.includes('Day 1 · 22/8 · €1,239.06')));
check('Day 2 subtotal', () => assert.ok(txt.includes('Day 2 · 23/8 · €9.00')));
check('category breakdown sorted desc', () =>
  assert.ok(txt.includes('  Shopping €1,234.56 · Food €4.50')));
check('budget section present when top-ups exist', () => {
  assert.ok(txt.includes('Budget left'));
  assert.ok(txt.includes('Donald €486.50'));
});

console.log('\n── entries outside the trip range ──');
T.setTopups([]);
T.setEntries([{ id: 'x', date: '2026-07-01', amountMinor: 100, account: 'Donald',
  payment: 'Cash', category: 'Food', description: '', remarks: '',
  createdAt: '2026-07-01T00:00:00Z' }]);
check('kept, but shown without a Day label', () => {
  const t = T.toText();
  assert.ok(t.includes('2026-07-01 · €1.00'), t);
  assert.ok(!t.includes('Day '), 'should not label a Day');
});

console.log('\n── stylesheet is parseable ──');
// A stray closing brace at top level makes the CSS parser skip the rule that
// follows it. That silently killed the date strip's flex container once, and
// no behavioural test noticed.
check('braces balance, with no stray closer', () => {
  const css = fs.readFileSync('styles.css', 'utf8');
  let depth = 0, line = 1;
  const strays = [];
  for (const ch of css) {
    if (ch === '\n') line++;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) { strays.push(line); depth = 0; }
    }
  }
  assert.deepStrictEqual(strays, [], 'stray } on line(s) ' + strays.join(', '));
  assert.strictEqual(depth, 0, depth + ' unclosed block(s)');
});
check('every rule the layout depends on survives parsing', () => {
  const css = fs.readFileSync('styles.css', 'utf8');
  ['.date-strip', '.date-chip', '.budget-card', '.state-line', '.toast', '.bar-fill']
    .forEach((sel) => assert.ok(css.includes(sel + ' {') || css.includes(sel + ','),
      'missing rule for ' + sel));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
