// views/log.js — #/log: what the system DID, newest first, filterable by kind of action.
//
// render(el, state, ctx): `state.events` is the /api/events body, `{ events: [{ id, ts, type,
// ok, detail }] }`. The private service writes one row per action it performs; reads and
// refreshes are not actions and never appear. Filtering is client-side over rows the load round
// already holds — a filter change fetches nothing, the same rule as a menu press.
//
// `detail` is a number or one of the service's own error names, never upstream text, and it is
// rendered with textContent like everything else on this page.

import { dateTime } from './he.js';

const TYPES = {
  start: 'התחלת טעינה',
  stop: 'עצירת טעינה',
  auto_stop: 'עצירה אוטומטית (הגבלה)',
  limit_set: 'הגדרת הגבלה',
  limit_clear: 'ביטול הגבלה',
  sign_in: 'כניסה',
  revoke: 'ניתוק חיבור',
  contact: 'עדכון פרטי קשר',
  token: 'החלפת הרשאה',
};
// An unknown type renders as itself rather than vanishing from a log.
const typeLabel = (t) => TYPES[t] ?? t;

// The detail column, in words where the value is one of ours.
const DETAILS = {
  ended: 'הטעינה הסתיימה',
  owner: 'בוטלה ידנית',
  self: 'הדפדפן הנוכחי',
  no_live_session: 'אין טעינה פעילה',
};
function detailText(e) {
  if (e.detail == null) return '';
  if (DETAILS[e.detail]) return DETAILS[e.detail];
  if (e.type === 'limit_set') return e.detail + ' kWh';
  if (e.type === 'auto_stop' && e.ok) return e.detail.replace('/', ' מתוך ') + ' kWh';
  return e.detail;
}

const COLUMNS = ['זמן', 'פעולה', 'תוצאה', 'פרטים'];

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  return node;
}

let filter = ''; // '' = every type. Module memory: survives a repaint, resets on reload.

export function render(el, state, ctx) {
  const events = Array.isArray(state?.events?.events) ? state.events.events : [];
  el.replaceChildren();

  if (!events.length) {
    const box = h('div', 'empty');
    box.append(h('div', 'empty__icon', '🗒'), h('p', 'empty__title', 'עוד לא נרשמו פעולות'));
    el.appendChild(box);
    return;
  }

  const form = h('div', 'inline-form');
  const field = h('div', 'field');
  const label = h('label', 'field__label', 'סוג פעולה');
  const select = h('select', 'input');
  select.id = 'log-filter';
  label.htmlFor = select.id;
  const types = [...new Set(events.map((e) => e.type))];
  for (const [value, text] of [['', 'הכל'], ...types.map((t) => [t, typeLabel(t)])]) {
    const opt = h('option', null, text);
    opt.value = value;
    opt.selected = value === filter;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    filter = select.value;
    render(el, state, ctx);
  });
  field.append(label, select);
  form.appendChild(field);
  el.appendChild(form);

  const shown = filter ? events.filter((e) => e.type === filter) : events;
  const wrap = h('div', 'table-wrap');
  wrap.style.setProperty('margin-block-start', 'var(--sp-4)'); // a style="" would be CSP-blocked
  const table = h('table', 'table');
  const head = h('tr');
  for (const c of COLUMNS) head.appendChild(h('th', null, c));
  table.appendChild(h('thead')).appendChild(head);
  const body = h('tbody');
  for (const e of shown) {
    const tr = h('tr');
    tr.appendChild(h('td', null, dateTime(e.ts)));
    tr.appendChild(h('td', null, typeLabel(e.type)));
    const res = h('td');
    res.appendChild(h('span', e.ok ? 'chip chip--ok' : 'chip chip--bad', e.ok ? 'הצליח' : 'נכשל'));
    tr.appendChild(res);
    tr.appendChild(h('td', null, detailText(e)));
    for (let i = 0; i < tr.children.length; i++) tr.children[i].dataset.label = COLUMNS[i];
    body.appendChild(tr);
  }
  table.appendChild(body);
  wrap.appendChild(table);
  el.appendChild(wrap);
}
