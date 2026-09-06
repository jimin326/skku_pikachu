/* sim_real.mjs — 실게임(pikavolley.js 상태머신 + bot/botInput.js 입력 규약) 프레임 단위 재현 하니스.
 * sim.mjs 와의 차이(=실서버 요소):
 *  - tick 카운터가 라운드/경기를 넘어 연속(위상이 자연 발생)
 *  - rallyFrameCount 는 점수합 변동 시 0으로 리셋 후 매 논리프레임 ++ (슬로모션6+afterEnd5+READY30 포함 → 라운드 첫 프레임에 41)
 *  - READY(물리 정지) 30프레임 동안도 3프레임마다 스냅샷이 가고 응답은 다음 프레임에 적용
 *  - 첫 랠리는 READY 없이 round 0프레임에 봇 장착(testSetup.syncWithGameState)
 *  - 서브 규칙 기본 RANDOM(rand()%2), touchLimit 5회 → awardPoint → forceNextRound(afterEndOfRound 직행)
 *  - 10점 경기, 경기 종료 후 211프레임 gameEnd 동안 물리 계속, 다음 경기 startOfNewGame 71프레임은 봇 미장착
 */
import fs from 'fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
/* 엔진 경로: 환경변수 ENGINE_ROOT(레포 루트 또는 그 src 디렉터리). 기본 = 이 저장소의 ../src.
 * 당일 새 레포를 가리키면 새 physics.js·rand.js·botContract.js(스냅샷 빌더)를 그대로 쓴다. 시드 고정은 여기서 export 하는 setCustomRng 로(같은 모듈 인스턴스). */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_ROOT = (() => {
  const cands = [];
  if (process.env.ENGINE_ROOT) { const r = path.resolve(process.env.ENGINE_ROOT); cands.push(r, path.join(r, 'src')); }
  else cands.push(path.resolve(HERE, '../src'));
  for (const c of cands) if (fs.existsSync(path.join(c, 'resources/js/physics.js'))) return c;
  throw new Error('ENGINE_ROOT 에서 resources/js/physics.js 를 찾을 수 없음: ' + cands.join(' | '));
})();
const eng = (p) => import(pathToFileURL(path.join(ENGINE_ROOT, 'resources/js', p)).href);
const { PikaPhysics, PikaUserInput } = await eng('physics.js');
const { rand, setCustomRng } = await eng('rand.js');
const { buildGameStateSnapshot } = await eng('bot/botContract.js');
export { PikaPhysics, PikaUserInput, rand, setCustomRng, buildGameStateSnapshot };

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
    let act = this.latestAction;
    if (game.skill && game.skill.filterInput) { const f = game.skill.filterInput(this.side, act, game, game.skillCtx); if (f) act = f; }   // 스킬 훅(입력형, 매 프레임)
    this.xDirection = act.x; this.yDirection = act.y; this.powerHit = act.hit;
    const total = game.scores[0] + game.scores[1];
    if (total !== this.previousScoreTotal) { this.rallyFrameCount = 0; this.previousScoreTotal = total; } else this.rallyFrameCount++;
    this.tick++;
    if (this.tick % 3 !== 0) return;
    if (this.queue.length) { this.skipped++; return; }   // 이전 요청 미해결 → 요청 건너뜀
    const rfc = this.simRally ? game.roundFrames : this.rallyFrameCount;
    const snap = buildSnapshot(this.tick, this.side, game.physics, { scores: game.scores, isPlayer2Serve: game.isPlayer2Serve }, rfc);
    if (game.skill && game.skill.extend) game.skill.extend(snap, this.side, game, game.skillCtx);   // 스킬 훅(스냅샷 새 필드)
    let a = null; this.calls++;
    try { a = this.decide(snap); } catch (e) { this.errors++; a = null; }
    if (!valid(a)) a = { x: 0, y: 0, hit: 0 };
    const lat = typeof this.latency === 'function' ? this.latency() : this.latency;
    this.queue.push({ at: this.frames + lat, action: Object.assign({}, a) });   // 추가 키(스킬 발동 등)도 보존 — 실엔진 botInput.js 의 latestAction = message.action 과 같게
  }
}

export class RealGame {
  constructor({ serveRule = 'random', winningScore = 10, readySnapshots = true, skill = null } = {}) {
    this.skill = null; this.skillCtx = null; this.tickerCbs = [];   // 스킬 훅(아래 setSkill·shim). skill 없으면 동작 동일
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
    if (skill) this.setSkill(skill);
  }
  /* ── 스킬 훅(당일용) ──────────────────────────────────────────────────────────────────────
   * skill = { init(ctx, game), onRally(game, ctx), extend(snap, side, game, ctx), filterInput(side, action, game, ctx) → action,
   *           observe(game, ctx) → null | 0 | 1 | 'LEFT' | 'RIGHT' } 중 있는 것만. 템플릿: tools/skills/today.mjs
   *   extend      봇에게 주는 스냅샷에 새 필드(게이지·claw 등) 추가
   *   filterInput 큐에서 꺼낸 행동이 엔진에 들어가기 직전(매 프레임). 봇의 추가 키는 action[KEY] 로 보인다
   *   observe     물리 스텝 뒤(라운드 중). game.physics.ball/player1/player2 를 덮어쓰면 프레임 후처리(assembly-layer) 재현.
   *               사이드를 돌려주면 그쪽 득점 + 라운드 종료(touchLimit 과 같은 awardPoint 경로)
   * 새 레포 skill/setup.js 가 setUpSkill(pikaVolley, ticker, operator) 꼴이면 init 에서
   *   setUpSkill(game.pikaVolleyShim(), game.tickerShim(), game.operatorShim()) 로 그들 코드를 직접 붙인다(필드명은 당일 맞춤). */
  setSkill(skill) {
    this.skill = skill || null; this.skillCtx = {};
    if (skill && skill.init) skill.init(this.skillCtx, this);
    return this;
  }
  observeSkill() {
    if (this.state !== 'round' || this.roundEnded || this.gameEnded) return;
    const r = this.skill.observe(this, this.skillCtx);
    const idx = (r === 'LEFT' || r === 0) ? 0 : (r === 'RIGHT' || r === 1) ? 1 : -1;
    if (idx >= 0) this.awardPoint(idx, 'skill');
  }
  /* operator.awardPoint + forceNextRound 재현. touchLimit·스킬 득점이 같은 경로를 탄다 */
  awardPoint(idx, how) {
    if (!this.isDuringMatch() || this.gameEnded || this.roundEnded) return false;
    this.endRally(idx, how);
    this.scores[idx] += 1;
    if (this.scores[idx] >= this.winningScore) { this.gameEnded = true; return true; }
    this.isPlayer2Serve = this.decideNextServe(idx === 1);
    this.roundEnded = true; this.slowMotionFramesLeft = 0; this.frameCounter = 0; this.state = 'afterEndOfRound';
    return true;
  }
  /* PikachuVolleyball 공개 필드를 실시간으로 비추는 뷰(setup.js 가 읽는 이름을 당일 여기에 맞춘다) */
  pikaVolleyShim() {
    const g = this;
    return {
      get physics() { return g.physics; },
      get keyboardArray() { return [g.inputs[0] || g.nullInput, g.inputs[1] || g.nullInput]; },
      get scores() { return g.scores; },
      get isPlayer2Serve() { return g.isPlayer2Serve; },
      get state() { return g.state; },
      get roundEnded() { return g.roundEnded; },
      get gameEnded() { return g.gameEnded; },
      get frameCounter() { return g.frameCounter; },
    };
  }
  tickerShim() { const g = this; return { add(cb) { g.tickerCbs.push(cb); return this; }, remove(cb) { g.tickerCbs = g.tickerCbs.filter((c) => c !== cb); return this; } }; }
  operatorShim() { const g = this; return { awardPoint: (idx) => g.awardPoint(idx, 'skill'), isDuringMatch: () => g.isDuringMatch() }; }
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
    /* 관찰자 순서: 실게임은 ticker 콜백(rules/skill)이 다음 프레임 gameLoop 앞에 돈다 = 여기 "물리 스텝 뒤"와 같다. skill ↔ touchLimit 상대 순서는 당일 main.js 로 확인 */
    for (let i = 0; i < this.tickerCbs.length; i++) this.tickerCbs[i]();
    if (this.skill && this.skill.observe) this.observeSkill();
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
    if (this.skill && this.skill.onRally) this.skill.onRally(this, this.skillCtx);   // 스킬 훅(랠리 시작: 게이지 리셋 등)
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
          if (this.awardPoint(opp, 'touchLimit')) return;
        }
      }
      tl.prevFlags[i] = c;
    }
  }
  runToEnd(maxFrames = 300000) { while (!this.finished && this.frameNo < maxFrames) this.step(); return this.rallies; }
}
