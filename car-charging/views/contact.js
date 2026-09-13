// ── views/contact.js — the contact card, and the form that edits it ──
//
// THIS FILE CONTAINS NO CONTACT DETAIL AND MUST NEVER GROW ONE. No name, no number, no address,
// no mail address, no site — not as a constant, not as a fallback for a missing field, not in a
// comment and not in a test fixture. Everything visible here arrives in `/api/contact` at
// runtime and is configured on the private half, which now means the D1 `contact` table behind
// the login session rather than a wrangler.toml var — a boundary this file never has to know
// about, because it only ever sees the same `{contact:{...}|null}` shape either way.
//
// That is the entire reason this route exists rather than a block of markup. This repository is
// public and search-indexed, and the sign-in screen renders to anonymous visitors — so a detail
// written into the page is a detail published to everyone who finds the page, whether or not
// they can get past the gate. `test/contact.test.mjs` renders this module and fails if anything
// it paints was not in the payload it was handed.
//
// `{"contact": null}` is a configured state, not a failure: the far side has nothing to say
// yet. It renders as a quiet `.empty` — no ⚠, no "try again". An error card would send the owner
// looking for a fault in a system that is working exactly as configured. It is NOT a dead end,
// though: the whole point of moving these seven fields into D1 was to make the card editable
// from here, so the empty state carries the same way to fill itself in as the filled one does.
//
// THE TWO ACTIONS ARE PLAIN LINKS, and both facts matter. The shipped CSP restricts what the
// page may LOAD; `form-action 'none'` does not apply to a navigation, so an <a href> works
// where a form would be blocked outright and `window.open` would be a popup a phone browser
// may swallow. The WhatsApp link also carries `rel="noopener noreferrer"` — the response
// headers already set `Referrer-Policy: no-referrer`, but the `rel` is the half that survives
// somebody editing that header.
//
// textContent only, everywhere, including the edit form: nothing here builds markup out of a
// string, and there is no HTML-parsing sink anywhere in this module. Nor is any style set from
// this module — the shipped CSP blocks an inline style declaration silently, and the only thing
// that reads as is a layout bug, so every look the form needs comes from a class.
//
// SAVING IS THE ONE THING HERE THAT MAY REACH UPSTREAM, and only on a press: a view switch and
// an idle page fetch nothing, exactly like every other panel, but `updateContact` is a save —
// the same exception the comment board's post button already is.

import { updateContact } from '../api.js';

// Nothing is imported from ./he.js because nothing here is a number, a time or a piece of
// upstream vocabulary: every string on this card is prose the far side configured, rendered
// exactly as it arrived. A formatter applied to a name or an address would be a transformation
// of somebody's own spelling of it.

// WhatsApp's own public link host. It is the mechanism, not an identity: it names no vendor,
// belongs to nobody in this system, and the number that completes it comes from the payload.
const WHATSAPP = 'https://wa.me/';

// The seven fields the edit form carries, in the order they are laid out. Same set the read
// view already knows as FIELDS below, plus `name` and `blurb`, which that list holds apart
// because they are painted differently (a heading, a paragraph) rather than a label/value row.
const EDIT_FIELDS = [
  ['name', 'שם'],
  ['phone', 'טלפון'],
  ['whatsapp', 'וואטסאפ'],
  ['email', 'דוא״ל'],
  ['site', 'אתר'],
  ['address', 'כתובת'],
  ['blurb', 'תיאור'],
];

// Module memory, like the comment board's `board`: the draft and the busy/error state have to
// survive a repaint that is not this module's own doing (a theme switch, a sibling view's
// reload), the same reason `board.draft` in views/comments.js does. Gone on an actual page
// reload, which is fine — there is nothing here worth remembering across one.
const form = { editing: false, busy: false, error: null, draft: null };
let mount = null; // { el, state, ctx }

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// A field is shown when the payload has something to show. Missing, null and blank are one
// state — absent — and the card simply omits the row rather than printing a placeholder that
// looks like a value.
const value = (raw) => (typeof raw === 'string' && raw.trim() ? raw.trim() : null);

// Hebrew labels, Latin values. The values are whatever came back, verbatim.
const FIELDS = [
  ['phone', 'טלפון'],
  ['email', 'דוא״ל'],
  ['site', 'אתר'],
  ['address', 'כתובת'],
];

export function render(el, state, ctx) {
  // The draft belongs to a mounted element, not to the module for all time: a genuine repaint of
  // the SAME panel body (a theme switch, a sibling view's reload) must leave an open form alone,
  // but a fresh element — a brand new panel, or this module rendered from scratch — starts from
  // the read-only card. `app.js` reuses one `<div>` per panel across its whole lifetime, so this
  // never fires on an ordinary repaint; it is what a first mount actually is.
  if (mount && mount.el !== el) {
    form.editing = false;
    form.busy = false;
    form.error = null;
    form.draft = null;
  }
  mount = { el, state, ctx };
  paint();
}

function paint() {
  if (!mount) return;
  const { el, state } = mount;
  // `state.contact` is the response body; `body.contact` is the card or null.
  const card = state?.contact?.contact ?? null;
  el.replaceChildren(form.editing ? buildForm() : buildView(card));
}

function buildView(card) {
  const fields = FIELDS.map(([key, label]) => [label, value(card?.[key])]).filter(([, v]) => v);
  const name = value(card?.name);
  const blurb = value(card?.blurb);
  const phone = value(card?.phone);
  const whatsapp = value(card?.whatsapp);

  const frag = document.createDocumentFragment();

  if (!name && !blurb && !fields.length && !whatsapp) {
    frag.append(empty());
  } else {
    if (name) frag.append(make('h3', 'contact__name', name));
    if (blurb) frag.append(make('p', 'contact__blurb', blurb));

    if (fields.length) {
      const list = make('dl', 'contact__list');
      for (const [label, text] of fields) {
        list.append(make('dt', 'contact__label', label), make('dd', 'contact__value', text));
      }
      frag.append(list);
    }

    const actions = make('div', 'btn-row contact__actions');
    if (phone) actions.append(link('btn btn--primary', '📞 חיוג', 'tel:' + dialable(phone)));
    if (whatsapp) {
      const chat = link('btn', '💬 וואטסאפ', WHATSAPP + encodeURIComponent(digits(whatsapp)));
      // Kept even though the response headers already send no referrer: a header is edited in
      // one file by one person, and this attribute is what still holds when that happens.
      chat.rel = 'noopener noreferrer';
      actions.append(chat);
    }
    if (actions.children.length) frag.append(actions);
  }

  // Reachable from either shape of the card, and that is the point: a blank card used to be a
  // dead end behind a menu item that only existed to lead to it. It is now the entry point, so
  // it gets the same button a filled-in card does, only worded for what it is about to do.
  const edit = make('button', 'btn contact__edit', card ? 'עריכת פרטי הקשר' : 'הוספת פרטי קשר');
  edit.type = 'button';
  edit.addEventListener('click', () => startEdit(card));
  frag.append(edit);

  return frag;
}

function link(className, label, href) {
  const anchor = make('a', className, label);
  anchor.href = href;
  return anchor;
}

// The scheme is ours and the rest is reduced to what a dialler can use, so nothing in the
// payload can steer the href somewhere else. The value on screen above is untouched.
const dialable = (raw) => raw.replace(/[^\d+]/g, '');
const digits = (raw) => raw.replace(/\D/g, '');

function empty() {
  const box = make('div', 'empty');
  box.append(
    make('div', 'empty__icon', '📇'),
    make('p', 'empty__title', 'אין כאן פרטי קשר'),
    make('p', 'empty__hint', 'עדיין לא מולאו פרטי קשר ללוח הזה.')
  );
  return box;
}

// ── The edit form ──
//
// One form, all seven fields, one save: the card is a single D1 row, not seven independent
// settings, so there is no partial-save shape to design. `draft` is seeded from the card that
// was on screen when the button was pressed — the current values for a filled-in card, or a
// blank string for each field on an empty one, never a placeholder that looks like a value.

function startEdit(card) {
  form.draft = Object.fromEntries(EDIT_FIELDS.map(([key]) => [key, value(card?.[key]) ?? '']));
  form.editing = true;
  form.error = null;
  paint();
}

function buildForm() {
  const wrap = make('div', 'contact__form');

  for (const [key, label] of EDIT_FIELDS) {
    const id = 'contact-' + key;
    const field = make('div', 'field');
    const lbl = make('label', 'field__label', label);
    lbl.htmlFor = id;
    const multiline = key === 'blurb';
    const control = document.createElement(multiline ? 'textarea' : 'input');
    control.className = multiline ? 'textarea' : 'input';
    control.id = id;
    if (!multiline) control.type = 'text';
    control.value = form.draft[key];
    control.addEventListener('input', () => {
      form.draft[key] = control.value;
    });
    field.append(lbl, control);
    wrap.append(field);
  }

  if (form.error) wrap.append(make('p', 'btn-note', form.error));

  const actions = make('div', 'btn-row contact__form-actions');
  const save = make('button', 'btn btn--primary', form.busy ? 'שומר…' : 'שמירה');
  save.type = 'button';
  if (form.busy) {
    save.classList.add('is-busy');
    save.disabled = true;
    save.setAttribute('aria-busy', 'true');
  }
  save.addEventListener('click', onSave);

  const cancel = make('button', 'btn', 'ביטול');
  cancel.type = 'button';
  cancel.disabled = form.busy;
  cancel.addEventListener('click', onCancel);

  actions.append(save, cancel);
  wrap.append(actions);
  return wrap;
}

async function onSave() {
  if (form.busy) return;
  form.busy = true;
  form.error = null;
  paint();

  const result = await updateContact(form.draft);
  form.busy = false;

  if (!result.ok) {
    // Nothing typed is lost either way: the draft stays in `form.draft` and the form stays open.
    form.error = result.error === 'auth_required'
      ? 'ההתחברות לדף הסתיימה. טענו את הדף מחדש כדי להתחבר שוב — הטופס עדיין מלא כפי שמילאתם.'
      : 'השמירה נכשלה. שום דבר לא אבד — הטופס עדיין מלא כפי שמילאתם.';
    paint();
    return;
  }

  form.editing = false;
  form.error = null;
  form.draft = null;
  paint();
  // A save is a press, so — unlike a view switch — it may reach upstream. The next round reads
  // the card straight back from the same route GET already uses, rather than trusting the
  // response this call got: one source of truth for what "saved" means, the same reason PUT's
  // own handler on the private half re-reads its own write instead of echoing what it was sent.
  await mount?.ctx?.reload();
}

function onCancel() {
  if (form.busy) return;
  form.editing = false;
  form.error = null;
  form.draft = null;
  paint();
}
