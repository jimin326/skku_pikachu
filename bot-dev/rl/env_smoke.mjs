import assert from 'node:assert/strict';
import { ACTIONS, FEATURES_PER_FRAME, FROZEN_VICTIM } from './config.mjs';
import {
  RedTeamEnv,
  canonicalizeSnapshot,
  canonicalizeAction,
  hashFile,
  makeSeededRng,
} from './redteam_env.mjs';
import { BotInput, RealGame, loadBot } from '../sim_real.mjs';
import { setCustomRng } from '../../src/resources/js/rand.js';

function scriptedDecide(snapshot) {
  const dx = snapshot.ball.expectedLandingPointX - snapshot.self.x;
  const x = Math.abs(dx) < 8 ? 0 : dx > 0 ? 1 : -1;
  const close = Math.abs(snapshot.ball.x - snapshot.self.x) < 62;
  const jump = snapshot.self.state === 0 && close && snapshot.ball.y > 105;
  return { x, y: jump ? -1 : 0, hit: close ? 1 : 0 };
}

function compactRallies(rallies) {
  return rallies.map((rally) => ({
    winner: rally.winner,
    how: rally.how,
    frames: rally.frames,
    landX: rally.landX,
    touches: rally.touches.map((touch) => [
      touch.i, touch.f, touch.ph, touch.bx, touch.by,
      touch.vx, touch.vy, ...touch.px, ...touch.py, ...touch.st,
    ]),
  }));
}

function runEnv(seed, side) {
  const env = new RedTeamEnv({ winningScore: 3 });
  let current = env.reset({ seed, side });
  assert.equal(current.observation.length, FEATURES_PER_FRAME * 4);
  let totalReward = 0;
  const rewardParts = { point: 0, match: 0, touch: 0, crossing: 0 };
  const transitionContexts = [];
  let steps = 0;
  let gameEndSignals = 0;
  while (true) {
    const snapshot = env.getRawSnapshot();
    const result = env.step(canonicalizeAction(scriptedDecide(snapshot), side));
    transitionContexts.push({ ...result.info.actionRally, lossMask: result.info.lossMask });
    totalReward += result.reward;
    for (const key of Object.keys(rewardParts)) rewardParts[key] += result.info.reward[key];
    steps++;
    gameEndSignals += result.info.gameEndedThisStep ? 1 : 0;
    if (result.terminated || result.truncated) break;
    assert.equal(result.observation.length, env.observationSize);
  }
  assert.equal(env.truncated, false);
  assert.equal(gameEndSignals, 1, 'match-point terminal signal must be emitted exactly once');
  const agentIndex = side === 'LEFT' ? 0 : 1;
  assert.equal(
    rewardParts.point,
    env.game.scores[agentIndex] - env.game.scores[1 - agentIndex],
    'point reward must equal the final point differential'
  );
  assert.equal(
    rewardParts.match,
    0,
    'default reward must not duplicate terminal point reward'
  );
  const summedParts = Object.values(rewardParts).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(totalReward - summedParts) < 1e-9, 'reward parts must sum to total reward');
  for (const context of transitionContexts) {
    if (context.id === null) {
      assert.equal(
        context.lossMask,
        context.trainable ? 1 : 0,
        'READY must remain trainable while post-game transitions are masked'
      );
    } else assert.equal(context.lossMask, context.trainable ? 1 : 0);
  }
  for (let i = 0; i + 1 < env.game.rallies.length; i++) {
    const expected = (
      env.rallyMetadata[i].victimServePhase + env.game.rallies[i].frames + 41
    ) % 3;
    assert.equal(
      env.rallyMetadata[i + 1].victimServePhase,
      expected,
      'the real-game serve phase chain must include rally duration'
    );
  }
  return {
    scores: [...env.game.scores],
    rallies: compactRallies(env.game.rallies),
    steps,
    totalReward,
  };
}

function runDirect(seed, side) {
  setCustomRng(makeSeededRng(seed));
  const game = new RealGame({ winningScore: 3, serveRule: 'random', readySnapshots: true });
  const agentIndex = side === 'LEFT' ? 0 : 1;
  game.inputs[agentIndex] = new BotInput(side, scriptedDecide, { latency: 1 });
  game.inputs[1 - agentIndex] = new BotInput(
    side === 'LEFT' ? 'RIGHT' : 'LEFT',
    loadBot(FROZEN_VICTIM.path),
    { latency: 1 }
  );
  game.runToEnd();
  return { scores: [...game.scores], rallies: compactRallies(game.rallies) };
}

function testCanonicalMirror() {
  const left = {
    tick: 3,
    side: 'LEFT',
    self: { x: 100, y: 200, state: 1, frameNumber: 2, divingDirection: 1 },
    opp: { x: 330, y: 210, state: 2, frameNumber: 3, divingDirection: -1 },
    ball: { x: 140, y: 120, xVelocity: 10, yVelocity: -4, isPowerHit: true, expectedLandingPointX: 88 },
    meta: { score: { self: 2, opp: 1 }, isPlayer2Serve: false, rallyFrameCount: 9 },
    config: { tickFrameGroupSize: 3 },
  };
  const right = {
    ...left,
    side: 'RIGHT',
    self: { ...left.self, x: 332, divingDirection: -1 },
    opp: { ...left.opp, x: 102, divingDirection: 1 },
    ball: { ...left.ball, x: 292, xVelocity: -10, expectedLandingPointX: 344 },
    meta: { ...left.meta, isPlayer2Serve: true },
  };
  assert.deepEqual(canonicalizeSnapshot(right), canonicalizeSnapshot(left));
}

assert.equal(ACTIONS.length, 18);
assert.equal(new Set(ACTIONS.map((a) => `${a.x},${a.y},${a.hit}`)).size, 18);
assert.equal(hashFile(FROZEN_VICTIM.path), FROZEN_VICTIM.sha256);
testCanonicalMirror();
assert.deepEqual(canonicalizeAction({ x: -1, y: 1, hit: 1 }, 'RIGHT'), { x: 1, y: 1, hit: 1 });
{
  const rightEnv = new RedTeamEnv({ winningScore: 1 });
  rightEnv.reset({ seed: 9191, side: 'RIGHT' });
  const moved = rightEnv.step({ x: 1, y: 0, hit: 0 });
  assert.equal(moved.info.globalAction.x, -1, 'RIGHT canonical +x must become global -x');
}

for (const [seed, side] of [[12345, 'LEFT'], [20260902, 'RIGHT']]) {
  const first = runEnv(seed, side);
  const second = runEnv(seed, side);
  assert.deepEqual(second, first, `${side} seed ${seed} was not deterministic`);
  const direct = runDirect(seed, side);
  assert.deepEqual(first.scores, direct.scores, `${side} score parity failed`);
  assert.deepEqual(first.rallies, direct.rallies, `${side} rally parity failed`);
  console.log(
    `${side} seed=${seed}: ${first.scores.join('-')}, ` +
    `${first.rallies.length} rallies, ${first.steps} RL decisions, parity OK`
  );
}

{
  const env = new RedTeamEnv({ winningScore: 1 });
  let result = env.reset({ seed: 777, side: 'LEFT' });
  while (!result.terminated && !result.truncated) {
    result = env.step(scriptedDecide(env.getRawSnapshot()));
  }
  const victimInstance = env.victimInput;
  const physicsInstance = env.game.physics;
  const tickAfterFirstGame = victimInstance.tick;
  result = env.reset({ preserveBotState: true, side: 'LEFT' });
  assert.equal(env.victimInput, victimInstance, 'victim Worker state must persist within a seed/side series');
  assert.equal(env.game.physics, physicsInstance, 'production physics object must persist within a series');
  assert.ok(env.victimInput.tick > tickAfterFirstGame, 'victim tick phase must continue across games');
  while (!result.terminated && !result.truncated) {
    result = env.step(scriptedDecide(env.getRawSnapshot()));
  }
}

console.log('RL environment smoke test: PASS');
