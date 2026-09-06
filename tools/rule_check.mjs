/* rule_check.mjs — 대회 규칙 준수 점검.
 *  정적: 파일 크기(4MB), 최상위 decide, 금지 API 토큰
 *  동적: Node 표준 전역만 있는 vm 컨텍스트(require/process/setTimeout/performance/fetch/window 없음)에서 로드
 *        → 초기화 시간, 실게임(sim_real) 중 decide 소요시간(avg/p99/max, 120ms 목표·360ms 하드), 예외·비정상 반환 횟수
 * usage: node --no-warnings tools/rule_check.mjs <bot.js ...> [--opp a.js,b.js,builtin] [--seeds 101,202] [--games 1]
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { RealGame, BotInput } = await import(pathToFileURL(ROOT + '/tools/sim_real.mjs'));
const { setCustomRng } = await import(pathToFileURL(ROOT + '/tools/sim_real.mjs'));   // sim_real 이 쓰는 엔진(ENGINE_ROOT)의 rand 와 같은 인스턴스

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const OPPS = opt('--opp', 'builtin').split(',');
const SEEDS = opt('--seeds', '101,202').split(',').map(Number);
const GAMES = Number(opt('--games', '1'));
const bots = argv.map((p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p)));
const oppPath = (o) => (o === 'builtin' ? o : path.isAbsolute(o) ? o : path.resolve(ROOT, 'bot', o));

const FORBIDDEN = /\brequire\s*\(|^\s*import\s|\bimport\s*\(|^\s*export\s|\bfetch\s*\(|XMLHttpRequest|\bwindow\b|\bdocument\b|new\s+Worker|\bprocess\b|\bglobalThis\b|\bsetTimeout\b|\bsetInterval\b|\bpostMessage\b|localStorage|module\.exports|\bnavigator\b|\bawait\b/;
const mk = (s) => { let x = s >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
const origLog = console.log; const quiet = (f) => { console.log = () => {}; try { return f(); } finally { console.log = origLog; } };

// botWorker.js 와 동일한 로드 방식(new Function + return decide)을, 표준 전역만 있는 컨텍스트에서 실행
function loadBare(src, label) {
  const sandbox = { console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } };
  const ctx = vm.createContext(sandbox);
  const t0 = performance.now();
  const factory = vm.runInContext('(function(){\n' + src + "\n;return (typeof decide === 'function') ? decide : null;\n})", ctx, { filename: label });
  const decide = factory();
  return { decide, initMs: performance.now() - t0 };
}
const valid = (a) => !!a && (a.x === -1 || a.x === 0 || a.x === 1) && (a.y === -1 || a.y === 0 || a.y === 1) && (a.hit === 0 || a.hit === 1);

let failed = false;
for (const botPath of bots) {
  const name = path.basename(botPath);
  const src = fs.readFileSync(botPath, 'utf8');
  const bytes = Buffer.byteLength(src, 'utf8');
  const lines = src.split('\n');
  const hits = [];
  lines.forEach((l, i) => { if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; if (FORBIDDEN.test(l)) hits.push(`${i + 1}: ${l.trim().slice(0, 90)}`); });
  const hasTopDecide = /^function\s+decide\s*\(/m.test(src);
  if (bytes > 4 * 1024 * 1024 || !hasTopDecide || hits.length > 0) failed = true;
  origLog(`\n=== ${name}`);
  origLog(`  size ${(bytes / 1024).toFixed(1)} KB (limit 4096 KB) ${bytes <= 4 * 1024 * 1024 ? 'OK' : 'FAIL'} | top-level decide: ${hasTopDecide ? 'yes' : 'NO'} | forbidden-token lines: ${hits.length}`);
  hits.slice(0, 8).forEach((h) => origLog('    ' + h));
  let loaded;
  try { loaded = loadBare(src, name); } catch (e) { failed = true; origLog(`  LOAD FAIL in bare context: ${e && e.message}`); continue; }
  if (!loaded.decide) { failed = true; origLog('  LOAD FAIL: decide not a function after init'); continue; }
  origLog(`  init ${loaded.initMs.toFixed(1)} ms (limit 60000) OK`);
  // 첫 호출(콜드) 시간
  const durs = []; let errors = 0, invalid = 0, calls = 0; const badSamples = [];
  const wrapped = (s) => {
    const t = performance.now(); let a = null, threw = false; calls++;
    try { a = loaded.decide(s); } catch (e) { threw = true; errors++; if (badSamples.length < 3) badSamples.push('throw: ' + (e && e.message)); }
    finally { durs.push(performance.now() - t); }
    // null 도 계약 위반: 엔진 botInput.js 는 null 을 malformed 와 똑같이 처리(중립 입력 대체 + 경고). throw 는 위에서 셌으므로 중복 계산하지 않는다
    if (!threw && !valid(a)) { invalid++; if (badSamples.length < 3) badSamples.push('invalid: ' + String(JSON.stringify(a))); }
    return a;
  };
  let gw = 0, gl = 0;
  for (const opp of OPPS) {
    const op = oppPath(opp);
    for (const seed of SEEDS) for (const mySide of ['LEFT', 'RIGHT']) {
      setCustomRng(mk(seed));
      const myIdx = mySide === 'LEFT' ? 0 : 1;
      const myIn = new BotInput(mySide, wrapped, { latency: 1 });
      let opIn = null;
      if (op !== 'builtin') opIn = new BotInput(mySide === 'LEFT' ? 'RIGHT' : 'LEFT', quiet(() => loadBare(fs.readFileSync(op, 'utf8'), opp).decide), { latency: 1 });
      for (let g = 0; g < GAMES; g++) {
        const game = new RealGame({ serveRule: 'random', winningScore: 10 });
        game.inputs[myIdx] = myIn; game.inputs[1 - myIdx] = opIn;
        if (op === 'builtin') (myIdx === 0 ? game.physics.player2 : game.physics.player1).isComputer = true;
        quiet(() => game.runToEnd());
        if (game.scores[myIdx] > game.scores[1 - myIdx]) gw++; else gl++;
      }
    }
  }
  const first = durs[0]; let warmMax = 0; for (let i = 10; i < durs.length; i++) if (durs[i] > warmMax) warmMax = durs[i];
  durs.sort((a, b) => a - b);
  const p = (q) => durs[Math.min(durs.length - 1, Math.floor(durs.length * q))];
  const mean = durs.reduce((a, b) => a + b, 0) / durs.length;
  const over120 = durs.filter((d) => d > 120).length, over360 = durs.filter((d) => d > 360).length;
  if (over120 || errors || invalid) failed = true;
  origLog(`  decide: calls ${calls} avg ${mean.toFixed(3)} p50 ${p(0.5).toFixed(2)} p99 ${p(0.99).toFixed(2)} max ${durs[durs.length - 1].toFixed(2)} ms (first ${first.toFixed(1)}, max after 10 calls ${warmMax.toFixed(1)}) | >120ms ${over120} | >360ms ${over360} ${over360 ? 'FAIL' : over120 ? 'WARN' : 'OK'}`);
  origLog(`  returns: throws ${errors} invalid ${invalid} ${errors + invalid ? 'FAIL' : 'OK'} | games ${gw}-${gl} vs [${OPPS.join(',')}]`);
  // 오케스트레이터가 삼킨 내부 예외(decide.__state.errors: thunder/ac/core/skill/orch). 폴백으로 경기는 이어지지만 당일엔 새 필드 접근 오류의 신호이므로 0 이어야 한다
  const ie = loaded.decide.__state && loaded.decide.__state.errors;
  if (ie) { const n = Object.keys(ie).reduce((x, k) => x + (ie[k] | 0), 0); if (n) failed = true; origLog(`  internal errors: ${JSON.stringify(ie)} ${n ? 'FAIL' : 'OK'}`); }
  badSamples.forEach((b) => origLog('    ' + b));
}
origLog(failed ? '\nRULE_CHECK FAIL' : '\nRULE_CHECK PASS');
process.exitCode = failed ? 1 : 0;
