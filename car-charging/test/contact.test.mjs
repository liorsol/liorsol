// Run: node --test car-charging/test/contact.test.mjs
//
// The contact card, and the property it exists for.
//
// THE SECRECY CHECK IS THE POINT OF THIS FILE. This repository is public and search-indexed,
// and the sign-in screen renders to anonymous visitors — so anything written into the page is
// published to everyone who finds it, gate or no gate. The card therefore holds no name, no
// number, no address, no mail address and no site of its own: every visible string arrives in
// `/api/contact` at runtime and is configured on the private half.
//
// That is checked two ways, because one alone is not enough:
//
//   1. RENDERED. The module is handed a payload of sentinels and everything it paints is
//      compared against them. A hardcoded name shown as a fallback for a missing field is
//      caught here and nowhere else — it is not URL-shaped, number-shaped or mail-shaped, so no
//      pattern would find it.
//   2. SOURCE. The file is scanned with its comments left in, because "not in a comment" is
//      part of the rule. A constant that is never rendered is still a leak in a public repo.
//
// The rest is the ordinary behaviour: two actions built from the payload, and `{"contact":
// null}` rendering as a quiet empty state rather than as a failure — nothing is broken when the
// far side has nothing configured yet, and an error card would send the owner hunting for a
// fault in a system that is working.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDocument, node, all, text, byClass } from './fake-dom.mjs';

installDocument();

const { render } = await import('../views/contact.js');

// A stub transport for the edit-form tests below. `install(handler)` swaps `globalThis.fetch`
// for the rest of the file; every earlier test in this file never saves, so it never needs one.
function install(handler) {
  globalThis.fetch = handler;
}

// Two readings of the same file, and they are not interchangeable.
//
// SOURCE keeps the comments, because "not in a comment" is part of the secrecy rule: a detail
// written into a comment in a public repository is published exactly as loudly as one written
// into a string.
//
// CODE blanks them, for the scans that are about what the module DOES. A file explaining why it
// must not reach for `window.open` would otherwise fail for containing the explanation -- the
// mistake this suite has made before (see authz.test.mjs).
const SOURCE = readFileSync(new URL('../views/contact.js', import.meta.url), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

// Sentinels, not plausible values. Every one is unique, none is a real detail, and the test
// below asserts that what reaches the screen is drawn from exactly this set.
const S = {
  name: 'SENTINELNAME',
  phone: '0000000001',
  whatsapp: '0000000002',
  email: 'SENTINELMAIL',
  site: 'SENTINELSITE',
  address: 'SENTINELADDRESS',
  blurb: 'SENTINELBLURB',
};

const mount = (contact, ctx) => {
  const el = node('div');
  render(el, { contact: { contact } }, ctx);
  return el;
};

const links = (el) => all(el).filter((n) => n.tagName === 'a');
const href = (el, needle) => links(el).find((n) => String(n.href).includes(needle));

// ── It renders what it was handed ──

test('every configured field reaches the card', () => {
  const painted = text(mount({ ...S }));
  for (const [key, value] of Object.entries(S)) {
    if (key === 'whatsapp') continue; // an action, not a printed row
    assert.ok(painted.includes(value), `the ${key} from the payload never reached the card`);
  }
});

test('a field the payload does not carry is omitted, not filled in', () => {
  const painted = text(mount({ name: S.name, phone: S.phone }));
  assert.ok(painted.includes(S.name));
  assert.ok(painted.includes(S.phone));
  // Nothing stands in for the four that were not sent. A placeholder that looks like a value is
  // worse than a missing row, and a hardcoded one is the whole thing this route exists to avoid.
  assert.doesNotMatch(painted, /דוא״ל|אתר|כתובת/, 'the card printed a label for a field it was never given');
});

// ── The two actions ──

test('both actions are plain links, built from the payload', () => {
  const el = mount({ ...S });

  const call = href(el, 'tel:');
  assert.ok(call, 'there was no way to call');
  assert.equal(call.tagName, 'a', 'the call action was not a link');
  assert.ok(call.href.includes(S.phone), 'the tel: link was not built from the payload’s number');

  const chat = href(el, 'wa.me');
  assert.ok(chat, 'there was no way to open a chat');
  assert.equal(chat.tagName, 'a', 'the chat action was not a link');
  assert.ok(chat.href.includes(S.whatsapp), 'the chat link was not built from the payload’s number');
  // The response headers already send no referrer. The attribute is the half that survives
  // somebody editing that header.
  assert.equal(chat.rel, 'noopener noreferrer', 'the outbound link carried no rel');
});

test('an action the payload cannot support is simply absent', () => {
  const el = mount({ name: S.name });
  assert.equal(links(el).length, 0, 'the card invented a link out of nothing');
});

// Neither a form nor a script-opened window: the shipped response headers forbid the first
// outright, and the second is a popup a phone browser may swallow with no visible failure.
test('nothing here submits a form or opens a window', () => {
  const el = mount({ ...S });
  assert.equal(all(el).some((n) => n.tagName === 'form'), false, 'the card grew a form');
  assert.doesNotMatch(CODE, /window\.open|\.submit\(|<form|'form'/, 'the card reached for a form or a popup');
});

// ── The unconfigured state ──

// This used to assert the blank card grew NOTHING to press — before the card was editable, an
// unfillable button would have been a lie. Now it is fillable, so the same emptiness gets a
// button instead: one way in, not a retry and not an error.
test('{"contact": null} is a quiet empty state with one way to fill it in, not an error', () => {
  const el = mount(null);

  assert.equal(byClass(el, 'empty').length, 1, 'the blank card was not the .empty style');
  assert.equal(byClass(el, 'empty empty--error').length, 0, 'an unconfigured card was painted as a failure');
  const painted = text(el);
  assert.doesNotMatch(painted, /רענון|נסו שוב|שגיאה|לא ניתן/, 'the blank card offered a retry for a state that is not a fault');

  const buttons = all(el).filter((n) => n.tagName === 'button');
  assert.equal(buttons.length, 1, 'the blank card offered no way in, or more than one');
});

test('a card with every field blank is the same quiet state, not a heading over nothing', () => {
  const el = mount({ name: '', phone: '   ', email: null, site: undefined, address: '', blurb: '', whatsapp: '' });
  assert.equal(byClass(el, 'empty').length, 1);
  assert.equal(links(el).length, 0);
});

// ── THE SECRECY CHECK ───────────────────────────────────────────────────────────────────────

// Against SOURCE, comments and all -- see the note beside its declaration.
test('the view carries no contact detail of its own', () => {
  // A mail address.
  assert.doesNotMatch(SOURCE, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'a mail address is written into the view');
  // A phone number, in any of the shapes one is written in.
  assert.doesNotMatch(SOURCE, /\d[\d\s().-]{5,}\d/, 'a number long enough to be a phone number is written into the view');
  assert.doesNotMatch(SOURCE, /\+\d{2,}/, 'an international dialling prefix is written into the view');

  // Every absolute URL in the file, against the one that is allowed. WhatsApp's link host is
  // the MECHANISM the contract names — it belongs to nobody in this system and identifies
  // nobody — and the number that completes it comes from the payload. Anything else is a
  // hostname this repository has no business knowing.
  const urls = SOURCE.match(/https?:\/\/[^\s'"`)]*/g) ?? [];
  for (const url of urls) {
    assert.equal(url, 'https://wa.me/', `the view names a host of its own: ${url}`);
  }
});

// The half a pattern cannot reach: a vendor NAME is just a word. So the module is rendered and
// what it paints is compared against what it was handed — a fallback name, a default blurb or a
// "call us at" baked into a label all fail here.
test('everything the card paints came out of the payload', () => {
  const painted = text(mount({ ...S }));

  // Strip the Hebrew labels the view owns, the sentinels it was given, and punctuation. What is
  // left must be nothing at all.
  const residue = painted
    .replace(new RegExp(Object.values(S).join('|'), 'g'), ' ')
    .replace(/[֐-׿\p{P}\p{S}\p{Zs}]/gu, ' ')
    .trim();

  assert.equal(residue, '', `the card painted something it was not given: "${residue}"`);
});

test('the blank card paints no Latin letter, no digit and no address', () => {
  // The likeliest hiding place for a vendor detail is the state where the payload has nothing:
  // a "meanwhile, call us on ..." reads as helpful and publishes the number to every visitor.
  const painted = text(mount(null));
  assert.doesNotMatch(painted, /[A-Za-z0-9@]/, `the blank card printed something of its own: "${painted}"`);
});

// ── THE EDIT FORM ────────────────────────────────────────────────────────────────────────────
//
// The owner's own design: the seven values moved out of a wrangler.toml var and into D1 behind
// the login session specifically so this card could be editable from the page itself. What
// follows is the affordance, not the secrecy rule above — that rule is unchanged and still holds
// over every value this form ever shows on screen, seeded or typed.

const editButton = (el) => all(el).find((n) => n.tagName === 'button' && /עריכ|הוספ/.test(n.textContent));
const inputsOf = (el) => all(el).filter((n) => n.tagName === 'input' || n.tagName === 'textarea');

test('pressing the edit control on an empty card opens all seven fields, none pre-filled', () => {
  const el = mount(null);
  editButton(el).handlers.click();

  const inputs = inputsOf(el);
  assert.equal(inputs.length, 7, 'the form did not carry all seven fields');
  for (const input of inputs) {
    assert.equal(input.value, '', 'a blank card pre-filled a field with a value of its own');
  }
  // Still no form element and still nothing but classes for style — the two rules that hold
  // for the read-only card hold for the form that edits it too.
  assert.equal(all(el).some((n) => n.tagName === 'form'), false, 'the edit form used a real <form>');
});

test('pressing edit on a configured card seeds the draft from what is on screen', () => {
  const el = mount({ ...S });
  editButton(el).handlers.click();

  const byId = Object.fromEntries(inputsOf(el).map((n) => [n.id, n.value]));
  for (const [key, val] of Object.entries(S)) {
    assert.equal(byId['contact-' + key], val, `the ${key} field did not seed from the card on screen`);
  }
});

test('saving calls PUT /api/contact with the draft and reloads once it succeeds', async () => {
  const el = mount({ ...S });
  let sent = null;
  install(async (path, init) => {
    sent = { path: String(path), method: init?.method, body: JSON.parse(init.body) };
    return { ok: true, status: 200, type: 'basic', json: async () => ({ contact: sent.body }) };
  });
  let reloaded = 0;
  render(el, { contact: { contact: { ...S } } }, { reload: async () => { reloaded += 1; } });

  editButton(el).handlers.click();
  const save = all(el).find((n) => n.tagName === 'button' && /שמיר/.test(n.textContent));
  await save.handlers.click();

  assert.equal(sent.path, '/api/contact');
  assert.equal(sent.method, 'PUT');
  assert.deepEqual(sent.body, S, 'the saved body was not the draft the form was showing');
  assert.equal(reloaded, 1, 'a successful save never asked the page to reload');
  assert.equal(inputsOf(el).length, 0, 'the form stayed open after a successful save');
});

test('a failed save keeps the form open with what was typed, and touches no upstream twice', async () => {
  const el = mount({ ...S });
  let calls = 0;
  install(async () => {
    calls += 1;
    return { ok: false, status: 500, type: 'basic', json: async () => ({ error: 'proxy_error' }) };
  });
  render(el, { contact: { contact: { ...S } } }, { reload: async () => { throw new Error('must not reload on failure'); } });

  editButton(el).handlers.click();
  const save = all(el).find((n) => n.tagName === 'button' && /שמיר/.test(n.textContent));
  await save.handlers.click();

  assert.equal(calls, 1);
  assert.equal(inputsOf(el).length, 7, 'a failed save closed the form and lost what was typed');
  assert.match(text(el), /לא אבד/, 'a failed save did not say the draft survived');
});

test('cancel discards the draft without calling the route at all', () => {
  const el = mount({ ...S });
  install(async () => { throw new Error('cancel must never reach the network'); });
  render(el, { contact: { contact: { ...S } } });

  editButton(el).handlers.click();
  assert.equal(inputsOf(el).length, 7, 'the form never opened');
  const cancel = all(el).find((n) => n.tagName === 'button' && /ביטול/.test(n.textContent));
  cancel.handlers.click();

  assert.equal(inputsOf(el).length, 0, 'cancel left the form open');
  assert.ok(editButton(el), 'cancel did not return to the read-only card');
});

test('the edit form is plain fields and buttons: no form tag, no innerHTML sink, no inline style', () => {
  assert.doesNotMatch(CODE, /innerHTML|insertAdjacentHTML/, 'the edit form used an HTML-parsing sink');
  assert.doesNotMatch(CODE, /\.style\.\w|setAttribute\(\s*['"]style['"]/, 'the edit form set an inline style, which the CSP blocks silently');
});
