// Run: node --test car-charging/test/mobile-layout.test.mjs
//
// Three defects the owner found by looking at the real rendered page rather than by reading
// CSS, all in the same family: something that touches something else, or a value with no name
// attached to it. None of them is visible to test/theme.test.mjs's existing checks (component
// coverage, logical properties, the 44px floor), so each gets its own assertion here, pinned to
// the CSS source the same crude-but-honest way test/theme.test.mjs already reads a sheet: split
// into `selector { body }` rules and read a declared property back out. There is no layout
// engine in `node --test`, so a real browser is still how these were found — this is what keeps
// them found.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styleSrc = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const classicSrc = readFileSync(new URL('../themes/classic.css', import.meta.url), 'utf8');

// Same split test/theme.test.mjs uses: strip comments, then take every `selector { declarations }`
// pair. A rule nested inside `@media { … }` still comes out as its own selector/body pair — the
// media wrapper's own brace never finds a matching one before the first inner rule's brace does,
// so it is silently skipped rather than merged into the rule that follows it.
function rulesOf(source) {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
  }));
}

const declared = (body, prop) => {
  const found = new RegExp('(?:^|[;{\\s])' + prop + '\\s*:\\s*([^;}]+)').exec(body);
  return found ? found[1].trim() : null;
};

// A margin value that is provably not zero. `var(--sp-3)` and `12px` both pass; `0`, `0px` and
// an absent declaration do not.
function isNonZeroLength(value) {
  if (value === null) return false;
  if (/^var\(/.test(value)) return true;
  const px = /^(-?\d+(?:\.\d+)?)(px|em|rem)?$/.exec(value.trim());
  return px ? Number(px[1]) !== 0 : true; // an unrecognised non-null value is not provably zero
}

// ── defect 1: the suspended-state badge touched the button row under it ──
//
// views/controls.js's default body (the one classic wears — every other theme in this project
// supplies its own body builder with its own rhythm) appends a `.status` badge and then a
// `.btn-row` as two plain block siblings. Neither carries a margin of its own — `.btn-note`
// does, everything else in that stack does not — so a `status--suspendedev` badge landed flush
// against "עצירה" / "התחלת טעינה" below it. Measured: 0px between them.
test('classic gives the status badge a gap from the button row that follows it', () => {
  const rules = rulesOf(classicSrc);
  const rule = rules.find((r) => /(?:^|[\s,])\.status\s*\+\s*\.btn-row(?![\w-])/.test(r.selector));
  assert.ok(
    rule,
    'themes/classic.css has no `.status + .btn-row` rule — the default controls body renders a ' +
      'status badge directly above the button row with nothing to separate them.'
  );
  const gap = declared(rule.body, 'margin-block-start') ?? declared(rule.body, 'margin-top');
  assert.ok(
    isNonZeroLength(gap),
    'themes/classic.css has a `.status + .btn-row` rule but it does not set a non-zero ' +
      '`margin-block-start` (or `margin-top`), so the badge and the row still touch.'
  );
});

// The settle bar (post-stop progress) is the other block in that same stack with no margin of
// its own; it always follows the button row or a reason paragraph and never leads the panel.
test('classic gives the settle bar a gap from whatever precedes it', () => {
  const rules = rulesOf(classicSrc);
  const rule = rules.find((r) => /(?:^|[\s,.])\.settle(?![\w-])/.test(r.selector) && !/settle__/.test(r.selector));
  assert.ok(rule, 'themes/classic.css has no bare `.settle` rule.');
  const gap = declared(rule.body, 'margin-block-start') ?? declared(rule.body, 'margin-top');
  assert.ok(
    isNonZeroLength(gap),
    '`.settle` in themes/classic.css does not set a non-zero top margin, so it touches the ' +
      'button row or reason paragraph above it.'
  );
});

// ── defect 2: the history/invoice tables only ever scrolled sideways on a phone ──
//
// `.table` carried a `min-width: 620px` and relied on `.table-wrap` to scroll it below that —
// a seven-column table dragged sideways under a thumb, which is a fallback and not a design.
// Below that same 620px this project already named as the floor a table can be read at, both
// `#history` and `#account` (neither replaces its table markup in any theme — THEMES.md §7) must
// fall back to a stacked card per row, with the column meaning printed beside its value rather
// than dropped.
test('history and account tables collapse to cards, not a sideways scroll, below 620px', () => {
  const rules = rulesOf(styleSrc);

  const blockRule = (id) =>
    rules.find(
      (r) =>
        r.selector.includes('#' + id) &&
        r.selector.includes('table.table') &&
        !r.selector.includes('td') &&
        !r.selector.includes('tr') &&
        !r.selector.includes('thead') &&
        !r.selector.includes('tbody') &&
        declared(r.body, 'display') === 'block'
    );

  for (const id of ['history', 'account']) {
    assert.ok(
      blockRule(id),
      `style.css has no rule turning \`#${id} .table-wrap table.table\` into \`display: block\` ` +
        'below the readable width — the table is still only a horizontal scroller on a phone.'
    );
  }

  // Every column history.js writes needs its meaning to survive the row becoming a card. A bare
  // number with no label is worse than the same number under a header, and a table that drops
  // its headers on mobile is worse than one that scrolls.
  const historyLabels = rules.filter(
    (r) => r.selector.includes('#history') && /td:nth-child\(\d\)::before/.test(r.selector)
  );
  assert.equal(
    historyLabels.length,
    7,
    `expected a generated label for all 7 columns views/history.js writes, found ` +
      `${historyLabels.length}. A column with no label on a card is a column whose meaning is gone.`
  );
  for (const rule of historyLabels) {
    assert.ok(
      declared(rule.body, 'content'),
      `${rule.selector} turns the row into a card but declares no \`content\` — that column's ` +
        'value would render with nothing saying what it is.'
    );
  }
});

// ── bonus, found the same way: a phone number in the contact edit form reordered itself ──
//
// `.contact__value` — the read-only half of the card — was already in style.css's
// `unicode-bidi: plaintext` set. The edit form's own `<input>` was not, and "+972500000000" has
// no strong character anywhere in it, so the page direction alone decided where the leading "+"
// landed: it rendered AFTER the digits instead of before them. Measured in the contact edit form
// at dir="rtl", in the phone and WhatsApp fields specifically.
test('the contact form\'s inputs get their own bidi paragraph, like the read-only card does', () => {
  const rules = rulesOf(styleSrc);
  const rule = rules.find(
    (r) => /(?:^|[\s,])\.input(?![\w-])/.test(r.selector) && declared(r.body, 'unicode-bidi') === 'plaintext'
  );
  assert.ok(
    rule,
    'style.css does not give `.input` `unicode-bidi: plaintext` — a phone or WhatsApp number ' +
      'typed into the contact edit form has no strong character to anchor it, and the leading ' +
      '"+" reorders to the wrong end of the value.'
  );
});
