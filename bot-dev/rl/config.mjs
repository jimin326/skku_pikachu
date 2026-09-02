import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const FROZEN_VICTIM = Object.freeze({
  path: path.resolve(here, '../../Lion_Eating_Bank_v1.js'),
  sha256: '0e7de2ef8d9ee0b159791a88f972ca0e79e70e79332d4fc99ba2663b6da765f6',
});

export const DEFAULT_ENV_CONFIG = Object.freeze({
  winningScore: 10,
  serveRule: 'random',
  latencyFrames: 1,
  frameStack: 4,
  maxFrames: 300000,
  maxDecisions: 100000,
});

export const DEFAULT_REWARD_CONFIG = Object.freeze({
  point: 1,
  match: 3,
  ownTouch: 0.005,
  crossNet: 0.01,
});

export const ACTIONS = Object.freeze(
  [-1, 0, 1].flatMap((x) =>
    [-1, 0, 1].flatMap((y) =>
      [0, 1].map((hit) => Object.freeze({ x, y, hit }))
    )
  )
);

export const FEATURES_PER_FRAME = 23;
