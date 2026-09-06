/* thunder_check.mjs — 새 물리 위에서 썬더 기대 궤적(TH_EXPECT)이 그대로 맞는지 검사 → THUNDER_SERVE 유지/끄기 판정.
 * 사용: node --no-warnings tools/dayof/thunder_check.mjs <새레포 루트 또는 src> [bot=Lion_Eating_Bank_v12_1] [--opps builtin,AdaptiveCounter_v5_2] [--seeds 101,202,303]
 *   (우리 레포로 자기검증: node --no-warnings tools/dayof/thunder_check.mjs . )
 * 방법: sim_real 을 ENGINE_ROOT=<새레포> 로 띄워 봇을 좌우×시드×상대로 돌리고, 썬더 ACTIVE 틱마다 (plan, tick) → 공 (x,y) 를 기록해
 *       봇 안의 TH_EXPECT(decide.__thunderTables.expect) 와 대조한다. 봇의 썬더 로그(발동/포기/이탈)도 집계.
 * 판정: 불일치 0 + 발동 관측 → THUNDER_SERVE=1 유지. 불일치 ≥1 또는 tickFrameGroupSize≠3 → THUNDER_SERVE=0 (v12_1 14행). */
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const OPPS = opt('--opps', 'builtin,AdaptiveCounter_v5_2').split(',');
const SEEDS = opt('--seeds', '101,202,303').split(',').map(Number);
const target = args[0]; const botName = args[1] || 'Lion_Eating_Bank_v12_1';
if (!target) { console.error('usage: thunder_check.mjs <새레포> [bot]'); process.exit(2); }
process.env.ENGINE_ROOT = path.resolve(target);
const { RealGame, BotInput, loadBot, setCustomRng, ENGINE_ROOT } = await import(pathToFileURL(path.join(ROOT, 'tools/sim_real.mjs')).href);
const contract = await import(pathToFileURL(path.join(ENGINE_ROOT, 'resources/js/bot/botContract.js')).href);
const botPath = fs.existsSync(botName) ? botName : path.join(ROOT, 'bot', botName.endsWith('.js') ? botName : botName + '.js');
const mk = (s) => { let x = s >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
const orig = console.log; const botLogs = {};
console.log = (...a) => { const t = a.join(' '); if (t.startsWith('[')) { const k = t.replace(/^\[[^\]]*\]\s*/, '').replace(/[-\d.]+/g, '#').slice(0, 60); botLogs[k] = (botLogs[k] || 0) + 1; return; } orig(...a); };
orig(`ENGINE_ROOT=${ENGINE_ROOT}  tickFrameGroupSize=${contract.TICK_FRAME_GROUP_SIZE}  bot=${path.basename(botPath)}`);
const obs = {}; let ticksSeen = 0, games = 0, expectTable = null;
for (const seed of SEEDS) for (const side of ['LEFT', 'RIGHT']) for (const opp of OPPS) {
  setCustomRng(mk(seed));
  const raw = loadBot(botPath); const TH = raw.__thunder; expectTable = expectTable || (raw.__thunderTables && raw.__thunderTables.expect);
  if (!TH || !expectTable) { orig('봇에 __thunder / __thunderTables 노출이 없음 — 이 검사는 Lion v4 이후 봇 전용'); process.exit(2); }
  const wrapped = (s) => {
    const a = raw(s);
    if (TH.armed && !TH.dead && TH.fEst >= 0 && TH.state === 'ACTIVE') {
      const phase = (3 - (TH.fEst % 3)) % 3, planIndex = (phase + 2) % 3, planTick = Math.floor(TH.fEst / 3);
      const bx = s.side === 'RIGHT' ? 432 - s.ball.x : s.ball.x;
      const key = planIndex + ':' + planTick, v = bx + ',' + s.ball.y;
      obs[key] = obs[key] || new Map(); obs[key].set(v, (obs[key].get(v) || 0) + 1); ticksSeen++;
    }
    return a;
  };
  const myIdx = side === 'LEFT' ? 0 : 1;
  const game = new RealGame({ serveRule: 'random', winningScore: 10 });
  game.inputs[myIdx] = new BotInput(side, wrapped, { latency: 1 });
  if (opp === 'builtin') (myIdx === 0 ? game.physics.player2 : game.physics.player1).isComputer = true;
  else game.inputs[1 - myIdx] = new BotInput(side === 'LEFT' ? 'RIGHT' : 'LEFT', loadBot(path.join(ROOT, 'bot', opp + '.js')), { latency: 1 });
  game.runToEnd(); games++;
}
console.log = orig;
let matched = 0, mismatched = 0, missingInTable = 0; const bad = [];
for (const key of Object.keys(obs).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
  const [pi, pt] = key.split(':').map(Number);
  const entries = [...obs[key].entries()].sort((a, b) => b[1] - a[1]);
  const exp = expectTable[pi] && expectTable[pi][pt];
  if (!exp) { missingInTable++; continue; }
  const ok = entries.length === 1 && entries[0][0] === exp[0] + ',' + exp[1];
  if (ok) matched++; else { mismatched++; if (bad.length < 12) bad.push(`plan${pi} tick${pt}: 기대 ${exp.join(',')} 관측 ${entries.map(([v, c]) => v + 'x' + c).join(' ')}`); }
}
const tableKeys = expectTable.reduce((s, plan) => s + plan.filter(Boolean).length, 0);
orig(`경기 ${games}, 썬더 ACTIVE 틱 ${ticksSeen}, (plan,tick) 키 ${Object.keys(obs).length}: 일치 ${matched}/${tableKeys}(표 전체), 불일치 ${mismatched}, 표에 없는 키 ${missingInTable}`);
for (const b of bad) orig('  !! ' + b);
orig('봇 로그 집계:'); for (const k of Object.keys(botLogs).sort()) orig(`  ${String(botLogs[k]).padStart(4)}  ${k}`);
const sum = (re) => Object.entries(botLogs).filter(([k]) => re.test(k)).reduce((s, [, c]) => s + c, 0);
const fired = sum(/썬더 발동/), aborted = sum(/궤적 이탈/);   // 봇의 SELF_CHECK 가 먼저 포기하면 관측이 초반 몇 틱에서 끊기므로 포기 횟수와 표 커버리지를 함께 본다
const groupOk = contract.TICK_FRAME_GROUP_SIZE === 3;
const reasons = [];
if (!groupOk) reasons.push('tickFrameGroupSize≠3');
if (fired === 0) reasons.push('썬더 발동이 한 번도 관측되지 않음(서브 공 위치·데드볼 가드 확인)');
if (mismatched > 0) reasons.push(`기대 궤적 불일치 ${mismatched}`);
if (aborted > 0) reasons.push(`봇 SELF_CHECK 궤적 이탈 포기 ${aborted}회`);
if (matched < tableKeys) reasons.push(`표 커버리지 ${matched}/${tableKeys} (시드·상대를 늘려도 안 차면 물리가 다른 것)`);
const keep = reasons.length === 0;
orig(`판정: ${keep ? 'THUNDER_SERVE=1 유지 (기대 궤적 표 전 구간 일치, 이탈 0)' : 'THUNDER_SERVE=0 으로 (v12_1 14행) — ' + reasons.join(', ')}`);
process.exit(keep ? 0 : 1);
