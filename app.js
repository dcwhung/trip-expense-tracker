'use strict';

/* ─────────────────────────────────────────────────────────
   Trip configuration.
   Next trip: change these constants, push, done — the PWA
   picks up the new version on its own. See PLAN.md §8.5.
   ───────────────────────────────────────────────────────── */
const TRIP = {
  id: 'italy-2026-08',
  name: 'Italy',
  start: '2026-08-22',
  end: '2026-08-28',
  currency: 'EUR',
  symbol: '€',
};
const SCHEMA_VERSION = 1;

const CATEGORIES = [
  { key: 'Transportation', ico: '🚆', zh: '交通' },
  { key: 'Food',           ico: '🍝', zh: '飲食' },
  { key: 'Household',      ico: '🏠', zh: '家用' },
  { key: 'Entertainment',  ico: '🎫', zh: '娛樂' },
  { key: 'Shopping',       ico: '🛍', zh: '購物' },
  { key: 'Kids',           ico: '🧸', zh: '小朋友' },
];
const ACCOUNTS = ['Donald', 'Kwan'];
const PAYMENTS = ['Global Money', 'Cash', 'Credit Card'];

const K = {
  entries: 'tripspend.entries.v1',
  sticky:  'tripspend.sticky.v1',
  backup:  'tripspend.lastBackup.v1',
  banner:  'tripspend.bannerDismissed.v1',
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
    toast('儲存唔到 — 儲存空間滿咗？即刻 export 備份！');
    return false;
  }
}

let entries = readKey(K.entries, []);
if (!Array.isArray(entries)) entries = [];

let sticky = readKey(K.sticky, {});
if (!sticky || typeof sticky !== 'object') sticky = {};
if (ACCOUNTS.indexOf(sticky.account) < 0) sticky.account = ACCOUNTS[0];
if (PAYMENTS.indexOf(sticky.payment) < 0) sticky.payment = PAYMENTS[0];

let editingId = null;

const saveEntries = () => writeKey(K.entries, entries);

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
const TRIP_DAYS = Math.round((asUTC(TRIP.end) - asUTC(TRIP.start)) / 86400000) + 1;

// 1-based day index inside the trip, or null when the date falls outside it.
function dayNumber(iso) {
  const t = asUTC(iso);
  if (isNaN(t) || t < asUTC(TRIP.start) || t > asUTC(TRIP.end)) return null;
  return Math.round((t - asUTC(TRIP.start)) / 86400000) + 1;
}

/* ── money ──────────────────────────────────────────────── */

// Returns integer minor units, or null when the text is not a usable amount.
// Accepts "12.50", "12,50", "1,234.56", "1.234,56" — iOS shows whichever
// decimal separator the phone's locale uses, so both must work.
function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\s €£$]/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let sep = null;
  if (lastComma > -1 && lastDot > -1) {
    sep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma > -1) {
    const after = s.length - lastComma - 1;
    if (s.indexOf(',') === lastComma && after > 0 && after <= 2) sep = ',';
  } else if (lastDot > -1) {
    const after = s.length - lastDot - 1;
    if (s.indexOf('.') === lastDot && after > 0 && after <= 2) sep = '.';
  }

  let intPart = s, fracPart = '';
  if (sep) {
    const i = s.lastIndexOf(sep);
    intPart = s.slice(0, i);
    fracPart = s.slice(i + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (intPart === '' && fracPart === '') return null;

  const minor = parseInt(intPart || '0', 10) * 100 + parseInt((fracPart + '00').slice(0, 2), 10);
  return Number.isFinite(minor) ? minor : null;
}

const plain = (m) => (m / 100).toFixed(2);
const money = (m) => TRIP.symbol + (m / 100).toLocaleString('en-GB', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const sortedAsc = () => entries.slice().sort((a, b) =>
  a.date === b.date ? String(a.createdAt).localeCompare(String(b.createdAt))
                    : a.date.localeCompare(b.date));

function groupByDate(list) {
  const map = new Map();
  list.forEach((e) => {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  });
  return map;
}

const sum = (list) => list.reduce((t, e) => t + e.amountMinor, 0);
const catOf = (key) => CATEGORIES.find((c) => c.key === key);

/* ── chip groups ────────────────────────────────────────── */

function buildChips(host, items, opts) {
  host.innerHTML = '';
  items.forEach((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.value = item.key;
    b.setAttribute('aria-pressed', 'false');
    if (opts.icons) {
      b.innerHTML = '<span class="ico"></span><span class="zh"></span><span class="en"></span>';
      b.querySelector('.ico').textContent = item.ico;
      b.querySelector('.zh').textContent = item.zh;
      b.querySelector('.en').textContent = item.key;
    } else {
      b.textContent = item.key;
    }
    b.addEventListener('click', () => {
      setChip(host, item.key);
      // Dismiss the numeric keypad — iOS gives it no "done" key, so the
      // category tap is what gets the Save button back on screen.
      const amt = $('#amount');
      if (document.activeElement === amt) amt.blur();
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

const VIEWS = ['add', 'list', 'export'];

function switchView(name) {
  VIEWS.forEach((v) => { $('#view-' + v).hidden = (v !== name); });
  document.querySelectorAll('.tab').forEach((t) => {
    t.setAttribute('aria-selected', String(t.dataset.view === name));
  });
  if (name === 'list') renderList();
  if (name === 'export') renderExport();
  window.scrollTo(0, 0);
}

/* ── add / edit form ────────────────────────────────────── */

function resetForm() {
  editingId = null;
  $('#amount').value = '';
  $('#description').value = '';
  $('#remarks').value = '';
  $('#date').value = localDate();
  setChip($('#cat-grid'), null);
  setChip($('#acct-grid'), sticky.account);
  setChip($('#pay-grid'), sticky.payment);
  $('#submit-btn').textContent = '儲存';
  $('#delete-btn').hidden = true;
  $('#cancel-btn').hidden = true;
  $('.screen-title').textContent = '入數';
}

function openEdit(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  $('#amount').value = plain(e.amountMinor);
  $('#description').value = e.description || '';
  $('#remarks').value = e.remarks || '';
  $('#date').value = e.date;
  setChip($('#cat-grid'), e.category);
  setChip($('#acct-grid'), e.account);
  setChip($('#pay-grid'), e.payment);
  $('#submit-btn').textContent = '更新';
  $('#delete-btn').hidden = false;
  $('#cancel-btn').hidden = false;
  $('#view-add').querySelector('.screen-title').textContent = '編輯';
  switchView('add');
}

function onSubmit(ev) {
  ev.preventDefault();

  const amountMinor = parseAmount($('#amount').value);
  if (amountMinor == null) { toast('金額入得唔啱'); $('#amount').focus(); return; }

  const category = getChip($('#cat-grid'));
  if (!category) { toast('揀返個 category'); return; }

  const date = $('#date').value || localDate();
  const account = getChip($('#acct-grid')) || sticky.account;
  const payment = getChip($('#pay-grid')) || sticky.payment;
  const description = $('#description').value.trim();
  const remarks = $('#remarks').value.trim();
  const now = new Date().toISOString();

  if (editingId) {
    const e = entries.find((x) => x.id === editingId);
    if (e) {
      Object.assign(e, { amountMinor, category, date, account, payment,
                         description, remarks, updatedAt: now });
    }
    if (!saveEntries()) return;
    resetForm();
    switchView('list');
    toast('已更新');
    return;
  }

  entries.push({
    id: uid(),
    schemaVersion: SCHEMA_VERSION,
    tripId: TRIP.id,
    date: date,
    amountMinor: amountMinor,
    currency: TRIP.currency,
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

  resetForm();
  updateBanner();
  toast('入咗 ' + money(amountMinor));
  if (navigator.vibrate) navigator.vibrate(12);
  $('#amount').focus();
}

function onDelete() {
  if (!editingId) return;
  if (!confirm('刪除呢筆？無得 undo。')) return;
  entries = entries.filter((x) => x.id !== editingId);
  saveEntries();
  resetForm();
  switchView('list');
  toast('已刪除');
}

/* ── list ───────────────────────────────────────────────── */

function renderList() {
  updateBanner();
  const total = sum(entries);
  $('#sum-total').textContent = money(total);
  $('#sum-meta').textContent = entries.length + ' 筆';

  const today = dayNumber(localDate());
  const now = asUTC(localDate());
  let dayText;
  if (today) dayText = '第 ' + today + ' 日 / 共 ' + TRIP_DAYS + ' 日';
  else if (now < asUTC(TRIP.start)) {
    dayText = '距離出發仲有 ' + Math.round((asUTC(TRIP.start) - now) / 86400000) + ' 日';
  } else dayText = '旅程完結';
  $('#sum-day').textContent = TRIP.name + ' · ' + TRIP.start + ' → ' + TRIP.end + ' · ' + dayText;

  const host = $('#list');
  host.innerHTML = '';

  if (!entries.length) {
    const p = document.createElement('div');
    p.className = 'empty-state';
    p.textContent = '仲未有紀錄。撳「入數」開始。';
    host.appendChild(p);
    return;
  }

  const dates = Array.from(groupByDate(entries).keys()).sort().reverse();
  dates.forEach((date) => {
    const list = entries.filter((e) => e.date === date)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const dn = dayNumber(date);

    const head = document.createElement('div');
    head.className = 'day-head';
    const left = document.createElement('span');
    left.textContent = (dn ? 'Day ' + dn + ' · ' : '') + date;
    const right = document.createElement('span');
    right.className = 'day-total';
    right.textContent = money(sum(list));
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
      const d = document.createElement('div');
      d.className = 'row-desc' + (e.description ? '' : ' empty');
      d.textContent = e.description || '（冇 description）';
      const s = document.createElement('div');
      s.className = 'row-sub';
      const bits = [e.category, e.account, e.payment];
      if (e.remarks) bits.push(e.remarks);
      s.textContent = bits.join(' · ');
      main.appendChild(d);
      main.appendChild(s);

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

/* ── exports ────────────────────────────────────────────── */

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV() {
  const head = ['Account', 'Date', 'Payment', 'Description', TRIP.currency, 'Category', 'Remarks'];
  const rows = sortedAsc().map((e) => [
    e.account, e.date, e.payment, e.description,
    plain(e.amountMinor), e.category, e.remarks,
  ].map(csvCell).join(','));
  // BOM keeps Excel from mangling the Chinese in Description / Remarks.
  return '\uFEFF' + [head.join(',')].concat(rows).join('\r\n') + '\r\n';
}

function toJSON() {
  return JSON.stringify({
    app: 'Trip Spend',
    schemaVersion: SCHEMA_VERSION,
    tripId: TRIP.id,
    trip: TRIP,
    exportedAt: new Date().toISOString(),
    entries: sortedAsc(),
  }, null, 2);
}

function toText() {
  const out = [];
  out.push('Trip Spend · ' + TRIP.name + ' ' + TRIP.start + ' → ' + TRIP.end.slice(5));
  out.push('總計 ' + money(sum(entries)) + ' · ' + entries.length + ' 筆');
  out.push('');

  const dates = Array.from(groupByDate(entries).keys()).sort();
  dates.forEach((date) => {
    const list = entries.filter((e) => e.date === date);
    const dn = dayNumber(date);
    out.push((dn ? 'Day ' + dn + ' · ' + date.slice(5) : date) + ' · ' + money(sum(list)));

    const cats = new Map();
    list.forEach((e) => cats.set(e.category, (cats.get(e.category) || 0) + e.amountMinor));
    const parts = Array.from(cats.entries()).sort((a, b) => b[1] - a[1])
      .map((p) => p[0] + ' ' + money(p[1]));
    out.push('  ' + parts.join(' · '));
  });
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

async function runExport(kind) {
  if (!entries.length) { toast('仲未有紀錄'); return; }
  const base = 'trip-spend-' + TRIP.id;

  if (kind === 'text') {
    const text = toText();
    const ok = await copyText(text);
    if (ok) toast('摘要已複製');
    else showSheet('純文字摘要', text);
    return;
  }

  const isCSV = kind === 'csv';
  const result = await deliver(
    base + (isCSV ? '.csv' : '.json'),
    isCSV ? 'text/csv;charset=utf-8' : 'application/json',
    isCSV ? toCSV() : toJSON()
  );
  if (result === 'shared' || result === 'downloaded') {
    if (!isCSV) markBackedUp();
    toast(isCSV ? 'CSV 出咗' : 'JSON 出咗');
  }
}

/* ── backup ─────────────────────────────────────────────── */

function markBackedUp() {
  writeKey(K.backup, new Date().toISOString());
  updateBanner();
}

async function backupNow() {
  if (!entries.length) { toast('仲未有紀錄'); return; }
  const text = toJSON();
  const ok = await copyText(text);
  if (ok) {
    markBackedUp();
    toast('已複製 — 快啲貼落 Notes');
  } else {
    showSheet('JSON 備份', text);
  }
}

function updateBanner() {
  const el = $('#banner');
  const now = new Date();
  const today = localDate(now);
  const last = readKey(K.backup, null);
  const dismissed = readKey(K.banner, null);

  const show = entries.length > 0
    && now.getHours() >= 20
    && dismissed !== today
    && !(last && String(last).slice(0, 10) === today);

  el.hidden = !show;
}

/* ── import / wipe ──────────────────────────────────────── */

function runImport() {
  const raw = $('#import-box').value.trim();
  if (!raw) { toast('貼返段 JSON 先'); return; }

  let data;
  try { data = JSON.parse(raw); }
  catch (e) { toast('讀唔到 — 唔係有效 JSON'); return; }

  const incoming = Array.isArray(data) ? data : (data && data.entries);
  if (!Array.isArray(incoming)) { toast('搵唔到 entries'); return; }

  const clean = incoming.filter((e) =>
    e && typeof e.date === 'string' && Number.isFinite(e.amountMinor));
  if (!clean.length) { toast('入面一筆有效紀錄都冇'); return; }

  if (!confirm('Import ' + clean.length + ' 筆，會覆蓋而家全部 ' + entries.length + ' 筆。繼續？')) return;

  entries = clean.map((e) => ({
    id: e.id || uid(),
    schemaVersion: e.schemaVersion || SCHEMA_VERSION,
    tripId: e.tripId || TRIP.id,
    date: e.date,
    amountMinor: Math.round(e.amountMinor),
    currency: e.currency || TRIP.currency,
    account: ACCOUNTS.indexOf(e.account) >= 0 ? e.account : ACCOUNTS[0],
    payment: PAYMENTS.indexOf(e.payment) >= 0 ? e.payment : PAYMENTS[0],
    category: catOf(e.category) ? e.category : CATEGORIES[0].key,
    description: e.description || '',
    remarks: e.remarks || '',
    createdAt: e.createdAt || new Date().toISOString(),
    updatedAt: e.updatedAt || new Date().toISOString(),
  }));
  saveEntries();
  $('#import-box').value = '';
  renderExport();
  toast('還原咗 ' + entries.length + ' 筆');
}

function runWipe() {
  if ($('#wipe-confirm').value.trim().toUpperCase() !== 'DELETE') return;
  if (!confirm('清除全部 ' + entries.length + ' 筆？無得 undo。')) return;
  entries = [];
  saveEntries();
  $('#wipe-confirm').value = '';
  $('#wipe-btn').disabled = true;
  renderExport();
  toast('清晒');
}

function renderExport() {
  const last = readKey(K.backup, null);
  $('#backup-state').textContent = last
    ? '上次備份：' + new Date(last).toLocaleString('en-GB')
    : '未備份過';
  $('#trip-label').textContent = TRIP.name + ' ' + TRIP.start + ' → ' + TRIP.end
    + ' · ' + entries.length + ' 筆';
  document.querySelectorAll('.cur-code').forEach((el) => { el.textContent = TRIP.currency; });
  updateBanner();
}

/* ── sheet & toast ──────────────────────────────────────── */

function showSheet(title, text) {
  $('#sheet-title').textContent = title;
  $('#sheet-text').value = text;
  $('#sheet').hidden = false;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ── wiring ─────────────────────────────────────────────── */

function init() {
  $('#cur-symbol').textContent = TRIP.symbol;

  buildChips($('#cat-grid'), CATEGORIES, { icons: true });
  buildChips($('#acct-grid'), ACCOUNTS.map((k) => ({ key: k })), { icons: false });
  buildChips($('#pay-grid'), PAYMENTS.map((k) => ({ key: k })), { icons: false });

  resetForm();

  $('#entry-form').addEventListener('submit', onSubmit);
  $('#delete-btn').addEventListener('click', onDelete);
  $('#cancel-btn').addEventListener('click', () => { resetForm(); switchView('list'); });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => switchView(t.dataset.view));
  });

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
    toast(ok ? '複製咗' : '複製唔到 — 長按揀全部');
  });

  switchView('add');
  updateBanner();

  // The date rolls over and the 20:00 banner needs re-checking after a
  // long backgrounding, so re-evaluate whenever the app comes back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if ($('#date').value < localDate() && !editingId) $('#date').value = localDate();
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
