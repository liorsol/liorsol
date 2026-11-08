import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLine, costOf, blocks5h, build, withUtil } from './claude-usage.mjs';

const line = (id, ts, o, extra = {}) => JSON.stringify({
  type: 'assistant', timestamp: ts, cwd: '/Users/x/secret', sessionId: 's1', uuid: 'u' + id,
  message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...extra } },
});

test('dedupe keeps max output_tokens per message id', () => {
  const m = new Map();
  addLine(m, line('msg_1', '2026-08-02T10:00:00Z', 5));
  addLine(m, line('msg_1', '2026-08-02T10:00:01Z', 500));
  addLine(m, line('msg_1', '2026-08-02T10:00:02Z', 50));
  addLine(m, 'not json "usage"');
  assert.equal(m.size, 1);
  assert.equal([...m.values()][0].o, 500);
});

test('skips synthetic and non-assistant', () => {
  const m = new Map();
  addLine(m, line('a', '2026-08-02T10:00:00Z', 5).replace('claude-opus-5-5', '<synthetic>'));
  addLine(m, line('b', '2026-08-02T10:00:00Z', 5).replace('"assistant"', '"user"'));
  assert.equal(m.size, 0);
});

test('pricing math: 5m/1h split, fallback, unknown model', () => {
  const base = { model: 'claude-opus-5', i: 1e6, o: 1e6, cr: 1e6, cw: 2e6, c5: 1e6, c1: 1e6 };
  assert.equal(costOf(base), 5 + 25 + 0.5 + 6.25 + 10);
  assert.equal(costOf({ ...base, c5: null, c1: null }), 5 + 25 + 0.5 + 12.5);
  assert.equal(costOf({ ...base, model: 'claude-opus-5-20260101' }), costOf(base));
  assert.equal(costOf({ ...base, model: 'claude-mystery-1' }), null);
});

const R = (iso, o = 1e6) => ({ t: Date.parse(iso), model: 'claude-opus-5-5', i: 0, o, cr: 0, cw: 0, c5: 0, c1: 0 });

test('5h blocks: hour floor, in-block, gap, expiry', () => {
  const b = blocks5h([R('2026-08-02T10:40:00Z'), R('2026-08-02T14:50:00Z'), R('2026-08-02T15:10:00Z'), R('2026-08-03T01:00:00Z')]);
  assert.equal(b.length, 3);
  assert.equal(new Date(b[0].s).toISOString(), '2026-08-02T10:00:00.000Z');
  assert.equal(new Date(b[1].s).toISOString(), '2026-08-02T15:00:00.000Z');
  assert.equal(b[0].cost, 40);
});

test('utilPct from snapshots, estPctOfPeak fallback', () => {
  const w = [{ s: 0, end: 5 * 3600e3, cost: 10 }, { s: 6 * 3600e3, end: 11 * 3600e3, cost: 5 }];
  const r = withUtil(w, [{ t: 1, fivePct: 20 }, { t: 2, fivePct: 35 }], 'fivePct');
  assert.deepEqual(r.map((x) => [x.utilPct, x.estPctOfPeak]), [[35, 100], [null, 50]]);
});

test('output has no ids, paths or session data', () => {
  const m = new Map();
  addLine(m, line('msg_secret', '2026-11-04T10:00:00Z', 100));
  const out = JSON.stringify(build([...m.values()], [], { now: new Date('2026-11-05T00:00:00Z') }));
  for (const bad of ['msg_', 'sessionId', 'uuid', '/Users/', 'secret', 's1']) assert.ok(!out.includes(bad), bad);
  assert.equal(JSON.parse(out).dailyCost[0].date, '2026-11-04');
});
