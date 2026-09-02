import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const FROZEN_VICTIM = Object.freeze({
  id: 'lion_v4',
  familyId: 'lion_eating_bank',
  kind: 'javascript',
  path: path.resolve(here, '../../Lion_Eating_Bank_v4.js'),
  sha256: '408bf16e4f986f893a4a5dabc749d7d494657a14811544eddcbe82c9e58bc17f',
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
  match: 0,
  ownTouch: 0,
  crossNet: 0,
});

export const ACTIONS = Object.freeze(
  [-1, 0, 1].flatMap((x) =>
    [-1, 0, 1].flatMap((y) =>
      [0, 1].map((hit) => Object.freeze({ x, y, hit }))
    )
  )
);

export const FEATURES_PER_FRAME = 23;
