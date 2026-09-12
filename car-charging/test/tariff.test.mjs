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
