/* sk_v2_test.mjs — 스킬 어댑터 v2 기능 검사 (bot-dev/DAYOF_PLAN_2026-09-05.md §5 게이트 2~5).
 * 사용: node --no-warnings bot-dev/sk_v2_test.mjs [<v12.js>] [<v12_1.js>] [OPP1,OPP2] [NSEED=1]
 *   v12_1 이 경기를 몰고(RealGame, 지연 1, 10점, 좌우), 스냅샷에 가짜 게이지(self.gauge/opp.gauge)를 주입한다.
 *   v12(SK.on=false) 는 같은 스냅샷(깊은 복사)을 그림자로 받아 x/y/hit 를 비교한다.
 * 시나리오:
 *   S1 on=1 fire=0 guard=0                          → x/y/hit 전 틱 동일 (게이트 2)
 *   S2 fire=1, 내 게이지 항상 100(접촉 소모형 흉내)  → 키가 최종 return 에 남음(게이트 3), 랠리당 ≤1회(게이트 4, latch),
 *                                                      발동 틱은 전부 owner AC·state 1·hit 1, x/y/hit 동일(resync 0)
 *   S3 fire=1, 발동 시 게이지 0 → +5/호출(입력 소모형)  → 발동 간격 ≥ 20호출, 소유자 AC 아닌 발동 0 (게이트 5)
 *   S4 guard=1, 상대 게이지 항상 100                  → 랠리의 첫 불일치는 반드시 "state 1·hit 1·v12 y=1 → y=-1"(지상 다이빙 보호)
 *   S5 S2 + resync=1                                 → 발동 뒤 하류 불일치가 생긴 랠리 수 (resync 기본값 근거)
 *   S6 fire=1, 게이지 객체 {ready:true} / boolean true → skFull 형식 허용 확인(발동 > 0)
 */
import path from 'node:path'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const { RealGame, BotInput, setCustomRng } = await import(pathToFileURL(path.join(ROOT, 'bot-dev/sim_real.mjs')));   // setCustomRng 는 sim_real 이 쓰는 엔진(ENGINE_ROOT)의 것
const DIR = path.join(ROOT, 'src/code-here');
const A = process.argv[2] || 'Lion_Eating_Bank_v12', B = process.argv[3] || 'Lion_Eating_Bank_v12_1';
const OPPS = (process.argv[4] || 'OurBot_v12,NetCamper_v2').split(',').filter(Boolean);
const NSEED = Number(process.argv[5] || 1);
const SEEDS = Array.from({ length: NSEED }, (_, i) => (1000 + i * 7919) >>> 0);
const srcOf = {};
const src = (n) => srcOf[n] || (srcOf[n] = fs.readFileSync(fs.existsSync(n) ? n : path.join(DIR, n.endsWith('.js') ? n : n + '.js'), 'utf8'));
const mk = (n) => new Function(src(n) + '\n;return decide;')();
const botLogs = [];
const olog = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[')) { botLogs.push(a.join(' ')); return; } olog(...a); };
const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.hit === b.hit;

/* 가짜 게이지 모델: (state) → self/opp 값. onFire 로 소모 처리 */
const MODELS = {
  full:   { init: () => ({ g: 100 }), self: (m) => m.g, opp: () => 0, onFire: () => {}, tick: () => {} },
  press:  { init: () => ({ g: 100 }), self: (m) => m.g, opp: () => 0, onFire: (m) => { m.g = 0; }, tick: (m) => { m.g = Math.min(100, m.g + 5); } },
  oppfull:{ init: () => ({}), self: () => 0, opp: () => 100, onFire: () => {}, tick: () => {} },
  ready:  { init: () => ({ n: 0 }), self: (m) => (m.n++ % 2 ? { ready: true } : true), opp: () => null, onFire: () => {}, tick: () => {} },
};
const SCEN = [
  { id: 'S1', sk: { on: true, fire: 0, guard: 0, latch: 1, resync: 0 }, model: 'full',    expect: 'identical' },
  { id: 'S2', sk: { on: true, fire: 1, guard: 0, latch: 1, resync: 0 }, model: 'full',    expect: 'fire-identical' },
  { id: 'S3', sk: { on: true, fire: 1, guard: 0, latch: 1, resync: 0 }, model: 'press',   expect: 'fire-identical' },
  { id: 'S4', sk: { on: true, fire: 0, guard: 1, latch: 1, resync: 0 }, model: 'oppfull', expect: 'guard' },
  { id: 'S5', sk: { on: true, fire: 1, guard: 0, latch: 1, resync: 1 }, model: 'full',    expect: 'fire-resync' },
  { id: 'S6', sk: { on: true, fire: 1, guard: 0, latch: 1, resync: 0 }, model: 'ready',   expect: 'fire-identical' },
];

let allPass = true;
const pass = (ok, msg) => { olog(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) allPass = false; };
for (const sc of SCEN) {
  const st = { calls: 0, mism: 0, fires: 0, firesNonAC: 0, firesBadState: 0, firesNoHit: 0, ralliesMultiFire: 0, rallies: 0,
    badFirst: 0, downstreamRallies: 0, guardTicks: 0, minGap: Infinity, errA: 0, errB: 0, firstBad: null };
  botLogs.length = 0;
  for (const on of OPPS) for (const seed of SEEDS) for (const myRight of [false, true]) {
    let rs = seed >>> 0; setCustomRng(() => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; });
    const a = mk(A), b = mk(B), op = mk(on);
    Object.assign(b.__sk, sc.sk);
    const model = MODELS[sc.model], m = model.init();
    let prevRfc = -1, rallyFires = 0, diverged = false, firedInRally = false, lastFireCall = -Infinity;
    const endRally = () => { st.rallies++; if (rallyFires > 1) st.ralliesMultiFire++; if (diverged && firedInRally) st.downstreamRallies++; rallyFires = 0; diverged = false; firedInRally = false; };
    const driver = (s) => {
      const rfc = s.meta.rallyFrameCount | 0;
      if (prevRfc >= 0 && rfc < prevRfc) endRally();
      prevRfc = rfc;
      model.tick(m);
      s.self.gauge = model.self(m); s.opp.gauge = model.opp(m);
      const sA = JSON.parse(JSON.stringify(s));
      let ra = null, rb = null; st.calls++;
      try { rb = b(s); } catch (e) { st.errB++; }
      try { ra = a(sA); } catch (e) { st.errA++; }
      const fired = rb && rb[b.__sk.key] !== undefined;
      const owner = b.__state.lastOwner;
      if (fired) {
        st.fires++; rallyFires++; firedInRally = true;
        if (owner !== 'AC') st.firesNonAC++;
        if (s.self.state !== 1) st.firesBadState++;
        if (rb.hit !== 1) st.firesNoHit++;
        if (lastFireCall > -Infinity) st.minGap = Math.min(st.minGap, st.calls - lastFireCall);
        lastFireCall = st.calls;
        model.onFire(m);
      }
      if (!same(ra, rb)) {
        st.mism++;
        if (!diverged) {
          const guardPattern = sc.expect === 'guard' && s.self.state === 1 && ra && ra.hit === 1 && ra.y === 1 && rb && rb.y === -1 && rb.x === ra.x && rb.hit === 1 && owner === 'AC';
          const resyncPattern = sc.expect === 'fire-resync' && firedInRally;
          if (guardPattern) st.guardTicks++;
          else if (!resyncPattern) { st.badFirst++; if (!st.firstBad) st.firstBad = { opp: on, side: myRight ? 'R' : 'L', tick: s.tick, owner, state: s.self.state, A: ra, B: rb }; }
        }
        diverged = true;
      }
      return rb;
    };
    const g = new RealGame({ serveRule: 'random', winningScore: 10 });
    const mi = myRight ? 1 : 0;
    g.inputs[mi] = new BotInput(myRight ? 'RIGHT' : 'LEFT', driver, { latency: 1 });
    g.inputs[1 - mi] = new BotInput(myRight ? 'LEFT' : 'RIGHT', op, { latency: 1 });
    while (!g.finished && g.frameNo < 300000) g.step();
    endRally();
  }
  olog(`${sc.id} ${JSON.stringify(sc.sk)} model=${sc.model}: calls=${st.calls} rallies=${st.rallies} mismatch=${st.mism} fires=${st.fires} errA=${st.errA} errB=${st.errB}`);
  pass(st.errA === 0 && st.errB === 0, '예외 0');
  if (sc.expect === 'identical') pass(st.mism === 0 && st.fires === 0, `x/y/hit 전 틱 동일·발동 0 (mismatch=${st.mism}, fires=${st.fires})`);
  if (sc.expect === 'fire-identical' || sc.expect === 'fire-resync') {
    pass(st.fires > 0, `발동 키가 최종 return 에 남음 (fires=${st.fires})`);
    pass(st.firesNonAC === 0, `소유자 AC 아닌 발동 0 (${st.firesNonAC})`);
    pass(st.firesBadState === 0 && st.firesNoHit === 0, `발동 틱 전부 state 1·hit 1 (badState=${st.firesBadState}, noHit=${st.firesNoHit})`);
    pass(st.ralliesMultiFire === 0 || sc.model === 'press', `랠리당 발동 ≤1 (latch; 2회 이상 랠리 ${st.ralliesMultiFire})`);
    if (sc.model === 'press') pass(st.minGap >= 20, `발동 간격 ≥ 20호출 (min ${st.minGap})`);
  }
  if (sc.expect === 'fire-identical') pass(st.mism === 0, `x/y/hit 전 틱 동일 (mismatch=${st.mism})`);
  if (sc.expect === 'fire-resync') { pass(st.badFirst === 0, `발동 전 불일치 0 (${st.badFirst})`); olog(`  INFO  resync=1 하류 불일치 랠리 ${st.downstreamRallies}/${st.rallies}, 틱 ${st.mism}`); }
  if (sc.expect === 'guard') {
    pass(st.badFirst === 0, `랠리 첫 불일치는 전부 공중 y=1→-1 (그 외 ${st.badFirst})`);
    olog(`  INFO  guard 로 y 가 바뀐 랠리 첫 불일치 ${st.guardTicks}, 총 불일치 틱 ${st.mism}`);
  }
  if (st.firstBad) olog('  first bad: ' + JSON.stringify(st.firstBad));
  if (sc.id === 'S2') { olog('  bot logs (v12_1, 처음 6줄):'); for (const l of botLogs.filter((l) => !l.includes('v4] ')).slice(0, 6)) olog('    ' + l); }
}
olog(allPass ? 'ALL PASS' : 'SOME FAIL');
process.exit(allPass ? 0 : 1);
