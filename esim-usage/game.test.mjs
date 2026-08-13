// Check for the mini-game loop in index.html: run it with `node esim-usage/game.test.mjs`.
// The page's own ?selftest=1 covers the usage formatting; this covers the physics,
// which needs frames a hidden browser tab never delivers (no requestAnimationFrame).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const src = html.split('<script>').find(s => s.includes('Runner clone')).split('</script>')[0];

const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const canvas = { width: 400, height: 200, getContext: () => noop, addEventListener() {} };
const keys = [];
let frame = null;

globalThis.window = globalThis;
globalThis.document = { getElementById: () => canvas };
globalThis.Image = class { set src(_) { this.complete = false; } };
globalThis.addEventListener = (type, fn) => { if (type === 'keydown') keys.push(fn); };
globalThis.requestAnimationFrame = fn => { frame = fn; };

new Function(src)();

let now = 0;
const run = seconds => {
  for (let i = 0; i < Math.round(seconds * 60); i++) { now += 1000 / 60; frame(now); }
};
const press = () => keys.forEach(fn => fn({ code: 'Space', preventDefault() {} }));
const game = () => window.__game();
const FLOOR = canvas.height - 20 - 72;

run(0.5);
assert.equal(game().t, 0, 'stays idle until the first tap');

press();
run(0.15);
assert.ok(game().y < FLOOR, 'tap lifts the dog off the floor');
run(1);
assert.equal(Math.round(game().y), FLOOR, 'gravity brings it back down');

const score = Math.floor(game().t * 10);
assert.ok(score >= 10 && score <= 13, `~10 points per second, got ${score}`);
run(2);
assert.ok(game().obs.length > 0, 'obstacles spawn');
assert.ok(game().speed > 300, 'speed ramps up');

const s = game();
s.dead = 0; s.obs = [{ x: 56, w: 34, h: 44 }]; // parked on top of the dog
run(0.05);
assert.equal(game().dead, 1, 'hitting an obstacle ends the run');

press();
assert.equal(game().t, 0, 'tap after game over restarts');
press();
run(0.05);
game().t = 49.95;
run(0.2);
assert.ok(game().won, 'crossing 500 points wins');
assert.ok(Math.floor(game().t * 10) >= 500, 'win threshold is 500 points');

console.log('esim-usage game checks passed');
