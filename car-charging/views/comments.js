// ── S8 comment board ──
//
// An inbox for future work, not a social feed. Everything lives in one D1 table read live on
// every call, and `GET /api/comments?archived=include` returns the whole backlog as JSON in one
// request, which is how a later automated session reads this board.
//
// Two properties matter more than anything else this file does:
//
//   1. Every server-supplied string is set with textContent. There is no HTML-parsing sink in
//      this module — not for the text, not for the author, not for the timestamp. That is not
//      general hygiene: this page can stop a charge, and the board is documented as an
//      instruction channel for an agent session that reads it. Markup that executes here does
//      not need to steal a cookie; it can just press the buttons.
//   2. The ✕ button archives. There is no delete: the route answers DELETE with 405, and an
//      archived row stays in the table, stays readable, and keeps reporting its flag so a reader
//      can tell an archived note from one that was dropped.
//
// The board's copy is Hebrew and the page is RTL, but the ROUTE is not: its path, its query
// parameters, its JSON keys and its error names stay English, because the caller that matters
// most for them is a machine. Note text itself is whatever the owner typed, in any script, and
// is never transformed on the way to the screen — no case folding, no trimming beyond the post
// itself. Hebrew has no capitals, so a case transform would be a no-op on the Hebrew half of a
// mixed note and a silent corruption of the Latin half.

import { getComments, postComment, updateComment } from '../api.js';
import { dayTime } from './he.js';

// The sign-in that has ended, worded the same way app.js words it. Refreshing cannot mend it.
const SIGNED_OUT = 'ההתחברות לדף הסתיימה. טענו את הדף מחדש כדי להתחבר שוב — רענון לא יחזיר אותה.';

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Provenance is the server's to assign, not this page's: the route derives `author` from the
// authenticated caller and discards whatever the body claims. A board documented as a hand-off
// channel to a later automated reader cannot let its only trust signal be forgeable by whatever
// posted. This constant is sent because the client's call signature declares the field; it is
// decoration, and the rendered author below is always the one that came back.
const AUTHOR = 'owner';

// Module memory, not browser storage. Everything here is gone on reload.
const board = {
  comments: [], // last successful list — never blanked by a later failure
  loaded: false,
  showArchived: false,
  error: null,
  busy: false,
  draft: '', // survives a repaint, not a reload
};

let mount = null; // { el, ctx }
let sequence = 0; // discards the answer to a request that a newer one has overtaken

export function render(el, state, ctx) {
  mount = { el, ctx };
  paint();
  load();
}

// Archived rows are included, never fetched on their own: the board should read as one list with
// the archived ones visibly set aside, which is what the stylesheet's dashed inset row is for.
async function load() {
  const mine = ++sequence;
  const result = await getComments(board.showArchived ? 'include' : 'exclude');
  if (mine !== sequence) return;

  if (result.ok && Array.isArray(result.data?.comments)) {
    board.comments = result.data.comments;
    board.loaded = true;
    board.error = null;
  } else {
    // Keep whatever is already on screen. A failed read is never a reason to blank the board.
    //
    // This board owns its own failure text (it fetches its own rows), so it owns this split
    // too: app.js makes the same one for the panels it feeds. On a cold load while the viewer
    // is signed out this is the ONLY panel that mounts -- nothing gates it -- so "press
    // refresh" here is the whole page's instruction, and it is the one action that provably
    // cannot work. Only a top-level navigation can follow the edge's redirect to the sign-in.
    board.error = result.error === 'auth_required' ? SIGNED_OUT : 'לא ניתן היה לטעון את ההערות. לחצו רענון כדי לנסות שוב.';
  }
  paint();
}

function paint() {
  if (!mount) return;
  const { el } = mount;
  const frag = document.createDocumentFragment();

  // Not a <form> element. Nothing on this page submits a form — the response headers forbid it
  // outright — and the page carries a credential field in one state, so a form the browser's
  // password manager can find is a liability with no upside. The class is what styles it.
  const composer = make('div', 'comment-form');
  const field = make('div', 'field');
  const label = make('label', 'field__label', 'הערה חדשה');
  label.htmlFor = 'comment-text';
  const textarea = make('textarea', 'textarea');
  textarea.id = 'comment-text';
  textarea.placeholder = 'מה קרה?';
  textarea.value = board.draft;
  textarea.addEventListener('input', () => {
    board.draft = textarea.value;
  });
  field.append(label, textarea);

  const actions = make('div', 'comment-form__actions');
  const post = make('button', 'btn btn--primary btn--small', board.busy ? 'מפרסם…' : 'פרסום');
  post.type = 'button';
  if (board.busy) {
    post.classList.add('is-busy');
    post.disabled = true;
    post.setAttribute('aria-busy', 'true');
  }
  post.addEventListener('click', () => onPost(textarea));
  actions.append(post);
  composer.append(field, actions);
  frag.append(composer);

  if (board.busy) frag.append(make('p', 'btn-note', 'מפרסם — הכפתור נעול עד שההערה נשמרת.'));

  const filter = make('div', 'comments__filter');
  const filterLabel = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'show-archived';
  checkbox.checked = board.showArchived;
  checkbox.addEventListener('change', () => {
    board.showArchived = checkbox.checked;
    paint();
    load();
  });
  filterLabel.append(checkbox, document.createTextNode(' הצגת הארכיון'));
  filter.append(filterLabel);
  frag.append(filter);

  if (board.error) frag.append(errorBlock(board.error, board.comments.length > 0));

  if (board.comments.length) {
    const list = make('ul', 'comment-list');
    for (const comment of board.comments) list.append(row(comment));
    frag.append(list);
  } else if (board.loaded && !board.error) {
    const empty = make('div', 'empty');
    empty.append(
      make('div', 'empty__icon', '🗒'),
      make('p', 'empty__title', 'אין עדיין הערות'),
      make(
        'p',
        'empty__hint',
        board.showArchived
          ? 'שום דבר לא נכתב על הלוח הזה, לא בארכיון ולא מחוצה לו.'
          : 'אין הערות פתוחות. סמנו “הצגת הארכיון” אם אתם מחפשים משהו שהועבר לשם.'
      )
    );
    frag.append(empty);
  }

  el.replaceChildren(frag);
}

function errorBlock(message, keepingData) {
  if (keepingData) return make('p', 'btn-note', message + ' ההערות שלמטה הן האחרונות שנטענו.');
  const block = make('div', 'empty empty--error');
  block.append(
    make('div', 'empty__icon', '⚠'),
    make('p', 'empty__title', 'לא ניתן לטעון את ההערות'),
    make('p', 'empty__hint', message)
  );
  return block;
}

function row(comment) {
  const done = comment.status === 'done';
  const archived = comment.archived === true;

  let className = 'comment';
  if (done) className += ' comment--done';
  if (archived) className += ' comment--archived';
  const item = make('li', className);

  // Order is load-bearing: the row is a two-column grid and expects meta, actions, text.
  const meta = make('div', 'comment__meta');
  meta.append(
    // The author the server returned, never the one this page sent. The stylesheet appends the
    // "archived" tag after this element itself — writing the word in as well would double it.
    make('span', 'comment__author', String(comment.author ?? '')),
    make('span', 'comment__time', when(comment.ts))
  );

  const actions = make('div', 'comment__actions');

  const toggle = make('button', 'btn btn--icon btn--small comment__toggle', '✓');
  toggle.type = 'button';
  // The pressed style keys off the attribute, not a class, so both have to be right.
  toggle.setAttribute('aria-pressed', done ? 'true' : 'false');
  toggle.append(make('span', 'sr-only', done ? 'סימון כפתוח' : 'סימון כבוצע'));
  toggle.addEventListener('click', () => patch(comment.id, { status: done ? 'open' : 'done' }, toggle));

  const archive = make('button', 'btn btn--icon btn--small comment__archive', archived ? '↩' : '✕');
  archive.type = 'button';
  archive.append(make('span', 'sr-only', archived ? 'שחזור מהארכיון' : 'העברה לארכיון'));
  // A boolean on the wire. The column behind it is an integer, but the route answers 400 to a
  // number and it is the route's shape that counts. Archiving never deletes: the row stays.
  archive.addEventListener('click', () => patch(comment.id, { archived: !archived }, archive));

  actions.append(toggle, archive);

  const text = make('p', 'comment__text');
  text.textContent = String(comment.text ?? ''); // pre-wrap, so pasted multi-line text survives

  item.append(meta, actions, text);
  return item;
}

async function onPost(textarea) {
  if (board.busy) return;
  const text = textarea.value.trim();
  if (!text) return;

  board.busy = true;
  board.draft = text;
  paint();

  const result = await postComment({ author: AUTHOR, text });
  board.busy = false;

  if (!result.ok) {
    board.error = result.error === 'auth_required'
      ? 'ההערה לא נשמרה: ההתחברות לדף הסתיימה. טענו את הדף מחדש כדי להתחבר שוב — הטקסט עדיין בתיבה שלמעלה.'
      : 'ההערה לא נשמרה. שום דבר לא אבד — היא עדיין בתיבה שלמעלה.';
    paint();
    return;
  }

  board.draft = '';
  board.error = null;
  if (result.data?.comment) board.comments = [result.data.comment, ...board.comments];
  paint();
  await mount.ctx.reload();
}

async function patch(id, change, button) {
  if (button.disabled) return;
  const label = button.firstChild;
  button.classList.add('is-busy');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (label) label.textContent = '…';

  const result = await updateComment(id, change);

  if (!result.ok) {
    board.error = 'השינוי הזה לא נשמר.';
    paint();
    return;
  }

  board.error = null;
  const updated = result.data?.comment;
  if (updated) {
    board.comments = board.comments
      .map((c) => (c.id === updated.id ? updated : c))
      // Archiving while archived rows are hidden takes the row off this list, exactly as the
      // next read would. The row itself is untouched in the table.
      .filter((c) => board.showArchived || c.archived !== true);
  }
  paint();
  await mount.ctx.reload();
}

function when(ts) {
  return typeof ts === 'number' ? dayTime(ts) : '';
}
