/* skills/today.mjs — 당일 스킬 재현 템플릿 (sim_real 훅). 실제 규칙이 공개되면 이 파일의 CFG 와 필요한 훅만 고친다.
 * 실행: node --no-warnings tools/eval_skill_real.mjs ./skills/today.mjs Lion_Eating_Bank_v12_1 OurBot_v12 2 --sk on=1,fire=1
 *
 * 훅(sim_real.mjs RealGame 이 부른다):
 *   init(ctx, game)                         경기 시작 1회. ctx 는 이 파일의 상태 저장소
 *   onRally(game, ctx)                      랠리 시작(READY 뒤 round 진입)
 *   extend(snap, side, game, ctx)           봇에게 주는 스냅샷에 새 필드 추가      ← 당일 "스냅샷 새 필드"를 여기서 흉내
 *   filterInput(side, action, game, ctx)    엔진에 들어가기 직전 입력 변경(매 프레임) ← 입력형(스턴). action[KEY] 로 봇의 발동 키가 보인다
 *   observe(game, ctx)                      물리 스텝 뒤. game.physics.ball/player1/player2 를 덮어쓰면 프레임 후처리 재현.
 *                                           'LEFT'|'RIGHT' 를 돌려주면 그쪽 득점                  ← 규칙형(touchLimit 방식)
 *
 * 새 레포 skill/setup.js 를 그대로 쓰려면: init 에서
 *   const { setUpSkill } = await import(pathToFileURL(process.env.ENGINE_ROOT + '/src/resources/js/skill/setup.js').href);
 *   setUpSkill(game.pikaVolleyShim(), game.tickerShim(), game.operatorShim());
 * 로 붙이고(필드명은 setup.js 가 읽는 이름에 맞춰 sim_real.pikaVolleyShim 수정) extend 만 남긴다.
 *
 * 아래는 가짜 규칙(원형 3개 중 CFG.TYPE 하나만 산다):
 *   충전: 자기 쪽 공 접촉마다 +CHARGE, 최대 FULL. 랠리마다 유지(RESET_ON_RALLY 로 리셋 가능)
 *   발동: 만충 상태에서 봇이 반환 객체에 KEY 를 넣으면 armed. 그 다음 자기 접촉에서 소모(접촉 소모형). PRESS_CONSUME=1 이면 누른 즉시 소모
 *   효과: A 공 물리 변조 — 발동 접촉 직후 공 속도 ×SPEED_MULT (엔진 y속도 상한 40 은 다음 프레임에 걸린다)
 *         B 스턴          — 발동 접촉 직후 상대 입력 STUN_FRAMES 동안 중립
 *         C 득점          — 발동 접촉으로 넘어간 공이 상대 코트에 닿으면(엔진 판정 그대로) + 즉시 득점은 하지 않음. 대신 접촉 즉시 득점하려면 INSTANT_POINT=1
 *   스냅샷: self.gauge / opp.gauge (숫자), self.claw / opp.claw = null | { armed, active, framesLeft }
 */
export const CFG = {
  TYPE: 'A', KEY: 'skill', FULL: 100, CHARGE: 25, RESET_ON_RALLY: 0, PRESS_CONSUME: 0,
  SPEED_MULT: 1.5, STUN_FRAMES: 30, INSTANT_POINT: 1,
};
if (process.env.SKILL_CFG) Object.assign(CFG, JSON.parse(process.env.SKILL_CFG));   // 예: SKILL_CFG='{"TYPE":"B"}'
const sideIdx = (side) => (side === 'LEFT' ? 0 : 1);
export default {
  init(ctx) {
    ctx.g = { gauge: [0, 0], armed: [false, false], active: [0, 0], stun: [0, 0], prevHit: [false, false], fires: 0, consumed: 0 };
  },
  onRally(game, ctx) {
    const g = ctx.g;
    g.armed = [false, false]; g.active = [0, 0]; g.stun = [0, 0]; g.prevHit = [false, false];
    if (CFG.RESET_ON_RALLY) g.gauge = [0, 0];
  },
  extend(snap, side, game, ctx) {
    const g = ctx.g, i = sideIdx(side);
    snap.self.gauge = g.gauge[i]; snap.opp.gauge = g.gauge[1 - i];
    snap.self.claw = (g.armed[i] || g.active[i] > 0) ? { armed: g.armed[i], active: g.active[i] > 0, framesLeft: g.active[i] } : null;
    snap.opp.claw = (g.armed[1 - i] || g.active[1 - i] > 0) ? { armed: g.armed[1 - i], active: g.active[1 - i] > 0, framesLeft: g.active[1 - i] } : null;
  },
  filterInput(side, action, game, ctx) {
    const g = ctx.g, i = sideIdx(side);
    /* 발동 키 감지: 만충 + KEY → armed (PRESS_CONSUME 이면 여기서 소모) */
    if (action && action[CFG.KEY] && g.gauge[i] >= CFG.FULL && !g.armed[i]) {
      g.armed[i] = true; g.fires++;
      if (CFG.PRESS_CONSUME) { g.gauge[i] = 0; g.consumed++; }
    }
    if (CFG.TYPE === 'B' && g.stun[i] > 0) return { x: 0, y: 0, hit: 0 };
    return action;
  },
  observe(game, ctx) {
    const g = ctx.g, ph = game.physics, pl = [ph.player1, ph.player2];
    for (let i = 0; i < 2; i++) { if (g.stun[i] > 0) g.stun[i]--; if (g.active[i] > 0) g.active[i]--; }
    for (let i = 0; i < 2; i++) {
      const c = pl[i].isCollisionWithBallHappened;
      if (c && !g.prevHit[i]) {                                   // 자기 접촉 에지
        if (g.armed[i]) {                                        // 발동 접촉
          g.armed[i] = false; if (!CFG.PRESS_CONSUME) { g.gauge[i] = 0; g.consumed++; }
          if (CFG.TYPE === 'A') { ph.ball.xVelocity = Math.round(ph.ball.xVelocity * CFG.SPEED_MULT); ph.ball.yVelocity = Math.round(ph.ball.yVelocity * CFG.SPEED_MULT); g.active[i] = 1; }
          if (CFG.TYPE === 'B') { g.stun[1 - i] = CFG.STUN_FRAMES; g.active[i] = CFG.STUN_FRAMES; }
          if (CFG.TYPE === 'C' && CFG.INSTANT_POINT) { g.prevHit[i] = c; return i === 0 ? 'LEFT' : 'RIGHT'; }
        } else g.gauge[i] = Math.min(CFG.FULL, g.gauge[i] + CFG.CHARGE);
      }
      g.prevHit[i] = c;
    }
    return null;
  },
};
