import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { ACTIONS } from '../config.mjs';
import { RedTeamEnv } from '../redteam_env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..', '..', '..');
const engineManifest = JSON.parse(fs.readFileSync(path.resolve(here, '..', 'engine_manifest.json'), 'utf8'));

for (const relativePath of engineManifest.runtimeFiles) {
  const filename = path.join(repositoryRoot, ...relativePath.split('/'));
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  if (actual !== engineManifest.files[relativePath]) throw new Error(`runtime engine hash mismatch: ${relativePath}`);
}

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function loadBot(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const quietConsole = { log() {}, warn() {}, error() {} };
  const start = process.hrtime.bigint();
  const decide = new Function('console', `${source}\n;return decide;`)(quietConsole);
  const loadNs = Number(process.hrtime.bigint() - start);
  return { decide, source, loadNs };
}

function percentile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(probability * sorted.length))];
}

function valid(action) {
  return action && [-1, 0, 1].includes(action.x) && [-1, 0, 1].includes(action.y) && [0, 1].includes(action.hit);
}

function collectSnapshots(count) {
  const snapshots = [];
  let episode = 0;
  while (snapshots.length < count) {
    const side = episode % 2 ? 'RIGHT' : 'LEFT';
    const env = new RedTeamEnv({ winningScore: 1 });
    let result = env.reset({ seed: 0x12340000 + episode, side });
    while (!result.terminated && !result.truncated && snapshots.length < count) {
      snapshots.push(env.getRawSnapshot());
      result = env.step(8);
    }
    episode++;
  }
  return snapshots;
}

function benchmark(filename, snapshots, warmup) {
  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const loaded = loadBot(filename);
  for (let i = 0; i < warmup; i++) loaded.decide(snapshots[i % snapshots.length]);
  const timings = [];
  let invalidActions = 0;
  for (const snapshot of snapshots) {
    const start = process.hrtime.bigint();
    let action;
    try { action = loaded.decide(snapshot); } catch { action = null; }
    timings.push(Number(process.hrtime.bigint() - start));
    if (!valid(action)) invalidActions++;
  }
  if (global.gc) global.gc();
  const bytes = Buffer.byteLength(loaded.source, 'utf8');
  return {
    path: path.resolve(filename),
    sha256: crypto.createHash('sha256').update(loaded.source).digest('hex'),
    samples: timings.length,
    warmup,
    p50Ns: percentile(timings, 0.50),
    p95Ns: percentile(timings, 0.95),
    p99Ns: percentile(timings, 0.99),
    maxNs: Math.max(...timings),
    loadNs: loaded.loadNs,
    rawBytes: bytes,
    gzipBytes: zlib.gzipSync(loaded.source).byteLength,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    invalidActions,
  };
}

const candidate = argument('candidate');
if (!candidate) throw new Error('--candidate=<exported JS bot> is required');
const baseline = argument('baseline', 'Lion_Eating_Bank_v4.js');
const samples = Number(argument('samples', '5000'));
const warmup = Number(argument('warmup', '500'));
if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(warmup) || warmup < 0) {
  throw new Error('samples and warmup must be non-negative integers, with samples > 0');
}
assertActionSchema();
const snapshots = collectSnapshots(samples);
const result = {
  schemaVersion: 1,
  scope: 'Node compute-only decide() benchmark on production-snapshot corpus',
  excluded: ['Worker scheduling', 'browser event loop', 'response application latency'],
  candidate: benchmark(path.resolve(candidate), snapshots, warmup),
  v4: benchmark(path.resolve(baseline), snapshots, warmup),
};
console.log(JSON.stringify(result, null, 2));

function assertActionSchema() {
  if (ACTIONS.length !== 18) throw new Error('action schema mismatch');
}
