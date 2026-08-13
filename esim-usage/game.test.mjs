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

// The dog never jumped during that run(2), so it may already have collided and even
// finished dying — clear the whole death state, not just `dead`, before staging ours.
const s = game();
Object.assign(s, { dead: 0, over: false, deathFrame: 0, deathTimer: 0, hit: null,
  obs: [{ x: 56, w: 34, h: 44, type: 'box1' }] }); // parked on top of the dog
run(0.05);
assert.equal(game().dead, 1, 'hitting an obstacle starts the death animation');
assert.equal(game().over, false, 'game over is not immediate — the dog still falls');

const scoreAtHit = Math.floor(game().t * 10);
press();
assert.equal(game().over, false, 'input is ignored mid-death, same as the original');
assert.equal(Math.floor(game().t * 10), scoreAtHit, 'score stays frozen while dying');

run(1); // fall to the floor + cycle all 4 death frames
assert.equal(game().over, true, 'landing plus a finished death animation ends the run');
assert.ok(game().hit.hitFrame > 0, 'the hit obstacle plays its own break-frame animation');

press();
assert.equal(game().t, 0, 'tap after game over restarts');
assert.equal(game().over, false, 'and clears the game-over flag');

press();
run(0.05);
game().t = 99.95;
run(0.2);
assert.ok(game().won, 'crossing 1000 points wins');
assert.ok(Math.floor(game().t * 10) >= 1000, 'win threshold is 1000 points');
const obsAtWin = game().obs.length;
run(0.5);
assert.equal(game().obs.length, obsAtWin, 'obstacles freeze once won');
assert.ok(game().wonT > 0, 'the victory bounce timer runs');

console.log('esim-usage game checks passed');
