import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GROUND_HALF_WIDTH, PikaPhysics, PikaUserInput } from '../../src/resources/js/physics.js';
import { setCustomRng } from '../../src/resources/js/rand.js';
import { RealGame } from '../sim_real.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'engine_manifest.json'), 'utf8'));

function parseGameRoot() {
  const index = process.argv.indexOf('--game-root');
  const candidate = index >= 0 ? process.argv[index + 1] : process.env.LEONYI_GAME_ROOT;
  if (!candidate) {
    throw new Error('Pass --game-root <official leonyi-volleyball checkout> or set LEONYI_GAME_ROOT.');
  }
  return path.resolve(candidate);
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function verifyOfficialSources(gameRoot) {
  for (const [relativePath, expected] of Object.entries(manifest.files)) {
    const filename = path.join(gameRoot, ...relativePath.split('/'));
    assert.equal(sha256(filename), expected, `official source hash mismatch: ${relativePath}`);
  }
  for (const relativePath of manifest.runtimeFiles) {
    const filename = path.join(repositoryRoot, ...relativePath.split('/'));
    assert.equal(
      sha256(filename),
      manifest.files[relativePath],
      `copied runtime hash mismatch: ${relativePath}`,
    );
  }
}

function loadSourceModule(gameRoot, relativePath, bindings, returnExpression) {
  const filename = path.join(gameRoot, ...relativePath.split('/'));
  const source = fs.readFileSync(filename, 'utf8')
    .replace(/^\s*import\s+.*?;\s*$/gm, '')
    .replace(/^\s*export\s+/gm, '');
  const names = Object.keys(bindings);
  const values = Object.values(bindings);
  return new Function(...names, `${source}\nreturn (${returnExpression});`)(...values);
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

class ScheduledInput extends PikaUserInput {
  constructor(action) {
    super();
    this.action = action;
    this.calls = 0;
  }

  getInput() {
    this.calls++;
    this.xDirection = this.action.x;
    this.yDirection = this.action.y;
    this.powerHit = this.action.hit;
  }
}

function makeView() {
  const noOp = () => {};
  return {
    intro: { visible: false, drawMark: noOp },
    menu: { visible: false, drawPengsooMenuBackground: noOp },
    game: {
      visible: true,
      drawPlayersAndBall: noOp,
      drawCloudsAndWave: noOp,
      drawGameStartMessage: noOp,
      drawGameEndMessage: noOp,
      drawScoresToScoreBoards: noOp,
      drawReadyMessage: noOp,
      toggleReadyMessage: noOp,
      messages: { gameEnd: { visible: false } },
    },
    fadeInOut: { visible: false, setBlackAlphaTo: noOp, changeBlackAlphaBy: noOp },
  };
}

function makeProductionGame(PikachuVolleyball, SERVE_RULE, rng, winningScore = 5) {
  setCustomRng(rng);
  const game = Object.create(PikachuVolleyball.prototype);
  game.view = makeView();
  game.audio = { sounds: { bgm: { play() {}, stop() {} } } };
  game.physics = new PikaPhysics(false, false);
  game.botInputs = [
    new ScheduledInput({ x: 0, y: 0, hit: 1 }),
    new ScheduledInput({ x: 0, y: 0, hit: 1 }),
  ];
  game.idleInputs = [
    new ScheduledInput({ x: 0, y: 0, hit: 0 }),
    new ScheduledInput({ x: 0, y: 0, hit: 0 }),
  ];
  game.keyboardArray = game.botInputs;
  game.normalFPS = 25;
  game.slowMotionFPS = 5;
  game.SLOW_MOTION_FRAMES_NUM = 6;
  game.slowMotionFramesLeft = 0;
  game.slowMotionNumOfSkippedFrames = 0;
  game.scores = [0, 0];
  game.winningScore = winningScore;
  game.gameEnded = false;
  game.roundEnded = false;
  game.isPlayer2Serve = false;
  game.serveRule = SERVE_RULE.RANDOM;
  game.frameCounter = 0;
  game.frameTotal = {
    intro: 165,
    afterMenuSelection: 15,
    beforeStartOfNewGame: 15,
    startOfNewGame: 71,
    afterEndOfRound: 5,
    beforeStartOfNextRound: 30,
    gameEnd: 211,
  };
  game.paused = false;
  game.isStereoSound = true;
  game._isPracticeMode = false;
  game.state = game.round;
  game.playSoundEffect = () => {};
  return game;
}

function productionStateName(game) {
  for (const name of ['startOfNewGame', 'round', 'afterEndOfRound', 'beforeStartOfNextRound', 'intro']) {
    if (game.state === game[name]) return name;
  }
  return 'unknown';
}

function canonicalProduction(game, tracker) {
  return {
    physics: game.physics,
    scores: game.scores,
    isPlayer2Serve: game.isPlayer2Serve,
    frameCounter: game.frameCounter,
    slowMotionFramesLeft: game.slowMotionFramesLeft,
    roundEnded: game.roundEnded,
    gameEnded: game.gameEnded,
    state: productionStateName(game),
    touch: {
      count: tracker.touchCount,
      last: tracker.lastToucherIndex,
      flags: tracker.previousCollisionFlags,
      onLeft: tracker.previousBallIsOnLeft,
    },
  };
}

function canonicalHarness(game) {
  return {
    physics: game.physics,
    scores: game.scores,
    isPlayer2Serve: game.isPlayer2Serve,
    frameCounter: game.frameCounter,
    slowMotionFramesLeft: game.slowMotionFramesLeft,
    roundEnded: game.roundEnded,
    gameEnded: game.gameEnded,
    state: game.state,
    touch: {
      count: game.tl.count,
      last: game.tl.last,
      flags: game.tl.prevFlags,
      onLeft: game.tl.prevOnLeft,
    },
  };
}

function assertEquivalent(production, tracker, harness, label) {
  assert.deepEqual(canonicalHarness(harness), canonicalProduction(production, tracker), label);
}

function runOneProcessedProductionFrame(game, tracker) {
  const duringMatch = game.state === game.round ||
    game.state === game.afterEndOfRound || game.state === game.beforeStartOfNextRound;
  game.keyboardArray = duringMatch ? game.botInputs : game.idleInputs;
  const callsBefore = game.keyboardArray[0].calls;
  let tickerCalls = 0;
  do {
    game.gameLoop();
    tracker.observe(game);
    tickerCalls++;
    assert.ok(tickerCalls <= 6, 'production logical frame did not advance within the slow-motion schedule');
  } while (game.keyboardArray[0].calls === callsBefore);
}

function runMatchDifferential(api) {
  const productionRng = makeRng(0x51a7c0de);
  const harnessRng = makeRng(0x51a7c0de);
  const production = makeProductionGame(api.PikachuVolleyball, api.SERVE_RULE, productionRng);
  const tracker = new api.TouchLimitTracker((side) => api.awardPoint(production, side));

  setCustomRng(harnessRng);
  let harness = new RealGame({ serveRule: 'random', winningScore: 5 });
  harness.state = 'round';
  harness.inputs = [
    new ScheduledInput({ x: 0, y: 0, hit: 1 }),
    new ScheduledInput({ x: 0, y: 0, hit: 1 }),
  ];
  harness.beginRally();

  assertEquivalent(production, tracker, harness, 'initial state');
  let processedFrames = 0;
  let totalRallies = 0;
  for (let match = 0; match < 2; match++) {
    while (productionStateName(production) !== 'intro' || harness.state !== 'intro') {
      setCustomRng(productionRng);
      runOneProcessedProductionFrame(production, tracker);
      setCustomRng(harnessRng);
      harness.step();
      processedFrames++;
      assertEquivalent(production, tracker, harness, `match ${match + 1}, processed frame ${processedFrames}`);
      assert.ok(processedFrames < 40000, 'series did not terminate');
    }
    assert.ok(harness.rallies.length >= 5 && harness.rallies.length <= 9);
    assert.equal(Math.max(...harness.scores), 5);
    totalRallies += harness.rallies.length;
    if (match === 0) {
      const preservedInputs = harness.inputs;
      const preservedPhysics = harness.physics;
      production.frameCounter = 0;
      production.state = production.startOfNewGame;
      harness = new RealGame({
        serveRule: 'random',
        winningScore: 5,
        physics: preservedPhysics,
      });
      harness.inputs = preservedInputs;
    }
  }
  return { processedFrames, totalRallies };
}

function runTouchLimitDifferential(api) {
  const productionRng = makeRng(0x0bad5eed);
  const harnessRng = makeRng(0x0bad5eed);
  const production = makeProductionGame(api.PikachuVolleyball, api.SERVE_RULE, productionRng);
  const tracker = new api.TouchLimitTracker((side) => api.awardPoint(production, side));
  production.scores = [0, 4];

  setCustomRng(harnessRng);
  const harness = new RealGame({ serveRule: 'random', winningScore: 5 });
  harness.state = 'round';
  harness.scores = [0, 4];

  for (let touch = 1; touch <= 5; touch++) {
    production.physics.ball.x = 100;
    harness.physics.ball.x = 100;
    production.physics.player1.isCollisionWithBallHappened = true;
    harness.physics.player1.isCollisionWithBallHappened = true;
    setCustomRng(productionRng);
    tracker.observe(production);
    setCustomRng(harnessRng);
    harness.observeTouchLimit();
    assertEquivalent(production, tracker, harness, `touch-limit contact ${touch}`);

    production.physics.player1.isCollisionWithBallHappened = false;
    harness.physics.player1.isCollisionWithBallHappened = false;
    tracker.observe(production);
    harness.observeTouchLimit();
    assertEquivalent(production, tracker, harness, `touch-limit release ${touch}`);
  }
  assert.equal(production.gameEnded, true);
  assert.deepEqual(production.scores, [0, 5]);
}

const gameRoot = parseGameRoot();
verifyOfficialSources(gameRoot);
const noOpClass = class {};
// The evaluated production class must use the same switchable RNG module as the harness.
const { rand } = await import('../../src/resources/js/rand.js');
const productionApi = loadSourceModule(
  gameRoot,
  'src/resources/js/pikavolley.js',
  {
    GROUND_HALF_WIDTH,
    PikaPhysics,
    MenuView: noOpClass,
    GameView: noOpClass,
    FadeInOut: noOpClass,
    IntroView: noOpClass,
    PikaKeyboard: noOpClass,
    PikaAudio: noOpClass,
    rand,
  },
  '{ PikachuVolleyball, SERVE_RULE }',
);
const { TouchLimitTracker } = loadSourceModule(
  gameRoot,
  'src/resources/js/rules/touchLimit.js',
  { GROUND_HALF_WIDTH },
  '{ TouchLimitTracker }',
);
const { awardPoint } = loadSourceModule(
  gameRoot,
  'src/resources/js/operator/console.js',
  {},
  '{ awardPoint }',
);
const api = { ...productionApi, TouchLimitTracker, awardPoint };

const { processedFrames, totalRallies } = runMatchDifferential(api);
runTouchLimitDifferential(api);
setCustomRng(null);
console.log(
  `PASS production differential: 2 persistent matches, ${totalRallies} rallies, ` +
  `${processedFrames} processed frames + touch-limit fixture`,
);
