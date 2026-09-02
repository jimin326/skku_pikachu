import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACTIONS } from './config.mjs';
import { canonicalizeAction, loadFrozenVictim, RedTeamEnv } from './redteam_env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..', '..');

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function actionIndex(action) {
  const index = ACTIONS.findIndex((item) => item.x === action?.x && item.y === action?.y && item.hit === action?.hit);
  return index >= 0 ? index : ACTIONS.findIndex((item) => item.x === 0 && item.y === 0 && item.hit === 0);
}

function loadPool(registryPath, splitPath) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const split = JSON.parse(fs.readFileSync(splitPath, 'utf8'));
  const entries = new Map(registry.opponents.map((item) => [item.id, item]));
  return split.opponents.map((id) => {
    const item = { ...entries.get(id) };
    if (!item.id) throw new Error(`Unknown opponent: ${id}`);
    if (item.path) item.path = path.resolve(path.dirname(registryPath), item.path);
    return item;
  });
}

const output = path.resolve(argument('output', 'bot-dev/rl/runs/bc/v4_rollouts.jsonl'));
const targetDecisions = Number(argument('decisions', '100000'));
const registryPath = path.resolve(argument('registry', path.join(here, 'eval', 'opponents.json')));
const splitPath = path.resolve(argument('split', path.join(here, 'eval', 'splits', 'train.json')));
const teacherPath = path.resolve(argument('teacher', path.join(repositoryRoot, 'Lion_Eating_Bank_v4.js')));
const teacherExpectedHash = '408bf16e4f986f893a4a5dabc749d7d494657a14811544eddcbe82c9e58bc17f';
const opponents = loadPool(registryPath, splitPath);
fs.mkdirSync(path.dirname(output), { recursive: true });
const stream = fs.createWriteStream(output, { encoding: 'utf8' });

let decisions = 0;
let episodes = 0;
let cursor = Number(argument('start-cursor', '0'));
const exposure = new Set();
while (decisions < targetDecisions) {
  const opponent = opponents[cursor % opponents.length];
  const side = cursor % 2 === 0 ? 'LEFT' : 'RIGHT';
  const seed = (0x3c6ef372 + cursor * 2654435761) >>> 0;
  const teacher = loadFrozenVictim({ path: teacherPath, sha256: teacherExpectedHash });
  const env = new RedTeamEnv({ winningScore: 10 });
  let current = env.reset({ seed, side, opponent });
  let episodeStart = true;
  exposure.add(opponent.familyId);
  while (!current.terminated && !current.truncated && decisions < targetDecisions) {
    const action = teacher.decide(env.getRawSnapshot());
    const index = actionIndex(canonicalizeAction(action, side));
    stream.write(JSON.stringify({
      observation: Array.from(current.observation),
      action: index,
      episodeStart,
      episodeId: episodes,
      seed,
      side,
      opponentId: opponent.id,
    }) + '\n');
    current = env.step(index);
    episodeStart = false;
    decisions++;
  }
  episodes++;
  cursor++;
}
await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
const metadata = {
  schemaVersion: 1,
  teacherPath,
  teacherSha256Normalized: teacherExpectedHash,
  decisions,
  episodes,
  observationSize: 92,
  actionCount: 18,
  opponentFamilies: [...exposure].sort(),
  registryPath,
  splitPath,
};
fs.writeFileSync(output + '.meta.json', JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ output, ...metadata }));
