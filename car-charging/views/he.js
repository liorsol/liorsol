// views/he.js — he-IL formatting, and Hebrew labels for the upstream vocabulary.
//
// One module rather than a copy per view. Three views render a connector state and five format a
// figure or a stamp; the two things that drift when that is copied are the VAT basis and the bidi
// behaviour of a number, and both of them read as correct while being wrong.
//
// THE LOCALE IS PINNED. Every formatter here says 'he-IL', never undefined. This dashboard is
// Hebrew for one owner in one timezone, and a viewer whose browser happens to be set to en-US
// must still read "11 בספט׳ 2026" beside Hebrew prose rather than "Sep 11, 2026". `undefined`
// would make the page's language depend on a browser preference that has nothing to do with it.
//
// BIDI — how a figure survives inside Hebrew prose. Everything here returns TEXT, never markup,
// and the fencing is the stylesheet's: .num, .stat__value, .updated__abs, .suspend__amount,
// .comment__time, .stale__age and .tariff__flip strong all carry `unicode-bidi: plaintext`, which
// gives each of those boxes its own bidi paragraph taking its direction from its first strong
// character. A bare figure has none, so it stays LTR; a value that opens with a Hebrew word reads
// RTL. Where a figure lands outside one of those boxes the view wraps it in a <bdi> of its own —
// that element is `unicode-bidi: isolate` with automatic direction in every UA sheet, which is the
// same rule again and costs the stylesheet nothing.
//
// Explicit RLM/LRM characters are deliberately not used to fence anything. The comment board
// strips \p{Cf} on the way in AND on the way out, so a directional mark is a thing that survives
// in one half of the page and vanishes in the other — a fence that is there when you test it and
// gone when a note travels through the board. ils() is the one exception and it proves the rule:
// Intl's own he-IL currency output carries the marks it needs, which is exactly why money in
// prose goes through Intl instead of being concatenated by hand.
//
// A rule worth keeping: a label that mixes Hebrew and a Latin unit OPENS IN HEBREW and puts the
// unit last, usually in brackets — "הספק ממוצע (kW)". Under `plaintext` the first strong character
// decides the whole box, so a label opening with "kW" would lay itself out left to right in the
// middle of a right-to-left table.

export const LOCALE = 'he-IL';

// ── stamps ──────────────────────────────────────────────────────────────────
// Invalid input returns the em dash rather than throwing: these are fed upstream strings.

const DATE_TIME = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
const DAY_TIME = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, DATE_TIME);
const dayTimeFmt = new Intl.DateTimeFormat(LOCALE, DAY_TIME);
// The payload's "local" stamps are wall-clock times stamped as if UTC, so reading them back in
// UTC is what makes them show the charger's own local time. See views/history.js.
const dayTimeUtcFmt = new Intl.DateTimeFormat(LOCALE, { ...DAY_TIME, timeZone: 'UTC' });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const relFmt = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

// CLDR spells the Hebrew singular and dual relative forms with the numeral appended in brackets —
// "בעוד שעתיים (2)", "לפני דקה (1)". It is a disambiguation gloss for data consumers, not text to
// put in front of a reader, and Intl hands it through verbatim. Reproduced identically in node
// (ICU 78 / CLDR 48) and in Chromium, so it is the locale data rather than one engine. Exactly
// five forms carry it — ±1 minute and ±1/±2 hours — and those are the ones this page shows most:
// the header's freshness age one minute after a load, and the flip sentence in the hour before
// 23:00. Stripped here, at the one function both callers route through, rather than at either.
const GLOSS = /\s*\(\d+\)$/;
const rel = (value, unit) => relFmt.format(value, unit).replace(GLOSS, '');

export const dateTime = (ms) => (Number.isFinite(ms) ? dateTimeFmt.format(ms) : '—');
export const dayTime = (ms) => (Number.isFinite(ms) ? dayTimeFmt.format(ms) : '—');
export const dayTimeUtc = (ms) => (Number.isFinite(ms) ? dayTimeUtcFmt.format(ms) : '—');
export const date = (ms) => (Number.isFinite(ms) ? dateFmt.format(ms) : '—');
export const time = (ms) => (Number.isFinite(ms) ? timeFmt.format(ms) : '—');

/**
 * A signed offset from now, in words: negative is past ("לפני 3 שעות"), positive is future
 * ("בעוד שעתיים"). `numeric: 'auto'` is what gets the Hebrew dual form and "עכשיו" for zero —
 * a hand-rolled "לפני 2 שעות" is wrong Hebrew, and it is wrong in the header of every page load.
 */
export function relative(deltaMs) {
  if (!Number.isFinite(deltaMs)) return '—';
  const minutes = Math.round(deltaMs / 60000);
  if (Math.abs(minutes) < 90) return rel(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return rel(hours, 'hour');
  return rel(Math.round(hours / 24), 'day');
}

/** "1 שע׳ 30 דק׳". Hebrew-first, so a .num cell's `plaintext` resolves it right to left. */
export function duration(secs) {
  if (!Number.isFinite(secs) || secs < 0) return '—';
  return Math.floor(secs / 3600) + ' שע׳ '
    + String(Math.floor((secs % 3600) / 60)).padStart(2, '0') + ' דק׳';
}

// ── figures ─────────────────────────────────────────────────────────────────

const formatters = new Map();

function formatter(digits, currency) {
  const key = digits + (currency ? 'c' : 'n');
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      ...(currency ? { style: 'currency', currency: 'ILS' } : {}),
    });
    formatters.set(key, fmt);
  }
  return fmt;
}

/** A bare figure: grouped, fixed fraction digits, he-IL separators. Replaces toFixed(). */
export const n = (value, digits = 2) =>
  (Number.isFinite(value) ? formatter(digits, false).format(value) : '—');

/**
 * ₪ in prose. Intl's he-IL currency output is self-fencing — it carries its own directional
 * marks — so it survives being dropped into a Hebrew sentence without a wrapper. Table cells and
 * stat tiles do NOT use this: there the symbol belongs to the column header or to .stat__unit,
 * and the cell stays a bare figure so a column of numbers lines up.
 */
export const ils = (value, digits = 2) =>
  (Number.isFinite(value) ? formatter(digits, true).format(value) : '—');

// ── upstream vocabulary ─────────────────────────────────────────────────────
//
// The protocol's own spellings are the keys and they never move: they are what the charger says,
// what the JSON carries and what a support conversation is about. Only the label is Hebrew, and
// every caller also hangs the raw value off the element as a `title`, so the owner can still read
// "SuspendedEVSE" off the thing that is misbehaving. The tariff panel goes further and names the
// raw state in its prose, because that is the one the owner is looking at when something is wrong
// and a hover is not reachable on a phone.

const normalise = (raw) => String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '');

const STATUS = {
  available: 'פנוי',
  preparing: 'בהכנה',
  charging: 'בטעינה',
  suspendedevse: 'מושהה — מצד העמדה',
  suspendedev: 'מושהה — מצד הרכב',
  finishing: 'מסיים',
  faulted: 'תקלה',
  reserved: 'משוריין',
  unavailable: 'לא זמין',
};

const STOP_REASON = {
  remote: 'נעצרה מרחוק',
  local: 'נעצרה בעמדה',
  unlockcommand: 'פקודת שחרור',
  evdisconnected: 'הכבל נותק',
  other: 'אחר',
  softreset: 'איפוס רך',
  hardreset: 'איפוס קשיח',
  reboot: 'הפעלה מחדש',
  powerloss: 'הפסקת חשמל',
  deauthorized: 'ההרשאה בוטלה',
  emergencystop: 'עצירת חירום',
};

// An unrecognised value falls back to itself rather than to "unknown": a state this map has not
// met is still the truest thing the page can say about the charger.
const lookup = (table, raw) => table[normalise(raw)] ?? String(raw ?? '');

export const statusKey = normalise;
export const statusLabel = (raw) => lookup(STATUS, raw);
export const stopReasonKey = normalise;
export const stopReasonLabel = (raw) => lookup(STOP_REASON, raw);
