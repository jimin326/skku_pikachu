// Teacher-shadow rollout: the candidate (exported JS bot) plays real matches
// while the frozen v4 teacher is queried on every learner-visited snapshot.
//
// Outputs
//   --output=<json>          disagreement / self-destruction attribution report
//   --dataset-output=<jsonl> DAgger-style corrective dataset (teacher labels on
//                            learner states).  Allowed only with the train split
//                            so validation opponents/seeds never leak into
//                            training data.
//   --beta=<0..1>            probability that the teacher's action is executed
//                            (DAgger mixing).  0 = pure learner states.
//
// The teacher's internal state evolves along the learner trajectory because it
// sees exactly the snapshots the learner sees; it never controls the player
// unless beta > 0.  That is the standard DAgger query model, and also the
// caveat: v4's hidden state after a learner deviation is not the state v4
// would have had on its own trajectory.
//
// Usage:
//   node bot-dev/rl/eval/teacher_shadow.mjs --candidate=path/to/bot.js \
//     --split=bot-dev/rl/eval/splits/validation.json --output=runs/x/shadow.json
//   node bot-dev/rl/eval/teacher_shadow.mjs --candidate=bot.js --split=...train.json \
//     --beta=0.5 --decisions=200000 --dataset-output=runs/dagger/round1.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACTIONS } from '../config.mjs';
import { canonicalizeAction, loadFrozenVictim, RedTeamEnv } from '../redteam_env.mjs';
import { candidateCause } from './paired_eval.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..', '..', '..');
const TEACHER_SHA = '408bf16e4f986f893a4a5dabc749d7d494657a14811544eddcbe82c9e58bc17f';
const NEUTRAL = ACTIONS.findIndex((a) => a.x === 0 && a.y === 0 && a.hit === 0);
const SELF_CAUSES = new Set(['self_touch_limit', 'untouched_self_serve_ground_on_own_half', 'self_last_touch_then_own_ground']);

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function actionIndex(action) {
  const index = ACTIONS.findIndex((item) => item.x === action?.x && item.y === action?.y && item.hit === action?.hit);
  return index;
}

function loadPool(registryPath, split) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const entries = new Map(registry.opponents.map((item) => [item.id, item]));
  const ids = [...split.opponents, ...(split.benchmarkOpponents || [])];
  return ids.map((id) => {
    const item = { ...entries.get(id) };
    if (!item.id) throw new Error(`Unknown opponent: ${id}`);
    if (item.path) item.path = path.resolve(path.dirname(registryPath), item.path);
    return item;
  });
}

function loadCandidate(candidatePath) {
  const source = fs.readFileSync(candidatePath, 'utf8').replace(/\r\n/g, '\n');
  const quietConsole = { log() {}, warn() {}, error() {} };
  const decide = new Function('console', `${source}\n;return decide;`)(quietConsole);
  if (typeof decide !== 'function') throw new Error(`decide() not found: ${candidatePath}`);
  return decide;
}

// Deterministic mixing RNG (mulberry32) so a DAgger round is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bucketOfDecision(index) {
  if (index < 5) return 'd0-4';
  if (index < 10) return 'd5-9';
  if (index < 20) return 'd10-19';
  return 'd20+';
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export async function runTeacherShadow({
  candidatePath,
  registryPath = path.join(here, 'opponents.json'),
  splitPath = path.join(here, 'splits', 'validation.json'),
  beta = 0,
  targetDecisions = 0,
  datasetOutput = null,
  mixSeed = 20260903,
  winningScore = 10,
  lastK = 5,
}) {
  const split = JSON.parse(fs.readFileSync(splitPath, 'utf8'));
  if (datasetOutput && split.name !== 'train') {
    throw new Error('DAgger datasets may only be collected on the train split (validation/test leakage guard)');
  }
  const opponents = loadPool(registryPath, split);
  const candidate = loadCandidate(candidatePath);
  const rng = mulberry32(mixSeed);
  const stream = datasetOutput ? fs.createWriteStream(datasetOutput, { encoding: 'utf8' }) : null;

  const decisionRows = []; // compact per-decision records
  const rallyRows = [];
  let invalidActions = 0;
  let decisions = 0;
  let episodes = 0;
  const componentDisagree = { x: 0, y: 0, hit: 0 };
  const confusion = Array.from({ length: 18 }, () => Array(18).fill(0));

  // Episode plan: every opponent x seed x side once (validation-style), or cycle
  // until targetDecisions (DAgger-style) if targetDecisions > 0.
  const plan = [];
  for (const opponent of opponents) for (const seed of split.seeds) for (const side of ['LEFT', 'RIGHT']) plan.push({ opponent, seed, side });
  let cursor = 0;
  while (true) {
    if (targetDecisions > 0 ? decisions >= targetDecisions : cursor >= plan.length) break;
    const item = plan[cursor % plan.length];
    const seed = targetDecisions > 0 ? ((item.seed + Math.floor(cursor / plan.length) * 7919) >>> 0) : item.seed;
    const teacher = loadFrozenVictim({ path: path.join(repositoryRoot, 'Lion_Eating_Bank_v4.js'), sha256: TEACHER_SHA });
    const env = new RedTeamEnv({ winningScore });
    let current = env.reset({ seed, side: item.side, opponent: item.opponent });
    const episodeId = episodes;
    let episodeStart = true;
    const perRally = new Map(); // rallyId -> {agree:[], firstDisagree}
    while (!current.terminated && !current.truncated) {
      const raw = env.getRawSnapshot();
      const rallyId = env.game.rallies.length;
      const inRound = env.game.state === 'round';
      const teacherAction = teacher.decide(structuredClone(raw));
      let candidateAction = null;
      try {
        candidateAction = candidate(structuredClone(raw));
      } catch {
        candidateAction = null;
      }
      const teacherIndex = actionIndex(canonicalizeAction(teacherAction, item.side));
      let candidateIndex = candidateAction ? actionIndex(canonicalizeAction(candidateAction, item.side)) : -1;
      if (candidateIndex < 0) {
        invalidActions++;
        candidateIndex = NEUTRAL;
      }
      const tIndex = teacherIndex < 0 ? NEUTRAL : teacherIndex;
      const agree = candidateIndex === tIndex;
      const ca = ACTIONS[candidateIndex];
      const ta = ACTIONS[tIndex];
      if (ca.x !== ta.x) componentDisagree.x++;
      if (ca.y !== ta.y) componentDisagree.y++;
      if (ca.hit !== ta.hit) componentDisagree.hit++;
      confusion[tIndex][candidateIndex]++;
      const bucket = perRally.get(rallyId) || { agree: [], firstDisagree: null, inRound };
      if (!agree && bucket.firstDisagree === null) bucket.firstDisagree = bucket.agree.length;
      bucket.agree.push(agree ? 1 : 0);
      perRally.set(rallyId, bucket);
      decisionRows.push({ e: episodeId, r: rallyId, i: bucket.agree.length - 1, a: agree ? 1 : 0, round: inRound ? 1 : 0 });

      const executeTeacher = beta > 0 && rng() < beta;
      const executed = executeTeacher ? tIndex : candidateIndex;
      if (stream) {
        stream.write(JSON.stringify({
          observation: Array.from(current.observation),
          action: tIndex,
          executedAction: executed,
          learnerAction: candidateIndex,
          episodeStart,
          episodeId,
          seed,
          side: item.side,
          opponentId: item.opponent.id,
          source: executeTeacher ? 'teacher-mixed' : 'learner',
        }) + '\n');
      }
      current = env.step(executed);
      episodeStart = false;
      decisions++;
      if (targetDecisions > 0 && decisions >= targetDecisions) break;
    }
    const agentIndex = env.agentIndex;
    env.game.rallies.forEach((rally, rallyId) => {
      const bucket = perRally.get(rallyId) || { agree: [], firstDisagree: null };
      const cause = candidateCause(rally, agentIndex);
      rallyRows.push({
        episodeId,
        opponentId: item.opponent.id,
        seed,
        side: item.side,
        rallyId,
        won: rally.winner === agentIndex,
        candidateServed: rally.serveP2 === (agentIndex === 1),
        lossCause: cause,
        selfDestruction: cause ? SELF_CAUSES.has(cause) : false,
        frames: rally.frames,
        decisions: bucket.agree.length,
        disagreeRate: bucket.agree.length ? 1 - mean(bucket.agree) : null,
        disagreeLastK: bucket.agree.length ? 1 - mean(bucket.agree.slice(-lastK)) : null,
        firstDisagreeIndex: bucket.firstDisagree,
      });
    });
    episodes++;
    cursor++;
  }
  if (stream) await new Promise((resolve, reject) => stream.end((error) => (error ? reject(error) : resolve())));

  // ---- aggregate ----
  const total = decisionRows.length;
  const disagreeOverall = total ? 1 - mean(decisionRows.map((d) => d.a)) : null;
  const byBucket = {};
  for (const d of decisionRows) {
    if (!d.round) continue;
    const key = bucketOfDecision(d.i);
    byBucket[key] = byBucket[key] || { decisions: 0, disagree: 0 };
    byBucket[key].decisions++;
    byBucket[key].disagree += 1 - d.a;
  }
  for (const key of Object.keys(byBucket)) byBucket[key].rate = byBucket[key].disagree / byBucket[key].decisions;
  const groupBy = (key) => {
    const out = {};
    for (const r of rallyRows) {
      const k = String(r[key]);
      out[k] = out[k] || { rallies: 0, wins: 0, selfDestruction: 0, disagree: [], disagreeLastK: [], frames: [] };
      out[k].rallies++;
      out[k].wins += r.won ? 1 : 0;
      out[k].selfDestruction += r.selfDestruction ? 1 : 0;
      if (r.disagreeRate !== null) out[k].disagree.push(r.disagreeRate);
      if (r.disagreeLastK !== null) out[k].disagreeLastK.push(r.disagreeLastK);
      out[k].frames.push(r.frames);
    }
    for (const v of Object.values(out)) {
      v.winRate = v.wins / v.rallies;
      v.meanDisagree = mean(v.disagree);
      v.meanDisagreeLastK = mean(v.disagreeLastK);
      v.meanFrames = mean(v.frames);
      delete v.disagree; delete v.disagreeLastK; delete v.frames;
    }
    return out;
  };
  const losses = rallyRows.filter((r) => !r.won);
  const selfDestructionLosses = losses.filter((r) => r.selfDestruction);
  const won = rallyRows.filter((r) => r.won);
  const report = {
    schemaVersion: 1,
    candidatePath: path.resolve(candidatePath),
    split: split.name,
    beta,
    mixSeed,
    episodes,
    decisions: total,
    invalidActions,
    rallies: rallyRows.length,
    rallyWinRate: rallyRows.length ? won.length / rallyRows.length : null,
    selfDestruction: {
      count: selfDestructionLosses.length,
      losses: losses.length,
      rateAmongLosses: losses.length ? selfDestructionLosses.length / losses.length : null,
    },
    disagreement: {
      overall: disagreeOverall,
      byComponent: {
        x: total ? componentDisagree.x / total : null,
        y: total ? componentDisagree.y / total : null,
        hit: total ? componentDisagree.hit / total : null,
      },
      byDecisionIndexInRally: byBucket,
      wonRallies: { mean: mean(won.map((r) => r.disagreeRate).filter((v) => v !== null)), lastK: mean(won.map((r) => r.disagreeLastK).filter((v) => v !== null)) },
      lostRallies: { mean: mean(losses.map((r) => r.disagreeRate).filter((v) => v !== null)), lastK: mean(losses.map((r) => r.disagreeLastK).filter((v) => v !== null)) },
      selfDestructionRallies: {
        mean: mean(selfDestructionLosses.map((r) => r.disagreeRate).filter((v) => v !== null)),
        lastK: mean(selfDestructionLosses.map((r) => r.disagreeLastK).filter((v) => v !== null)),
        firstDisagreeIndexMean: mean(selfDestructionLosses.map((r) => r.firstDisagreeIndex).filter((v) => v !== null)),
      },
      lastK,
    },
    byLossCause: groupBy('lossCause'),
    byOpponent: groupBy('opponentId'),
    bySide: groupBy('side'),
    teacherVsCandidateConfusion: { rows: 'teacher action index', cols: 'candidate action index', matrix: confusion },
    interpretation: [
      'Rising byDecisionIndexInRally disagreement + high disagreement in lost/self-destruction rallies = compounding error after leaving the teacher distribution (covariate shift).',
      'Flat, uniformly high disagreement even at d0-4 (fresh serve states the teacher also visits) = the learner never fit those states (capacity, imbalance) or the teacher label is ambiguous (hidden state); cross-check bc_diagnostics aliasing.',
      'Teacher hidden state evolves along the learner trajectory; disagreement after a deviation is a DAgger query, not ground truth of what v4 would do on its own path.',
    ],
    dataset: datasetOutput ? path.resolve(datasetOutput) : null,
  };
  if (datasetOutput) {
    fs.writeFileSync(datasetOutput + '.meta.json', JSON.stringify({
      schemaVersion: 1,
      teacherPath: path.join(repositoryRoot, 'Lion_Eating_Bank_v4.js'),
      teacherSha256Normalized: TEACHER_SHA,
      decisions: total,
      episodes,
      observationSize: 92,
      actionCount: 18,
      opponentFamilies: [...new Set(opponents.map((o) => o.familyId))].sort(),
      registryPath: path.resolve(registryPath),
      splitPath: path.resolve(splitPath),
      collection: 'dagger-teacher-shadow',
      learnerPath: path.resolve(candidatePath),
      beta,
      mixSeed,
    }, null, 2) + '\n');
  }
  return { report, rallyRows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidatePath = argument('candidate');
  if (!candidatePath) throw new Error('--candidate=<exported JS bot> is required');
  const output = argument('output', null);
  const datasetOutput = argument('dataset-output', null);
  if (datasetOutput) fs.mkdirSync(path.dirname(path.resolve(datasetOutput)), { recursive: true });
  const { report, rallyRows } = await runTeacherShadow({
    candidatePath: path.resolve(candidatePath),
    registryPath: path.resolve(argument('registry', path.join(here, 'opponents.json'))),
    splitPath: path.resolve(argument('split', path.join(here, 'splits', 'validation.json'))),
    beta: Number(argument('beta', '0')),
    targetDecisions: Number(argument('decisions', '0')),
    datasetOutput: datasetOutput ? path.resolve(datasetOutput) : null,
    mixSeed: Number(argument('mix-seed', '20260903')),
    winningScore: Number(argument('winning-score', '10')),
    lastK: Number(argument('last-k', '5')),
  });
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(output.replace(/\.json$/, '') + '.rallies.jsonl', rallyRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  console.log(JSON.stringify({
    output,
    episodes: report.episodes,
    decisions: report.decisions,
    rallyWinRate: report.rallyWinRate,
    disagreeOverall: report.disagreement.overall,
    selfDestruction: report.selfDestruction,
    invalidActions: report.invalidActions,
  }));
}
