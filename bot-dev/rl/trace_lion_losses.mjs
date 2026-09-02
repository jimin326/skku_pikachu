import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { BotInput, RealGame, loadBot } from '../sim_real.mjs';
import { setCustomRng } from '../../src/resources/js/rand.js';
import { makeSeededRng } from './redteam_env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function parseArgs(argv) {
  const result = Object.create(null);
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const split = item.indexOf('=');
    result[item.slice(2, split < 0 ? undefined : split)] =
      split < 0 ? true : item.slice(split + 1);
  }
  return result;
}

function sha256(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function validAction(action) {
  return (
    action &&
    (action.x === -1 || action.x === 0 || action.x === 1) &&
    (action.y === -1 || action.y === 0 || action.y === 1) &&
    (action.hit === 0 || action.hit === 1)
  );
}

function normalizeX(x, rlSide) {
  return rlSide === 'RIGHT' ? 432 - x : x;
}

function normalizeDirection(x, rlSide) {
  return rlSide === 'RIGHT' ? -x : x;
}

function compactDecision(
  { role, snapshot, action, gameFrame, state },
  rally,
  rlSide
) {
  const right = rlSide === 'RIGHT';
  const rlPlayer = role === 'RL' ? snapshot.self : snapshot.opp;
  const lionPlayer = role === 'LION' ? snapshot.self : snapshot.opp;
  const ball = snapshot.ball;
  return {
    f: gameFrame - rally.startFrame,
    t: snapshot.tick,
    rf: snapshot.meta.rallyFrameCount,
    st: state,
    a: [normalizeDirection(action.x, rlSide), action.y, action.hit],
    raw: [action.x, action.y, action.hit],
    b: [
      normalizeX(ball.x, rlSide),
      ball.y,
      right ? -ball.xVelocity : ball.xVelocity,
      ball.yVelocity,
      normalizeX(ball.expectedLandingPointX, rlSide),
      ball.isPowerHit ? 1 : 0,
    ],
    p: [
      [
        normalizeX(rlPlayer.x, rlSide),
        rlPlayer.y,
        rlPlayer.state,
        rlPlayer.frameNumber,
        normalizeDirection(rlPlayer.divingDirection, rlSide),
      ],
      [
        normalizeX(lionPlayer.x, rlSide),
        lionPlayer.y,
        lionPlayer.state,
        lionPlayer.frameNumber,
        normalizeDirection(lionPlayer.divingDirection, rlSide),
      ],
    ],
  };
}

function compactTouch(touch, rally, rlSide, rlIndex) {
  const lionIndex = 1 - rlIndex;
  return {
    by: touch.i === rlIndex ? 'RL' : 'LION',
    f: touch.f,
    power: touch.ph ? 1 : 0,
    b: [
      normalizeX(touch.bx, rlSide),
      touch.by,
      normalizeDirection(touch.vx, rlSide),
      touch.vy,
    ],
    p: [
      [
        normalizeX(touch.px[rlIndex], rlSide),
        touch.py[rlIndex],
        touch.st[rlIndex],
      ],
      [
        normalizeX(touch.px[lionIndex], rlSide),
        touch.py[lionIndex],
        touch.st[lionIndex],
      ],
    ],
  };
}

async function writeLine(stream, value) {
  if (!stream.write(`${JSON.stringify(value)}\n`)) await once(stream, 'drain');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const redTeamPath = path.resolve(
    root,
    args.redteam || 'RedTeam_RL_v1.js'
  );
  const lionPath = path.resolve(
    root,
    args.lion || 'Lion_Eating_Bank_v1.js'
  );
  const seedCount = Number(args['seed-count'] || 100);
  const gamesPerSeries = Number(args['games-per-series'] || 5);
  const baseSeed = Number(args['base-seed'] || 620260902) >>> 0;
  const maxFrames = Number(args['max-frames'] || 60000);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .replace('T', '_');
  const outputPath = path.resolve(
    root,
    args.output ||
      `bot-dev/rl/runs/lion_loss_${timestamp}/lion_loss_traces.jsonl`
  );

  for (const [name, value] of Object.entries({
    seedCount,
    gamesPerSeries,
    maxFrames,
  })) {
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer`);
  }
  for (const filePath of [redTeamPath, lionPath]) {
    if (!fs.existsSync(filePath))
      throw new Error(`file not found: ${filePath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const output = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  const metadata = {
    type: 'meta',
    version: 1,
    createdAt: new Date().toISOString(),
    redTeam: { path: redTeamPath, sha256: sha256(redTeamPath) },
    lion: { path: lionPath, sha256: sha256(lionPath) },
    seedCount,
    gamesPerSeries,
    plannedGames: seedCount * gamesPerSeries * 2,
    baseSeed,
    maxFrames,
    serveRule: 'random',
    latencyFrames: 1,
    tickFrameGroupSize: 3,
  };
  await writeLine(output, metadata);

  let games = 0;
  let lionLosses = 0;
  let thunderLosses = 0;
  let redTeamMatchWins = 0;
  let truncatedGames = 0;

  for (let seedIndex = 0; seedIndex < seedCount; seedIndex++) {
    const seed = (baseSeed + Math.imul(seedIndex + 1, 7919)) >>> 0 || 1;
    for (const rlSide of ['LEFT', 'RIGHT']) {
      setCustomRng(makeSeededRng(seed));
      const rlBase = loadBot(redTeamPath);
      const lionBase = loadBot(lionPath);
      const rlIndex = rlSide === 'LEFT' ? 0 : 1;
      const lionIndex = 1 - rlIndex;
      let game = null;
      let decisions = [];

      const wrap = (role, decide) => (snapshot) => {
        let action;
        try {
          action = decide(snapshot);
        } catch {
          action = null;
        }
        if (!validAction(action)) action = { x: 0, y: 0, hit: 0 };
        decisions.push({
          role,
          snapshot,
          action: { x: action.x, y: action.y, hit: action.hit },
          gameFrame: game.frameNo,
          state: game.state,
        });
        return action;
      };

      const rlInput = new BotInput(rlSide, wrap('RL', rlBase), { latency: 1 });
      const lionSide = rlSide === 'LEFT' ? 'RIGHT' : 'LEFT';
      const lionInput = new BotInput(lionSide, wrap('LION', lionBase), {
        latency: 1,
      });

      for (let gameIndex = 0; gameIndex < gamesPerSeries; gameIndex++) {
        decisions = [];
        game = new RealGame({
          serveRule: 'random',
          winningScore: 10,
          readySnapshots: true,
        });
        game.inputs[rlIndex] = rlInput;
        game.inputs[lionIndex] = lionInput;
        game.runToEnd(maxFrames);
        const truncated = !game.finished;
        truncatedGames += Number(truncated);
        const wonMatch =
          !truncated && game.scores[rlIndex] > game.scores[lionIndex];
        redTeamMatchWins += Number(wonMatch);

        await writeLine(output, {
          type: 'game',
          seed,
          side: rlSide,
          game: gameIndex,
          scores: { rl: game.scores[rlIndex], lion: game.scores[lionIndex] },
          rallies: game.rallies.length,
          won: wonMatch,
          truncated,
        });

        const runningScore = [0, 0];
        let previousEndFrame = 0;
        for (
          let rallyIndex = 0;
          rallyIndex < game.rallies.length;
          rallyIndex++
        ) {
          const rally = game.rallies[rallyIndex];
          const scoreBefore = {
            rl: runningScore[rlIndex],
            lion: runningScore[lionIndex],
          };
          runningScore[rally.winner]++;
          const endFrame = rally.startFrame + rally.frames;
          const window = decisions.filter(
            (decision) =>
              decision.gameFrame > previousEndFrame &&
              decision.gameFrame <= endFrame
          );
          previousEndFrame = endFrame;
          if (rally.winner !== rlIndex) continue;

          const serverIndex = rally.serveP2 ? 1 : 0;
          const server = serverIndex === rlIndex ? 'RL' : 'LION';
          const lionServePhase =
            server === 'LION' ? (rally.tick0[lionIndex] + 1) % 3 : null;
          const rlServePhase =
            server === 'RL' ? (rally.tick0[rlIndex] + 1) % 3 : null;
          const thunder =
            server === 'LION' && (lionServePhase === 0 || lionServePhase === 2);
          lionLosses++;
          thunderLosses += Number(thunder);

          await writeLine(output, {
            type: 'lionLoss',
            id: `s${seed}_${rlSide}_g${gameIndex}_r${rallyIndex}`,
            seed,
            side: rlSide,
            game: gameIndex,
            rally: rallyIndex,
            scoreBefore,
            server,
            rlServePhase,
            lionServePhase,
            thunder,
            frames: rally.frames,
            how: rally.how,
            landX: normalizeX(rally.landX, rlSide),
            touches: rally.touches.map((touch) =>
              compactTouch(touch, rally, rlSide, rlIndex)
            ),
            rlDecisions: window
              .filter((decision) => decision.role === 'RL')
              .map((decision) => compactDecision(decision, rally, rlSide)),
            lionDecisions: window
              .filter((decision) => decision.role === 'LION')
              .map((decision) => compactDecision(decision, rally, rlSide)),
          });
        }

        games++;
        if (games % 50 === 0) {
          console.log(
            `traced ${games}/${metadata.plannedGames} games, Lion losses=${lionLosses}`
          );
        }
      }
    }
  }

  await writeLine(output, {
    type: 'summary',
    games,
    redTeamMatchWins,
    matchWinRate: games ? redTeamMatchWins / games : null,
    lionLosses,
    thunderLosses,
    truncatedGames,
  });
  output.end();
  await once(output, 'finish');
  console.log(
    JSON.stringify(
      {
        status: 'complete',
        output: outputPath,
        games,
        redTeamMatchWins,
        lionLosses,
        thunderLosses,
        truncatedGames,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
