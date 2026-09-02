/* Black-box prefix beam gate for RedTeam vs the frozen Lion.
 *
 * This is deliberately not an RL algorithm. It forces an action prefix while
 * the real Lion decide() runs on the other side, then lets a fixed fallback
 * finish the rally. PPO must eventually match at least one discovered
 * non-thunder score; otherwise the learner/bridge is suspect.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulatePoint } from '../sim.mjs';
import { setCustomRng } from '../../src/resources/js/rand.js';
import { ACTIONS, FROZEN_VICTIM } from './config.mjs';
import { makeSeededRng } from './redteam_env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = '1'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const WIDTH = Number(args.width || 12);
const DEPTH = Number(args.depth || 18);
const MAX_FRAMES = Number(args.maxFrames || 900);
const SEED = Number(args.seed || 73021);
const OUTPUT = path.resolve(args.output || path.join(here, 'checkpoints/beam_gate.json'));
const ONLY_CELL = args.cell || null;
const victimSource = fs.readFileSync(FROZEN_VICTIM.path, 'utf8');
const createVictim = new Function(`${victimSource}\n;return decide;`);

function fallback(snapshot) {
  const dx = snapshot.ball.expectedLandingPointX - snapshot.self.x;
  const close = Math.abs(snapshot.ball.x - snapshot.self.x) <= 72;
  const descending = snapshot.ball.yVelocity >= -3;
  return {
    x: Math.abs(dx) < 8 ? 0 : dx > 0 ? 1 : -1,
    y: snapshot.self.state === 0 && close && descending && snapshot.ball.y > 92 ? -1 : 0,
    hit: close ? 1 : 0,
  };
}

function cellName(cell) {
  return `${cell.side}_${cell.redServes ? 'RED_SERVE' : 'LION_SERVE'}_P${cell.phase}`;
}

function evaluate(indices, cell) {
  setCustomRng(makeSeededRng(SEED + cell.phase * 101 + (cell.side === 'RIGHT' ? 17 : 0)));
  const victim = createVictim();
  let call = 0;
  let maxThreat = 0;
  let minDistance = 999;
  const scriptFn = (_tick, _rally, snapshot) => {
    const ballX = cell.side === 'LEFT' ? snapshot.ball.x : 432 - snapshot.ball.x;
    maxThreat = Math.max(maxThreat, ballX);
    minDistance = Math.min(
      minDistance,
      Math.hypot(snapshot.ball.x - snapshot.self.x, snapshot.ball.y - snapshot.self.y)
    );
    const action = call < indices.length ? ACTIONS[indices[call]] : fallback(snapshot);
    call++;
    return action;
  };
  const serveIsP2 = cell.redServes ? cell.side === 'RIGHT' : cell.side === 'LEFT';
  const result = simulatePoint(() => ({ x: 0, y: 0, hit: 0 }), {
    botSide: cell.side,
    opponent: victim,
    serveIsP2,
    phase: cell.phase,
    latency: 1,
    maxFrames: MAX_FRAMES,
    scriptFn,
  });
  const won = result.winner === cell.side;
  const score = won
    ? 1e9 - result.frames * 1000 + result.botTouches * 50
    : maxThreat * 1000 + result.botTouches * 600 + result.powerhits * 250 -
      minDistance - result.frames * 0.1;
  return { result, won, score, maxThreat, minDistance };
}

function search(cell) {
  let beams = [{ indices: [], score: -Infinity }];
  const wins = [];
  const baseline = evaluate([], cell);
  if (baseline.won) wins.push({ indices: [], evaluation: baseline });
  for (let depth = 1; depth <= DEPTH && !wins.length; depth++) {
    const candidates = [];
    for (const beam of beams) {
      for (let action = 0; action < ACTIONS.length; action++) {
        const indices = [...beam.indices, action];
        const evaluation = evaluate(indices, cell);
        const item = { indices, score: evaluation.score, evaluation };
        candidates.push(item);
        if (evaluation.won) wins.push(item);
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    beams = candidates.slice(0, WIDTH).map(({ indices, score }) => ({ indices, score }));
    process.stderr.write(
      `${cellName(cell)} depth=${depth} best=${Math.round(candidates[0].score)} ` +
      `wins=${wins.length}\n`
    );
  }
  wins.sort((a, b) => a.evaluation.result.frames - b.evaluation.result.frames);
  return {
    cell: { ...cell, name: cellName(cell), nonThunder: true },
    baseline: summarize([], baseline),
    found: wins.slice(0, 16).map((item) => summarize(item.indices, item.evaluation)),
  };
}

function summarize(indices, evaluation) {
  return {
    indices,
    actions: indices.map((index) => ACTIONS[index]),
    won: evaluation.won,
    winner: evaluation.result.winner,
    frames: evaluation.result.frames,
    landX: evaluation.result.landX,
    touches: evaluation.result.botTouches,
    powerHits: evaluation.result.powerhits,
    maxThreat: evaluation.maxThreat,
  };
}

const cells = [];
for (const side of ['LEFT', 'RIGHT']) {
  for (const redServes of [true, false]) {
    for (const phase of [0, 1, 2]) {
      if (!redServes && phase !== 1) continue; // uncontrollable Lion thunder
      const cell = { side, redServes, phase };
      if (!ONLY_CELL || cellName(cell) === ONLY_CELL) cells.push(cell);
    }
  }
}
if (!cells.length) throw new Error(`Unknown or excluded cell: ${ONLY_CELL}`);

const startedAt = new Date().toISOString();
const results = cells.map(search);
const gateWins = results.reduce((sum, result) => sum + result.found.length, 0);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify({
  version: 1,
  victim: FROZEN_VICTIM,
  seed: SEED,
  width: WIDTH,
  depth: DEPTH,
  maxFrames: MAX_FRAMES,
  startedAt,
  completedAt: new Date().toISOString(),
  gatePassed: gateWins > 0,
  gateWins,
  results,
}, null, 2));
console.error(`beam gate ${gateWins > 0 ? 'PASS' : 'MISS'}: ${gateWins} wins -> ${OUTPUT}`);
if (!gateWins) process.exitCode = 2;
