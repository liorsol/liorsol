// views/session-limits.js — the limit each charging session ran under, for the #/history table.
//
// The private service keeps no per-session record of it, only the action log behind #/log, so
// sessionLimits() replays those rows through the one armed slot the service itself has.

import { isLiveSession, startMs, stopMs } from '../api.js';

// A closing row is written after the stop it reports, so it may land just past the stop stamp.
const SLACK_MS = 2 * 60 * 1000;

const reachedBy = (row, kwh) => Number(row.totalEnergy) >= kwh;

/**
 * Pure: no DOM, no clock.
 * shortcut: the service returns only the newest 300 events, so an older session reads as having
 * had no limit. Upgrade to a per-session record on the private service once the table has to be
 * right further back than that.
 * @param {object[]} events `{ ts, type, ok, detail }`, newest first
 * @param {object[]} sessions the history rows
 * @param {object} [armed] the /api/limit row, `{ kwh, sessionId, setAt }`
 * @returns {Map<object, { kwh: number, reached: boolean, live?: boolean }>} keyed by session row
 */
export function sessionLimits(events, sessions, armed) {
  const limits = new Map();
  const rows = Array.isArray(sessions) ? sessions : [];
  const latest = (fits) =>
    rows.filter(fits).reduce((best, row) => (best && startMs(best) >= startMs(row) ? best : row), null);

  let slot = null;
  for (const e of Array.isArray(events) ? [...events].reverse() : []) {
    if (!e.ok) continue; // a failed stop leaves the limit armed; the next tick retries
    if (e.type === 'limit_set') {
      slot = { kwh: Number(e.detail), at: e.ts };
    } else if (slot && (e.type === 'auto_stop' || e.type === 'limit_clear')) {
      const stopped = e.type === 'auto_stop';
      let row = null;
      if (stopped) row = latest((r) => startMs(r) <= e.ts && e.ts <= stopMs(r) + SLACK_MS);
      // Must have stopped by the tick: a session started since then is not the one that ended.
      else if (e.detail === 'ended') {
        row = latest((r) => startMs(r) < e.ts && stopMs(r) >= slot.at && stopMs(r) <= e.ts + SLACK_MS);
      }
      if (row) limits.set(row, { kwh: slot.kwh, reached: stopped || reachedBy(row, slot.kwh) });
      slot = null;
    }
  }

  if (armed) {
    const bound = armed.sessionId != null
      && rows.find((r) => String(r.sessionId) === String(armed.sessionId));
    const row = bound || rows.find(isLiveSession);
    if (row) {
      const live = isLiveSession(row);
      limits.set(row, { kwh: armed.kwh, reached: !live && reachedBy(row, armed.kwh), live });
    }
  }
  return limits;
}

/** The table cell. One wrapper, because the phone layout spreads a cell's children apart. */
export function limitCell(limit) {
  const td = document.createElement('td');
  if (!limit) return td;
  const box = document.createElement('span');
  const amount = document.createElement('bdi'); // else a card reads "kWh 8" and the table "8 kWh"
  amount.textContent = limit.kwh + ' kWh ';
  box.appendChild(amount);
  const chip = document.createElement('span');
  chip.className = limit.live ? 'chip chip--info' : limit.reached ? 'chip chip--ok' : 'chip';
  chip.textContent = limit.live ? 'פעילה' : limit.reached ? 'הושגה' : 'לא הושגה';
  box.appendChild(chip);
  td.appendChild(box);
  return td;
}
