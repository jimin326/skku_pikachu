import assert from 'node:assert/strict';
import { PikaPhysics, PikaUserInput } from '../../src/resources/js/physics.js';

function stepWithVerticalVelocity(yVelocity) {
  const physics = new PikaPhysics(false, false);
  physics.ball.x = 100;
  physics.ball.y = 100;
  physics.ball.xVelocity = 0;
  physics.ball.yVelocity = yVelocity;
  physics.runEngineForNextFrame([new PikaUserInput(), new PikaUserInput()]);
  return { y: physics.ball.y, yVelocity: physics.ball.yVelocity };
}

assert.deepEqual(stepWithVerticalVelocity(64), { y: 140, yVelocity: 41 });
assert.deepEqual(stepWithVerticalVelocity(-64), { y: 60, yVelocity: -39 });

console.log('physics clamp smoke: PASS');
