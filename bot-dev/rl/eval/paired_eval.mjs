import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PikaUserInput } from '../../../src/resources/js/physics.js';
import { setCustomRng } from '../../../src/resources/js/rand.js';
import { BotInput, RealGame } from '../../sim_real.mjs';
import { makeSeededRng } from '../redteam_env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..', '..', '..');
const engineManifest = JSON.parse(fs.readFileSync(path.resolve(here, '..', 'engine_manifest.json'), 'utf8'));

class BuiltinInput extends PikaUserInput {
  getInput() {}
}

function normalizedSource(filename) {
  return fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
}

function normalizedHash(filename) {
  return crypto.createHash('sha256').update(normalizedSource(filename), 'utf8').digest('hex');
}

function rawHash(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

for (const relativePath of engineManifest.runtimeFiles) {
  const filename = path.join(repositoryRoot, ...relativePath.split('/'));
  assert.equal(rawHash(filename), engineManifest.files[relativePath], `runtime engine hash mismatch: ${relativePath}`);
}

function loadJavascript(filename, expectedHash = null) {
  const actualHash = normalizedHash(filename);
  if (expectedHash && actualHash !== expectedHash) {
    throw new Error(`Bot hash mismatch: ${filename}\nexpected ${expectedHash}\nactual   ${actualHash}`);
  }
  const quietConsole = { log() {}, warn() {}, error() {} };
  const decide = new Function('console', `${normalizedSource(filename)}\n;return decide;`)(quietConsole);
  if (typeof decide !== 'function') throw new Error(`decide() not found: ${filename}`);
  return { decide, sha256Normalized: actualHash };
}

function fixedPolicy(name) {
  if (name === 'neutral') return () => ({ x: 0, y: 0, hit: 0 });
  if (name === 'chase') {
    return (snapshot) => {
      const dx = snapshot.ball.x - snapshot.self.x;
      const close = Math.abs(dx) < 64 && Math.abs(snapshot.ball.y - snapshot.self.y) < 96;
      const airborne = snapshot.self.y < 244 || snapshot.self.state !== 0;
      return {
        x: dx < -4 ? -1 : dx > 4 ? 1 : 0,
        y: !airborne && close ? -1 : 0,
        hit: airborne && close ? 1 : 0,
      };
    };
  }
  throw new Error(`Unknown fixed policy: ${name}`);
}

function loadRegistry(registryPath) {
  const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const entries = new Map();
  for (const item of raw.opponents || []) {
    if (entries.has(item.id)) throw new Error(`Duplicate opponent id: ${item.id}`);
    const entry = { ...item };
    if (entry.path) entry.absolutePath = path.resolve(path.dirname(registryPath), entry.path);
    entries.set(entry.id, entry);
  }
  return { raw, entries };
}

function loadPolicy(entry, timings) {
  let decide;
  let sourceHash = entry.sha256Normalized || null;
  if (entry.kind === 'javascript' || entry.kind === 'checkpoint') {
    const loaded = loadJavascript(entry.absolutePath, entry.sha256Normalized);
    decide = loaded.decide;
    sourceHash = loaded.sha256Normalized;
  } else if (entry.kind === 'fixed') {
    decide = fixedPolicy(entry.policy);
  } else {
    throw new Error(`Cannot load ${entry.kind} as a JavaScript policy`);
  }
  return {
    decide(snapshot) {
      const start = process.hrtime.bigint();
      try {
        return decide(snapshot);
      } finally {
        timings.push(Number(process.hrtime.bigint() - start));
      }
    },
    sourceHash,
  };
}

function makeInput(entry, side, timings) {
  if (entry.kind === 'builtin') return { input: new BuiltinInput(), builtin: true, sourceHash: entry.sha256Normalized };
  const loaded = loadPolicy(entry, timings);
  return {
    input: new BotInput(side, loaded.decide, { latency: 1 }),
    builtin: false,
    sourceHash: loaded.sourceHash,
  };
}

export function candidateCause(rally, candidateIndex) {
  if (rally.winner === candidateIndex) return null;
  if (rally.how === 'touchLimit') return 'self_touch_limit';
  if (rally.how !== 'ground') return 'unknown';
  if (!rally.touches.length) {
    const candidateServed = rally.serveP2 === (candidateIndex === 1);
    const landedOnCandidateHalf = candidateIndex === 0 ? rally.landX < 216 : rally.landX >= 216;
    return candidateServed && landedOnCandidateHalf
      ? 'untouched_self_serve_ground_on_own_half'
      : 'opponent_serve_unreturned';
  }
  const lastToucher = rally.touches[rally.touches.length - 1].i;
  return lastToucher === candidateIndex
    ? 'self_last_touch_then_own_ground'
    : 'opponent_last_touch_score';
}

function percentile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(probability * sorted.length))];
}

function timingSummary(values) {
  return {
    samples: values.length,
    p50Ns: percentile(values, 0.50),
    p95Ns: percentile(values, 0.95),
    p99Ns: percentile(values, 0.99),
    maxNs: values.length ? Math.max(...values) : null,
  };
}

function runSeries({ arm, policyEntry, opponent, side, seed, gamesPerSeries, winningScore, maxFrames }) {
  const rng = makeSeededRng(seed);
  setCustomRng(rng);
  const policyTimings = [];
  const opponentTimings = [];
  const candidateLoaded = makeInput(policyEntry, side, policyTimings);
  const opponentSide = side === 'LEFT' ? 'RIGHT' : 'LEFT';
  const opponentLoaded = makeInput(opponent, opponentSide, opponentTimings);
  const candidateIndex = side === 'LEFT' ? 0 : 1;
  const opponentIndex = 1 - candidateIndex;
  let physics = null;
  const rows = [];

  for (let gameIndex = 0; gameIndex < gamesPerSeries; gameIndex++) {
    const game = new RealGame({ serveRule: 'random', winningScore, physics });
    physics = game.physics;
    game.inputs[candidateIndex] = candidateLoaded.input;
    game.inputs[opponentIndex] = opponentLoaded.input;
    game.physics.player1.isComputer = candidateIndex === 0 ? candidateLoaded.builtin : opponentLoaded.builtin;
    game.physics.player2.isComputer = candidateIndex === 1 ? candidateLoaded.builtin : opponentLoaded.builtin;
    game.runToEnd(maxFrames);
    const blockId = `${opponent.id}/${seed}/0`;
    const selfScore = game.scores[candidateIndex];
    const opponentScore = game.scores[opponentIndex];
    rows.push({
      kind: 'match',
      blockId,
      arm,
      opponentId: opponent.id,
      familyId: opponent.familyId,
      benchmarkOnly: !!opponent.benchmarkOnly,
      seed,
      side,
      seriesIndex: 0,
      gameIndex,
      persistentState: gameIndex > 0,
      winningScore,
      scoreSelf: selfScore,
      scoreOpponent: opponentScore,
      won: game.finished && selfScore > opponentScore,
      truncated: !game.finished,
      gameFrames: game.frameNo,
      rallyCount: game.rallies.length,
      firstServer: game.rallies.length ? (game.rallies[0].serveP2 ? 'RIGHT' : 'LEFT') : null,
    });
    for (let rallyIndex = 0; rallyIndex < game.rallies.length; rallyIndex++) {
      const rally = game.rallies[rallyIndex];
      const touchesBySide = [0, 0];
      for (const touch of rally.touches) touchesBySide[touch.i]++;
      const lastToucher = rally.touches.length ? rally.touches[rally.touches.length - 1].i : null;
      rows.push({
        kind: 'rally',
        blockId,
        arm,
        opponentId: opponent.id,
        familyId: opponent.familyId,
        benchmarkOnly: !!opponent.benchmarkOnly,
        seed,
        side,
        seriesIndex: 0,
        gameIndex,
        rallyIndex,
        serverSide: rally.serveP2 ? 'RIGHT' : 'LEFT',
        candidateServed: rally.serveP2 === (candidateIndex === 1),
        won: rally.winner === candidateIndex,
        winnerSide: rally.winner === 0 ? 'LEFT' : 'RIGHT',
        terminalType: rally.how === 'touchLimit' ? 'touch_limit' : rally.how,
        lossCause: candidateCause(rally, candidateIndex),
        frames: rally.frames,
        landX: rally.landX,
        touchesSelf: touchesBySide[candidateIndex],
        touchesOpponent: touchesBySide[opponentIndex],
        lastToucherSide: lastToucher === null ? null : (lastToucher === 0 ? 'LEFT' : 'RIGHT'),
      });
    }
  }
  return { rows, timing: timingSummary(policyTimings), policySourceHash: candidateLoaded.sourceHash };
}

export function evaluatePaired({
  candidatePath,
  registryPath = path.join(here, 'opponents.json'),
  splitPath = path.join(here, 'splits', 'validation.json'),
  gamesPerSeries = 1,
  winningScore = 10,
  maxFrames = 300000,
}) {
  const registry = loadRegistry(path.resolve(registryPath));
  const split = JSON.parse(fs.readFileSync(path.resolve(splitPath), 'utf8'));
  const candidateAbsolute = path.resolve(candidatePath);
  const candidate = {
    id: 'candidate',
    familyId: 'candidate',
    kind: 'javascript',
    absolutePath: candidateAbsolute,
    sha256Normalized: normalizedHash(candidateAbsolute),
  };
  const baseline = registry.entries.get('lion_v4');
  assert.ok(baseline, 'lion_v4 baseline missing from registry');
  const opponentIds = [...split.opponents, ...(split.benchmarkOpponents || [])];
  const rows = [];
  const timings = [];
  for (const opponentId of opponentIds) {
    const opponent = registry.entries.get(opponentId);
    if (!opponent) throw new Error(`Unknown opponent: ${opponentId}`);
    for (const seed of split.seeds) {
      for (const [arm, policy] of [['candidate', candidate], ['v4', baseline]]) {
        for (const side of ['LEFT', 'RIGHT']) {
          const result = runSeries({
            arm,
            policyEntry: policy,
            opponent,
            side,
            seed,
            gamesPerSeries,
            winningScore,
            maxFrames,
          });
          rows.push(...result.rows);
          timings.push({ arm, opponentId, seed, side, ...result.timing });
        }
      }
    }
  }
  return {
    metadata: {
      schemaVersion: 1,
      engineCommit: engineManifest.commit,
      candidatePath: candidateAbsolute,
      candidateSha256Normalized: candidate.sha256Normalized,
      baselineSha256Normalized: baseline.sha256Normalized,
      splitName: split.name,
      seeds: split.seeds,
      opponentIds,
      gamesPerSeries,
      winningScore,
      latencyFrames: 1,
      pairing: 'same initial RNG seed per arm/side; later serve streams may diverge with rally count',
      timingScope: 'Node compute-only decide() time; excludes Worker scheduling and browser latency',
    },
    rows,
    timings,
  };
}

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidate = argument('candidate');
  if (!candidate) throw new Error('--candidate=<exported JS bot> is required');
  const output = path.resolve(argument('output', 'bot-dev/rl/runs/evaluation/raw.jsonl'));
  const result = evaluatePaired({
    candidatePath: candidate,
    registryPath: argument('registry', path.join(here, 'opponents.json')),
    splitPath: argument('split', path.join(here, 'splits', 'validation.json')),
    gamesPerSeries: Number(argument('games-per-series', '1')),
    winningScore: Number(argument('winning-score', '10')),
    maxFrames: Number(argument('max-frames', '300000')),
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(output + '.meta.json', JSON.stringify({ metadata: result.metadata, timings: result.timings }, null, 2) + '\n');
  console.log(JSON.stringify({ output, rows: result.rows.length, ...result.metadata }));
}
