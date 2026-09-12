// Run: node --test car-charging/test/he.test.mjs
//
// relative() is the only thing on this page that turns a timestamp into words, and both of its
// callers put the result straight in front of the owner: app.js:136 renders it as the header's
// freshness age on every load, views/tariff.js:305 ends the flip sentence with it.
//
// CLDR's Hebrew singular and dual relative forms carry a bracketed numeral — "בעוד שעתיים (2)",
// "לפני דקה (1)" — a disambiguation gloss meant for data consumers, and Intl.RelativeTimeFormat
// hands it through verbatim. It afflicts exactly ±1 minute and ±1/±2 hours, which are the most
// common values this page ever shows.
//
// These assert the STRING A READER GETS, never the shape of he.js's source. A test that greps
// for `.replace(` passes just as happily against a `.replace()` that strips nothing, and passes
// forever after ICU stops emitting the gloss and the strip becomes dead code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relative } from '../views/he.js';

const MIN = 60000;
const HOUR = 60 * MIN;

// Not a list of the five known-glossed forms: a gloss on any output is a bug, and CLDR is data
// that moves. Every value relative() can be asked for across its three unit bands, both signs.
const SPANS = [
  ['a minute ago', -MIN], ['in a minute', MIN],
  ['an hour ago', -HOUR], ['in an hour', HOUR],
  ['two hours ago', -2 * HOUR], ['in two hours', 2 * HOUR],
  ['three hours ago', -3 * HOUR], ['in three hours', 3 * HOUR],
  ['now', 0], ['half an hour ago', -30 * MIN],
  ['just under the day band', -26 * HOUR], ['just over it', 26 * HOUR],
  ['days ago', -5 * 24 * HOUR], ['in days', 5 * 24 * HOUR],
];

test('no relative phrase ends in CLDR\'s bracketed numeral gloss', () => {
  for (const [label, delta] of SPANS) {
    const said = relative(delta);
    assert.doesNotMatch(said, /\(\d+\)/,
      `${label}: the owner is shown "${said}" — CLDR's disambiguation gloss leaked to the screen`);
  }
});

test('stripping the gloss does not eat the words around it', () => {
  // The two the page shows most, spelled out. If the strip ever grows teeth these go first.
  assert.equal(relative(2 * HOUR), 'בעוד שעתיים');
  assert.equal(relative(-MIN), 'לפני דקה');
  // And the forms that never carried a gloss must come through untouched.
  assert.equal(relative(-3 * HOUR), 'לפני 3 שעות');
  assert.equal(relative(-2 * 24 * HOUR), 'שלשום');
});

test('every phrase still says something a reader can read', () => {
  for (const [label, delta] of SPANS)
    assert.match(relative(delta), /\p{Script=Hebrew}/u, `${label} rendered no Hebrew at all`);
  assert.equal(relative(NaN), '—');
});
