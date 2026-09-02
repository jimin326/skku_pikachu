/* sim_real.mjs — 실게임(pikavolley.js 상태머신 + bot/botInput.js 입력 규약) 프레임 단위 재현 하니스.
 * sim.mjs 와의 차이(=실서버 요소):
 *  - tick 카운터가 라운드/경기를 넘어 연속(위상이 자연 발생)
 *  - rallyFrameCount 는 점수합 변동 시 0으로 리셋 후 매 논리프레임 ++ (슬로모션6+afterEnd5+READY30 포함 → 라운드 첫 프레임에 41)
 *  - READY(물리 정지) 30프레임 동안도 3프레임마다 스냅샷이 가고 응답은 다음 프레임에 적용
 *  - 첫 랠리는 READY 없이 round 0프레임에 봇 장착(testSetup.syncWithGameState)
 *  - 서브 규칙 기본 RANDOM(rand()%2), touchLimit 5회 → awardPoint → forceNextRound(afterEndOfRound 직행)
 *  - 10점 경기, 경기 종료 후 211프레임 gameEnd 동안 물리 계속, 다음 경기 startOfNewGame 71프레임은 봇 미장착
 */
import { PikaPhysics, PikaUserInput } from '../src/resources/js/physics.js';
import { rand } from '../src/resources/js/rand.js';
import { buildGameStateSnapshot } from '../src/resources/js/bot/botContract.js';
import fs from 'fs';

export function loadBot(path) {
  const src = fs.readFileSync(path, 'utf8');
  return new Function(src + '\n;return decide;')();
}
const valid = (a) => !!a && (a.x === -1 || a.x === 0 || a.x === 1) && (a.y === -1 || a.y === 0 || a.y === 1) && (a.hit === 0 || a.hit === 1);
export function buildSnapshot(tick, side, phys, meta, rallyFrameCount) {
  return buildGameStateSnapshot({
    tick,
    side,
    physics: phys,
    meta,
    rallyFrameCount,
  });
}

/* botInput.js PikaBotInput 재현. latency: 응답이 적용되기까지의 프레임 수(실브라우저 ≈1). 함수면 매 요청마다 호출(지터). */
export class BotInput extends PikaUserInput {
  constructor(side, decide, opts = {}) {
    super();
    this.side = side; this.decide = decide;
    this.latency = opts.latency === undefined ? 1 : opts.latency;
    this.simRally = !!opts.simRally;   // 진단용: rallyFrameCount 를 sim.mjs 식(라운드 시작=0)으로
    this.tick = 0; this.rallyFrameCount = 0; this.previousScoreTotal = 0;
    this.latestAction = { x: 0, y: 0, hit: 0 }; this.queue = [];
    this.errors = 0; this.calls = 0; this.skipped = 0; this.frames = 0;
  }
  getInput(game) {
    this.frames++;
    while (this.queue.length && this.queue[0].at <= this.frames) this.latestAction = this.queue.shift().action;
    this.xDirection = this.latestAction.x; this.yDirection = this.latestAction.y; this.powerHit = this.latestAction.hit;
    const total = game.scores[0] + game.scores[1];
    if (total !== this.previousScoreTotal) { this.rallyFrameCount = 0; this.previousScoreTotal = total; } else this.rallyFrameCount++;
    this.tick++;
    if (this.tick % 3 !== 0) return;
    if (this.queue.length) { this.skipped++; return; }   // 이전 요청 미해결 → 요청 건너뜀
    const rfc = this.simRally ? game.roundFrames : this.rallyFrameCount;
    const snap = buildSnapshot(this.tick, this.side, game.physics, { scores: game.scores, isPlayer2Serve: game.isPlayer2Serve }, rfc);
    let a = null; this.calls++;
    try { a = this.decide(snap); } catch (e) { this.errors++; a = null; }
    if (!valid(a)) a = { x: 0, y: 0, hit: 0 };
    const lat = typeof this.latency === 'function' ? this.latency() : this.latency;
    this.queue.push({ at: this.frames + lat, action: { x: a.x, y: a.y, hit: a.hit } });
  }
}

export class RealGame {
  constructor({ serveRule = 'random', winningScore = 10, readySnapshots = true } = {}) {
    this.physics = new PikaPhysics(false, false);
    this.scores = [0, 0]; this.isPlayer2Serve = false; this.serveRule = serveRule; this.winningScore = winningScore;
    this.readySnapshots = readySnapshots;
    this.frameNo = 0; this.roundFrames = 0; this.inputs = [null, null]; this.installed = false;
    this.frameCounter = 0; this.slowMotionFramesLeft = 0; this.roundEnded = false; this.gameEnded = false; this.finished = false;
    this.tl = { count: 0, last: null, prevFlags: [false, false], prevOnLeft: null };
    this.rallies = []; this.cur = null;
    this.state = 'startOfNewGame';
    this.frameTotal = { startOfNewGame: 71, afterEndOfRound: 5, beforeStartOfNextRound: 30, gameEnd: 211 };
    this.nullInput = new PikaUserInput();
  }
  decideNextServe(isP2Winner) {
    switch (this.serveRule) {
      case 'random': return rand() % 2 === 1;
      case 'loser': return !isP2Winner;
      default: return isP2Winner;
    }
  }
  isDuringMatch() { return this.state === 'round' || this.state === 'afterEndOfRound' || this.state === 'beforeStartOfNextRound'; }
  step() {
    this.frameNo++;
    if (this.slowMotionFramesLeft > 0) this.slowMotionFramesLeft--;   // 슬로모션: 논리 프레임 1개당 1 감소(건너뛴 실프레임은 getInput 없음)
    // testSetup.syncWithGameState: 경기 중 상태에서만 봇 장착 (gameLoop 이전 ticker 콜백)
    const during = this.isDuringMatch();
    if (during && !this.installed) this.installed = true; else if (!during && this.installed) this.installed = false;
    if (this.installed) {
      for (const inp of this.inputs) {
        if (!inp) continue;
        if (!this.readySnapshots && this.state !== 'round') { inp.tick++; continue; }   // 진단용: READY 스냅샷 끄기
        inp.getInput(this);
      }
    }
    this[this.state]();
    this.observeTouchLimit();
  }
  startOfNewGame() {
    if (this.frameCounter === 0) {
      this.gameEnded = false; this.roundEnded = false;
      this.isPlayer2Serve = this.decideNextServe(false);
      this.scores[0] = 0; this.scores[1] = 0;
      this.physics.player1.initializeForNewRound(); this.physics.player2.initializeForNewRound();
      this.physics.ball.initializeForNewRound(this.isPlayer2Serve);
    }
    this.frameCounter++;
    if (this.frameCounter >= this.frameTotal.startOfNewGame) { this.frameCounter = 0; this.state = 'round'; this.beginRally(); }
  }
  beginRally() {
    this.roundFrames = 0;
    if (this.onRallyStart) this.onRallyStart(this.rallies.length);
    this.cur = { serveP2: this.isPlayer2Serve, startFrame: this.frameNo, tick0: this.inputs.map((i) => (i ? i.tick : 0)), touches: [], ph: [0, 0], prevSt: null };
  }
  round() {
    const ua = [this.inputs[0] || this.nullInput, this.inputs[1] || this.nullInput];
    const touched = this.physics.runEngineForNextFrame(ua);
    this.roundFrames++;
    if (this.cur) {
      const pl = [this.physics.player1, this.physics.player2];
      for (let i = 0; i < 2; i++) if (pl[i].state === 2 && this.cur.prevSt && this.cur.prevSt[i] !== 2) this.cur.ph[i]++;
      this.cur.prevSt = [pl[0].state, pl[1].state];
    }
    if (this.gameEnded) {
      this.frameCounter++;
      if (this.frameCounter >= this.frameTotal.gameEnd) { this.frameCounter = 0; this.state = 'intro'; this.finished = true; }
      return;
    }
    if (touched && !this.roundEnded && !this.gameEnded) {
      const p2Won = this.physics.ball.punchEffectX < 216;
      this.endRally(p2Won ? 1 : 0, 'ground');
      this.isPlayer2Serve = this.decideNextServe(p2Won);
      this.scores[p2Won ? 1 : 0] += 1;
      if (this.scores[p2Won ? 1 : 0] >= this.winningScore) this.gameEnded = true;
      if (!this.gameEnded) this.slowMotionFramesLeft = 6;
      this.roundEnded = true;
    }
    if (this.roundEnded && !this.gameEnded) { if (this.slowMotionFramesLeft === 0) this.state = 'afterEndOfRound'; }
  }
  afterEndOfRound() {
    this.frameCounter++;
    if (this.frameCounter >= this.frameTotal.afterEndOfRound) { this.frameCounter = 0; this.state = 'beforeStartOfNextRound'; }
  }
  beforeStartOfNextRound() {
    if (this.frameCounter === 0) {
      this.physics.player1.initializeForNewRound(); this.physics.player2.initializeForNewRound();
      this.physics.ball.initializeForNewRound(this.isPlayer2Serve);
    }
    this.frameCounter++;
    if (this.frameCounter >= this.frameTotal.beforeStartOfNextRound) { this.frameCounter = 0; this.roundEnded = false; this.state = 'round'; this.beginRally(); }
  }
  intro() {}
  endRally(winnerIdx, how) {
    if (!this.cur) return;
    this.cur.winner = winnerIdx; this.cur.how = how; this.cur.frames = this.roundFrames; this.cur.landX = this.physics.ball.x | 0;
    this.rallies.push(this.cur); this.cur = null;
  }
  /* rules/touchLimit.js + operator.awardPoint + forceNextRound 재현 */
  observeTouchLimit() {
    const tl = this.tl;
    if (this.state !== 'round') { tl.count = 0; tl.last = null; tl.prevFlags = [false, false]; tl.prevOnLeft = null; return; }
    const onLeft = this.physics.ball.x < 216;
    if (tl.prevOnLeft !== null && onLeft !== tl.prevOnLeft) { tl.count = 0; tl.last = null; tl.prevFlags = [false, false]; }
    tl.prevOnLeft = onLeft;
    const pl = [this.physics.player1, this.physics.player2];
    for (let i = 0; i < 2; i++) {
      const c = pl[i].isCollisionWithBallHappened;
      if (c && !tl.prevFlags[i]) {
        if (tl.last !== null && tl.last !== i) tl.count = 0;
        tl.last = i; tl.count++;
        if (this.cur) {
          const b = this.physics.ball, p1 = this.physics.player1, p2 = this.physics.player2;
          this.cur.touches.push({ i, f: this.roundFrames, ph: b.isPowerHit, bx: b.x | 0, by: b.y | 0, vx: b.xVelocity | 0, vy: b.yVelocity | 0, px: [p1.x | 0, p2.x | 0], py: [p1.y | 0, p2.y | 0], st: [p1.state, p2.state] });
        }
        if (tl.count >= 5) {
          const opp = i === 0 ? 1 : 0;
          tl.count = 0; tl.last = null; tl.prevFlags = [false, false];
          if (this.isDuringMatch() && !this.gameEnded && !this.roundEnded) {
            this.endRally(opp, 'touchLimit');
            this.scores[opp] += 1;
            if (this.scores[opp] >= this.winningScore) { this.gameEnded = true; return; }
            this.isPlayer2Serve = this.decideNextServe(opp === 1);
            this.roundEnded = true; this.slowMotionFramesLeft = 0; this.frameCounter = 0; this.state = 'afterEndOfRound';
            return;
          }
        }
      }
      tl.prevFlags[i] = c;
    }
  }
  runToEnd(maxFrames = 300000) { while (!this.finished && this.frameNo < maxFrames) this.step(); return this.rallies; }
}
