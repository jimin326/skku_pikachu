/* shadow_diff.mjs — 두 봇이 같은 스냅샷 열에서 같은 출력을 내는지 검사(출력 동일성). 리팩터·정리 단계의 채택 조건.
 * 사용: node --no-warnings bot-dev/v8/shadow_diff.mjs <A> <B> [OPP1,OPP2,...] [NSEED=8]
 *   A 가 실제로 경기를 몰고(RealGame, 지연 1, 10점, 좌우 각 1경기), 매 decide 호출마다 B 에게도 같은 스냅샷(깊은 복사)을 준다.
 *   두 봇의 내부 상태는 같은 입력 열을 보므로 같게 진화해야 하고, 출력이 한 틱이라도 다르면 그 시점·스냅샷을 기록한다.
 *   시간 측정은 틱마다 호출 순서를 번갈아(A→B, B→A) 캐시 편향을 줄인다. 봇 이름은 src/code-here 의 파일명(.js 생략 가능) 또는 경로.
 */
import path from 'node:path'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const { RealGame, BotInput, setCustomRng } = await import(pathToFileURL(path.join(ROOT, 'bot-dev/sim_real.mjs')));   // setCustomRng 는 sim_real 이 쓰는 엔진(ENGINE_ROOT)의 것
const DIR = path.join(ROOT, 'src/code-here');
const A = process.argv[2], B = process.argv[3];
const OPPS = (process.argv[4] || 'AdaptiveCounter_v5_2,NetCamper_v2,RedTeam_RL_v1,OurBot_v12,mixed_v2,' + A).split(',').filter(Boolean);
const NSEED = Number(process.argv[5] || 8);
if (!A || !B) { console.error('usage: shadow_diff.mjs <A> <B> [OPPS] [NSEED]'); process.exit(2); }
const SEEDS = Array.from({ length: NSEED }, (_, i) => (1000 + i * 7919) >>> 0);
const srcOf = {};
const src = (n) => srcOf[n] || (srcOf[n] = fs.readFileSync(fs.existsSync(n) ? n : path.join(DIR, n.endsWith('.js') ? n : n + '.js'), 'utf8'));
const mk = (n) => new Function(src(n) + '\n;return decide;')();
const olog = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[')) return; olog(...a); };
const q = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.hit === b.hit;

let totalCalls = 0, totalMismatch = 0; const firstMismatches = [];
const tA = [], tB = [];
olog(`A=${A}  B=${B}  seeds=${NSEED}  opps=${OPPS.join(',')}`);
olog('opp'.padEnd(24) + 'games'.padEnd(8) + 'calls'.padEnd(9) + 'mismatch'.padEnd(10) + 'A err'.padEnd(7) + 'B err'.padEnd(7) + 'A p50/p99/max ms'.padEnd(22) + 'B p50/p99/max ms');
for (const on of OPPS) {
  let calls = 0, mism = 0, errA = 0, errB = 0, games = 0; const dA = [], dB = [];
  for (const seed of SEEDS) for (const myRight of [false, true]) {
    let st = seed >>> 0; setCustomRng(() => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; });
    const a = mk(A), b = mk(B), op = mk(on);
    const mi = myRight ? 1 : 0; let n = 0;
    const driver = (s) => {
      const sB = JSON.parse(JSON.stringify(s));
      let ra = null, rb = null, ea = null, eb = null; n++;
      const callA = () => { const t0 = performance.now(); try { ra = a(s); } catch (e) { ea = e; } dA.push(performance.now() - t0); };
      const callB = () => { const t0 = performance.now(); try { rb = b(sB); } catch (e) { eb = e; } dB.push(performance.now() - t0); };
      if (n % 2) { callA(); callB(); } else { callB(); callA(); }
      calls++; if (ea) errA++; if (eb) errB++;
      if (!same(ra, rb) || !!ea !== !!eb) {
        mism++;
        if (firstMismatches.length < 5) firstMismatches.push({ opp: on, seed, side: myRight ? 'RIGHT' : 'LEFT', tick: s.tick, A: ra, B: rb, errA: ea && ea.message, errB: eb && eb.message, snap: s });
      }
      if (ea) throw ea;
      return ra;
    };
    const g = new RealGame({ serveRule: 'random', winningScore: 10 });
    g.inputs[mi] = new BotInput(myRight ? 'RIGHT' : 'LEFT', driver, { latency: 1 });
    g.inputs[1 - mi] = new BotInput(myRight ? 'LEFT' : 'RIGHT', op, { latency: 1 });
    while (!g.finished && g.frameNo < 300000) g.step();
    games++;
  }
  totalCalls += calls; totalMismatch += mism; tA.push(...dA); tB.push(...dB);
  const f = (d) => `${q(d, 0.5).toFixed(3)}/${q(d, 0.99).toFixed(3)}/${Math.max(...d).toFixed(2)}`;
  olog(on.padEnd(24) + String(games).padEnd(8) + String(calls).padEnd(9) + String(mism).padEnd(10) + String(errA).padEnd(7) + String(errB).padEnd(7) + f(dA).padEnd(22) + f(dB));
}
olog(`TOTAL calls=${totalCalls} mismatch=${totalMismatch} (${totalCalls ? (100 * totalMismatch / totalCalls).toFixed(4) : 0}%)  A p50/p99 ${q(tA, 0.5).toFixed(3)}/${q(tA, 0.99).toFixed(3)} ms  B p50/p99 ${q(tB, 0.5).toFixed(3)}/${q(tB, 0.99).toFixed(3)} ms`);
if (firstMismatches.length) {
  olog('first mismatches:');
  for (const m of firstMismatches) olog(JSON.stringify({ opp: m.opp, seed: m.seed, side: m.side, tick: m.tick, A: m.A, B: m.B, errA: m.errA, errB: m.errB, ball: m.snap.ball, self: m.snap.self, opp: m.snap.opp }));
}
process.exit(totalMismatch ? 1 : 0);
