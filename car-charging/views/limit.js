// views/limit.js — the charge limit: "stop by itself after N kWh".
//
// This panel writes a NUMBER and nothing else. The stop it leads to is fired by the private
// service's ten-minute cron, through the same server-side stop the stop button uses — so this
// module imports no command and holds no path to the contactor, and views/controls.js stays the
// only place on the page that can press one.
//
// render(el, state, ctx): `state.limit` is the /api/limit body, `{ limit: null | { kwh,
// sessionId, setAt } }`. A press reloads with force=false: setting a limit changes no charger
// state, so there is nothing upstream worth forcing.

import { isLiveSession, setLimit, clearLimit } from '../api.js';
import { n } from './he.js';

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  return node;
}

// Kept across a repaint so a refused save still says why after the round that follows it.
let note = null;
let busy = false;

async function act(el, state, ctx, call) {
  if (busy) return;
  busy = true;
  note = null;
  render(el, state, ctx);
  const result = await call();
  busy = false;
  if (!result.ok) note = 'השמירה נכשלה. נסו שוב.';
  // A bounce is news about the sign-in, and the round is what raises the sign-in card.
  if (result.ok || result.error === 'auth_required') await ctx.reload(false);
  else render(el, state, ctx);
}

export function render(el, state, ctx) {
  const limit = state?.limit?.limit ?? null;
  const sessions = state?.state?.sessions;
  const live = Array.isArray(sessions) ? sessions.find(isLiveSession) : null;
  el.replaceChildren();

  if (limit) {
    el.appendChild(h('p', null, 'הטעינה תיעצר מעצמה אחרי ' + n(limit.kwh, 1) + ' kWh.'));
    if (live && live.totalEnergy != null) {
      el.appendChild(h('p', 'empty__hint', 'נטענו עד עכשיו ' + n(Number(live.totalEnergy), 1) + ' kWh.'));
    } else {
      el.appendChild(h('p', 'empty__hint', 'אין טעינה פעילה — ההגבלה תחול על הטעינה הבאה.'));
    }
    const row = h('div', 'btn-row');
    const cancel = h('button', 'btn', busy ? 'מבטל…' : 'ביטול ההגבלה');
    cancel.type = 'button';
    cancel.disabled = busy;
    cancel.addEventListener('click', () => act(el, state, ctx, clearLimit));
    row.appendChild(cancel);
    el.appendChild(row);
  } else {
    const form = h('div', 'inline-form');
    const field = h('div', 'field');
    const label = h('label', 'field__label', 'לעצור אחרי (kWh)');
    const input = h('input', 'input');
    input.id = 'limit-kwh';
    label.htmlFor = input.id;
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0.5';
    input.step = '0.5';
    input.placeholder = 'למשל 10';
    field.append(label, input);
    const save = h('button', 'btn btn--primary', busy ? 'שומר…' : 'הגדרה');
    save.type = 'button';
    save.disabled = busy;
    save.addEventListener('click', () => {
      const kwh = Number(input.value);
      if (!input.value || !Number.isFinite(kwh) || kwh <= 0) {
        note = 'הזינו כמות חיובית בקוט״ש.';
        render(el, state, ctx);
        return;
      }
      act(el, state, ctx, () => setLimit(kwh));
    });
    form.append(field, save);
    el.appendChild(form);
  }

  if (note) el.appendChild(h('p', 'form-error', note));
  // Said once, plainly: the check is every ten minutes, so the stop lands a little past the mark.
  el.appendChild(h('p', 'empty__hint', 'נבדק כל 10 דקות, כך שהעצירה עשויה לעבור את היעד במעט.'));
}
