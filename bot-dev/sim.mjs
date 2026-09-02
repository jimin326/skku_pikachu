// 헤드리스 시뮬레이터 — 실제 엔진(physics.js) + 봇 tick(3프레임)/1tick 지연 모델 재현
import { PikaPhysics, PikaUserInput } from '../src/resources/js/physics.js';
import fs from 'fs';

const TFG = 3; // TICK_FRAME_GROUP_SIZE

export function loadBot(path) {
  const src = fs.readFileSync(path, 'utf8');
  return new Function(src + '\n;return decide;')();
}
const pv = (p) => ({ x: p.x, y: p.y, state: p.state, frameNumber: p.frameNumber, divingDirection: p.divingDirection });

function buildSnapshot(tick, side, phys, isP2Serve, rally) {
  const isP2 = side === 'RIGHT';
  const self = isP2 ? phys.player2 : phys.player1;
  const opp = isP2 ? phys.player1 : phys.player2;
  return {
    tick, side, self: pv(self), opp: pv(opp),
    ball: { x: phys.ball.x, y: phys.ball.y, xVelocity: phys.ball.xVelocity, yVelocity: phys.ball.yVelocity, isPowerHit: phys.ball.isPowerHit, expectedLandingPointX: phys.ball.expectedLandingPointX },
    meta: { score: { self: 0, opp: 0 }, isPlayer2Serve: isP2Serve, rallyFrameCount: rally },
    config: { tickFrameGroupSize: TFG },
  };
}
const validAction = (a) => a && [-1, 0, 1].includes(a.x) && [-1, 0, 1].includes(a.y) && [0, 1].includes(a.hit);

// scriptFn(tick, rally) can override the bot on the serving side (returns action or null)
export function simulatePoint(decide, opts = {}) {
  const { botSide = 'LEFT', opponent = 'ai', serveIsP2 = false, maxFrames = 1500, trace = false, scriptFn = null, latency = null, phase = 0, preRound = true, skill = null, touchLimit = 5, tickStart = 0, rallyStart = 0 } = opts;
  const botIsP2 = botSide === 'RIGHT';
  const phys = new PikaPhysics(false, false);
  const oppIsP2 = !botIsP2;
  const oppDecide = (typeof opponent === 'function') ? opponent : null;
  if (opponent === 'ai') { if (oppIsP2) phys.player2.isComputer = true; else phys.player1.isComputer = true; }
  phys.ball.initializeForNewRound(serveIsP2);
  phys.player1.initializeForNewRound();
  phys.player2.initializeForNewRound();

  const u = [new PikaUserInput(), new PikaUserInput()];
  const bi = botIsP2 ? 1 : 0;
  const latencyFrames = latency == null ? TFG : latency; // 결정→적용 지연(프레임). 기본 3(=1 tick group)
  let latest = { x: 0, y: 0, hit: 0 };
  const queue = [];
  let tick = tickStart, rally = rallyStart, jumps = 0, powerhits = 0, hits = 0, hitFrame = -1;
  const selfP = () => (botIsP2 ? phys.player2 : phys.player1);
  let prevState = selfP().state;
  let prevBallPH = false, connected = 0; // 실제로 맞은 파워히트(봇의) 수
  const tr = [];
  const tl = { count: 0, last: null, prevFlags: [false, false], prevOnLeft: null, maxRun: 0 }; let botTouches = 0;

  // 실제 게임: 라운드 시작 전 READY 구간(30프레임)에도 매 tick 스냅샷이 가고 물리만 멈춰 있음.
  // → 라운드 0프레임의 입력은 "정지 상태 초기 스냅샷"으로 미리 결정된 행동이다.
  const oppSide = botIsP2 ? 'LEFT' : 'RIGHT';
  // 당일 스킬 훅: skill.init(ctx) / skill.extend(snapshot, side, phys, ctx) / skill.observe(phys, ctx) -> null|'LEFT'|'RIGHT'(즉시 득점)
  //              / skill.filterInput(side, action, phys, ctx) -> action (입력 조작형 스킬 재현용)
  const ctx = { frame: 0, bot: botSide, prevCollision: [false, false], touches: [0, 0] };
  if (skill && skill.init) skill.init(ctx, phys);
  const snapFor = (side, rallyN) => { const sn = buildSnapshot(tick, side, phys, serveIsP2, rallyN); if (skill && skill.extend) skill.extend(sn, side, phys, ctx); return sn; };
  let oppLatest = { x: 0, y: 0, hit: 0 }; const oppQueue = [];
  if (preRound) {
    const snap0 = snapFor(botSide, 40);
    let a0 = null;
    if (scriptFn) a0 = scriptFn(0, 40, snap0);
    if (a0 == null) { try { a0 = decide(snap0); } catch (e) { a0 = { x: 0, y: 0, hit: 0 }; } }
    if (!validAction(a0)) a0 = { x: 0, y: 0, hit: 0 };
    latest = a0;
    if (oppDecide) { let b0; try { b0 = oppDecide(snapFor(oppSide, 40)); } catch (e) { b0 = null; } oppLatest = validAction(b0) ? b0 : { x: 0, y: 0, hit: 0 }; }
  }
  for (let f = 0; f < maxFrames; f++) {
    if ((f + phase) % TFG === 0) {   // phase: 실제 게임은 tick 카운터가 라운드 간 이어져 위상이 0/1/2 중 임의
      tick += TFG; // 실서버 semantics: 프레임 카운터가 TFG 배수일 때 전송 -> 봇이 보는 tick은 3,6,9,... (Jayce가 tick차이=경과프레임으로 사용)
      const snap = snapFor(botSide, rally);
      let a = null;
      if (scriptFn) a = scriptFn(tick, rally, snap);
      if (a == null) { try { a = decide(snap); } catch (e) { a = { x: 0, y: 0, hit: 0 }; } }
      if (!validAction(a)) a = { x: 0, y: 0, hit: 0 };
      const lat = (typeof latencyFrames === 'function') ? latencyFrames() : latencyFrames;
      queue.push({ at: f + lat, action: a });
      if (oppDecide) { let b; try { b = oppDecide(snapFor(oppSide, rally)); } catch (e) { b = null; } oppQueue.push({ at: f + lat, action: validAction(b) ? b : { x: 0, y: 0, hit: 0 } }); }
      if (a.hit === 1) hits++;
      if (trace) { const s = selfP(); tr.push(`t${tick} f${f} ball(${phys.ball.x | 0},${phys.ball.y | 0} v${phys.ball.xVelocity | 0},${phys.ball.yVelocity | 0}) self(${s.x | 0},${s.y | 0} st${s.state}) ELP${phys.ball.expectedLandingPointX | 0} -> ${JSON.stringify(a)}`); }
    }
    while (queue.length && queue[0].at <= f) latest = queue.shift().action;
    u[bi].xDirection = latest.x; u[bi].yDirection = latest.y; u[bi].powerHit = latest.hit;
    if (oppDecide) { while (oppQueue.length && oppQueue[0].at <= f) oppLatest = oppQueue.shift().action; u[1 - bi].xDirection = oppLatest.x; u[1 - bi].yDirection = oppLatest.y; u[1 - bi].powerHit = oppLatest.hit; }
    else if (opponent !== 'ai') { u[1 - bi].xDirection = 0; u[1 - bi].yDirection = 0; u[1 - bi].powerHit = 0; }
    if (skill && skill.filterInput) {
      const fa = skill.filterInput(botSide, { x: u[bi].xDirection, y: u[bi].yDirection, hit: u[bi].powerHit }, phys, ctx);
      u[bi].xDirection = fa.x; u[bi].yDirection = fa.y; u[bi].powerHit = fa.hit;
      const fb = skill.filterInput(oppSide, { x: u[1 - bi].xDirection, y: u[1 - bi].yDirection, hit: u[1 - bi].powerHit }, phys, ctx);
      u[1 - bi].xDirection = fb.x; u[1 - bi].yDirection = fb.y; u[1 - bi].powerHit = fb.hit;
    }
    const touched = phys.runEngineForNextFrame(u);
    rally++; ctx.frame = f + 1;
    // 대회 규칙 rules/touchLimit.js 재현: 한쪽이 연속 5회 접촉하면 그 순간 상대 득점(네트를 넘으면 리셋)
    {
      const isOnLeft = phys.ball.x < 216;
      if (tl.prevOnLeft !== null && isOnLeft !== tl.prevOnLeft) { tl.count = 0; tl.last = null; tl.prevFlags = [false, false]; }
      tl.prevOnLeft = isOnLeft;
      const pl = [phys.player1, phys.player2];
      for (let i = 0; i < 2; i++) {
        const c = pl[i].isCollisionWithBallHappened;
        if (c && !tl.prevFlags[i]) {
          if (tl.last !== null && tl.last !== i) tl.count = 0;
          tl.last = i; tl.count += 1; if (i === bi) botTouches++; if (tl.count > tl.maxRun) tl.maxRun = tl.count;
          if (touchLimit && tl.count >= touchLimit) {
            const winner = i === 0 ? 'RIGHT' : 'LEFT';
            return { winner, frames: f + 1, jumps, powerhits, connected, hits, hitFrame, landX: phys.ball.x | 0, trace: tr, byTouchLimit: true, botTouches };
          }
        }
        tl.prevFlags[i] = c;
      }
    }
    if (skill && skill.observe) {
      const award = skill.observe(phys, ctx);   // 'LEFT'|'RIGHT' 반환 시 그쪽 득점으로 랠리 종료(touchLimit/awardPoint 방식)
      if (award === 'LEFT' || award === 'RIGHT') return { winner: award, frames: f + 1, jumps, powerhits, connected, hits, hitFrame, landX: phys.ball.x | 0, trace: tr, bySkill: true };
    }
    const s = selfP();
    if (prevState === 0 && s.state === 1) jumps++;
    if (s.state === 2 && prevState !== 2) { powerhits++; if (hitFrame < 0) hitFrame = f; }
    if (phys.ball.isPowerHit && !prevBallPH && (s.state === 2 || prevState === 2)) connected++;
    prevBallPH = phys.ball.isPowerHit;
    prevState = s.state;
    if (touched) {
      const winner = phys.ball.x < 216 ? 'RIGHT' : 'LEFT';
      return { winner, frames: f + 1, jumps, powerhits, connected, hits, hitFrame, landX: phys.ball.x | 0, trace: tr, botTouches, maxRun: tl.maxRun };
    }
  }
  return { winner: 'none', frames: maxFrames, jumps, powerhits, connected, hits, hitFrame, landX: phys.ball.x | 0, trace: tr, botTouches, maxRun: tl.maxRun };
}

// ---- 진단 실행 ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const botPath = process.argv[2] || '../src/code-here/OurBot_v9.js';
  const decide = loadBot(botPath);
  const N = 40;
  const agg = { LEFT: 0, RIGHT: 0, none: 0, jumps: 0, powerhits: 0, hits: 0, frames: 0 };
  for (let i = 0; i < N; i++) {
    // 서브를 번갈아: 절반은 LEFT(봇) 서브, 절반은 RIGHT(AI) 서브
    const r = simulatePoint(decide, { botSide: 'LEFT', opponent: 'ai', serveIsP2: i % 2 === 1, maxFrames: 1800 });
    agg[r.winner]++; agg.jumps += r.jumps; agg.powerhits += r.powerhits; agg.hits += r.hits; agg.frames += r.frames;
  }
  console.log(`[${botPath}] OurBot(LEFT) vs AI(RIGHT), ${N} points`);
  console.log(`  승: 봇(LEFT)=${agg.LEFT}  AI(RIGHT)=${agg.RIGHT}  무=${agg.none}`);
  console.log(`  봇 점프 총 ${agg.jumps}회, 파워히트 총 ${agg.powerhits}회, hit=1 지시 총 ${agg.hits}회, 평균 랠리 ${(agg.frames / N | 0)}프레임`);
  const t = simulatePoint(decide, { botSide: 'LEFT', opponent: 'ai', serveIsP2: false, maxFrames: 500, trace: true });
  console.log(`\n--- 샘플 포인트 (승자 ${t.winner}, 점프 ${t.jumps}, 파워히트 ${t.powerhits}) 앞 42 tick ---`);
  console.log(t.trace.slice(0, 42).join('\n'));
}
