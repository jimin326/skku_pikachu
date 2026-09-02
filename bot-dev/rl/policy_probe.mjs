import fs from 'node:fs';
import readline from 'node:readline';

const botPath = process.argv[2];
if (!botPath) throw new Error('usage: node policy_probe.mjs <RedTeam_RL.js>');
const source = fs.readFileSync(botPath, 'utf8');
const decide = new Function(`${source}\n;return decide;`)();
if (!decide.__rl) throw new Error(`${botPath} does not expose decide.__rl`);

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const request = JSON.parse(line);
    if (request.op === 'metadata') {
      console.log(JSON.stringify({ ok: true, metadata: decide.__rl.metadata }));
      continue;
    }
    if (request.op !== 'infer' || !Array.isArray(request.observations)) {
      throw new Error('expected {op:"infer", observations:[[...], ...]}');
    }
    const results = request.observations.map((values) => {
      const observation = Float32Array.from(values);
      const logits = decide.__rl.policyLogits(observation);
      return {
        action: decide.__rl.inferActionIndex(observation),
        logits: Array.from(logits),
      };
    });
    console.log(JSON.stringify({ ok: true, results }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.stack || String(error) }));
  }
}
