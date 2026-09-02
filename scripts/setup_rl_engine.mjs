import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!gameRoot) throw new Error('usage: node scripts/setup_rl_engine.mjs <official-game-checkout>');
const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'bot-dev/rl/engine_manifest.json'), 'utf8'));
const commit = execFileSync(
  'git',
  ['-c', `safe.directory=${gameRoot}`, '-C', gameRoot, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' },
).trim();
assert.equal(commit, manifest.commit, 'official engine commit mismatch');

function hash(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

for (const [relativePath, expected] of Object.entries(manifest.files)) {
  const source = path.join(gameRoot, ...relativePath.split('/'));
  assert.equal(hash(source), expected, `official engine hash mismatch: ${relativePath}`);
}
for (const relativePath of manifest.runtimeFiles) {
  const source = path.join(gameRoot, ...relativePath.split('/'));
  const destination = path.join(repositoryRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  assert.equal(hash(destination), manifest.files[relativePath], `copied engine hash mismatch: ${relativePath}`);
  console.log(`${relativePath}  ${hash(destination)}`);
}
console.log(`Official engine commit verified: ${commit}`);
