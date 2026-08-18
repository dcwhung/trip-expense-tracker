const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function el() {
  const e = {
    children: [], dataset: {}, style: {}, hidden: false, value: '',
    textContent: '', innerHTML: '', disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, focus() {}, blur() {}, click() {},
    select() {}, setSelectionRange() {},
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
  setTimeout, clearTimeout, URL, Blob: class {}, File: class {},
  confirm: () => true,
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.window.crypto = { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) };
ctx.window.addEventListener = () => {};
ctx.window.scrollTo = () => {};

const src = fs.readFileSync('app.js', 'utf8') + `
globalThis.__T = {
  parseAmount, normaliseAmountInput, toCSV, toText, dayNumber, money, plain, csvCell, TRIP, TRIP_DAYS,
  setEntries: (v) => { entries = v; },
};`;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const T = ctx.__T;

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('\n── parseAmount ──');
const cases = [
  ['12.50', 1250], ['12,50', 1250], ['1234.56', 123456], ['1,234.56', 123456],
  ['1.234,56', 123456], ['0', 0], ['0.01', 1], ['.5', 50], ['5.', 500],
  ['1.5', 150], ['€12.50', 1250], [' 12.50 ', 1250], ['1234', 123400],
  ['', null], ['abc', null],
  // Regression: a third decimal digit must never be read as thousands
  // grouping. "12.345" once became €12,345.00 — a 1000x error.
  ['12.345', 1234], ['12,345', 1234], ['0.005', 0], ['9.999', 999],
  ['1.2.3', 1230], ['1234.567', 123456],
];
cases.forEach(([input, want]) => {
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

console.log('\n── dayNumber ──');
check('start = Day 1', () => assert.strictEqual(T.dayNumber('2026-08-22'), 1));
check('end = Day 7', () => assert.strictEqual(T.dayNumber('2026-08-28'), 7));
check('mid = Day 3', () => assert.strictEqual(T.dayNumber('2026-08-24'), 3));
check('before trip = null', () => assert.strictEqual(T.dayNumber('2026-08-21'), null));
check('after trip = null', () => assert.strictEqual(T.dayNumber('2026-08-29'), null));
check('TRIP_DAYS = 7', () => assert.strictEqual(T.TRIP_DAYS, 7));

console.log('\n── money ──');
check('1250 → €12.50', () => assert.strictEqual(T.money(1250), '€12.50'));
check('0 → €0.00', () => assert.strictEqual(T.money(0), '€0.00'));
check('123456 → €1,234.56', () => assert.strictEqual(T.money(123456), '€1,234.56'));
check('plain(123456) = 1234.56', () => assert.strictEqual(T.plain(123456), '1234.56'));

console.log('\n── CSV ──');
T.setEntries([
  { id: 'a', date: '2026-08-22', amountMinor: 450, currency: 'EUR', account: 'Donald',
    payment: 'Cash', category: 'Food', description: 'Gelato', remarks: '',
    createdAt: '2026-08-22T10:00:00Z' },
  { id: 'b', date: '2026-08-22', amountMinor: 123456, currency: 'EUR', account: 'Kwan',
    payment: 'Global Money', category: 'Shopping', description: 'Bar, "Sport"',
    remarks: '兩件\n第二行', createdAt: '2026-08-22T11:00:00Z' },
  { id: 'c', date: '2026-08-23', amountMinor: 900, currency: 'EUR', account: 'Donald',
    payment: 'Credit Card', category: 'Transportation', description: '', remarks: '',
    createdAt: '2026-08-23T09:00:00Z' },
]);
const csv = T.toCSV();
const lines = csv.split('\r\n');

check('starts with UTF-8 BOM', () => assert.strictEqual(csv.charCodeAt(0), 0xFEFF));
check('header exact', () => assert.strictEqual(lines[0],
  '﻿Account,Date,Payment,Description,EUR,Category,Remarks'));
check('plain row', () => assert.strictEqual(lines[1],
  'Donald,2026-08-22,Cash,Gelato,4.50,Food,'));
check('quotes + comma escaped', () => assert.ok(lines[2].includes('"Bar, ""Sport"""')));
check('newline in remarks quoted', () => assert.ok(csv.includes('"兩件\n第二行"')));
check('amount 123456 → 1234.56 (no separator)', () => assert.ok(lines[2].includes(',1234.56,')));
check('sorted by date then createdAt', () => {
  const dates = lines.slice(1).filter(Boolean).map((l) => l.split(',')[1]);
  assert.deepStrictEqual(dates.slice(0, 2), ['2026-08-22', '2026-08-22']);
  assert.strictEqual(dates[dates.length - 1], '2026-08-23');
});
check('empty description stays empty', () => assert.ok(
  lines.some((l) => l.startsWith('Donald,2026-08-23,Credit Card,,9.00,Transportation,'))));
check('trailing CRLF', () => assert.ok(csv.endsWith('\r\n')));

console.log('\n── text summary ──');
const txt = T.toText();
check('header line', () => assert.ok(txt.startsWith('Trip Spend · Italy 2026-08-22 → 08-28')));
check('total line', () => assert.ok(txt.includes('總計 €1,248.06 · 3 筆')));
check('Day 1 subtotal', () => assert.ok(txt.includes('Day 1 · 08-22 · €1,239.06')));
check('Day 2 subtotal', () => assert.ok(txt.includes('Day 2 · 08-23 · €9.00')));
check('category breakdown sorted desc', () => assert.ok(txt.includes('  Shopping €1,234.56 · Food €4.50')));

console.log('\n── out-of-range date ──');
T.setEntries([{ id: 'x', date: '2026-07-01', amountMinor: 100, account: 'Donald',
  payment: 'Cash', category: 'Food', description: '', remarks: '',
  createdAt: '2026-07-01T00:00:00Z' }]);
check('no Day label outside trip', () => {
  const t = T.toText();
  assert.ok(t.includes('2026-07-01 · €1.00'), t);
  assert.ok(!t.includes('Day '), 'should not label a Day');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
