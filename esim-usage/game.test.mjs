// Physics checks for the mini-game: run it with `node esim-usage/game.test.mjs`.
// The page's own ?selftest=1 covers the usage formatting; this covers the physics,
// which needs frames a hidden browser tab never delivers (no requestAnimationFrame).
//
// THERE ARE TWO COPIES OF THIS GAME and this file checks both: the original in
// esim-usage/index.html, and the port on the Italy trip page's #esim view, which
// differs only in its on-canvas Hebrew and in idling while the view is closed.
// Running the same assertions over both is the only thing stopping them drifting.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const SOURCES = [
  ['esim-usage/index.html', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    return html.split('<script>').find(s => s.includes('Runner clone')).split('</script>')[0];
  }],
  ['trips/italy-2026/trip.js (ported)', () => {
    const js = readFileSync(new URL('../trips/italy-2026/trip.js', import.meta.url), 'utf8');
    const at = js.indexOf('// Runner clone of the esim.dog mini-game');
    assert.ok(at > 0, 'the ported game is missing from trip.js');
    return js.slice(at);
  }],
];

for (const [label, load] of SOURCES) check(label, load());

function check(label, src) {
const noop = new Proxy({}, { get: () => () => {}, set: () => true });
/* offsetParent is what the port uses to decide "is this view on screen"; a plain
   object would read undefined, which happens to be truthy-enough, so state it. */
const canvas = { width: 400, height: 200, offsetParent: {}, getContext: () => noop, addEventListener() {} };
const keys = [];
let frame = null, rafCalls = 0;

globalThis.window = globalThis;
globalThis.document = { getElementById: () => canvas, hidden: false };
globalThis.Image = class { set src(_) { this.complete = false; } };
globalThis.addEventListener = (type, fn) => { if (type === 'keydown') keys.push(fn); };
globalThis.requestAnimationFrame = fn => { rafCalls++; frame = fn; };

new Function(src)();

let now = 0;
const run = seconds => {
  for (let i = 0; i < Math.round(seconds * 60); i++) { now += 1000 / 60; frame(now); }
};
const press = () => keys.forEach(fn => fn({ code: 'Space', preventDefault() {} }));
const game = () => window.__game();
const FLOOR = canvas.height - 20 - 72;

/* The loop must keep rescheduling itself. Nothing else here would notice it dying:
   every assertion below calls `frame` by hand, so a loop that stopped asking for the
   next frame still "passes" — which is exactly how a blank canvas shipped once. */
const rafBefore = rafCalls;
run(0.5);
assert.ok(rafCalls > rafBefore, 'the loop reschedules itself each frame');
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

/* Only the port has this, and it is the one behaviour the port added: a closed view
   must burn no frames, and reopening must not integrate the whole gap at once.
   The run above ended in the won state, which freezes `t` on purpose — so put the
   game back to a plainly-running one first. `spawn: t` buys >=0.55s before the next
   obstacle, which keeps both short runs below free of a collision that would freeze
   `t` for a reason that has nothing to do with visibility.
   There is deliberately NO assertion about replaying the gap on resume: dt is clamped
   to 50 ms in the loop, so that cannot happen, and an assertion for it passed with the
   guard removed — i.e. it tested nothing. */
if (label.includes('ported')) {
  Object.assign(game(), { won: false, wonT: 0, over: false, dead: 0, hit: null,
                          obs: [], t: 1, spawn: 1, y: FLOOR, v: 0 });
  run(0.3);
  const moving = game().t;
  assert.ok(moving > 1, 'the game is running again before the visibility check');

  canvas.offsetParent = null;              // the view is closed
  run(2);
  assert.equal(game().t, moving, 'a closed view advances nothing');

  canvas.offsetParent = {};                // reopened
  run(0.2);
  assert.ok(game().t > moving, 'reopening resumes');

  /* The keydown listener is window-wide, and it once preventDefault-ed every Space on
     the page — no text box on any view could type one (family comment, Sep 2026). */
  const key = (target, on) => {
    let swallowed = false;
    canvas.offsetParent = on ? {} : null;
    Object.assign(game(), { won: false, over: false, dead: 0, y: FLOOR, v: 0 });
    keys.forEach(fn => fn({ code: 'Space', target, preventDefault() { swallowed = true; } }));
    const jumped = game().v !== 0;
    canvas.offsetParent = {};
    return { swallowed, jumped };
  };
  const field = { closest: sel => (sel.includes('textarea') ? field : null) };
  const page  = { closest: () => null };
  assert.deepEqual(key(field, true), { swallowed: false, jumped: false }, 'a space typed into a text box is the text box\'s');
  assert.deepEqual(key(page, false), { swallowed: false, jumped: false }, 'with the view closed, Space is not the game\'s');
  assert.deepEqual(key(page, true),  { swallowed: true,  jumped: true  }, 'on the open view, Space still jumps');
}

console.log('game checks passed \u2014 ' + label);
}
