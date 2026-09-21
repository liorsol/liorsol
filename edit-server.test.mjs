/* node edit-server.test.mjs
 *
 * The editor writes to the trip page, so the things worth checking are that a region's byte
 * range is exactly its content (a splice one byte off eats a tag and silently corrupts the
 * file the user is about to commit) and that no prose falls between regions (text with no
 * region is text nobody can edit, which is how <b> ended up as its own field). Run against
 * the real pages, not a fixture — the input that has to survive is this repo's own HTML.
 * No framework, no deps, same as trips/sw-core.test.js. */
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { parse, regions, skipped, norm } from './edit-server.mjs';

const say = (m) => console.log('  ok  ' + m);
const inner = (src, r) => src.slice(r.inner[0], r.inner[1]);

/* --- what counts as one field ----------------------------------------------- */
{
  /* The bug this rule exists for: the callout owns loose text, so it is one field with its
     <b> inside — not a <b> field plus four sentences nobody can reach. */
  const html = '<body><div class="note">נוחתים ב-<b>00:45</b>. ההסעה <a href="#x">ממתינה</a> בחוץ.</div></body>';
  const found = regions(parse(html), html);
  assert.deepStrictEqual(found.map((r) => r.tag), ['div']);
  assert.strictEqual(inner(html, found[0]), 'נוחתים ב-<b>00:45</b>. ההסעה <a href="#x">ממתינה</a> בחוץ.');
  say('an element that owns loose text is one field, bold and all');
}
{
  /* No loose text of its own, so a container is looked inside until the pieces are small
     enough to be one field each. */
  const card = '<div class="card"><h3>כותרת</h3><p>' + 'גוף '.repeat(60) + '</p></div>';
  const html = '<body><div class="grid">' + card.repeat(3) + '</div></body>';
  assert.deepStrictEqual(regions(parse(html), html).map((r) => r.attrs.includes('card') ? 'card' : r.tag), ['card', 'card', 'card']);
  /* ...but a small one is left whole, so a short list stays one field you can add items to. */
  const list = '<body><ul><li>אחד</li><li>שתיים</li></ul></body>';
  assert.deepStrictEqual(regions(parse(list), list).map((r) => r.tag), ['ul']);
  say('a big container is descended into, a card and a short list each stay one field');
}
{
  /* trip.js fills these after load. A region containing one would write its output to the file. */
  const html = '<body><div class="card" id="weather"><h3>מזג אוויר</h3><div id="wx-days">טוען…</div>' +
    '<details><summary>עוד</summary><p>פנים</p></details></div></body>';
  const tags = regions(parse(html), html).map((r) => r.tag);
  assert.ok(!tags.includes('div'), 'the card cannot be one field: it holds generated and stateful children');
  assert.deepStrictEqual(tags, ['h3', 'details'], 'the <details> is its own field, the wx box is no field at all');
  /* The card is #weather but its heading is still written in the file: the skip rule has to
     name the generated box, not the card, or that heading becomes uneditable. */
  say('generated boxes are excluded without taking their card with them; <details> is one field but never inside another');
}

{
  /* What the browser hands back is not always what the file said. Both of these are the
     same markup, and treating either as a change would take the field out of the editor
     (the round-trip check) or refuse the write (the content match). */
  assert.strictEqual(norm('<a href="?a=1&amp;b=2">x</a>'), norm('<a href="?a=1&b=2">x</a>'), 'a raw & and &amp;');
  assert.strictEqual(norm('<tbody><tr><td>1</td></tr></tbody>'), norm('<tr><td>1</td></tr>'), 'an invented <tbody>');
  say('the parser\'s own artifacts are not counted as edits');
}

/* The head's <link href="data:image/svg+xml,<svg ...>"> is a > inside a quoted attribute.
   A naive [^>]* tokenizer ends the tag early there and every offset after it is wrong. */
{
  const html = `<html><head><link rel="icon" href="data:image/svg+xml,<svg><text y='.9em'>X</text></svg>"></head><body><p>אחרי</p></body></html>`;
  const found = regions(parse(html), html);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(inner(html, found[0]), 'אחרי', 'offsets survive the data: URI');
  say('a > inside a quoted attribute does not derail the offsets');
}
{
  const html = '<body><nav><a data-view="home">בית</a></nav><main><p>גוף</p></main></body>';
  assert.deepStrictEqual(regions(parse(html), html).map((r) => r.tag), ['p']);
  say('the side rail is skipped so it keeps navigating');
}

/* --- the real pages ---------------------------------------------------------
   Not just the page this was written for. The rules are meant to hold on any hand-written
   page in this repo, so every one it might be pointed at is checked — that is what makes
   `node edit-server.mjs <other-dir>` a safe thing to reach for later. */
const PAGES = ['trips/italy-2026/index.html', 'trips/italy-2026/map.html',
  'trips/albania-2026/index.html', 'trips/jerusalem-2026/index.html', 'car-checklist.html'];
for (const page of PAGES) {
  const src = await readFile(page, 'utf8');
  const root = parse(src);
  const found = regions(root, src);
  const parentOf = new Map();
  (function walk(n) { for (const c of n.children) { parentOf.set(c, n); walk(c); } })(root);
  assert.ok(found.length > 0, page + ' has editable text');

  for (const r of found) {
    assert.strictEqual(src[r.inner[0] - 1], '>', 'a region starts right after its own opening tag');
    assert.ok(src.startsWith('</' + r.tag, r.inner[1]),
      `region <${r.tag}> must end at its own closing tag, got: ${JSON.stringify(src.slice(r.inner[1], r.inner[1] + 30))}`);
  }

  /* The reported bug: a <b> as its own field, its sentence in another (or in none). An
     inline element may be a field only when it IS all of its parent's loose text — a line
     that happens to be entirely bold. If any prose sits beside it, they belong together. */
  const split = found.filter((r) => ['b', 'strong', 'em', 'i', 'u', 'span'].includes(r.tag)).filter((r) => {
    const p = parentOf.get(r);
    let at = p.inner[0], beside = '';                  // only the gaps: text in p itself, not in its children
    for (const c of p.children) { beside += src.slice(at, c.start); at = c.outEnd; }
    return /\S/.test(beside + src.slice(at, p.inner[1]));
  });
  assert.deepStrictEqual(split.map((r) => inner(src, r)), [], 'bold must not be a field apart from its own sentence');

  let at = 0;
  for (const r of found) {
    assert.ok(r.inner[0] >= at, 'regions are in document order and do not overlap');
    at = r.inner[1];
  }

  /* Prose with no region is prose nobody can edit — the other half of the reported bug.
     Walk everything the editor did NOT claim and everything it did not deliberately skip,
     and assert none of it holds text of its own. */
  const inRegion = new Set(found);
  const orphan = [];
  (function walk(n) {
    for (const c of n.children) {
      if (skipped(c) || inRegion.has(c)) continue;        // generated, or already a field
      let cut = c.inner[0], beside = '';
      for (const k of c.children) { beside += src.slice(cut, k.start); cut = k.outEnd; }
      beside += src.slice(cut, c.inner[1]);
      /* Comments, and the <script>/<style> the parser steps over rather than treating as
         elements, are markup sitting in the gap — not prose anybody wants to edit. */
      const bare = beside.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '');
      if (/\S/.test(bare)) orphan.push(c.tag + ': ' + JSON.stringify(bare.trim().slice(0, 70)));
      walk(c);
    }
  })(root);
  assert.deepStrictEqual(orphan, [], 'prose with no region is prose nobody can edit');

  /* The splice the save path performs, applied to every region at once: replacing each with
     itself must reproduce the file byte for byte. Ranges that overlapped, ran backwards or
     swallowed a tag would show up here. */
  let out = '', cut = 0;
  for (const r of found) { out += src.slice(cut, r.inner[0]) + inner(src, r); cut = r.inner[1]; }
  assert.strictEqual(out + src.slice(cut), src, 'identity splice is byte-identical');

  const big = Math.max(...found.map((r) => r.inner[1] - r.inner[0]));
  say(`${page}: ${found.length} regions, largest ${big}b, no orphan prose, identity splice is lossless`);
}

console.log('\nall good');
