import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluatePaired } from './paired_eval.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pikachu-paired-'));
const split = path.join(temporary, 'split.json');
fs.writeFileSync(split, JSON.stringify({
  schemaVersion: 1,
  name: 'smoke',
  opponents: ['fixed_neutral', 'fixed_chase', 'builtin', 'lion_v4'],
  seeds: [77123],
}));
const v4 = path.resolve(here, '..', '..', '..', 'Lion_Eating_Bank_v4.js');
const result = evaluatePaired({
  candidatePath: v4,
  splitPath: split,
  gamesPerSeries: 1,
  winningScore: 1,
  maxFrames: 20000,
});
const matches = result.rows.filter((row) => row.kind === 'match');
assert.equal(matches.length, 16);
for (const opponentId of ['fixed_neutral', 'fixed_chase', 'builtin', 'lion_v4']) {
  for (const side of ['LEFT', 'RIGHT']) {
    const candidate = matches.find((row) => row.arm === 'candidate' && row.side === side && row.opponentId === opponentId);
    const baseline = matches.find((row) => row.arm === 'v4' && row.side === side && row.opponentId === opponentId);
    assert.deepEqual(
      [candidate.scoreSelf, candidate.scoreOpponent, candidate.won, candidate.rallyCount],
      [baseline.scoreSelf, baseline.scoreOpponent, baseline.won, baseline.rallyCount],
    );
  }
}
console.log('paired evaluation identical-arm smoke: PASS');
