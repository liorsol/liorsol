// Run: node --test car-charging/test/tariff.test.mjs
//
// One requirement, and it is the first one the owner wrote down: the panel must say IN WORDS
// which slice is live and WHEN IT FLIPS. The band above it is decoration — a reader cannot get
// a time off a coloured rectangle, and the difference between plugging in at 22:50 and at 23:00
// is the whole 2.79x spread between the two TAOZ prices.
//
// This is a RENDER, not a grep, and that is the point. The sentence was already correct and its
// only guard was a source-text scan for the English words it used to contain ('flips to ', ',
// until '); the Hebrew pass translated them and the guard went blind while the code stayed
// right. A scan for a spelling measures the spelling. Driving the module measures the sentence.
//
// The three negative cases are the ones that invent a time if nobody watches. The published
// calendar is a rolling ~24 h horizon and a real payload has carried ONE slice, so "there is no
// next slice" is a normal Tuesday, not an error — and the panel has to say so rather than
// extrapolate the pattern past the end of what the charger actually published.
//
// Fixtures are relative to now on purpose: no wall-clock literal to go stale, and no timezone
// assumption — every assertion about a clock compares against he.js's own formatter, which is
// the only thing allowed to decide how 23:00 is spelled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDocument, node, all } from './fake-dom.mjs';

installDocument();
const { render } = await import('../views/tariff.js');
const { time } = await import('../views/he.js');

const H = 3600000;
const iso = (ms) => new Date(ms).toISOString();

// The panel's own paragraph, and everything a reader would see in it, in order. text() from
// fake-dom joins with a space; this joins with nothing, because the sentence is split across
// text nodes and a <strong> and the seam between them is where a substring assertion lands.
function flip(slices) {
  const el = node('div');
  render(el, { state: { pricingSlices: slices, sessions: [] } }, {});
  const line = all(el).find((n) => n.className === 'tariff__flip');
  assert.ok(line, 'the tariff panel rendered no .tariff__flip paragraph at all');
  const read = [line.textContent, ...all(line).map((n) => n.textContent)].filter(Boolean).join('');
  return { line, read, clock: all(line).find((n) => n.tagName === 'strong') };
}

// A two-price calendar with the flip still ahead: the ordinary case, and the only one where a
// time may be named at all.
const ahead = () => {
  const now = Date.now();
  return [
    { name: 'פסגה', price: 1.6096, from: iso(now - H), to: iso(now + 2 * H), type: 'Energy', vat: 18 },
    { name: 'שפל', price: 0.5773, from: iso(now + 2 * H + 1000), to: iso(now + 20 * H), type: 'Energy', vat: 18 },
  ];
};

test('the panel names the next slice and the clock time it flips at', () => {
  const slices = ahead();
  const { line, read, clock } = flip(slices);

  assert.equal(line.tagName, 'p');
  assert.match(read, /מתחלף/, `the flip sentence never says it changes: "${read}"`);
  assert.match(read, /שפל/, `the flip sentence does not name the slice being flipped to: "${read}"`);
  assert.ok(clock, 'the flip time is not in a <strong> — style.css fences the clock through ' +
    '`.tariff__flip strong { unicode-bidi: plaintext }`, so bare text is a bidi bug in RTL');
  assert.equal(clock.textContent, time(Date.parse(slices[1].from)),
    'the clock is not he.js\'s he-IL formatting of the next slice\'s own start');
  assert.match(clock.textContent, /\d{1,2}:\d{2}/);
  // The sentence ends in relative() and this fixture flips two hours out, which is one of the
  // five forms CLDR glosses with a bracketed numeral ("בעוד שעתיים (2)"). he.js strips it; this
  // is the assertion that the strip is still between the locale data and the panel. See
  // test/he.test.mjs for the other four forms and for the header's age.
  assert.doesNotMatch(read, /\(\d+\)/,
    `CLDR's disambiguation gloss reached the flip sentence: "${read}"`);
});

test('one slice in the calendar: it says no next slice was published, and invents no flip', () => {
  const now = Date.now();
  const only = [{ name: 'שפל', price: 0.5773, from: iso(now - H), to: iso(now + 10 * H), type: 'Energy', vat: 18 }];
  const { read, clock } = flip(only);

  assert.doesNotMatch(read, /מתחלף/, `a single-slice calendar was reported as flipping: "${read}"`);
  assert.match(read, /לא פורסמה פרוסה הבאה/, `the single-slice sentence does not say so: "${read}"`);
  // The one time it may print is the published end of the slice it is standing in. Anything
  // else is the daily TAOZ pattern extrapolated past the horizon, which is a guess.
  assert.equal(clock && clock.textContent, time(Date.parse(only[0].to)));
});

test('no calendar at all: the flip time is unknown and no time is printed', () => {
  const { read } = flip([]);
  assert.match(read, /אינו ידוע/, `an empty calendar produced: "${read}"`);
  assert.doesNotMatch(read, /\d/, `a clock was printed with no calendar to read it from: "${read}"`);
});

test('past the end of the published calendar: unknown, not extrapolated', () => {
  const now = Date.now();
  const { read } = flip([
    { name: 'שפל', price: 0.5773, from: iso(now - 5 * H), to: iso(now - H), type: 'Energy', vat: 18 },
  ]);
  assert.match(read, /לא ידוע/, `past the horizon the panel said: "${read}"`);
  assert.doesNotMatch(read, /\d/, `a clock was invented past the calendar's end: "${read}"`);
});

// ── THREE RATES, WHICH IS WHAT A REAL TAOZ DAY HAS ──
//
// The classification here used to be binary — `price === top ? היקרה : הזולה` — and the Israeli
// tariff has THREE rates. On a day carrying גבע the panel told the owner `כרגע הפרוסה הזולה`
// while they were on the middle tier at ~1.6x the true off-peak price. That is not a wording
// slip: it is the one judgement this dashboard exists to make, printed backwards, and it was
// live.
//
// The sentence is asserted by rendering, for the same reason the flip time is: a scan for a
// spelling measures the spelling.

const { priceTier } = await import('../views/tariff.js');
const { all: descendants } = await import('./fake-dom.mjs');

/** The modifier every slice and legend key came out wearing, in order. */
function modifiers(slices) {
  const el = node('div');
  render(el, { state: { pricingSlices: slices, sessions: [] } }, {});
  const of = (prefix) => descendants(el)
    .filter((n) => n.className.startsWith(prefix + ' ' + prefix + '--'))
    .map((n) => n.className.split(prefix + '--')[1]);
  return { slices: of('tariff__slice'), keys: of('tariff__key') };
}

// Prices from the published calendar. The spread between שפל and פסגה is the 2.79x this whole
// project is built around; גבע sits between them at about 1.6x the low rate.
const LOW = 0.5773;
const MID = 0.9273;
const TOP = 1.6096;

/** A three-rate day with `live` covering this moment. */
const taoz = (live) => {
  const now = Date.now();
  const win = { שפל: LOW, גבע: MID, פסגה: TOP };
  return Object.entries(win).map(([name, price], i) => ({
    name,
    price,
    vat: 18,
    // The live one straddles now; the others sit before and after it.
    from: iso(name === live ? now - H : now + (i + 1) * 6 * H),
    to: iso(name === live ? now + H : now + (i + 2) * 6 * H),
  }));
};

test('priceTier names the middle rate, and does not invent one that is not published', () => {
  const three = taoz('גבע');
  assert.equal(priceTier(TOP, three), 'peak');
  assert.equal(priceTier(MID, three), 'mid');
  assert.equal(priceTier(LOW, three), 'offpeak');
  assert.equal(priceTier(null, three), 'unknown');

  // Two rates: there is no middle and nothing may be called one.
  const two = [
    { name: 'שפל', price: LOW, from: iso(Date.now()), to: iso(Date.now() + H) },
    { name: 'פסגה', price: TOP, from: iso(Date.now() + H), to: iso(Date.now() + 2 * H) },
  ];
  assert.deepEqual([priceTier(LOW, two), priceTier(TOP, two)], ['offpeak', 'peak']);

  // One rate: nothing is "the dearest", so nothing is a tier at all.
  const one = [{ name: 'אחיד', price: LOW, from: iso(Date.now()), to: iso(Date.now() + H) }];
  assert.equal(priceTier(LOW, one), 'flat');
  assert.equal(priceTier(LOW, []), 'flat');

  // Four rates: everything strictly between the ends is the middle. Nothing here counts to three.
  const four = [LOW, 0.7, MID, TOP].map((price, i) => ({
    price, from: iso(Date.now() + i * H), to: iso(Date.now() + (i + 1) * H),
  }));
  assert.deepEqual(four.map((s) => priceTier(s.price, four)), ['offpeak', 'mid', 'mid', 'peak']);
});

// The strip lays slices out as a percentage of the viewer's LOCAL day and clips to it, so a
// fixture for it is anchored at local midnight rather than at an offset from now — otherwise
// the run's wall-clock time decides how many of the three windows are on the axis at all.
const localDay = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.getTime();
};

/** A whole local day in three contiguous windows, cheapest first. */
const wholeDay = () => {
  const base = localDay();
  return [
    { name: 'שפל', price: LOW, vat: 18, from: iso(base), to: iso(base + 8 * H) },
    { name: 'גבע', price: MID, vat: 18, from: iso(base + 8 * H), to: iso(base + 16 * H) },
    { name: 'פסגה', price: TOP, vat: 18, from: iso(base + 16 * H), to: iso(base + 24 * H) },
  ];
};

test('a three-rate day is three modifiers on the strip, so a sheet-only theme can paint it', () => {
  const { slices, keys } = modifiers(wholeDay());
  assert.deepEqual(slices.slice().sort(), ['mid', 'offpeak', 'peak'],
    'the strip drew a middle-tier window in the cheap window\'s modifier');
  assert.deepEqual(keys.slice().sort(), ['mid', 'offpeak', 'peak'],
    'the legend key did not match the slice it explains');
});

test('a single-rate day still claims no tier — nothing invented for a calendar that has none', () => {
  const now = Date.now();
  const { slices } = modifiers([
    { name: 'אחיד', price: LOW, vat: 18, from: iso(now - H), to: iso(now + 10 * H) },
  ]);
  assert.deepEqual(slices, ['offpeak'],
    'a flat day was marked --peak or --mid, which invents a window the charger never published');
});

test('standing in the middle window, the panel says so instead of calling it the cheap one', () => {
  const { read } = flip(taoz('גבע'));
  assert.doesNotMatch(read, /הפרוסה הזולה/,
    `the middle tier was announced as the cheap slice — the defect this test exists for: "${read}"`);
  assert.match(read, /הביניים/, `the middle tier was not named: "${read}"`);
  assert.match(read, /גבע/, 'the calendar\'s own name for the window was dropped');
});

test('the dearest and the cheapest windows are still named plainly on the same day', () => {
  const dear = flip(taoz('פסגה')).read;
  assert.match(dear, /הפרוסה היקרה/, `the peak window read: "${dear}"`);
  assert.doesNotMatch(dear, /הביניים/, 'the peak window was hedged as a middle one');

  const cheap = flip(taoz('שפל')).read;
  assert.match(cheap, /הפרוסה הזולה/, `the off-peak window read: "${cheap}"`);
  assert.doesNotMatch(cheap, /הביניים/, 'the cheap window was hedged as a middle one');
});

test('a single flat rate keeps its own honest wording, unchanged', () => {
  const now = Date.now();
  const { read } = flip([{ name: 'אחיד', price: LOW, vat: 18, from: iso(now - H), to: iso(now + 10 * H) }]);
  assert.match(read, /מחיר אחד בלוח/, `a flat day read: "${read}"`);
  assert.doesNotMatch(read, /הזולה|היקרה|הביניים/, 'a flat day was given a tier it does not have');
});

test('a slice that carries no price is not the cheap one either', () => {
  const now = Date.now();
  const { read } = flip([
    { name: 'ללא מחיר', vat: 18, from: iso(now - H), to: iso(now + H) },
    { name: 'שפל', price: LOW, vat: 18, from: iso(now + H), to: iso(now + 5 * H) },
    { name: 'פסגה', price: TOP, vat: 18, from: iso(now + 5 * H), to: iso(now + 9 * H) },
  ]);
  assert.doesNotMatch(read, /הפרוסה הזולה/, `an unpriced slice was announced as the cheap one: "${read}"`);
  assert.match(read, /לא נקבה במחיר/, `an unpriced slice read: "${read}"`);
});
