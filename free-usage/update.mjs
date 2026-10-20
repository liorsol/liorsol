#!/usr/bin/env node
// Refreshes data.json for the free-plan usage page.
//
//   node free-usage/update.mjs
//
// GitHub: uses the `gh` CLI's login, which needs the `user` scope for billing
//   (gh auth refresh -h github.com -s user).
// Cloudflare: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment.
//   A read-only token is enough: Account Analytics Read, Workers Scripts Read,
//   D1 Read, Workers KV Storage Read, Cloudflare Pages Read.
//   Without them the Cloudflare block from the previous data.json is kept.
//
// This repo is public, so data.json never holds account ids, emails or the names
// of private GitHub repos.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('./data.json', import.meta.url);
const MB = 1024 * 1024;
const now = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const sum = (xs, f = (x) => x) => xs.reduce((s, x) => s + (f(x) || 0), 0);

// ---------- GitHub ----------

// Included amounts for GitHub Free:
// https://docs.github.com/en/billing/reference/product-usage-included
const GH_INCLUDED = {
  actions_minutes: { name: 'Actions minutes', included: 2000, unit: 'min' },
  actions_storage: { name: 'Actions storage', included: 500, unit: 'MB' },
  lfs_storage: { name: 'Git LFS storage', included: 10, unit: 'GB' },
  lfs_bandwidth: { name: 'Git LFS bandwidth', included: 10, unit: 'GB' },
  packages_storage: { name: 'Packages storage', included: 500, unit: 'MB' },
  packages_transfer: { name: 'Packages transfer', included: 1, unit: 'GB' },
  codespaces_compute: { name: 'Codespaces compute', included: 120, unit: 'core-hours' },
  codespaces_storage: { name: 'Codespaces storage', included: 15, unit: 'GB-month' },
};

const gh = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 64 * MB }));
const ghPages = (path) =>
  JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', path], { encoding: 'utf8', maxBuffer: 64 * MB })).flat();

function github() {
  const login = gh('user').login;
  const repos = ghPages('user/repos?affiliation=owner&per_page=100');
  const isPrivate = Object.fromEntries(repos.map((r) => [r.name, r.private]));

  // Usage of one month, folded into the meters above. Storage SKUs are reported in
  // GB-hours (LFS) and GB-hours/MB-hours elsewhere; we divide by hours covered.
  const month = (y, m) => {
    const items = gh(`users/${login}/settings/billing/usage?year=${y}&month=${m}`).usageItems || [];
    const of = (pred) => items.filter(pred);
    const actions = of((i) => i.product === 'actions' && /minutes/i.test(i.unitType));
    const days = (xs) => new Set(xs.map((i) => i.date.slice(0, 10))).size || 1;
    const avg = (xs) => sum(xs, (i) => i.quantity) / (days(xs) * 24);
    const lfsStore = of((i) => i.product === 'git_lfs' && /storage/i.test(i.sku));
    const pkgStore = of((i) => i.product === 'packages' && /storage/i.test(i.sku));
    const actStore = of((i) => i.product === 'actions' && /storage/i.test(i.sku));
    const csStore = of((i) => i.product === 'codespaces' && /storage/i.test(i.sku));
    return {
      month: `${y}-${String(m).padStart(2, '0')}`,
      actionsPrivate: sum(actions.filter((i) => isPrivate[i.repositoryName]), (i) => i.quantity),
      actionsPublic: sum(actions.filter((i) => !isPrivate[i.repositoryName]), (i) => i.quantity),
      lfsStorageGb: round(avg(lfsStore), 3),
      lfsBandwidthGb: round(sum(of((i) => i.product === 'git_lfs' && /bandwidth/i.test(i.sku)), (i) => i.quantity), 3),
      packagesStorageMb: round(avg(pkgStore) * 1024, 1),
      packagesTransferGb: round(sum(of((i) => i.product === 'packages' && /transfer|bandwidth/i.test(i.sku)), (i) => i.quantity), 3),
      actionsStorageMb: round(avg(actStore) * 1024, 1),
      codespacesCoreHours: round(sum(of((i) => i.product === 'codespaces' && /compute/i.test(i.sku)), (i) => i.quantity), 1),
      codespacesStorageGb: round(avg(csStore), 2),
      billedUsd: round(sum(items, (i) => i.netAmount)),
    };
  };

  const monthly = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    monthly.push(month(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  const cur = monthly.at(-1);
  const used = {
    actions_minutes: cur.actionsPrivate,
    actions_storage: cur.actionsStorageMb,
    lfs_storage: cur.lfsStorageGb,
    lfs_bandwidth: cur.lfsBandwidthGb,
    packages_storage: cur.packagesStorageMb,
    packages_transfer: cur.packagesTransferGb,
    codespaces_compute: cur.codespacesCoreHours,
    codespaces_storage: cur.codespacesStorageGb,
  };

  return {
    updatedAt: now.toISOString(),
    login,
    period: cur.month,
    billedUsd: cur.billedUsd,
    publicActionsMinutes: cur.actionsPublic,
    allowances: Object.entries(GH_INCLUDED).map(([id, a]) => ({ id, ...a, used: used[id] })),
    monthly: monthly.map(({ month, actionsPrivate, actionsPublic, billedUsd }) => ({ month, actionsPrivate, actionsPublic, billedUsd })),
    repos: repos
      .map((r) => ({ name: r.name, private: r.private, sizeMb: round(r.size / 1024, 1), pushed: r.pushed_at?.slice(0, 10) }))
      .sort((a, b) => b.sizeMb - a.sizeMb)
      .map((r, i, all) => (r.private ? { ...r, name: `private repo ${all.slice(0, i + 1).filter((x) => x.private).length}` } : r)),
  };
}

// ---------- Cloudflare ----------

// Workers Free plan, daily limits reset 00:00 UTC:
// https://developers.cloudflare.com/workers/platform/limits/
// https://developers.cloudflare.com/d1/platform/pricing/
// https://developers.cloudflare.com/kv/platform/pricing/
// https://developers.cloudflare.com/durable-objects/platform/pricing/
// https://developers.cloudflare.com/pages/platform/limits/
const CF_INCLUDED = {
  workers_requests: { name: 'Workers requests', group: 'Workers', included: 100000, unit: 'requests / day', window: 'day' },
  d1_rows_read: { name: 'D1 rows read', group: 'D1', included: 5000000, unit: 'rows / day', window: 'day' },
  d1_rows_written: { name: 'D1 rows written', group: 'D1', included: 100000, unit: 'rows / day', window: 'day' },
  d1_storage: { name: 'D1 storage', group: 'D1', included: 5120, unit: 'MB total', window: 'total' },
  kv_reads: { name: 'KV reads', group: 'KV', included: 100000, unit: 'reads / day', window: 'day' },
  kv_writes: { name: 'KV writes', group: 'KV', included: 1000, unit: 'writes / day', window: 'day' },
  do_requests: { name: 'Durable Objects requests', group: 'Durable Objects', included: 100000, unit: 'requests / day', window: 'day' },
  pages_builds: { name: 'Pages builds', group: 'Pages', included: 500, unit: 'builds / month', window: 'month' },
};

async function cloudflare(token, account) {
  const api = async (path, init = {}) => {
    const res = await fetch('https://api.cloudflare.com/client/v4' + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const j = await res.json();
    if (j.errors?.length) throw new Error(`${path}: ${JSON.stringify(j.errors)}`);
    return j.result ?? j.data;
  };

  const today = ymd(now);
  const from = ymd(new Date(now - 29 * 864e5));
  const q = `query($a: String!, $s: Date!, $e: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    workers: workersInvocationsAdaptive(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { sum { requests errors } dimensions { date scriptName } }
    d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { sum { rowsRead rowsWritten } dimensions { date } }
    kv: kvOperationsAdaptiveGroups(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { sum { requests } dimensions { date actionType } }
    dobj: durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { sum { requests } dimensions { date } }
  } } }`;
  const [acct] = (await api('/graphql', { method: 'POST', body: JSON.stringify({ query: q, variables: { a: account, s: from, e: today } }) })).viewer.accounts;

  const dates = [];
  for (let t = new Date(from + 'T00:00:00Z'); ymd(t) <= today; t = new Date(+t + 864e5)) dates.push(ymd(t));
  const byDay = (rows, f, pred = () => true) => Object.fromEntries(dates.map((d) => [d, sum(rows.filter((r) => r.dimensions.date === d && pred(r)), f)]));
  const workers = byDay(acct.workers, (r) => r.sum.requests);
  const d1Read = byDay(acct.d1, (r) => r.sum.rowsRead);
  const d1Write = byDay(acct.d1, (r) => r.sum.rowsWritten);
  const kvRead = byDay(acct.kv, (r) => r.sum.requests, (r) => r.dimensions.actionType === 'read');
  const kvWrite = byDay(acct.kv, (r) => r.sum.requests, (r) => r.dimensions.actionType !== 'read');
  const doReq = byDay(acct.dobj, (r) => r.sum.requests);
  const daily = dates.map((d) => ({ date: d, workers: workers[d], d1Read: d1Read[d], d1Write: d1Write[d], kvRead: kvRead[d], kvWrite: kvWrite[d], doRequests: doReq[d] }));

  const d1 = await api(`/accounts/${account}/d1/database`);
  const projects = await api(`/accounts/${account}/pages/projects`);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const pages = [];
  for (const p of projects) {
    let builds = 0;
    for (let page = 1; page < 40; page++) {
      const deps = await api(`/accounts/${account}/pages/projects/${p.name}/deployments?per_page=25&page=${page}`);
      const recent = deps.filter((d) => d.created_on >= monthStart);
      builds += recent.length;
      if (recent.length < deps.length || deps.length < 25) break;
    }
    pages.push({ name: p.name, domains: p.domains, buildsThisMonth: builds });
  }

  const peak = (k) => Math.max(0, ...daily.map((d) => d[k]));
  const last = daily.at(-1);
  const meters = {
    workers_requests: ['workers', last.workers],
    d1_rows_read: ['d1Read', last.d1Read],
    d1_rows_written: ['d1Write', last.d1Write],
    d1_storage: [null, round(sum(d1, (x) => x.file_size) / MB, 2)],
    kv_reads: ['kvRead', last.kvRead],
    kv_writes: ['kvWrite', last.kvWrite],
    do_requests: ['doRequests', last.doRequests],
    pages_builds: [null, sum(pages, (p) => p.buildsThisMonth)],
  };

  const perScript = {};
  for (const r of acct.workers) perScript[r.dimensions.scriptName] = (perScript[r.dimensions.scriptName] || 0) + r.sum.requests;

  return {
    updatedAt: now.toISOString(),
    today,
    from,
    allowances: Object.entries(CF_INCLUDED).map(([id, a]) => {
      const [key, used] = meters[id];
      return { id, ...a, used, peak30d: key ? peak(key) : null };
    }),
    daily,
    workers: Object.entries(perScript).map(([name, requests30d]) => ({ name, requests30d })).sort((a, b) => b.requests30d - a.requests30d),
    d1: d1.map((x) => ({ name: x.name, sizeMb: round(x.file_size / MB, 2) })),
    pages,
  };
}

// ---------- main ----------

let prev = {};
try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch {}

const out = { github: github(), cloudflare: prev.cloudflare ?? null };
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (token && account) out.cloudflare = await cloudflare(token, account);
else console.warn('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set: keeping the previous Cloudflare data.');

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${OUT.pathname}`);
