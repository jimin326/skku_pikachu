/**
 * Python variant of the bot Worker runner. Same on-the-wire protocol as
 * botWorker.js (see that file's header) -- init/tick/result messages,
 * shared PikaBotInput on the main side -- but runs inside Pyodide (a
 * WebAssembly build of CPython) instead of `new Function()`.
 *
 * See docs/agent-dev/CONTRACTS.md §1.3 / §1.4 and ADR-0012~0018.
 *
 * The Pyodide runtime itself (pyodide.mjs, pyodide.asm.wasm, python_stdlib.zip,
 * pyodide-lock.json) is copied into dist/pyodide/ at build time
 * (webpack.common.js CopyPlugin, ADR-0014). Package wheels (numpy) are not
 * bundled -- they fall back to Pyodide's release CDN on first load.
 * TODO: bundle wheels locally for guaranteed offline support (follow-up ADR).
 */
'use strict';

/**
 * Absolute URL of the Pyodide runtime directory. Resolved relative to this
 * Worker's own URL so it works both under webpack-dev-server (dev) and in
 * the production dist/ layout (prod) without hardcoded paths.
 * dist layout: dist/ ├── *.bundle.js  ├── pyodide/pyodide.mjs
 */
const PYODIDE_INDEX_URL = new URL('../../../pyodide/', import.meta.url).href;

/** @type {any} */
let pyodide = null;
/** @type {any} the participant's Python `decide` function, once loaded */
let decideFn = null;

/**
 * Replace every `null` in a snapshot with `undefined`, in place.
 *
 * `pyodide.toPy` maps JS `null` to `pyodide.ffi.JsNull`, a sentinel that is
 * NOT Python's `None`: measured on the bundled runtime, `x is None` and
 * `x == None` are both False for it, and subscripting it raises
 * "'JsNull' object is not subscriptable". So the obvious Python spelling of
 * an absent field -- `if s['self']['claw'] is None` -- silently does the
 * wrong thing, and the participant sees nothing: ADR-0002's neutral fallback
 * swallows the exception, so the bot just never moves (ADR-0029).
 *
 * `undefined` maps to `None`, which is why this walks the snapshot instead of
 * hooking the conversion: `toPy`'s `default_converter` is never called for
 * `null` (measured: 0 invocations), so there is nothing to hook. Converting
 * through JSON would also work but costs a serialize/parse per tick and
 * turns NaN into null, hiding a class of physics bug we would rather see.
 *
 * Mutating in place is safe: `message.snapshot` is this Worker's own
 * structured-clone copy, not the object the main thread holds.
 * @param {*} value snapshot node
 * @return {*} the same node, nulls replaced
 */
function nullsToUndefined(value) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = value[i] === null ? undefined : nullsToUndefined(value[i]);
    }
    return value;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] =
        value[key] === null ? undefined : nullsToUndefined(value[key]);
    }
    return value;
  }
  return value;
}

/**
 * Coerce a Pyodide-returned Python dict (PyProxy) into a plain JS object
 * so the main side's isValidBotAction() can check it without depending on
 * Pyodide types.
 * @param {*} result
 * @return {*}
 */
function toPlainJs(result) {
  if (result && typeof result.toJs === 'function') {
    const plain = result.toJs({ dict_converter: Object.fromEntries });
    // PyProxy objects hold references into WASM linear memory; leaking
    // them causes Pyodide to warn about un-destroyed proxies.
    result.destroy();
    return plain;
  }
  return result;
}

/**
 * Lazily import loadPyodide and boot the interpreter + numpy. Kicked off
 * during the `init` message. Progress is reported to the main thread via
 * intermediate `initResult` messages with a `phase` field
 * (D-017: 'loadingPyodide' -> 'loadingNumpy' -> 'runningSource' -> 'ok'|error).
 */
async function bootstrap(source) {
  self.postMessage({ type: 'initResult', phase: 'loadingPyodide' });
  const { loadPyodide } = await import(PYODIDE_INDEX_URL + 'pyodide.mjs');
  pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

  // Without this, a participant's print() goes nowhere: Pyodide's default
  // sinks write to the page console of whoever loaded it, and inside a
  // Worker that is a console nobody opens. A JS bot's console.log shows up
  // in devtools for free, so leaving this unwired made Python strictly
  // harder to debug than JS for no reason (ADR-0029, side finding).
  // `batched` hands us whole lines, so one message per line rather than
  // one per character.
  pyodide.setStdout({
    batched: (text) =>
      self.postMessage({ type: 'stdout', stream: 'stdout', text: text }),
  });
  pyodide.setStderr({
    batched: (text) =>
      self.postMessage({ type: 'stdout', stream: 'stderr', text: text }),
  });

  self.postMessage({ type: 'initResult', phase: 'runningSource' });
  // runPython evaluates the whole source in the interpreter's __main__
  // namespace, so a top-level `def decide(snapshot): ...` ends up as
  // pyodide.globals['decide'] (D-013).
  pyodide.runPython(source);
  const candidate = pyodide.globals.get('decide');
  if (!candidate || typeof candidate.callKwargs !== 'function') {
    if (candidate && typeof candidate.destroy === 'function') {
      candidate.destroy();
    }
    throw new Error('bot not initialized (no top-level `decide` function)');
  }
  decideFn = candidate;
}

self.onmessage = async function (event) {
  const message = event.data;

  if (message.type === 'init') {
    try {
      await bootstrap(message.source);
      self.postMessage({ type: 'initResult', phase: 'ok', ok: true });
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
      // Still bootstrapping (or bootstrap failed) -- respond with null so
      // PikaBotInput falls back to neutral for this tick (D-002/D-017).
      self.postMessage({
        type: 'result',
        requestId: requestId,
        action: null,
        error: 'bot not initialized (Python runtime still loading?)',
      });
      return;
    }
    let snapshotProxy = null;
    let resultProxy = null;
    try {
      // Pyodide converts the plain JS snapshot object to a Python dict on
      // the fly; participants access fields as snapshot['self']['x'] etc.
      // See CONTRACTS.md §1.4.2. Nulls are rewritten first so an absent
      // field arrives as Python `None` rather than the JsNull sentinel
      // (see nullsToUndefined above, ADR-0029).
      snapshotProxy = pyodide.toPy(nullsToUndefined(message.snapshot));
      resultProxy = decideFn(snapshotProxy);
      const action = toPlainJs(resultProxy);
      resultProxy = null; // toPlainJs already destroyed it
      self.postMessage({
        type: 'result',
        requestId: requestId,
        action: action,
      });
    } catch (error) {
      if (resultProxy && typeof resultProxy.destroy === 'function') {
        resultProxy.destroy();
      }
      self.postMessage({
        type: 'result',
        requestId: requestId,
        action: null,
        error: String(error && error.message ? error.message : error),
      });
    } finally {
      if (snapshotProxy && typeof snapshotProxy.destroy === 'function') {
        snapshotProxy.destroy();
      }
    }
  }
};
