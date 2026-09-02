import assert from 'node:assert/strict';
import { candidateCause } from './paired_eval.mjs';

const base = { winner: 1, how: 'ground', serveP2: false, landX: 100, touches: [] };
assert.equal(candidateCause(base, 0), 'untouched_self_serve_ground_on_own_half');
assert.equal(candidateCause({ ...base, serveP2: true }, 0), 'opponent_serve_unreturned');
assert.equal(candidateCause({ ...base, landX: 300 }, 0), 'opponent_serve_unreturned');
assert.equal(candidateCause({ ...base, touches: [{ i: 0 }] }, 0), 'self_last_touch_then_own_ground');
assert.equal(candidateCause({ ...base, touches: [{ i: 1 }] }, 0), 'opponent_last_touch_score');
assert.equal(candidateCause({ ...base, how: 'touchLimit' }, 0), 'self_touch_limit');
assert.equal(candidateCause({ ...base, winner: 0 }, 0), null);
console.log('loss-cause classifier tests PASS');
