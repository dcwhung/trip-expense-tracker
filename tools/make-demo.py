#!/usr/bin/env python3
"""Build demo/ — a self-contained showcase copy of the frozen app.

The demo lives at the same origin as the real app, so the two would share
one localStorage bucket and one CacheStorage. Both are dealt with here:

  * every storage key is prefixed, so the demo cannot see or clobber real
    trip data;
  * the demo registers no service worker at all. The root worker deletes
    every cache that is not its own on activate, so a second worker would
    end up wiping the real app's offline cache. Not worth it for a demo
    that will be shown with a network.

Nothing under the repository root is modified. Re-run after any change to
the real app to refresh the copy.
"""

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'demo'

PREFIX = 'tripspend.demo.'

# ── the copy ────────────────────────────────────────────────

if OUT.exists():
    shutil.rmtree(OUT)
(OUT / 'icons').mkdir(parents=True)

for name in ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png']:
    shutil.copy2(ROOT / 'icons' / name, OUT / 'icons' / name)

# app.js — namespace the storage, drop the service worker, mark the build.
app = (ROOT / 'app.js').read_text()

app, n = re.subn(r"'tripspend\.", "'" + PREFIX, app)
assert n >= 6, 'storage keys not found — did K move?'

sw_block = re.search(
    r"\n  if \('serviceWorker' in navigator\) \{.*?\n  \}\n", app, re.S)
assert sw_block, 'service worker registration not found'
app = app.replace(sw_block.group(0), """
  // No service worker here: the real app's worker deletes every cache but
  // its own, so a second one would knock the real app offline.
""")

app, n = re.subn(r"const BUILD = '([^']+)';.*", r"const BUILD = '\1-demo';", app, count=1)
assert n == 1, 'BUILD stamp not found'

(OUT / 'app.js').write_text(app)

# styles.css — plus the badge that keeps the two apart on screen.
css = (ROOT / 'styles.css').read_text() + """
/* ── demo build only ─────────────────────────────────────── */

.demo-pill {
  display: inline-block;
  vertical-align: 3px;
  margin-left: 8px;
  padding: 2px 8px;
  border: 1px solid var(--accent);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--accent);
}
"""
(OUT / 'styles.css').write_text(css)

# index.html — seed before app.js, and say Demo in the places iOS reads.
html = (ROOT / 'index.html').read_text()
html = html.replace('<title>Trip Spend</title>', '<title>Trip Spend Demo</title>')
html = html.replace('content="Trip Spend"', 'content="Trip Spend Demo"')
html = html.replace('<script src="app.js"></script>',
                    '<script src="demo-seed.js"></script>\n<script src="app.js"></script>')
assert 'demo-seed.js' in html
(OUT / 'index.html').write_text(html)

manifest = json.loads((ROOT / 'manifest.json').read_text())
manifest['name'] = 'Trip Spend Demo'
manifest['short_name'] = 'Spend Demo'
manifest['description'] = 'Sample data — demo build of Trip Spend'
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

# ── the sample trip ─────────────────────────────────────────
#
# Dates are relative to whenever the demo is opened: a 7-day trip whose
# third day is today. That way the date strip has past and future days,
# the progress line reads "Day 3 of 7", and the demo never goes stale.
#
# offset is in days from today; hhmm only orders rows within a day.

TOPUPS = [
    (-2, '0810', 'Donald', 80000),
    (-2, '0812', 'Kwan',   25000),
    (-1, '0930', 'Donald', 20000),
]

ENTRIES = [
    # Booked before the trip started — entries are not bound to the strip.
    (-4, '2015', 'Donald', 'Credit Card', 'Transportation', 18240,
     'ITA Airways LHR-FCO', 'Booking ref XK9P2'),

    (-2, '1105', 'Donald', 'Cash',         'Transportation',  1400, 'Leonardo Express', 'Fiumicino to Termini'),
    (-2, '1340', 'Donald', 'Global Money', 'Food',            3850, 'Trattoria Da Enzo', 'Lunch, 4 pax'),
    (-2, '1620', 'Kwan',   'Cash',         'Household',       1290, 'Farmacia', 'Sunscreen and plasters'),
    (-2, '1705', 'Kwan',   'Cash',         'Food',             960, 'Gelateria Giolitti', ''),
    (-2, '1930', 'Donald', 'Credit Card',  'Entertainment',   4800, 'Colosseum', 'Skip-the-line x2'),

    (-1, '0805', 'Donald', 'Cash',         'Food',             680, '', 'Caffe and cornetto'),
    (-1, '1015', 'Donald', 'Global Money', 'Transportation',  7200, 'Frecciarossa Roma to Firenze', ''),
    (-1, '1450', 'Kwan',   'Credit Card',  'Shopping',       12400, 'San Lorenzo leather market', 'Bag for mum'),
    (-1, '1610', 'Kwan',   'Cash',         'Kids',            2250, '', 'Carousel and a toy'),
    (-1, '2010', 'Donald', 'Global Money', 'Food',            6120, "Osteria dell'Enoteca", 'Dinner'),
    (-1, '2145', 'Donald', 'Cash',         'Household',        450, '', 'Bottled water x6'),

    (0,  '0845', 'Kwan',   'Cash',         'Food',            1140, 'Mercato Centrale', 'Breakfast'),
    (0,  '1030', 'Donald', 'Global Money', 'Entertainment',   5200, 'Uffizi Gallery', 'Timed entry 10:30'),
    (0,  '1320', 'Donald', 'Cash',         'Transportation',  1800, '', 'Taxi back to the hotel'),
    (0,  '1640', 'Donald', 'Credit Card',  'Shopping',        3590, 'Pharmacy skincare', ''),
]

seed = """/* Generated by tools/make-demo.py — do not edit by hand.

   Runs before app.js so the sample trip is already in storage by the time
   the app reads it. Seeds once; after that the demo behaves like the real
   app and remembers whatever you do to it. Open with ?reseed to start the
   sample over. */
(function () {
  var PREFIX = %s;
  var MARK = PREFIX + 'seeded.v1';
  var TOPUPS = %s;
  var ENTRIES = %s;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function shift(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // An ISO stamp on the given day at the given hhmm — only the ordering
  // within a day matters, and the records list sorts on createdAt.
  function stamp(days, hhmm) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(+hhmm.slice(0, 2), +hhmm.slice(2), 0, 0);
    return d.toISOString();
  }

  var reseed = /[?&]reseed\\b/.test(location.search);
  try {
    if (!reseed && localStorage.getItem(MARK)) return;
  } catch (e) { return; }

  var n = 0;
  var uid = function () { return 'demo-' + (++n); };

  var topups = TOPUPS.map(function (t) {
    return {
      id: uid(), schemaVersion: 2, date: shift(t[0]), amountMinor: t[3],
      currency: 'EUR', account: t[2],
      createdAt: stamp(t[0], t[1]), updatedAt: stamp(t[0], t[1]),
    };
  });

  var entries = ENTRIES.map(function (e) {
    return {
      id: uid(), schemaVersion: 2, date: shift(e[0]), amountMinor: e[5],
      currency: 'EUR', account: e[2], payment: e[3], category: e[4],
      description: e[6], remarks: e[7],
      createdAt: stamp(e[0], e[1]), updatedAt: stamp(e[0], e[1]),
    };
  });

  var put = function (k, v) { localStorage.setItem(PREFIX + k, JSON.stringify(v)); };
  put('settings.v1', { tripStart: shift(-2), tripEnd: shift(4), accounts: ['Donald', 'Kwan'] });
  put('topups.v1', topups);
  put('entries.v1', entries);
  put('sticky.v1', { account: 'Donald', payment: 'Cash' });
  // Backed up just now, so a fresh demo opens without the nag banner.
  put('lastBackup.v1', new Date().toISOString());
  localStorage.removeItem(PREFIX + 'bannerDismissed.v1');
  localStorage.setItem(MARK, '1');

  if (reseed) history.replaceState(null, '', location.pathname);
})();

// A badge on every screen, so a demo phone is never mistaken for the real
// one. Added from script to keep the copied markup identical to the app's.
document.addEventListener('DOMContentLoaded', function () {
  Array.prototype.forEach.call(document.querySelectorAll('.screen-title'), function (h) {
    var pill = document.createElement('span');
    pill.className = 'demo-pill';
    pill.textContent = 'DEMO';
    h.appendChild(pill);
  });
});
""" % (json.dumps(PREFIX), json.dumps(TOPUPS), json.dumps(ENTRIES))

(OUT / 'demo-seed.js').write_text(seed)

spend = {}
for e in ENTRIES:
    spend[e[2]] = spend.get(e[2], 0) + e[5]
top = {}
for t in TOPUPS:
    top[t[2]] = top.get(t[2], 0) + t[3]

print('demo/ built — ' + str(len(ENTRIES)) + ' entries, ' + str(len(TOPUPS)) + ' top-ups')
for a in sorted(top):
    print('  %-8s topped up %8.2f  spent %8.2f  left %8.2f'
          % (a, top[a] / 100, spend.get(a, 0) / 100, (top[a] - spend.get(a, 0)) / 100))
