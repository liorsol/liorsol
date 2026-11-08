#!/usr/bin/env node
// Merges a `claude` block (API-equivalent cost estimates, not billed) into data.json.
//
//   node free-usage/claude-usage.mjs [--limit-usd <n>]
//
// Reads ~/.claude/projects/**/*.jsonl (streamed; deduped by message.id, max output_tokens wins).
// Utilization %: Anthropic exposes no history, so if ~/.cache/cc-usage.json exists (written by
// ~/.claude/statusline-shared.sh) a snapshot is appended to ~/.cache/claude-usage-snapshots.jsonl
// and utilPct = max snapshot pct inside the window; otherwise null. estPctOfPeak is the fallback.
// data.json is public: only per-day/model/window aggregates are emitted, never paths or ids.

import { createReadStream, readFileSync, writeFileSync, readdirSync, statSync, appendFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRICING_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
// $/MTok: [input, 5m cache write, 1h cache write, cache read, output]
export const PRICES = {
  'claude-opus-5-5': [4, 5, 8, 0.2, 20],
  'claude-opus-5': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-8': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-7': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-6': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-5': [5, 6.25, 10, 0.5, 25],
  'claude-sonnet-5-5': [2, 2.5, 4, 0.1, 10],
  'claude-sonnet-5': [2, 2.5, 4, 0.2, 10],
  'claude-sonnet-4-6': [3, 3.75, 6, 0.3, 15],
  'claude-sonnet-4-5': [3, 3.75, 6, 0.3, 15],
  'claude-fable-5-1': [10, 12.5, 20, 0.25, 50],
  'claude-fable-5': [10, 12.5, 20, 1, 50],
  'claude-haiku-4-5': [1, 1.25, 2, 0.1, 5],
};
const HOUR = 3600e3, H5 = 5 * HOUR, WEEK = 7 * 24 * HOUR;
const round = (n) => Math.round(n * 100) / 100;
const normModel = (m) => String(m).replace(/-\d{8}$/, '').replace(/\[.*\]$/, '');

export function costOf(r) {
  const p = PRICES[normModel(r.model)];
  if (!p) return null;
  const w1 = r.c1 ?? 0, w5 = r.c5 ?? Math.max(0, r.cw - w1); // no split: all writes at 5m rate
  return (r.i * p[0] + w5 * p[1] + w1 * p[2] + r.cr * p[3] + r.o * p[4]) / 1e6;
}

// Keeps one compact record per message.id (the one with max output_tokens).
export function addLine(map, line) {
  if (!line.includes('"usage"')) return;
  let j; try { j = JSON.parse(line); } catch { return; }
  const m = j.message, u = m?.usage;
  if (j.type !== 'assistant' || !u || !m.model || m.model === '<synthetic>' || !j.timestamp) return;
  const t = Date.parse(j.timestamp);
  if (!Number.isFinite(t)) return;
  const cc = u.cache_creation;
  const rec = {
    t, model: normModel(m.model), i: u.input_tokens || 0, o: u.output_tokens || 0, cr: u.cache_read_input_tokens || 0,
    cw: u.cache_creation_input_tokens || 0,
    c5: cc ? cc.ephemeral_5m_input_tokens || 0 : null, c1: cc ? cc.ephemeral_1h_input_tokens || 0 : null,
  };
  const key = m.id || `${j.uuid}`;
  const old = map.get(key);
  if (!old || rec.o > old.o) map.set(key, rec);
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });

export function daily(recs) {
  const days = new Map();
  for (const r of recs) {
    const c = costOf(r); if (c == null) continue;
    const d = dayFmt.format(r.t), e = days.get(d) || {};
    e[r.model] = (e[r.model] || 0) + c; days.set(d, e);
  }
  return [...days].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, ms]) => ({
    date, models: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, round(v)])), total: round(Object.values(ms).reduce((a, b) => a + b, 0)),
  }));
}

// ccusage-style: block starts at first message floored to the UTC hour, lasts 5h; a message at/after the end, or >=5h after the previous one, opens a new block.
export function blocks5h(recs) {
  const out = []; let cur = null, last = 0;
  for (const r of [...recs].sort((a, b) => a.t - b.t)) {
    const c = costOf(r) ?? 0;
    if (!cur || r.t >= cur.end || r.t - last >= H5) {
      const s = Math.floor(r.t / HOUR) * HOUR; cur = { s, end: s + H5, cost: 0 }; out.push(cur);
    }
    cur.cost += c; last = r.t;
  }
  return out.map((b) => ({ s: b.s, end: b.end, cost: b.cost }));
}

export function weeks(recs, anchor) {
  const first = Math.min(...recs.map((r) => r.t));
  const a = anchor ?? Math.floor(first / HOUR) * HOUR;
  const byIdx = new Map();
  for (const r of recs) { const k = Math.floor((r.t - a) / WEEK); byIdx.set(k, (byIdx.get(k) || 0) + (costOf(r) ?? 0)); }
  return [...byIdx].sort(([x], [y]) => x - y).map(([k, cost]) => ({ s: a + k * WEEK, end: a + (k + 1) * WEEK, cost }));
}

export function withUtil(wins, snaps, pctKey, limit) {
  const peak = Math.max(0, ...wins.map((w) => w.cost));
  return wins.map((w) => {
    const ps = snaps.filter((s) => s.t >= w.s && s.t < w.end && s[pctKey] != null).map((s) => s[pctKey]);
    const o = {
      start: new Date(w.s).toISOString(), end: new Date(w.end).toISOString(),
      utilPct: ps.length ? Math.max(...ps) : null,
      estPctOfPeak: peak ? Math.round((w.cost / peak) * 1000) / 10 : 0, estCostUsd: round(w.cost),
    };
    if (limit) o.estPctOfLimit = Math.round((w.cost / limit) * 1000) / 10;
    return o;
  });
}

export function build(recs, snaps = [], { limit, now = new Date(), weekAnchor } = {}) {
  const priced = recs.filter((r) => PRICES[r.model]);
  const unpriced = [...new Set(recs.filter((r) => !PRICES[r.model]).map((r) => r.model))].sort();
  const cutoff = now.getTime() - 60 * 24 * HOUR;
  return {
    updatedAt: now.toISOString(), note: 'API-equivalent estimate, not billed', pricingSource: PRICING_SOURCE,
    dailyCost: daily(priced),
    windows5h: withUtil(blocks5h(priced), snaps, 'fivePct', limit).filter((w) => Date.parse(w.end) >= cutoff),
    weekly: priced.length ? withUtil(weeks(priced, weekAnchor), snaps, 'weekPct', limit) : [],
    unpriced,
  };
}

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n), st = statSync(p);
    if (st.isDirectory()) yield* walk(p); else if (n.endsWith('.jsonl')) yield p;
  }
}

function snapshots(home) {
  const cache = join(home, '.cache/cc-usage.json'), log = join(home, '.cache/claude-usage-snapshots.jsonl');
  const read = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  let all = read();
  if (existsSync(cache)) {
    try {
      const c = JSON.parse(readFileSync(cache, 'utf8')), t = statSync(cache).mtimeMs;
      const s = { t: new Date(t).toISOString(), fivePct: c.five_hour?.utilization ?? null, fiveResetsAt: c.five_hour?.resets_at ?? null, weekPct: c.seven_day?.utilization ?? null, weekResetsAt: c.seven_day?.resets_at ?? null };
      const l = all.at(-1);
      if (!l || l.t !== s.t) { appendFileSync(log, JSON.stringify(s) + '\n'); all.push(s); }
    } catch {}
  }
  return all.map((s) => ({ ...s, t: Date.parse(s.t) }));
}

async function main() {
  const home = homedir(), args = process.argv.slice(2);
  const li = args.indexOf('--limit-usd'), limit = li >= 0 ? Number(args[li + 1]) : undefined;
  const map = new Map();
  for (const f of walk(join(home, '.claude/projects')))
    for await (const line of createInterface({ input: createReadStream(f), crlfDelay: Infinity })) addLine(map, line);
  const snaps = snapshots(home);
  const wk = [...snaps].reverse().find((s) => s.weekResetsAt)?.weekResetsAt;
  const claude = build([...map.values()], snaps, { limit, weekAnchor: wk ? Date.parse(wk) % WEEK : undefined });
  const OUT = new URL('./data.json', import.meta.url);
  let prev = {}; try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch {}
  writeFileSync(OUT, JSON.stringify({ ...prev, claude }, null, 2) + '\n');
  console.log(`claude: ${claude.dailyCost.length} days, ${claude.windows5h.length} windows, ${claude.weekly.length} weeks, unpriced: ${claude.unpriced.join(',') || 'none'}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
