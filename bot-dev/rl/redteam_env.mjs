import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PikaUserInput } from '../../src/resources/js/physics.js';
import { setCustomRng } from '../../src/resources/js/rand.js';
import { BotInput, RealGame, buildSnapshot } from '../sim_real.mjs';
import {
  ACTIONS,
  DEFAULT_ENV_CONFIG,
  DEFAULT_REWARD_CONFIG,
  FEATURES_PER_FRAME,
  FROZEN_VICTIM,
} from './config.mjs';

const WIDTH = 432;
const NET_X = 216;
const BALL_GROUND_Y = 252;
const PLAYER_GROUND_Y = 244;
const VALID_SIDE = new Set(['LEFT', 'RIGHT']);

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function cloneAction(action) {
  return { x: action.x, y: action.y, hit: action.hit };
}

function isValidAction(action) {
  return !!action &&
    (action.x === -1 || action.x === 0 || action.x === 1) &&
    (action.y === -1 || action.y === 0 || action.y === 1) &&
    (action.hit === 0 || action.hit === 1);
}

export function makeSeededRng(seed) {
  let state = Number(seed) >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function hashFile(filePath) {
  // Git may check text files out as CRLF on Windows and LF elsewhere. Hash the
  // normalized source so the frozen-victim guard is stable across platforms.
  const source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

export function loadFrozenVictim(victim = FROZEN_VICTIM) {
  const actualHash = hashFile(victim.path);
  if (victim.sha256 && actualHash !== victim.sha256.toLowerCase()) {
    throw new Error(
      `Frozen victim changed: ${victim.path}\nexpected ${victim.sha256}\nactual   ${actualHash}`
    );
  }
  const source = fs.readFileSync(victim.path, 'utf8');
  const quietConsole = { log() {}, warn() {}, error() {} };
  const decide = new Function('console', `${source}\n;return decide;`)(quietConsole);
  if (typeof decide !== 'function') throw new Error(`decide() not found in ${victim.path}`);
  return { decide, hash: actualHash, builtin: false };
}

class BuiltinInput extends PikaUserInput {
  constructor() {
    super();
    this.tick = 0;
  }
  getInput() { this.tick++; }
}

function sameOpponent(left, right) {
  return !!left && !!right && left.id === right.id && left.kind === right.kind &&
    (left.sha256 || left.sha256Normalized || null) === (right.sha256 || right.sha256Normalized || null);
}

export function loadOpponent(spec = FROZEN_VICTIM) {
  const normalized = {
    id: spec.id || path.basename(spec.path || 'opponent'),
    familyId: spec.familyId || spec.id || 'unknown',
    kind: spec.kind || 'javascript',
    path: spec.path ? path.resolve(spec.path) : null,
    sha256: spec.sha256 || spec.sha256Normalized || null,
    policy: spec.policy || null,
  };
  if (normalized.kind === 'builtin') {
    return { spec: normalized, input: new BuiltinInput(), decide: null, hash: normalized.sha256, builtin: true };
  }
  if (normalized.kind === 'fixed') {
    let decide;
    if (normalized.policy === 'neutral') decide = () => ({ x: 0, y: 0, hit: 0 });
    else if (normalized.policy === 'chase') {
      decide = (snapshot) => {
        const dx = snapshot.ball.x - snapshot.self.x;
        const close = Math.abs(dx) < 64 && Math.abs(snapshot.ball.y - snapshot.self.y) < 96;
        const airborne = snapshot.self.y < 244 || snapshot.self.state !== 0;
        return { x: dx < -4 ? -1 : dx > 4 ? 1 : 0, y: !airborne && close ? -1 : 0, hit: airborne && close ? 1 : 0 };
      };
    } else throw new Error(`Unknown fixed opponent policy: ${normalized.policy}`);
    return { spec: normalized, decide, hash: null, builtin: false };
  }
  const loaded = loadFrozenVictim({ path: normalized.path, sha256: normalized.sha256 });
  return { ...loaded, spec: normalized };
}

export function canonicalizeSnapshot(snapshot) {
  const mirror = snapshot.side === 'RIGHT';
  const mirrorPlayer = (player) => ({
    x: mirror ? WIDTH - player.x : player.x,
    y: player.y,
    state: player.state,
    frameNumber: player.frameNumber,
    divingDirection: mirror ? -player.divingDirection : player.divingDirection,
  });
  return {
    tick: snapshot.tick,
    side: 'LEFT',
    self: mirrorPlayer(snapshot.self),
    opp: mirrorPlayer(snapshot.opp),
    ball: {
      x: mirror ? WIDTH - snapshot.ball.x : snapshot.ball.x,
      y: snapshot.ball.y,
      xVelocity: mirror ? -snapshot.ball.xVelocity : snapshot.ball.xVelocity,
      yVelocity: snapshot.ball.yVelocity,
      isPowerHit: snapshot.ball.isPowerHit,
      expectedLandingPointX: mirror
        ? WIDTH - snapshot.ball.expectedLandingPointX
        : snapshot.ball.expectedLandingPointX,
    },
    meta: {
      score: { self: snapshot.meta.score.self, opp: snapshot.meta.score.opp },
      selfServe: snapshot.side === 'RIGHT'
        ? snapshot.meta.isPlayer2Serve
        : !snapshot.meta.isPlayer2Serve,
      rallyFrameCount: snapshot.meta.rallyFrameCount,
    },
    config: { tickFrameGroupSize: snapshot.config.tickFrameGroupSize },
  };
}

export function canonicalizeAction(action, side) {
  return {
    x: side === 'RIGHT' && action.x !== 0 ? -action.x : action.x,
    y: action.y,
    hit: action.hit,
  };
}

export function globalizeAction(action, side) {
  return canonicalizeAction(action, side);
}

export function encodeFrame(snapshot, appliedAction, winningScore) {
  const s = canonicalizeSnapshot(snapshot);
  const canonicalAction = canonicalizeAction(appliedAction, snapshot.side);
  const features = [
    s.ball.x / NET_X - 1,
    clamp(s.ball.y / BALL_GROUND_Y, -0.25, 1.25),
    clamp(s.ball.xVelocity / 40, -1.5, 1.5),
    clamp(s.ball.yVelocity / 40, -1.5, 1.5),
    s.ball.expectedLandingPointX / NET_X - 1,
    s.ball.isPowerHit ? 1 : 0,
    s.self.x / NET_X - 1,
    clamp(s.self.y / PLAYER_GROUND_Y, 0, 1.25),
    clamp(s.self.state / 4, 0, 1),
    clamp(s.self.frameNumber / 5, 0, 1),
    clamp(s.self.divingDirection, -1, 1),
    s.opp.x / NET_X - 1,
    clamp(s.opp.y / PLAYER_GROUND_Y, 0, 1.25),
    clamp(s.opp.state / 4, 0, 1),
    clamp(s.opp.frameNumber / 5, 0, 1),
    clamp(s.opp.divingDirection, -1, 1),
    clamp(s.meta.score.self / winningScore, 0, 1),
    clamp(s.meta.score.opp / winningScore, 0, 1),
    s.meta.selfServe ? 1 : 0,
    clamp(s.meta.rallyFrameCount / 300, 0, 2),
    canonicalAction.x,
    canonicalAction.y,
    canonicalAction.hit,
  ];
  if (features.length !== FEATURES_PER_FRAME) {
    throw new Error(`Feature schema mismatch: ${features.length}`);
  }
  return Float32Array.from(features);
}

class StepInput extends PikaUserInput {
  constructor(side, latency = 1) {
    super();
    this.side = side;
    this.latency = latency;
    this.tick = 0;
    this.frames = 0;
    this.rallyFrameCount = 0;
    this.previousScoreTotal = 0;
    this.latestAction = { x: 0, y: 0, hit: 0 };
    this.queue = [];
    this.pendingSnapshot = null;
    this.pendingAppliedAction = null;
    this.decisions = 0;
  }

  getInput(game) {
    this.frames++;
    while (this.queue.length && this.queue[0].at <= this.frames) {
      this.latestAction = this.queue.shift().action;
    }
    this.xDirection = this.latestAction.x;
    this.yDirection = this.latestAction.y;
    this.powerHit = this.latestAction.hit;

    const scoreTotal = game.scores[0] + game.scores[1];
    if (scoreTotal !== this.previousScoreTotal) {
      this.rallyFrameCount = 0;
      this.previousScoreTotal = scoreTotal;
    } else {
      this.rallyFrameCount++;
    }

    this.tick++;
    if (this.tick % 3 !== 0) return;
    if (this.pendingSnapshot !== null) {
      throw new Error('Environment advanced before the pending RL action was submitted');
    }
    this.pendingSnapshot = buildSnapshot(
      this.tick,
      this.side,
      game.physics,
      { scores: game.scores, isPlayer2Serve: game.isPlayer2Serve },
      this.rallyFrameCount
    );
    this.pendingAppliedAction = cloneAction(this.latestAction);
    this.decisions++;
  }

  submit(action) {
    if (this.pendingSnapshot === null) throw new Error('No RL decision is currently pending');
    if (!isValidAction(action)) throw new TypeError(`Invalid action: ${JSON.stringify(action)}`);
    this.queue.push({ at: this.frames + this.latency, action: cloneAction(action) });
    this.pendingSnapshot = null;
    this.pendingAppliedAction = null;
  }

  cancelPending() {
    this.pendingSnapshot = null;
    this.pendingAppliedAction = null;
  }
}

export class RedTeamEnv {
  constructor(options = {}) {
    this.config = { ...DEFAULT_ENV_CONFIG, ...options };
    this.rewardConfig = { ...DEFAULT_REWARD_CONFIG, ...(options.reward || {}) };
    this.victim = options.victim || FROZEN_VICTIM;
    this.game = null;
    this.agentInput = null;
    this.victimInput = null;
    this.agentSide = null;
    this.agentIndex = null;
    this.victimIndex = null;
    this.seed = null;
    this.rng = null;
    this.frames = [];
    this.lastObservation = null;
    this.terminated = false;
    this.truncated = false;
    this.crossings = 0;
    this.previousBallOnAgentHalf = null;
    this.lastRewardCursor = { rallies: 0, agentTouches: 0, crossings: 0 };
    this.victimHash = null;
    this.opponentSpec = null;
    this.opponentBuiltin = false;
    this.episodeDecisionStart = 0;
    this.rallyMetadata = [];
    this.activeRallyId = null;
    this.matchRewardEmitted = false;
  }

  get observationSize() {
    return FEATURES_PER_FRAME * this.config.frameStack;
  }

  get actionCount() {
    return ACTIONS.length;
  }

  decodeAction(action) {
    if (Number.isInteger(action)) {
      if (action < 0 || action >= ACTIONS.length) {
        throw new RangeError(`Action index must be in [0, ${ACTIONS.length - 1}]`);
      }
      return ACTIONS[action];
    }
    if (!isValidAction(action)) throw new TypeError(`Invalid action: ${JSON.stringify(action)}`);
    return action;
  }

  reset({ seed, side = 'random', opponent = null, preserveBotState = false } = {}) {
    if (preserveBotState && (!this.agentInput || !this.victimInput)) {
      throw new Error('preserveBotState requires an existing completed episode');
    }
    if (preserveBotState && this.game && !this.game.finished) {
      throw new Error('Cannot preserve bot state from an unfinished episode');
    }
    if (preserveBotState && opponent && !sameOpponent(this.opponentSpec, opponent)) {
      throw new Error('A persistent bot series cannot change opponents');
    }
    if (!preserveBotState && seed === undefined) seed = 1;
    if (side !== 'random' && !VALID_SIDE.has(side)) {
      throw new TypeError(`side must be LEFT, RIGHT, or random; got ${side}`);
    }
    if (preserveBotState) {
      if (side !== 'random' && side !== this.agentSide) {
        throw new Error('A persistent bot series cannot change sides');
      }
      if (seed !== undefined) {
        this.seed = Number(seed) >>> 0;
        this.rng = makeSeededRng(this.seed);
      }
    } else {
      this.seed = Number(seed) >>> 0;
      this.agentSide = side === 'random'
        ? (this.seed % 2 === 0 ? 'LEFT' : 'RIGHT')
        : side;
      this.agentIndex = this.agentSide === 'LEFT' ? 0 : 1;
      this.victimIndex = 1 - this.agentIndex;
      this.rng = makeSeededRng(this.seed);
      const loaded = loadOpponent(opponent || this.config.opponent || this.victim);
      this.opponentSpec = loaded.spec;
      this.opponentBuiltin = loaded.builtin;
      this.victimHash = loaded.hash;
      this.agentInput = new StepInput(this.agentSide, this.config.latencyFrames);
      const victimSide = this.agentSide === 'LEFT' ? 'RIGHT' : 'LEFT';
      this.victimInput = loaded.builtin
        ? loaded.input
        : new BotInput(victimSide, loaded.decide, { latency: this.config.latencyFrames });
    }
    setCustomRng(this.rng);
    this.terminated = false;
    this.truncated = false;
    this.crossings = 0;
    this.previousBallOnAgentHalf = null;
    this.frames = [];
    this.lastObservation = null;
    this.rallyMetadata = [];
    this.activeRallyId = null;
    this.matchRewardEmitted = false;
    const preservedPhysics = preserveBotState ? this.game.physics : null;
    this.game = new RealGame({
      serveRule: this.config.serveRule,
      winningScore: this.config.winningScore,
      readySnapshots: true,
      physics: preservedPhysics,
    });
    this.game.inputs[this.agentIndex] = this.agentInput;
    this.game.inputs[this.victimIndex] = this.victimInput;
    this.game.physics.player1.isComputer = this.victimIndex === 0 && this.opponentBuiltin;
    this.game.physics.player2.isComputer = this.victimIndex === 1 && this.opponentBuiltin;
    this.episodeDecisionStart = this.agentInput.decisions;
    this.lastRewardCursor = { rallies: 0, agentTouches: 0, crossings: 0 };

    this.#advanceUntilDecisionOrDone();
    if (this.game.finished) {
      throw new Error('Game ended before the first RL decision');
    }
    this.#appendPendingObservation(true);
    this.lastRewardCursor = this.#rewardCursor();
    return {
      observation: this.lastObservation,
      info: { ...this.#info(), decision: this.#decisionContext() },
    };
  }

  step(action) {
    if (!this.game) throw new Error('Call reset() before step()');
    if (this.terminated || this.truncated) throw new Error('Episode is over; call reset()');
    const decoded = this.decodeAction(action);
    const globalAction = globalizeAction(decoded, this.agentSide);
    setCustomRng(this.rng);
    const actionContext = this.#decisionContext();
    const gameEndedBefore = this.game.gameEnded;
    this.agentInput.submit(globalAction);
    const scoresBefore = [...this.game.scores];
    const cursorBefore = { ...this.lastRewardCursor };

    this.#advanceUntilDecisionOrDone();
    this.terminated = this.game.finished;
    this.truncated = !this.terminated && (
      this.game.frameNo >= this.config.maxFrames ||
      this.agentInput.decisions - this.episodeDecisionStart >= this.config.maxDecisions
    );

    const rewardParts = this.#reward(scoresBefore, cursorBefore);
    if (this.terminated || this.truncated) {
      this.agentInput.cancelPending();
    } else {
      this.#appendPendingObservation(false);
    }
    this.lastRewardCursor = this.#rewardCursor();
    return {
      observation: this.lastObservation,
      reward: rewardParts.total,
      terminated: this.terminated,
      truncated: this.truncated,
      info: {
        ...this.#info(),
        reward: rewardParts,
        action: cloneAction(decoded),
        globalAction: cloneAction(globalAction),
        gameEndedThisStep: !gameEndedBefore && this.game.gameEnded,
        lossMask: actionContext.trainable ? 1 : 0,
        actionRally: actionContext,
        decision: this.terminated || this.truncated ? null : this.#decisionContext(),
      },
    };
  }

  getRawSnapshot() {
    return this.agentInput && this.agentInput.pendingSnapshot
      ? structuredClone(this.agentInput.pendingSnapshot)
      : null;
  }

  #advanceUntilDecisionOrDone() {
    while (
      !this.game.finished &&
      this.game.frameNo < this.config.maxFrames &&
      this.agentInput.decisions - this.episodeDecisionStart < this.config.maxDecisions &&
      this.agentInput.pendingSnapshot === null
    ) {
      const before = this.#ballOnAgentHalf();
      this.game.step();
      this.#syncRallyMetadata();
      const after = this.#ballOnAgentHalf();
      if (before === true && after === false) this.crossings++;
      this.previousBallOnAgentHalf = after;
    }
  }

  #syncRallyMetadata() {
    if (this.game.cur && this.activeRallyId !== this.game.rallies.length) {
      const id = this.game.rallies.length;
      const tick0 = this.game.cur.tick0[this.victimIndex];
      const victimServe = this.game.cur.serveP2 === (this.victimIndex === 1);
      const victimServePhase = (tick0 + 1) % 3;
      const thunder = victimServe && (victimServePhase === 0 || victimServePhase === 2);
      this.rallyMetadata[id] = {
        id,
        victimServe,
        victimServePhase,
        thunder,
        tick0,
      };
      this.activeRallyId = id;
    }
    if (!this.game.cur) this.activeRallyId = null;
  }

  #decisionContext() {
    const inRound = this.game && this.game.state === 'round' && this.game.cur !== null;
    const meta = inRound ? this.rallyMetadata[this.game.rallies.length] : null;
    return meta
      ? { ...meta, trainable: !this.game.gameEnded }
      : {
        id: null,
        victimServe: false,
        victimServePhase: null,
        thunder: false,
        trainable: !!this.game && !this.game.gameEnded,
      };
  }

  #ballOnAgentHalf() {
    if (!this.game || this.game.state !== 'round') return null;
    return this.agentSide === 'LEFT'
      ? this.game.physics.ball.x < NET_X
      : this.game.physics.ball.x >= NET_X;
  }

  #appendPendingObservation(initial) {
    const snapshot = this.agentInput.pendingSnapshot;
    if (!snapshot) throw new Error('Expected an RL decision snapshot');
    const frame = encodeFrame(
      snapshot,
      this.agentInput.pendingAppliedAction,
      this.config.winningScore
    );
    if (initial) {
      for (let i = 0; i < this.config.frameStack; i++) this.frames.push(frame.slice());
    } else {
      this.frames.push(frame);
      while (this.frames.length > this.config.frameStack) this.frames.shift();
    }
    const flat = new Float32Array(this.observationSize);
    this.frames.forEach((item, index) => flat.set(item, index * FEATURES_PER_FRAME));
    this.lastObservation = flat;
  }

  #totalAgentTouches() {
    let count = 0;
    for (const rally of this.game.rallies) {
      for (const touch of rally.touches) if (touch.i === this.agentIndex) count++;
    }
    if (this.game.cur) {
      for (const touch of this.game.cur.touches) if (touch.i === this.agentIndex) count++;
    }
    return count;
  }

  #rewardCursor() {
    return {
      rallies: this.game.rallies.length,
      agentTouches: this.#totalAgentTouches(),
      crossings: this.crossings,
    };
  }

  #reward(scoresBefore, cursorBefore) {
    const selfDelta = this.game.scores[this.agentIndex] - scoresBefore[this.agentIndex];
    const oppDelta = this.game.scores[1 - this.agentIndex] - scoresBefore[1 - this.agentIndex];
    const point = (selfDelta - oppDelta) * this.rewardConfig.point;
    const cursorAfter = this.#rewardCursor();
    const touch = Math.max(0, cursorAfter.agentTouches - cursorBefore.agentTouches) *
      this.rewardConfig.ownTouch;
    const crossing = Math.max(0, cursorAfter.crossings - cursorBefore.crossings) *
      this.rewardConfig.crossNet;
    let match = 0;
    if (this.game.gameEnded && !this.matchRewardEmitted) {
      match = this.game.scores[this.agentIndex] > this.game.scores[1 - this.agentIndex]
        ? this.rewardConfig.match
        : -this.rewardConfig.match;
      this.matchRewardEmitted = true;
    }
    return { point, match, touch, crossing, total: point + match + touch + crossing };
  }

  #rallyStats() {
    const phases = [0, 0, 0];
    let thunderRallies = 0;
    let nonThunderWins = 0;
    let nonThunderLosses = 0;
    for (let i = 0; i < this.game.rallies.length; i++) {
      const meta = this.rallyMetadata[i];
      const rally = this.game.rallies[i];
      if (!meta) continue;
      if (meta.victimServe) phases[meta.victimServePhase]++;
      if (meta.thunder) {
        thunderRallies++;
      } else if (rally.winner === this.agentIndex) {
        nonThunderWins++;
      } else {
        nonThunderLosses++;
      }
    }
    const wonMatch = this.game.gameEnded &&
      this.game.scores[this.agentIndex] > this.game.scores[this.victimIndex];
    return {
      thunderRallies,
      nonThunderWins,
      nonThunderLosses,
      nonThunderWinRate: nonThunderWins + nonThunderLosses
        ? nonThunderWins / (nonThunderWins + nonThunderLosses)
        : null,
      victimServePhaseCounts: phases,
      winningGameVictimServePhaseCounts: wonMatch ? [...phases] : [0, 0, 0],
    };
  }

  #info() {
    const scores = {
      self: this.game.scores[this.agentIndex],
      opp: this.game.scores[1 - this.agentIndex],
    };
    return {
      seed: this.seed,
      side: this.agentSide,
      scores,
      gameFrame: this.game.frameNo,
      decisions: this.agentInput.decisions - this.episodeDecisionStart,
      rallies: this.game.rallies.length,
      rallyStats: this.#rallyStats(),
      state: this.game.state,
      victimPath: this.opponentSpec.path,
      victimSha256: this.victimHash,
      opponentId: this.opponentSpec.id,
      opponentFamilyId: this.opponentSpec.familyId,
      opponentKind: this.opponentSpec.kind,
      opponentPath: this.opponentSpec.path,
      opponentSha256: this.victimHash,
      tickFrameGroupSize: 3,
      latencyFrames: this.config.latencyFrames,
      observationSize: this.observationSize,
      actionCount: this.actionCount,
    };
  }
}
