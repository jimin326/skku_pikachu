import readline from 'node:readline';
import { RedTeamEnv } from './redteam_env.mjs';

// Stdout is reserved for newline-delimited protocol messages. A participant
// bot that logs must not corrupt the Python bridge.
console.log = (...args) => console.error(...args);

let envs = [];

function pack(result) {
  return {
    ...result,
    observation: Array.from(result.observation),
  };
}

function send(id, payload) {
  process.stdout.write(`${JSON.stringify({ id, ok: true, ...payload })}\n`);
}

function fail(id, error) {
  process.stdout.write(`${JSON.stringify({
    id,
    ok: false,
    error: error instanceof Error ? error.stack || error.message : String(error),
  })}\n`);
}

function handle(message) {
  const { id = null, command } = message;
  if (command === 'create') {
    const count = message.count ?? 1;
    if (!Number.isInteger(count) || count < 1) throw new TypeError('count must be a positive integer');
    envs = Array.from({ length: count }, () => new RedTeamEnv(message.options || {}));
    send(id, {
      count,
      observationSize: envs[0].observationSize,
      actionCount: envs[0].actionCount,
    });
    return;
  }
  if (command === 'spec') {
    if (!envs.length) throw new Error('create must be called first');
    send(id, {
      count: envs.length,
      observationSize: envs[0].observationSize,
      actionCount: envs[0].actionCount,
    });
    return;
  }
  if (command === 'reset') {
    if (!envs.length) throw new Error('create must be called first');
    const requests = message.requests || envs.map((_, index) => ({ seed: index + 1 }));
    if (requests.length !== envs.length) throw new Error('reset request count mismatch');
    send(id, { results: envs.map((env, index) => {
      const request = requests[index];
      if (request === null) {
        if (!env.lastObservation) throw new Error(`environment ${index} has not been reset`);
        return pack({ observation: env.lastObservation, info: { kept: true } });
      }
      return pack(env.reset(request));
    }) });
    return;
  }
  if (command === 'step') {
    if (!envs.length) throw new Error('create must be called first');
    if (!Array.isArray(message.actions) || message.actions.length !== envs.length) {
      throw new Error('action count mismatch');
    }
    const results = envs.map((env, index) => {
      const action = message.actions[index];
      if (action === null && (env.terminated || env.truncated)) {
        return pack({
          observation: env.lastObservation,
          reward: 0,
          terminated: env.terminated,
          truncated: env.truncated,
          info: { skipped: true },
        });
      }
      return pack(env.step(action));
    });
    send(id, { results });
    return;
  }
  if (command === 'close') {
    send(id, {});
    process.exit(0);
  }
  throw new Error(`Unknown command: ${command}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
input.on('line', (line) => {
  chain = chain.then(() => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
      handle(message);
    } catch (error) {
      fail(message && message.id !== undefined ? message.id : null, error);
    }
  });
});
