'use strict';

/* Trip Spend — offline expense tracker.
   Trip dates and account names live in Settings; the currency is fixed per
   build. See PLAN.md for the decisions behind all of this. */

const CURRENCY = { code: 'EUR', symbol: '€' };
const SCHEMA_VERSION = 2;
const LOW_BALANCE_MINOR = 10000;   // under €100 left shows red
const MAX_TRIP_DAYS = 120;

const CATEGORIES = [
  { key: 'Transportation', ico: '🚆' },
  { key: 'Food',           ico: '🍝' },
  { key: 'Household',      ico: '🏠' },
  { key: 'Entertainment',  ico: '🎫' },
  { key: 'Shopping',       ico: '🛍' },
  { key: 'Kids',           ico: '🧸' },
];
const PAYMENTS = ['Global Money', 'Cash', 'Credit Card'];

// One fixed colour slot per category, in category order, so a filter or a
// re-sort never repaints a series. Light/dark steps come from the data-viz
// reference palette and were run through its validator.
const CATEGORY_COLORS = {
  Transportation: { light: '#2a78d6', dark: '#3987e5' },
  Food:           { light: '#eb6834', dark: '#d95926' },
  Household:      { light: '#1baf7a', dark: '#199e70' },
  Entertainment:  { light: '#eda100', dark: '#c98500' },
  Shopping:       { light: '#e87ba4', dark: '#d55181' },
  Kids:           { light: '#008300', dark: '#008300' },
};

const K = {
  entries:  'tripspend.entries.v1',
  topups:   'tripspend.topups.v1',
  settings: 'tripspend.settings.v1',
  sticky:   'tripspend.sticky.v1',
  backup:   'tripspend.lastBackup.v1',
  banner:   'tripspend.bannerDismissed.v1',
};

const $ = (sel) => document.querySelector(sel);

/* ── storage ────────────────────────────────────────────── */

function readKey(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeKey(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    toast('Could not save — storage full? Export a backup now.', 'error');
    return false;
  }
}

let entries = readKey(K.entries, []);
if (!Array.isArray(entries)) entries = [];

let topups = readKey(K.topups, []);
if (!Array.isArray(topups)) topups = [];

let settings = normaliseSettings(readKey(K.settings, null));

let sticky = readKey(K.sticky, {});
if (!sticky || typeof sticky !== 'object') sticky = {};

let selectedDate = null;
let editingId = null;
let editingTopupId = null;
let mode = 'expense';          // 'expense' | 'topup'

const TOPUP_KEY = '__topup';

const saveEntries = () => writeKey(K.entries, entries);
const saveTopups = () => writeKey(K.topups, topups);
const saveSettings = () => writeKey(K.settings, settings);

function normaliseSettings(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const accounts = Array.isArray(s.accounts) ? s.accounts.slice(0, 2) : [];
  while (accounts.length < 2) accounts.push('');
  return {
    tripStart: typeof s.tripStart === 'string' ? s.tripStart : '',
    tripEnd: typeof s.tripEnd === 'string' ? s.tripEnd : '',
    accounts: accounts.map((a) => String(a == null ? '' : a).trim()),
  };
}

// Naming accounts is optional. With none named — or only one — everything
// lives in a single pot and account names vanish from the rest of the app.
function activeAccounts() {
  const named = settings.accounts.filter(Boolean);
  return named.length ? named : [''];
}

const multiAccount = () => activeAccounts().length > 1;

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* ── dates ──────────────────────────────────────────────── */

const pad2 = (n) => String(n).padStart(2, '0');

function localDate(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

const asUTC = (iso) => Date.parse(iso + 'T00:00:00Z');
const daysBetween = (a, b) => Math.round((asUTC(b) - asUTC(a)) / 86400000);

// Why a range can't be used, or '' when it is fine.
function rangeError(start, end) {
  if (!start || !end) return 'Pick both a start and an end date.';
  if (isNaN(asUTC(start)) || isNaN(asUTC(end))) return 'Those dates are not valid.';
  if (asUTC(end) < asUTC(start)) return 'The end date is before the start date.';
  const span = daysBetween(start, end) + 1;
  if (span > MAX_TRIP_DAYS) return 'That is ' + span + ' days — longer than this app is meant for.';
  return '';
}

const tripConfigured = () => !rangeError(settings.tripStart, settings.tripEnd);
const tripLength = () => (tripConfigured() ? daysBetween(settings.tripStart, settings.tripEnd) + 1 : 0);

function tripDates() {
  if (!tripConfigured()) return [];
  const out = [];
  for (let i = 0; i < tripLength(); i++) {
    const d = new Date(asUTC(settings.tripStart) + i * 86400000);
    out.push(d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()));
  }
  return out;
}

// 1-based day index inside the trip, or null when the date falls outside it.
function dayNumber(iso) {
  if (!tripConfigured() || !iso) return null;
  const t = asUTC(iso);
  if (isNaN(t) || t < asUTC(settings.tripStart) || t > asUTC(settings.tripEnd)) return null;
  return daysBetween(settings.tripStart, iso) + 1;
}

// "2026-08-24" → "24/8", matching how the trip is written down day to day.
function shortDate(iso) {
  const p = String(iso).split('-');
  return p.length === 3 ? Number(p[2]) + '/' + Number(p[1]) : iso;
}

/* ── money ──────────────────────────────────────────────── */

// Splits an amount string into integer and fraction digits.
// Rule: the LAST separator is the decimal point, anything before it is
// thousands grouping, and at most two fraction digits count. Guessing that
// "12.345" meant thousands is what once turned €12.34 into €12,345.00.
function splitAmount(raw) {
  const s = String(raw == null ? '' : raw).replace(/[^\d.,]/g, '');
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep < 0) return { int: s, frac: '', sep: '' };
  return {
    int: s.slice(0, lastSep).replace(/[.,]/g, ''),
    frac: s.slice(lastSep + 1).replace(/[.,]/g, '').slice(0, 2),
    sep: s[lastSep],
  };
}

// What an amount field is allowed to contain — applied on every keystroke so
// a third decimal digit simply never appears.
function normaliseAmountInput(raw) {
  const p = splitAmount(raw);
  return p.sep ? p.int + p.sep + p.frac : p.int;
}

function parseAmount(raw) {
  if (raw == null) return null;
  const p = splitAmount(raw);
  if (p.int === '' && p.frac === '') return null;
  const minor = parseInt(p.int || '0', 10) * 100 + parseInt((p.frac + '00').slice(0, 2), 10);
  return Number.isFinite(minor) ? minor : null;
}

const plain = (m) => (m / 100).toFixed(2);
const money = (m) => (m < 0 ? '-' : '') + CURRENCY.symbol +
  (Math.abs(m) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sum = (list) => list.reduce((t, e) => t + e.amountMinor, 0);
const catOf = (key) => CATEGORIES.find((c) => c.key === key);

const sortedAsc = () => entries.slice().sort((a, b) =>
  a.date === b.date ? String(a.createdAt).localeCompare(String(b.createdAt))
                    : a.date.localeCompare(b.date));

function datesOf(list) {
  const seen = [];
  list.forEach((e) => { if (seen.indexOf(e.date) < 0) seen.push(e.date); });
  return seen;
}

/* ── budgets ────────────────────────────────────────────── */

function accountStats(name) {
  const mine = (r) => (multiAccount() ? r.account === name : true);
  const toppedUp = sum(topups.filter(mine));
  const spent = sum(entries.filter(mine));
  return { toppedUp: toppedUp, spent: spent, left: toppedUp - spent, hasSpend: spent > 0 };
}

// Green until money has actually been deducted and the balance drops
// under €100; red from there.
const balanceIsLow = (st) => st.hasSpend && st.left < LOW_BALANCE_MINOR;

/* ── chip groups ────────────────────────────────────────── */

function buildChips(host, items, opts) {
  opts = opts || {};
  host.innerHTML = '';
  items.forEach((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.value = item.key;
    b.setAttribute('aria-pressed', 'false');
    if (item.wide) b.classList.add('chip-wide');
    if (item.ico) {
      const i = document.createElement('span');
      i.className = 'ico';
      i.textContent = item.ico;
      const n = document.createElement('span');
      n.textContent = item.label || item.key;
      b.appendChild(i);
      b.appendChild(n);
    } else {
      b.textContent = item.key;
    }
    b.addEventListener('click', () => {
      setChip(host, item.key);
      // iOS gives the decimal keypad no "done" key, so dismiss it whenever
      // the user leaves an amount to touch a chip.
      if (document.activeElement && document.activeElement.inputMode === 'decimal') {
        document.activeElement.blur();
      }
      if (opts.onPick) opts.onPick(item.key);
    });
    host.appendChild(b);
  });
}

function setChip(host, value) {
  host.querySelectorAll('.chip').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.value === value));
  });
}

const getChip = (host) => {
  const el = host.querySelector('.chip[aria-pressed="true"]');
  return el ? el.dataset.value : null;
};

/* ── views ──────────────────────────────────────────────── */

const VIEWS = ['add', 'list', 'stats', 'export', 'settings'];

const TRIP_ONLY_VIEWS = ['list', 'stats', 'export'];

function updateTabVisibility() {
  const ok = tripConfigured();
  TRIP_ONLY_VIEWS.forEach((v) => {
    const tab = document.querySelector('.tab[data-view="' + v + '"]');
    if (tab) tab.hidden = !ok;
  });
}

function switchView(name) {
  // Without a trip range there is nowhere useful to go but Settings, and
  // bouncing the user to a dead Expense screen only makes them tap back.
  if (!tripConfigured() && name !== 'settings') {
    if (name === 'add') toast('Set your trip dates in Settings first', 'warn');
    name = 'settings';
  }
  VIEWS.forEach((v) => { $('#view-' + v).hidden = (v !== name); });
  document.querySelectorAll('.tab').forEach((t) => {
    t.setAttribute('aria-selected', String(t.dataset.view === name));
  });
  if (name === 'add') renderAdd();
  if (name === 'list') renderList();
  if (name === 'stats') renderStats();
  if (name === 'export') renderExport();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

/* ── add / edit ─────────────────────────────────────────── */

function renderAdd() {
  $('#field-account').hidden = !multiAccount();
  renderDateStrip();
}

function renderDateStrip() {
  const host = $('#date-strip');
  host.innerHTML = '';

  // Shortcut to the current day, always available: bookings paid before the
  // trip and top-ups done ahead of departure both need a date outside the
  // strip's range.
  const today = localDate();
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'date-chip date-chip-today';
  jump.id = 'date-today';
  jump.textContent = 'Today';
  jump.setAttribute('aria-pressed', String(selectedDate === today));
  jump.addEventListener('click', () => { selectDate(today); scrollSelectedIntoView(); });
  host.appendChild(jump);

  tripDates().forEach((iso) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'date-chip';
    b.dataset.value = iso;
    b.textContent = shortDate(iso);
    b.setAttribute('aria-pressed', String(iso === selectedDate));
    b.addEventListener('click', () => selectDate(iso));
    host.appendChild(b);
  });
  updateDayBadge();
  scrollSelectedIntoView();
}

function selectDate(iso) {
  selectedDate = iso;
  const today = localDate();
  $('#date-strip').querySelectorAll('.date-chip').forEach((b) => {
    const on = b.id === 'date-today' ? (iso === today) : (b.dataset.value === iso);
    b.setAttribute('aria-pressed', String(on));
  });
  updateDayBadge();
}

function updateDayBadge() {
  if (!selectedDate) { $('#day-badge').textContent = ''; return; }
  const n = dayNumber(selectedDate);
  $('#day-badge').textContent = n ? 'Day ' + n : shortDate(selectedDate);
}

function scrollSelectedIntoView() {
  const el = $('#date-strip').querySelector('.date-chip[data-value][aria-pressed="true"]');
  if (el && el.scrollIntoView) {
    el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
}

function resetForm() {
  editingId = null;
  editingTopupId = null;
  $('#amount').value = '';
  $('#description').value = '';
  $('#remarks').value = '';
  // Default to today when the trip is running; otherwise leave it unpicked
  // so no Day badge is shown and the choice stays deliberate.
  const today = localDate();
  selectedDate = dayNumber(today) ? today : null;
  setChip($('#cat-grid'), null);
  setChip($('#acct-grid'), sticky.account);
  setChip($('#pay-grid'), sticky.payment);
  setMode('expense');
  $('#submit-btn').textContent = 'Save';
  $('#delete-btn').hidden = true;
  $('#cancel-btn').hidden = true;
  $('#add-title').textContent = 'Expense';
  renderAdd();
}

function openEdit(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  editingTopupId = null;
  $('#amount').value = plain(e.amountMinor);
  $('#description').value = e.description || '';
  $('#remarks').value = e.remarks || '';
  selectedDate = e.date;
  setChip($('#cat-grid'), e.category);
  setChip($('#acct-grid'), e.account);
  setChip($('#pay-grid'), e.payment);
  setMode('expense');
  $('#submit-btn').textContent = 'Update';
  $('#delete-btn').hidden = false;
  $('#cancel-btn').hidden = false;
  $('#add-title').textContent = 'Edit';
  switchView('add');
}

function onSubmit(ev) {
  ev.preventDefault();
  if (mode === 'topup') { submitTopup(); return; }

  if (!selectedDate) { toast('Pick a date', 'warn'); return; }

  const amountMinor = parseAmount($('#amount').value);
  if (amountMinor == null) { toast('That amount is not valid', 'error'); $('#amount').focus(); return; }

  const category = getChip($('#cat-grid'));
  if (!category) { toast('Pick a category', 'warn'); return; }

  const account = multiAccount()
    ? (getChip($('#acct-grid')) || activeAccounts()[0])
    : activeAccounts()[0];
  const payment = getChip($('#pay-grid')) || PAYMENTS[0];
  const description = $('#description').value.trim();
  const remarks = $('#remarks').value.trim();
  const now = new Date().toISOString();

  if (editingId) {
    const e = entries.find((x) => x.id === editingId);
    if (e) {
      Object.assign(e, { amountMinor: amountMinor, category: category, date: selectedDate,
                         account: account, payment: payment, description: description,
                         remarks: remarks, updatedAt: now });
    }
    if (!saveEntries()) return;
    resetForm();
    switchView('list');
    toast('Updated');
    return;
  }

  entries.push({
    id: uid(),
    schemaVersion: SCHEMA_VERSION,
    date: selectedDate,
    amountMinor: amountMinor,
    currency: CURRENCY.code,
    account: account,
    payment: payment,
    category: category,
    description: description,
    remarks: remarks,
    createdAt: now,
    updatedAt: now,
  });
  if (!saveEntries()) return;

  sticky = { account: account, payment: payment };
  writeKey(K.sticky, sticky);

  const keepDate = selectedDate;
  resetForm();
  selectDate(keepDate);          // stay on the day you are logging
  scrollSelectedIntoView();
  updateBanner();
  toast('Added ' + money(amountMinor));
  if (navigator.vibrate) navigator.vibrate(12);
}

function onDelete() {
  if (editingTopupId) {
    const t = topups.find((x) => x.id === editingTopupId);
    if (!t) return;
    if (!confirm('Delete the ' + money(t.amountMinor) + ' top-up for ' + t.account + '? No undo.')) return;
    topups = topups.filter((x) => x.id !== editingTopupId);
    saveTopups();
    resetForm();
    switchView('list');
    toast('Top-up deleted');
    return;
  }
  if (!editingId) return;
  if (!confirm('Delete this entry? No undo.')) return;
  entries = entries.filter((x) => x.id !== editingId);
  saveEntries();
  resetForm();
  switchView('list');
  toast('Deleted');
}

/* ── top-ups ────────────────────────────────────────────── */

// A top-up reuses the entry form: same date strip, amount and account, with
// the expense-only fields hidden and the button relabelled.
function setMode(next) {
  mode = next;
  const isTopup = next === 'topup';
  $('#field-payment').hidden = isTopup;
  $('#field-description').hidden = isTopup;
  $('#field-remarks').hidden = isTopup;

  // An existing top-up has no category, and letting the grid switch types
  // mid-edit would turn it into a different record — so hide it outright.
  $('#field-category').hidden = !!editingTopupId;

  // Top Up is a mode switch, not something an existing expense can become.
  const topupChip = $('#cat-grid').querySelector('.chip[data-value="' + TOPUP_KEY + '"]');
  if (topupChip) topupChip.hidden = !!editingId;

  $('#submit-btn').textContent = (editingId || editingTopupId)
    ? 'Update'
    : (isTopup ? 'Confirm' : 'Save');
}

function submitTopup() {
  if (!selectedDate) { toast('Pick a date', 'warn'); return; }
  const amountMinor = parseAmount($('#amount').value);
  if (amountMinor == null || amountMinor <= 0) { toast('That amount is not valid', 'error'); return; }
  const account = multiAccount()
    ? (getChip($('#acct-grid')) || activeAccounts()[0])
    : activeAccounts()[0];

  if (editingTopupId) {
    const t = topups.find((x) => x.id === editingTopupId);
    if (t) {
      Object.assign(t, { amountMinor: amountMinor, account: account, date: selectedDate,
                         updatedAt: new Date().toISOString() });
    }
    if (!saveTopups()) return;
    resetForm();
    switchView('list');
    toast('Top-up updated');
    return;
  }

  topups.push({
    id: uid(),
    schemaVersion: SCHEMA_VERSION,
    date: selectedDate,
    amountMinor: amountMinor,
    currency: CURRENCY.code,
    account: account,
    createdAt: new Date().toISOString(),
  });
  if (!saveTopups()) return;

  sticky.account = account;
  writeKey(K.sticky, sticky);

  const keepDate = selectedDate;
  resetForm();
  selectDate(keepDate);
  toast('Topped up ' + account + ' ' + money(amountMinor));
  if (navigator.vibrate) navigator.vibrate(12);
}

function openEditTopup(id) {
  const t = topups.find((x) => x.id === id);
  if (!t) return;
  editingId = null;
  editingTopupId = id;
  $('#amount').value = plain(t.amountMinor);
  $('#description').value = '';
  $('#remarks').value = '';
  selectedDate = t.date;
  setChip($('#cat-grid'), TOPUP_KEY);
  setChip($('#acct-grid'), t.account);
  setMode('topup');
  $('#delete-btn').hidden = false;
  $('#cancel-btn').hidden = false;
  $('#add-title').textContent = 'Edit top-up';
  switchView('add');
}

/* ── records ────────────────────────────────────────────── */

function renderList() {
  updateBanner();
  $('#sum-left').textContent = money(sum(topups) - sum(entries));
  $('#sum-total').textContent = money(-sum(entries));

  if (!tripConfigured()) {
    $('#sum-day').textContent = 'No trip dates set';
  } else {
    const today = localDate();
    const n = dayNumber(today);
    let where;
    if (n) where = 'Day ' + n + ' of ' + tripLength();
    else if (asUTC(today) < asUTC(settings.tripStart)) {
      where = daysBetween(today, settings.tripStart) + ' days to go';
    } else where = 'Trip finished';
    $('#sum-day').textContent = shortDate(settings.tripStart) + ' → ' +
      shortDate(settings.tripEnd) + ' · ' + tripLength() + ' days · ' + where;
  }

  renderBudgets();
  renderTopupList();
  renderExpenses();
}

function renderBudgets() {
  const host = $('#budget-cards');
  host.innerHTML = '';
  const names = activeAccounts();
  host.classList.toggle('is-single', names.length === 1);
  names.forEach((name) => {
    const st = accountStats(name);
    const card = document.createElement('div');
    card.className = 'budget-card ' + (balanceIsLow(st) ? 'is-low' : 'is-ok');

    const top = document.createElement('div');
    top.className = 'budget-top';
    if (multiAccount()) {
      const who = document.createElement('span');
      who.className = 'budget-name';
      who.textContent = name;
      top.appendChild(who);
    }
    const left = document.createElement('span');
    left.className = 'budget-left';
    left.textContent = money(st.left);
    top.appendChild(left);

    const sub = document.createElement('div');
    sub.className = 'budget-sub';
    [['Topped up', st.toppedUp, false], ['Spent', -st.spent, true]].forEach((pair) => {
      const line = document.createElement('div');
      line.className = 'budget-line';
      const k = document.createElement('span');
      k.textContent = pair[0] + ':';
      const v = document.createElement('span');
      if (pair[2]) v.className = 'is-debit';
      v.textContent = money(pair[1]);
      line.appendChild(k);
      line.appendChild(v);
      sub.appendChild(line);
    });

    card.appendChild(top);
    card.appendChild(sub);
    host.appendChild(card);
  });
}

function renderTopupList() {
  $('#topup-list-wrap').hidden = topups.length === 0;
  $('#topup-total').textContent = '+' + money(sum(topups));
  const host = $('#topup-list');
  host.innerHTML = '';
  topups.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .forEach((t) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';

      const ico = document.createElement('span');
      ico.className = 'row-ico';
      ico.textContent = '💶';

      const main = document.createElement('div');
      main.className = 'row-main';
      const d = document.createElement('div');
      d.className = 'row-desc';
      d.textContent = multiAccount() ? t.account : 'Top-up';
      const s = document.createElement('div');
      s.className = 'row-sub';
      s.textContent = (multiAccount() ? 'Top-up · ' : '') + t.date;
      main.appendChild(d);
      main.appendChild(s);

      const amt = document.createElement('span');
      amt.className = 'row-amt';
      amt.textContent = money(t.amountMinor);

      row.appendChild(ico);
      row.appendChild(main);
      row.appendChild(amt);
      row.addEventListener('click', () => openEditTopup(t.id));
      host.appendChild(row);
    });
}

function renderExpenses() {
  const host = $('#list');
  host.innerHTML = '';

  if (!entries.length) {
    const p = document.createElement('div');
    p.className = 'empty-state';
    p.textContent = 'Nothing logged yet.';
    host.appendChild(p);
    return;
  }

  datesOf(entries).sort().reverse().forEach((date) => {
    const list = entries.filter((e) => e.date === date)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const dn = dayNumber(date);

    const head = document.createElement('div');
    head.className = 'day-head';
    const left = document.createElement('span');
    left.textContent = (dn ? 'Day ' + dn + ' · ' : '') + date;
    const right = document.createElement('span');
    right.className = 'day-total is-debit';
    right.textContent = money(-sum(list));
    head.appendChild(left);
    head.appendChild(right);
    host.appendChild(head);

    list.forEach((e) => {
      const c = catOf(e.category);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';

      const ico = document.createElement('span');
      ico.className = 'row-ico';
      ico.textContent = c ? c.ico : '•';

      const main = document.createElement('div');
      main.className = 'row-main';
      // Description is often blank until the bank statement arrives, so fall
      // back to the remarks. With neither, the category line simply moves up
      // rather than leaving a placeholder behind.
      const label = [e.description, e.remarks].filter(Boolean).join(' | ');
      const meta = [e.category, multiAccount() ? e.account : null, e.payment]
        .filter(Boolean).join(' · ');
      if (label) {
        const d = document.createElement('div');
        d.className = 'row-desc';
        d.textContent = label;
        const sub = document.createElement('div');
        sub.className = 'row-sub';
        sub.textContent = meta;
        main.appendChild(d);
        main.appendChild(sub);
      } else {
        const only = document.createElement('div');
        only.className = 'row-desc row-desc-meta';
        only.textContent = meta;
        main.appendChild(only);
      }

      const amt = document.createElement('span');
      amt.className = 'row-amt';
      amt.textContent = money(e.amountMinor);

      row.appendChild(ico);
      row.appendChild(main);
      row.appendChild(amt);
      row.addEventListener('click', () => openEdit(e.id));
      host.appendChild(row);
    });
  });
}

/* ── statistics ─────────────────────────────────────────── */

function categoryTotals() {
  const totals = CATEGORIES.map((c) => ({
    key: c.key,
    ico: c.ico,
    amount: sum(entries.filter((e) => e.category === c.key)),
  })).filter((r) => r.amount > 0);
  const total = totals.reduce((t, r) => t + r.amount, 0);
  totals.forEach((r) => { r.pct = total ? (r.amount / total) * 100 : 0; });
  return { rows: totals.slice().sort((a, b) => b.amount - a.amount), total: total };
}

const cssVar = (name) => getComputedStyle(document.documentElement)
  .getPropertyValue(name).trim();

function categoryColor(key) {
  const pair = CATEGORY_COLORS[key];
  if (!pair) return cssVar('--muted');
  return document.body.dataset.mode === 'dark' ? pair.dark : pair.light;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Horizontal bars: the form that actually answers "which category cost most".
function buildBars(data) {
  const wrap = el('div', 'viz-block');
  wrap.appendChild(el('h3', 'viz-title', 'By category'));
  const max = data.rows[0] ? data.rows[0].amount : 1;

  data.rows.forEach((r) => {
    const row = el('div', 'bar-row');
    const head = el('div', 'bar-head');
    head.appendChild(el('span', 'bar-name', r.ico + '  ' + r.key));
    head.appendChild(el('span', 'bar-value', money(r.amount) + '  ·  ' + r.pct.toFixed(0) + '%'));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = Math.max(2, (r.amount / max) * 100) + '%';
    fill.style.background = categoryColor(r.key);
    track.appendChild(fill);
    row.appendChild(head);
    row.appendChild(track);
    wrap.appendChild(row);
  });
  return wrap;
}

function renderStats() {
  const body = $('#stats-body');
  body.innerHTML = '';
  const data = categoryTotals();

  if (!data.rows.length) {
    body.appendChild(el('div', 'empty-state', 'Nothing logged yet.'));
    return;
  }

  const head = el('div', 'stats-head');
  head.appendChild(el('div', 'stats-total', money(data.total)));
  head.appendChild(el('div', 'stats-label', 'total spend'));
  body.appendChild(head);
  body.appendChild(buildBars(data));
}

/* ── settings ───────────────────────────────────────────── */

function renderSettings() {
  $('#set-start').value = settings.tripStart;
  $('#set-end').value = settings.tripEnd;
  $('#set-acct-0').value = settings.accounts[0];
  $('#set-acct-1').value = settings.accounts[1];
  // Nothing but the dates until a trip exists — the rest has no meaning yet.
  const ok = tripConfigured();
  $('#accounts-card').hidden = !ok;
  $('#reset-card').hidden = !ok;
  $('#reset-confirm').value = '';
  $('#reset-settings').disabled = true;
  updateRangeState();
  updateAccountsState();
}

function updateRangeState() {
  const el = $('#range-state');
  const err = rangeError($('#set-start').value, $('#set-end').value);
  if (err) {
    setStateLine(el, 'warn', err);
  } else {
    const start = $('#set-start').value;
    const end = $('#set-end').value;
    const n = daysBetween(start, end) + 1;
    setStateLine(el, 'success', shortDate(start) + ' → ' + shortDate(end) + ' · ' + n +
      (n === 1 ? ' day' : ' days'));
  }
  return err;
}

// Names are optional; only a genuine clash is an error.
function accountsError(names) {
  const named = names.filter(Boolean);
  if (named.length === 2 && named[0] === named[1]) {
    return 'The two accounts need different names.';
  }
  return '';
}

function updateAccountsState() {
  const err = accountsError(accountFieldValues());
  const el = $('#accounts-state');
  el.hidden = !err;
  if (err) setStateLine(el, 'warn', err);
  return err;
}

const accountFieldValues = () => [$('#set-acct-0').value.trim(), $('#set-acct-1').value.trim()];

function applyAccountRename(next) {
  // Only a rename migrates records. Clearing a name is not a rename — those
  // records keep their label and simply fold into the single pot.
  const rename = {};
  settings.accounts.forEach((old, i) => {
    if (old && next[i] && old !== next[i]) rename[old] = next[i];
  });
  if (!Object.keys(rename).length) return false;

  entries.forEach((e) => { if (rename[e.account]) e.account = rename[e.account]; });
  topups.forEach((t) => { if (rename[t.account]) t.account = rename[t.account]; });
  if (rename[sticky.account]) sticky.account = rename[sticky.account];
  saveEntries();
  saveTopups();
  writeKey(K.sticky, sticky);
  return true;
}

// One Save for the whole screen. Both kinds of problem are already spelled
// out inline as you type, so a failed save stays silent rather than
// repeating the same sentence in a toast.
function saveAllSettings() {
  if (updateRangeState() || updateAccountsState()) return;

  const names = accountFieldValues();
  const renamed = applyAccountRename(names);
  settings.accounts = names;
  settings.tripStart = $('#set-start').value;
  settings.tripEnd = $('#set-end').value;
  if (!saveSettings()) return;

  buildChips($('#acct-grid'), activeAccounts().map((k) => ({ key: k })));
  if (activeAccounts().indexOf(sticky.account) < 0) {
    sticky.account = activeAccounts()[0];
    writeKey(K.sticky, sticky);
  }
  updateTabVisibility();

  // Entries logged outside the new range stay put, but they lose their Day
  // label — say so rather than letting it look like data went missing.
  const orphans = entries.filter((e) => !dayNumber(e.date)).length;
  const warn = $('#range-warning');
  warn.hidden = orphans === 0;
  if (orphans) {
    warn.textContent = orphans + (orphans === 1 ? ' entry falls' : ' entries fall') +
      ' outside this range. They are kept, but shown without a Day number.';
  }

  resetForm();
  renderSettings();   // first save unlocks the Accounts card and Reset
  toast('Saved');
}

function resetSettings() {
  if ($('#reset-confirm').value.trim().toUpperCase() !== 'RESET') return;
  if (!confirm('Reset everything?\n\nThis erases all ' + entries.length + ' entries and ' +
               topups.length + ' top-ups, along with the trip dates and account names. ' +
               'No undo.')) return;

  entries = [];
  topups = [];
  settings = normaliseSettings(null);
  sticky = { account: '', payment: PAYMENTS[0] };
  saveEntries();
  saveTopups();
  if (!saveSettings()) return;
  writeKey(K.sticky, sticky);
  writeKey(K.backup, null);
  writeKey(K.banner, null);

  buildChips($('#acct-grid'), activeAccounts().map((k) => ({ key: k })));
  updateTabVisibility();
  resetForm();
  renderSettings();
  switchView('settings');
  toast('Everything reset');
}

/* ── exports ────────────────────────────────────────────── */

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV() {
  const head = ['Account', 'Date', 'Payment', 'Description', CURRENCY.code, 'Category', 'Remarks'];
  const rows = sortedAsc().map((e) => [
    e.account, e.date, e.payment, e.description,
    plain(e.amountMinor), e.category, e.remarks,
  ].map(csvCell).join(','));
  // BOM keeps Excel from mangling non-ASCII text in Description / Remarks.
  return '\uFEFF' + [head.join(',')].concat(rows).join('\r\n') + '\r\n';
}

function toJSON() {
  return JSON.stringify({
    app: 'Trip Spend',
    schemaVersion: SCHEMA_VERSION,
    currency: CURRENCY.code,
    settings: settings,
    exportedAt: new Date().toISOString(),
    entries: sortedAsc(),
    topups: topups,
  }, null, 2);
}

function toText() {
  const out = [];
  const title = tripConfigured()
    ? 'Trip Spend · ' + settings.tripStart + ' → ' + settings.tripEnd
    : 'Trip Spend';
  out.push(title);
  out.push('Total ' + money(sum(entries)) + ' · ' + entries.length + ' entries');
  out.push('');

  datesOf(entries).sort().forEach((date) => {
    const list = entries.filter((e) => e.date === date);
    const dn = dayNumber(date);
    out.push((dn ? 'Day ' + dn + ' · ' + shortDate(date) : date) + ' · ' + money(sum(list)));

    const cats = new Map();
    list.forEach((e) => cats.set(e.category, (cats.get(e.category) || 0) + e.amountMinor));
    out.push('  ' + Array.from(cats.entries()).sort((a, b) => b[1] - a[1])
      .map((p) => p[0] + ' ' + money(p[1])).join(' · '));
  });

  if (topups.length) {
    out.push('');
    out.push('Budget left');
    activeAccounts().forEach((name) => {
      const st = accountStats(name);
      out.push('  ' + (multiAccount() ? name + ' ' : '') + money(st.left) +
        ' (' + money(st.toppedUp) + ' topped up, ' + money(st.spent) + ' spent)');
    });
  }
  return out.join('\n');
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

// Three layers, because iOS standalone mode is unreliable about downloads:
// share sheet → <a download> → raw text the user can select and copy.
async function deliver(filename, mime, text) {
  try {
    const file = new File([text], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return 'downloaded';
  } catch (e) { /* fall through */ }
  showSheet(filename, text);
  return 'sheet';
}

function exportBaseName() {
  return 'trip-spend-' + (settings.tripStart || localDate());
}

async function runExport(kind) {
  if (!entries.length) { toast('Nothing logged yet', 'warn'); return; }

  if (kind === 'text') {
    const text = toText();
    if (await copyText(text)) toast('Summary copied');
    else showSheet('Text summary', text);
    return;
  }

  const isCSV = kind === 'csv';
  const result = await deliver(
    exportBaseName() + (isCSV ? '.csv' : '.json'),
    isCSV ? 'text/csv;charset=utf-8' : 'application/json',
    isCSV ? toCSV() : toJSON()
  );
  if (result === 'shared' || result === 'downloaded') {
    if (!isCSV) markBackedUp();
    toast(isCSV ? 'CSV exported' : 'JSON exported');
  }
}

/* ── backup ─────────────────────────────────────────────── */

function markBackedUp() {
  writeKey(K.backup, new Date().toISOString());
  updateBanner();
}

async function backupNow() {
  if (!entries.length && !topups.length) { toast('Nothing logged yet', 'warn'); return; }
  const text = toJSON();
  if (await copyText(text)) {
    markBackedUp();
    toast('Copied — paste it somewhere safe');
  } else {
    showSheet('JSON backup', text);
  }
}

function updateBanner() {
  const now = new Date();
  const today = localDate(now);
  const last = readKey(K.backup, null);
  const dismissed = readKey(K.banner, null);

  $('#banner').hidden = !(entries.length > 0
    && now.getHours() >= 20
    && dismissed !== today
    && !(last && String(last).slice(0, 10) === today));
}

/* ── import / wipe ──────────────────────────────────────── */

function cleanEntry(e) {
  return {
    id: e.id || uid(),
    schemaVersion: SCHEMA_VERSION,
    date: e.date,
    amountMinor: Math.round(e.amountMinor),
    currency: e.currency || CURRENCY.code,
    account: (!multiAccount() || activeAccounts().indexOf(e.account) >= 0)
      ? (e.account || '') : activeAccounts()[0],
    payment: PAYMENTS.indexOf(e.payment) >= 0 ? e.payment : PAYMENTS[0],
    category: catOf(e.category) ? e.category : CATEGORIES[0].key,
    description: e.description || '',
    remarks: e.remarks || '',
    createdAt: e.createdAt || new Date().toISOString(),
    updatedAt: e.updatedAt || new Date().toISOString(),
  };
}

function runImport() {
  const raw = $('#import-box').value.trim();
  if (!raw) { toast('Paste a backup first', 'warn'); return; }

  let data;
  try { data = JSON.parse(raw); }
  catch (e) { toast('That is not valid JSON', 'error'); return; }

  const incoming = Array.isArray(data) ? data : (data && data.entries);
  if (!Array.isArray(incoming)) { toast('No entries found in that backup', 'error'); return; }

  const valid = (x) => x && typeof x.date === 'string' && Number.isFinite(x.amountMinor);
  const cleanEntries = incoming.filter(valid);
  const cleanTopups = (Array.isArray(data.topups) ? data.topups : []).filter(valid);

  if (!cleanEntries.length && !cleanTopups.length) { toast('That backup has no usable records', 'error'); return; }
  if (!confirm('Import ' + cleanEntries.length + ' entries and ' + cleanTopups.length +
               ' top-ups, replacing everything here?')) return;

  // Settings first, so account names in the backup validate against the
  // accounts the backup itself was written with.
  if (data.settings) {
    settings = normaliseSettings(data.settings);
    saveSettings();
  }

  entries = cleanEntries.map(cleanEntry);
  topups = cleanTopups.map((t) => ({
    id: t.id || uid(),
    schemaVersion: SCHEMA_VERSION,
    date: t.date,
    amountMinor: Math.round(t.amountMinor),
    currency: t.currency || CURRENCY.code,
    account: (!multiAccount() || activeAccounts().indexOf(t.account) >= 0)
      ? (t.account || '') : activeAccounts()[0],
    createdAt: t.createdAt || new Date().toISOString(),
  }));
  saveEntries();
  saveTopups();

  $('#import-box').value = '';
  buildChips($('#acct-grid'), activeAccounts().map((k) => ({ key: k })));
  updateTabVisibility();
  resetForm();
  renderExport();
  toast('Restored ' + entries.length + ' entries');
}

function runWipe() {
  if ($('#wipe-confirm').value.trim().toUpperCase() !== 'DELETE') return;
  if (!confirm('Erase all ' + entries.length + ' entries and ' + topups.length +
               ' top-ups? No undo.')) return;
  entries = [];
  topups = [];
  saveEntries();
  saveTopups();
  $('#wipe-confirm').value = '';
  $('#wipe-btn').disabled = true;
  renderExport();
  toast('Erased');
}

function renderExport() {
  const last = readKey(K.backup, null);
  $('#backup-state').textContent = last
    ? 'Last backup: ' + new Date(last).toLocaleString('en-GB')
    : 'Never backed up';
  $('#trip-label').textContent = (tripConfigured()
    ? settings.tripStart + ' → ' + settings.tripEnd
    : 'no dates set') + ' · ' + entries.length + ' entries';
  document.querySelectorAll('.cur-code').forEach((el) => { el.textContent = CURRENCY.code; });
  updateBanner();
}

/* ── sheet & toast ──────────────────────────────────────── */

function showSheet(title, text) {
  $('#sheet-title').textContent = title;
  $('#sheet-text').value = text;
  $('#sheet').hidden = false;
}

const TOAST_ICON = { success: '✅', warn: '⚠️', error: '⛔' };

// Icon + message, used by toasts and by the inline state lines in Settings.
function fillTinted(el, kind, msg) {
  el.innerHTML = '';
  const ico = document.createElement('span');
  ico.className = 'toast-icon';
  ico.textContent = TOAST_ICON[kind];
  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(ico);
  el.appendChild(text);
}

function setStateLine(el, kind, msg) {
  el.className = 'state-line tint-' + kind;
  fillTinted(el, kind, msg);
}

let toastTimer = null;
// kind: 'success' (default) | 'warn' | 'error'
function toast(msg, kind) {
  const k = TOAST_ICON[kind] ? kind : 'success';
  const el = $('#toast');
  el.className = 'toast tint-' + k;
  fillTinted(el, k, msg);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ── keyboard ───────────────────────────────────────────── */

// Keep the save bar above the software keyboard. The amount sits after the
// category grid, so the keypad is usually the last thing open before saving
// and a fixed bar would otherwise be buried under it.
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const bar = document.querySelector('.actions');
  if (!bar) return;
  const apply = () => {
    const overlap = window.innerHeight - (vv.height + vv.offsetTop);
    bar.style.bottom = overlap > 60 ? overlap + 'px' : '';
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}

function wireAmountField(el) {
  el.addEventListener('input', () => {
    const cleaned = normaliseAmountInput(el.value);
    if (cleaned !== el.value) el.value = cleaned;
  });
}

/* ── wiring ─────────────────────────────────────────────── */

function trackColorScheme() {
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const apply = () => { document.body.dataset.mode = (mq && mq.matches) ? 'dark' : 'light'; };
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  apply();
}

function init() {
  trackColorScheme();
  $('#cur-symbol').textContent = CURRENCY.symbol;

  buildChips($('#cat-grid'), CATEGORIES.concat([
    { key: TOPUP_KEY, ico: '💶', label: 'Top Up', wide: true },
  ]), { onPick: (key) => setMode(key === TOPUP_KEY ? 'topup' : 'expense') });
  buildChips($('#acct-grid'), activeAccounts().map((k) => ({ key: k })));
  buildChips($('#pay-grid'), PAYMENTS.map((k) => ({ key: k })));

  if (activeAccounts().indexOf(sticky.account) < 0) sticky.account = activeAccounts()[0];
  if (PAYMENTS.indexOf(sticky.payment) < 0) sticky.payment = PAYMENTS[0];

  wireAmountField($('#amount'));

  resetForm();

  $('#entry-form').addEventListener('submit', onSubmit);
  $('#delete-btn').addEventListener('click', onDelete);
  $('#cancel-btn').addEventListener('click', () => { resetForm(); switchView('list'); });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => switchView(t.dataset.view));
  });

  $('#set-start').addEventListener('change', updateRangeState);
  $('#set-end').addEventListener('change', updateRangeState);
  $('#set-acct-0').addEventListener('input', updateAccountsState);
  $('#set-acct-1').addEventListener('input', updateAccountsState);
  $('#save-settings').addEventListener('click', saveAllSettings);
  $('#reset-confirm').addEventListener('input', (ev) => {
    $('#reset-settings').disabled = ev.target.value.trim().toUpperCase() !== 'RESET';
  });
  $('#reset-settings').addEventListener('click', resetSettings);

  document.querySelectorAll('[data-export]').forEach((b) => {
    b.addEventListener('click', () => runExport(b.dataset.export));
  });

  $('#backup-now').addEventListener('click', backupNow);
  $('#banner-backup').addEventListener('click', backupNow);
  $('#banner-close').addEventListener('click', () => {
    writeKey(K.banner, localDate());
    updateBanner();
  });

  $('#import-btn').addEventListener('click', runImport);
  $('#wipe-confirm').addEventListener('input', (ev) => {
    $('#wipe-btn').disabled = ev.target.value.trim().toUpperCase() !== 'DELETE';
  });
  $('#wipe-btn').addEventListener('click', runWipe);

  $('#sheet-close').addEventListener('click', () => { $('#sheet').hidden = true; });
  $('#sheet-copy').addEventListener('click', async () => {
    const ok = await copyText($('#sheet-text').value);
    if (ok) toast('Copied');
    else toast('Could not copy — select the text instead', 'error');
  });

  updateTabVisibility();
  switchView(tripConfigured() ? 'add' : 'settings');
  updateBanner();
  trackKeyboard();

  // The date rolls over and the 20:00 banner needs re-checking after a long
  // backgrounding, so re-evaluate whenever the app comes back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (!editingId && !editingTopupId && !$('#view-add').hidden) {
        const today = localDate();
        if (dayNumber(today) && selectedDate !== today && !$('#amount').value) selectDate(today);
      }
      updateBanner();
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

init();
