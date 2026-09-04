/* eval_skill_real.mjs — 스킬 훅을 꽂은 실게임(sim_real: 데드볼·READY·터치리밋 포함)에서 봇 평가. 같은 시드로 스킬 OFF/ON 비교.
 * 사용: node --no-warnings bot-dev/eval_skill_real.mjs [skill=./skills/today.mjs] [bot=Lion_Eating_Bank_v12_1] [opp=OurBot_v12|builtin|경로] [NSEED=2] [--sk k=v,...] [--both]
 *   --sk on=1,fire=1,key=skill,gauge=self.gauge,full=100   스킬 ON 조건에서 봇의 decide.__sk 에 대입(v12_1 계열). 숫자는 숫자로
 *   --both                                                  상대 봇에도 같은 --sk 를 대입(상대가 v12_1 계열일 때)
 *   ENGINE_ROOT=<새 레포>                                    새 물리·스냅샷 빌더 위에서 실행
 * 출력: 조건(OFF/ON)별 승-패·랠리·스킬로 끝난 랠리(how==='skill')·봇 발동 수(decide.__skState.fired)·가짜 규칙 발동/소모·평균 프레임, 좌우 분리
 */
import path from 'node:path'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const { RealGame, BotInput, setCustomRng, ENGINE_ROOT } = await import(pathToFileURL(path.join(ROOT, 'bot-dev/sim_real.mjs')));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--sk'));
const skillPath = pos[0] || './skills/today.mjs', botName = pos[1] || 'Lion_Eating_Bank_v12_1', oppName = pos[2] || 'OurBot_v12', NSEED = Number(pos[3] || 2);
const skSet = {}; for (const kv of (opt('--sk') || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); skSet[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v; }
const both = args.includes('--both');
const skillMod = await import(pathToFileURL(path.resolve(ROOT, 'bot-dev', skillPath)).href);
const skill = skillMod.default;
const DIR = path.join(ROOT, 'src/code-here');
const src = (n) => fs.readFileSync(fs.existsSync(n) ? n : path.join(DIR, n.endsWith('.js') ? n : n + '.js'), 'utf8');
const mk = (n) => new Function(src(n) + '\n;return decide;')();
const olog = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[')) return; olog(...a); };
const SEEDS = Array.from({ length: NSEED }, (_, i) => (1000 + i * 7919) >>> 0);
olog(`ENGINE_ROOT=${ENGINE_ROOT}`);
olog(`skill=${skillPath}${skillMod.CFG ? ' CFG=' + JSON.stringify(skillMod.CFG) : ''}  bot=${botName}  opp=${oppName}  seeds=${NSEED}  --sk ${JSON.stringify(skSet)}${both ? ' (both)' : ''}`);
for (const useSkill of [false, true]) {
  const st = { L: { w: 0, l: 0 }, R: { w: 0, l: 0 }, rallies: 0, bySkill: 0, fires: 0, frames: 0, games: 0, ruleFires: 0, ruleConsumed: 0, errs: 0, fieldLog: null };
  for (const seed of SEEDS) for (const myRight of [false, true]) {
    let rs = seed >>> 0; setCustomRng(() => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; });
    const bot = mk(botName);
    if (useSkill && bot.__sk) Object.assign(bot.__sk, skSet);
    const g = new RealGame({ serveRule: 'random', winningScore: 10, skill: useSkill ? skill : null });
    const mi = myRight ? 1 : 0, side = myRight ? 'RIGHT' : 'LEFT';
    const myIn = new BotInput(side, bot, { latency: 1 });
    g.inputs[mi] = myIn;
    if (oppName === 'builtin') (mi === 0 ? g.physics.player2 : g.physics.player1).isComputer = true;
    else { const op = mk(oppName); if (useSkill && both && op.__sk) Object.assign(op.__sk, skSet); g.inputs[1 - mi] = new BotInput(myRight ? 'LEFT' : 'RIGHT', op, { latency: 1 }); }
    while (!g.finished && g.frameNo < 300000) g.step();
    const s = st[myRight ? 'R' : 'L'];
    if (g.scores[mi] > g.scores[1 - mi]) s.w++; else s.l++;
    st.games++; st.frames += g.frameNo; st.rallies += g.rallies.length; st.bySkill += g.rallies.filter((r) => r.how === 'skill').length;
    st.fires += bot.__skState ? bot.__skState.fired : 0; st.errs += myIn.errors;
    if (g.skillCtx && g.skillCtx.g) { st.ruleFires += g.skillCtx.g.fires || 0; st.ruleConsumed += g.skillCtx.g.consumed || 0; }
    if (!st.fieldLog && bot.__state && bot.__state.fieldLog) st.fieldLog = Object.keys(bot.__state.fieldLog);
  }
  const tot = { w: st.L.w + st.R.w, l: st.L.l + st.R.l };
  olog(`${useSkill ? '스킬 ON ' : '스킬 OFF'}: ${tot.w}-${tot.l} (L ${st.L.w}-${st.L.l} / R ${st.R.w}-${st.R.l})  랠리 ${st.rallies}  스킬로 끝난 랠리 ${st.bySkill}  봇 발동 ${st.fires}  규칙 armed/소모 ${st.ruleFires}/${st.ruleConsumed}  봇 예외 ${st.errs}  평균 ${(st.frames / st.games) | 0}f/경기` + (st.fieldLog && st.fieldLog.length ? `  새 필드 ${JSON.stringify(st.fieldLog)}` : ''));   // 새 필드는 OFF 행에도(ENGINE_ROOT 새 스냅샷 빌더가 넣는 필드 확인용)
}
