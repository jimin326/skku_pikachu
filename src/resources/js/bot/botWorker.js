/**
 * Runs inside a dedicated Web Worker (see docs/agent-dev/CONTRACTS.md §1.3,
 * decision D-003). This is the isolation boundary: a bot's code executes
 * here, on its own thread, so a hung or buggy bot can't freeze the main
 * game thread (rendering, the other player's input, everything else).
 *
 * Protocol (all messages are plain objects via postMessage):
 *   in  { type: 'init', source: string }
 *       -- source must define a top-level function `decide(snapshot)`
 *          that returns { x, y, hit }.
 *   out { type: 'initResult', ok: boolean, error?: string }
 *
 *   in  { type: 'tick', requestId: number, snapshot: Object }
 *   out { type: 'result', requestId: number, action: Object|null, error?: string }
 */
'use strict';

/** @type {(function(Object): Object)|null} */
let decideFn = null;

self.onmessage = function (event) {
  const message = event.data;

  if (message.type === 'init') {
    try {
      // The bot's source runs in this Worker's own global scope, isolated
      // from the main thread and from other bots' Workers. Using Function
      // here (rather than eval) avoids leaking access to this closure's
      // local variables into the bot's code.
      // eslint-disable-next-line no-new-func
      const factory = new Function(
        message.source +
          "\n;return (typeof decide === 'function') ? decide : null;"
      );
      decideFn = factory();
      self.postMessage({
        type: 'initResult',
        phase: decideFn !== null ? 'ok' : 'error',
        ok: decideFn !== null,
        error:
          decideFn !== null
            ? undefined
            : 'bot not initialized (no top-level `decide` function)',
      });
    } catch (error) {
      decideFn = null;
      self.postMessage({
        type: 'initResult',
        phase: 'error',
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
    return;
  }

  if (message.type === 'tick') {
    const requestId = message.requestId;
    if (decideFn === null) {
      self.postMessage({
        type: 'result',
        requestId: requestId,
        action: null,
        error: 'bot not initialized (no decide() function)',
      });
      return;
    }
    try {
      const action = decideFn(message.snapshot);
      self.postMessage({
        type: 'result',
        requestId: requestId,
        action: action,
      });
    } catch (error) {
      self.postMessage({
        type: 'result',
        requestId: requestId,
        action: null,
        error: String(error && error.message ? error.message : error),
      });
    }
  }
};
