/**
 * Bot-controlled counterpart to PikaKeyboard (../keyboard.js). Drop a
 * PikaBotInput into PikachuVolleyball#keyboardArray in place of a
 * PikaKeyboard and the physics engine can't tell the difference -- both
 * only need to satisfy the PikaUserInput contract (xDirection/yDirection/
 * powerHit), see docs/agent-dev/CONTRACTS.md §1.0.
 *
 * side: 'LEFT' bots must occupy keyboardArray[0], 'RIGHT' bots must occupy
 * keyboardArray[1] (physicsEngine pairs userInputArray[i] with player1/
 * player2 by index -- see physics.js).
 */
'use strict';
import { PikaUserInput } from '../physics.js';
import {
  buildGameStateSnapshot,
  isValidBotAction,
  isValidBotLanguage,
  BOT_LANGUAGE,
  NEUTRAL_ACTION,
  TICK_FRAME_GROUP_SIZE,
  BOT_RESPONSE_TIMEOUT_MS,
  MAX_CONSECUTIVE_TIMEOUTS_BEFORE_RESTART,
} from './botContract.js';

export class PikaBotInput extends PikaUserInput {
  /**
   * @param {Object} args
   * @param {'LEFT'|'RIGHT'} args.side
   * @param {import('../physics.js').PikaPhysics} args.physics
   * @param {function(): {scores: number[], isPlayer2Serve: boolean}} args.getMeta
   * @param {string} args.botSource bot's source code; must define a
   *   top-level `decide(snapshot)` function (see botWorker.js /
   *   botWorkerPython.js).
   * @param {'js'|'py'} [args.language] bot source language (D-012, D-013).
   *   Selects which Worker script runs the source. Defaults to 'js' when
   *   omitted so pre-Phase-5 callers keep working unchanged.
   * @param {function({phase: string, ok: (boolean|undefined), error: (string|undefined)}): void} [args.onInitResult]
   *   called when the Worker reports init progress. JS runner emits one
   *   terminal event (`phase: 'ok'` with `ok: true|false`); Python runner
   *   emits progress events (`phase: 'loadingPyodide'` -> `'loadingNumpy'`
   *   -> `'runningSource'` -> `'ok'` or `'error'`) so UI can surface
   *   Pyodide load progress (D-015, D-017).
   */
  constructor({ side, physics, getMeta, botSource, language, onInitResult }) {
    super();

    this.side = side;
    this.physics = physics;
    this.getMeta = getMeta;
    this.botSource = botSource;
    this.language = isValidBotLanguage(language) ? language : BOT_LANGUAGE.JS;
    this.onInitResult = onInitResult || null;

    /** @type {number} monotonically increasing tick counter for this input */
    this.tick = 0;
    /** @type {number} ticks elapsed since the current rally started */
    this.rallyFrameCount = 0;
    /** @type {number} sum of both scores as of the last tick, used to detect rally resets */
    this.previousScoreTotal = 0;

    /** @type {{x: number, y: number, hit: number}} last action resolved from the bot's Worker */
    this.latestAction = Object.assign({}, NEUTRAL_ACTION);

    /** @type {number|null} requestId currently awaiting a Worker response, if any */
    this.pendingRequestId = null;
    this.nextRequestId = 1;
    /** @type {number|null} setTimeout handle for the pending request's timeout guard */
    this.timeoutHandle = null;
    /** @type {number} consecutive timeouts, used to detect a hung Worker (D-003) */
    this.consecutiveTimeouts = 0;

    /**
     * Has the Worker reported a successful init yet?
     *
     * Only used to decide whether a failed tick is worth reporting. Before
     * init lands, both runners answer every tick with "bot not initialized",
     * which for Python is simply what loading looks like -- Pyodide takes
     * ~20s, and at roughly eight ticks a second that is a normal state, not
     * a fault. Init progress and init failures already reach the user
     * through onInitResult (the Bot Setup status line), so nothing is lost
     * by staying quiet here until the bot is actually running.
     * @type {boolean}
     */
    this.workerReady = false;
    /** @type {string|null} last failure text reported to the console, for dedup */
    this.lastReportedFailure = null;
    /** @type {number} times the last failure has repeated since it was reported */
    this.repeatedFailureCount = 0;

    /** @type {Worker|null} */
    this.worker = null;
    this.spawnWorker();
  }

  /**
   * (Re)spawn the Worker that runs this bot's code, isolated from the main
   * thread (decision D-003). Any request the previous Worker had pending is
   * abandoned -- its eventual response, if it ever comes, is ignored because
   * handleWorkerMessage() checks requestId against a fresh worker generation.
   */
  spawnWorker() {
    if (this.worker !== null) {
      this.worker.terminate();
    }
    this.pendingRequestId = null;
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.consecutiveTimeouts = 0;
    // A respawn starts a fresh Worker that has to initialize all over again.
    this.workerReady = false;

    const workerUrl =
      this.language === BOT_LANGUAGE.PY
        ? new URL('./botWorkerPython.js', import.meta.url)
        : new URL('./botWorker.js', import.meta.url);
    this.worker = new Worker(workerUrl, {
      type: 'module',
    });
    this.worker.onmessage = (event) => this.handleWorkerMessage(event.data);
    this.worker.postMessage({ type: 'init', source: this.botSource });
  }

  /**
   * @param {{type: string, requestId?: number, action?: Object, ok?: boolean, error?: string}} message
   */
  handleWorkerMessage(message) {
    if (message.type === 'initResult') {
      // Both runners send exactly one terminal event; the Python one is
      // preceded by progress phases carrying no `ok`.
      if (message.ok === true) {
        this.workerReady = true;
      }
      if (this.onInitResult) {
        // Python runner emits progress phases; JS runner emits a single
        // terminal event. Forward whatever came through so the UI can
        // decide whether to show "Python 로딩 중..." or a final status.
        this.onInitResult({
          phase: message.phase || (message.ok ? 'ok' : 'error'),
          ok: message.ok,
          error: message.error,
        });
      }
      return;
    }
    if (message.type === 'stdout') {
      // A participant's print() (or anything their code writes to stderr).
      // Passed through verbatim -- this is their own output, not a
      // diagnostic of ours, so it gets a label and nothing else.
      const label = `[bot ${this.side}]`;
      if (message.stream === 'stderr') {
        console.warn(label, message.text);
      } else {
        console.log(label, message.text);
      }
      return;
    }
    if (message.type !== 'result') {
      return;
    }
    // A stale reply from an earlier (already timed-out, or superseded)
    // request -- ignore it so it can't clobber a more recent result.
    if (message.requestId !== this.pendingRequestId) {
      return;
    }
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.pendingRequestId = null;

    if (message.action !== null && isValidBotAction(message.action)) {
      this.latestAction = message.action;
      this.consecutiveTimeouts = 0;
    } else {
      // Malformed action or a thrown error inside decide() -> neutral (D-002).
      this.latestAction = Object.assign({}, NEUTRAL_ACTION);
      this.reportBotFailure(message.error);
    }
  }

  /**
   * Surface a bot's own failure once, instead of only substituting neutral
   * input for it.
   *
   * D-002's fallback is what keeps a broken bot from crashing the match, but
   * on its own it is indistinguishable from a bot that simply chose to stand
   * still: a bot throwing on every single tick produced no error, no warning
   * and no console output at all, and was only found by measuring how often
   * it moved (ADR-0029). Reporting it costs nothing and turns a silent
   * mystery into a stack trace.
   *
   * Deduplicated by message because the usual case is the same exception
   * every tick -- roughly eight per second, which would bury everything
   * else in the console. The repeat count is reported instead, so the
   * "every tick" shape stays visible.
   * @param {string|undefined} error message from the Worker, if it sent one
   */
  reportBotFailure(error) {
    if (!this.workerReady) {
      // Still loading (or init failed, which onInitResult already reported).
      // See workerReady.
      return;
    }
    const text = error
      ? String(error)
      : 'returned a malformed action (see CONTRACTS.md 1.1)';
    if (text === this.lastReportedFailure) {
      this.repeatedFailureCount++;
      // Powers of two: frequent enough to show the problem is ongoing,
      // rare enough that it never becomes the noise it is reporting.
      if ((this.repeatedFailureCount & (this.repeatedFailureCount - 1)) === 0) {
        console.warn(
          `[bot ${this.side}] still failing (${this.repeatedFailureCount} more times); neutral input substituted`
        );
      }
      return;
    }
    this.lastReportedFailure = text;
    this.repeatedFailureCount = 0;
    console.warn(
      `[bot ${this.side}] decide() failed; neutral input substituted:\n${text}`
    );
  }

  /**
   * @param {number} requestId the request this timeout guard was armed for
   */
  handleTimeout(requestId) {
    // A response arrived just as the timeout fired, or a newer request has
    // since been dispatched -- this timeout is no longer relevant.
    if (requestId !== this.pendingRequestId) {
      return;
    }
    this.pendingRequestId = null;
    this.timeoutHandle = null;
    this.latestAction = Object.assign({}, NEUTRAL_ACTION);
    this.consecutiveTimeouts++;
    if (this.consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS_BEFORE_RESTART) {
      this.spawnWorker();
    }
  }

  /**
   * Freeze this tick's input. Called once per game frame from
   * PikachuVolleyball#gameLoop, mirroring PikaKeyboard#getInput.
   *
   * Because the bot runs in a Worker, its response for this tick's snapshot
   * cannot arrive synchronously -- browsers disallow blocking the main
   * thread on a Worker reply (Atomics.wait is Worker-only). So this method
   * applies whatever action resolved most recently (typically the previous
   * tick's decision -- roughly one tick of latency) and, in the background,
   * kicks off the request for the *next* tick's action. See
   * docs/agent-dev/CONTRACTS.md D-009 for the full reasoning.
   */
  getInput() {
    this.xDirection = this.latestAction.x;
    this.yDirection = this.latestAction.y;
    this.powerHit = this.latestAction.hit;

    // Apply may have already called destroy() on us (e.g. re-Apply with a
    // modified source tears down the old input before the new one finishes
    // loading), but the ticker can still call getInput() while we're
    // sitting in keyboardArray waiting to be swapped out. Bail before we
    // touch this.worker.
    if (this.worker === null) {
      return;
    }

    const meta = this.getMeta();
    const currentScoreTotal = meta.scores[0] + meta.scores[1];
    if (currentScoreTotal !== this.previousScoreTotal) {
      this.rallyFrameCount = 0;
      this.previousScoreTotal = currentScoreTotal;
    } else {
      this.rallyFrameCount++;
    }

    this.tick++;
    if (this.tick % TICK_FRAME_GROUP_SIZE !== 0) {
      return;
    }
    // Previous request hasn't resolved yet (bot is slower than one tick
    // group) -- don't pile up requests, just wait for it (or its timeout).
    if (this.pendingRequestId !== null) {
      return;
    }

    const snapshot = buildGameStateSnapshot({
      tick: this.tick,
      side: this.side,
      physics: this.physics,
      meta: meta,
      rallyFrameCount: this.rallyFrameCount,
    });

    const requestId = this.nextRequestId++;
    this.pendingRequestId = requestId;
    this.worker.postMessage({
      type: 'tick',
      requestId: requestId,
      snapshot: snapshot,
    });
    this.timeoutHandle = setTimeout(() => {
      this.handleTimeout(requestId);
    }, BOT_RESPONSE_TIMEOUT_MS);
  }

  /**
   * Release the Worker. Call this when swapping this bot out of
   * keyboardArray (e.g. switching test-environment modes) so its Worker
   * doesn't keep running in the background.
   */
  destroy() {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
