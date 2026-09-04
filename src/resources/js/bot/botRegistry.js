/**
 * Build-time index of bot source files under src/code-here/. Replaces the
 * old textarea-paste flow: participants (or the operator staging their
 * submissions) drop files into src/code-here/ and the panel's dropdown is
 * populated from this list at page load. See ADR-0020.
 *
 * Filename convention (also documented in src/code-here/README.md):
 *
 *     <TeamName>_v<version>.<js|py>
 *
 * The separator is a single underscore before "v", split at the LAST
 * occurrence so team names may contain their own underscores
 * (e.g. `Team_A_v1.js` -> team "Team_A", version "1"). Language is derived
 * from the extension -- there is intentionally no separate language field
 * in the UI anymore.
 *
 * webpack: `require.context` receives an `include`-scoped rule from
 * webpack.common.js that emits each matched file as `asset/source`, so
 * ctx(key) resolves to the raw text of the file (default export in ESM
 * interop, or the string directly in CJS).
 */
'use strict';
import { BOT_LANGUAGE } from './botContract.js';

/** @typedef {{id: string, team: string, version: string, language: 'js'|'py', displayLabel: string, source: string}} BotEntry */

const FILENAME_RE = /^(.+)\.(js|py)$/;

/**
 * @param {string} filename e.g. "./Alpha_v1.js"
 * @return {{team: string, version: string, language: 'js'|'py'}|null}
 */
function parseFilename(filename) {
  // require.context keys look like "./Alpha_v1.js" -- strip the leading "./".
  const bare = filename.replace(/^\.\//, '');
  const extMatch = FILENAME_RE.exec(bare);
  if (!extMatch) {
    return null;
  }
  const stem = extMatch[1];
  const ext = extMatch[2];
  // Split on the LAST "_v" so team names may include underscores.
  const vIdx = stem.lastIndexOf('_v');
  if (vIdx <= 0 || vIdx + 2 >= stem.length) {
    return null;
  }
  const team = stem.slice(0, vIdx);
  const version = stem.slice(vIdx + 2);
  const language = ext === 'py' ? BOT_LANGUAGE.PY : BOT_LANGUAGE.JS;
  return { team, version, language };
}

/**
 * Compose the stable id used in localStorage + the <select> value.
 * Includes language so a `Foo_v1.js` and `Foo_v1.py` don't collide.
 * @param {{team: string, version: string, language: 'js'|'py'}} parts
 */
function makeId(parts) {
  return `${parts.team}_v${parts.version}.${parts.language}`;
}

/**
 * @param {{team: string, version: string, language: 'js'|'py'}} parts
 */
function makeDisplayLabel(parts) {
  const langTag = parts.language === BOT_LANGUAGE.PY ? 'PY' : 'JS';
  return `${parts.team} v${parts.version} (${langTag})`;
}

/**
 * Scan src/code-here/*.{js,py} at build time and return one entry per file.
 * @return {BotEntry[]}
 */
function buildRegistry() {
  // Third arg 'sync' + regex includes both extensions. Webpack watches this
  // directory during dev, so adding/removing files hot-reloads.
  const ctx = require.context(
    '../../../code-here/',
    false,
    /^\.\/[^/]+\.(js|py)$/
  );
  /** @type {BotEntry[]} */
  const entries = [];
  ctx.keys().forEach((key) => {
    const parts = parseFilename(key);
    if (!parts) {
      // Filename doesn't match `<team>_v<version>.<ext>` -- skip silently
      // rather than crashing the whole panel. The operator will notice the
      // file missing from the dropdown.
      return;
    }
    const mod = ctx(key);
    // asset/source in webpack 5: default export is the string. Fall back to
    // the raw value in case the pipeline ever returns it directly.
    const source = typeof mod === 'string' ? mod : mod && mod.default;
    if (typeof source !== 'string') {
      return;
    }
    entries.push({
      id: makeId(parts),
      team: parts.team,
      version: parts.version,
      language: parts.language,
      displayLabel: makeDisplayLabel(parts),
      source,
    });
  });
  entries.sort((a, b) => {
    if (a.team !== b.team) return a.team < b.team ? -1 : 1;
    if (a.version !== b.version) return a.version < b.version ? -1 : 1;
    return a.language < b.language ? -1 : 1;
  });
  return entries;
}

const REGISTRY = buildRegistry();

/** @return {BotEntry[]} snapshot of the registry, safe to iterate. */
export function listBots() {
  return REGISTRY.slice();
}

/**
 * @param {string} id
 * @return {BotEntry|null}
 */
export function getBotById(id) {
  for (const entry of REGISTRY) {
    if (entry.id === id) return entry;
  }
  return null;
}
