import fs from 'node:fs';
import path from 'node:path';
import { ACTIONS } from './config.mjs';
import { RedTeamEnv } from './redteam_env.mjs';

const botPath = path.resolve(process.argv[2] || 'RedTeam_RL_v1.js');
const source = fs.readFileSync(botPath, 'utf8');
const decide = new Function(`${source}\n;return decide;`)();
if (!decide.__rl) throw new Error('exported bot does not expose decide.__rl');

function actionIndex(action) {
  return ACTIONS.findIndex((candidate) =>
    candidate.x === action.x && candidate.y === action.y && candidate.hit === action.hit
  );
}

function assertObservation(expected, actual, context) {
  if (!(actual instanceof Float32Array) || actual.length !== expected.length) {
    throw new Error(`${context}: invalid exported observation`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (!Object.is(expected[i], actual[i])) {
      throw new Error(`${context}: observation[${i}] ${actual[i]} != ${expected[i]}`);
    }
  }
}

const records = [];
for (const [seed, side] of [[773, 'LEFT'], [991, 'RIGHT']]) {
  const env = new RedTeamEnv({ winningScore: 10, maxFrames: 60000 });
  decide.__rl.reset();
  let preserveBotState = false;
  for (let game = 0; game < 2; game++) {
    env.reset(preserveBotState ? { preserveBotState: true, side } : { seed, side });
    let decisions = 0;
    while (!env.terminated && !env.truncated) {
      const snapshot = env.getRawSnapshot();
      const action = decide(snapshot);
      assertObservation(env.lastObservation, decide.__rl.lastObservation(), `${side}/g${game}/d${decisions}`);
      const index = actionIndex(action);
      if (index < 0) throw new Error(`invalid action ${JSON.stringify(action)}`);
      env.step(index);
      decisions++;
    }
    records.push({
      seed,
      side,
      game,
      decisions,
      truncated: env.truncated,
      scores: env.game.scores.slice(),
      agentIndex: env.agentIndex,
      won: !env.truncated && env.game.scores[env.agentIndex] > env.game.scores[env.victimIndex],
    });
    if (env.truncated) throw new Error(`${side}/g${game} truncated`);
    preserveBotState = true;
  }
}

console.log(JSON.stringify({ status: 'PASS', botPath, records }, null, 2));
