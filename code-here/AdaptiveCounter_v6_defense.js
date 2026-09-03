'use strict';
/* AdaptiveCounter_v6 — adversarial multi-skill build
+ * Generated from v5_4 by tools/build-adaptive-v6.mjs.
+ *
+ * Added skills:
+ *  - phase-aware fast-serve receive
+ *  - high-speed corridor interception
+ *  - opponent-pose pre-jump and profile-gated defence
+ *  - emergency dive with exact trajectory gating
+ *
+ * Preserved skills:
+ *  - quick attack and contact-height search
+ *  - slow Thunder search
+ *  - aimed touch / jump touch
+ *
+ * Original lineage: AdaptiveCounter_v5_4
 * v5_3 = v5_2 에서 상수 두 개(ADAPT_CFG.MAX_BLEND 0.30, CFG.AIR_MAX 22).
 * v5_4 는 거기에 세 가지를 더했다. 근거는 전부 패치 엔진(origin/main 1f3cecb,
 * y속도 상한 40) 기준 16시드 × 좌우 = 상대당 32경기 실측.
 *
 *  [PATCH-SYNC] 봇 내부 공 모델(stepBall)에도 y속도 ±40 상한을 넣었다.
 *      엔진은 착지 예측기 두 곳에도 같은 상한을 넣었는데 우리 모델에는 없어서,
 *      파워히트(|vy|*2)로 40을 넘는 순간마다 예측이 실제와 어긋나고 있었다.
 *
 *  [QA] 속공 + 타점 낮추기 — 나무위키 기술 분류의 '속공'(올라가는 공을 바로
 *      반격)과 '타점 낮추기 / 점프 터치'(점프 중 무빙으로 접촉 높이 조절)를
 *      한 덩어리로 구현. "언제 점프해 어느 높이에서 어떤 각도로 칠까"를 전수로
 *      뒤지고, 월드 모델로 끝까지 굴려 상대가 못 받는 것만 고른다.
 *      v5_2의 findFastAttack 은 11,281회 호출에 21회만 발동해 사실상 죽어 있었다.
 *
 *  [ST] 느린 썬더 — 기본 꺼짐. 물리적으로는 실재하지만 실전에서 안 나온다(아래).
 *
 * 리그 성적 (8봇, 16시드):
 *   v5_4 139승 85패 / v5_3 130승 94패 / v5_2 130승 93패
 *   vs Lion_Eating_Bank_v1  17.2%(v5_2) -> 21.9%(v5_3) -> 43.8%(v5_4)   ← 가장 큰 개선
 *   vs Lion_Eating_Bank_v2   3.1%(v5_2) -> 46.9%(v5_3) -> 43.8%(v5_4)
 *   vs Adaptive_v5          65.6% -> 81.3% -> 78.1%
 * 주의(비추이성): v5_2 원본과 붙으면 12-20 으로 진다. 반드시 리그로 판단할 것.
 *
 * 성능: decide 최대 6.8ms (v5_3 은 0.8ms). 대회 목표 120ms / 하드 360ms 대비
 * 여유는 있으나 브라우저 워커는 더 느리므로 당일 F12 로 한 번 확인할 것.
 * QA_CFG.ON = 0 으로 끄면 v5_3 동작으로 돌아간다.
 */

var GROUND_WIDTH = 432;
var NET_X = 216;
var PLAYER_GROUND_Y = 244;
var BALL_GROUND_Y = 252;
var PLAYER_HALF = 32;
var NET_HALF_W = 25;
var NET_TOP_Y = 176;
var NET_TOP_BOTTOM_Y = 192;
var WALK_SPEED = 6;
var DIVE_SPEED = 8;
var LATENCY_FRAMES = 1;

var CFG = { AIR_MIN: 3, AIR_MAX: 22, Y_LO: 120, Y_HI: 218, TOL: 26, BAND: 0 };

/* === [ADAPT-1] 적응 강도: 초반에는 v5 그대로, 표본이 쌓일수록 서서히 반영 === */
var ADAPT_CFG = {
  MIN_SAMPLES: 3,       // 이 횟수 전에는 학습값을 수비에 사용하지 않음
  FULL_SAMPLES: 12,     // 이 정도 관측하면 표본 신뢰도를 최대로 봄
  EMA_RATE: 0.34,       // 최근 공격 코스에 반응하는 속도
  MAX_BLEND: 0.30,      // 기존 v5 수비 판단을 최소 38% 보존
  MAX_SHIFT: 72,        // 학습 때문에 한 번에 치우칠 수 있는 최대 거리
  RECENT_SIZE: 8,
  HIT_X_RANGE: 105,
  HIT_Y_RANGE: 125
};

/* === [FAST-1] 빠른 공격은 엄격한 성공 조건을 통과할 때만 사용 === */
var FAST_ATTACK_CFG = {
  ARM_UNTILS: [2, 3],   // v5_1의 4프레임 대기보다 1~2프레임 먼저 타격 준비
  MAX_CONTACT: 13,      // 너무 늦게 만나는 공은 '반박자 빠른 공격'에서 제외
  MAX_DROP: 15,
  DOWN_MAX_DROP: 11,    // 하향 공격은 접촉 뒤 11프레임 안에 떨어져야 함
  COURT_MARGIN: 10,
  OPP_WINDOW: 2,        // 상대가 대응 가능한 프레임 창
  COMMIT_TICKS: 15,
  ABORT_SCORE: -280,
  DOWN_BONUS: 145,
  EARLY_WEIGHT: 11
};

var FAST_DEFENSE_CFG = {
  MIN_SPEED: 17,
  CORRIDOR_Y_LO: 93,
  CORRIDOR_Y_HI: 226,
  CORRIDOR_HORIZON: 40,
  FRONT_FROM_NET: 63,
  PREJUMP_BALL_DX: 106,
  PREJUMP_BALL_DY: 139,
  PREJUMP_OPP_NET: 111,
  PREJUMP_ALIGN: 18,
  PROFILE_MIN: 3,
  PROFILE_MAX_VARIANCE: 2056,
  PROFILE_LAND_TOL: 30,
  JUMP_TOL: 27,
  JUMP_MIN_AGE: 0,
  JUMP_MAX_AGE: 18,
  DIVE_MAX_FRAMES: 13
};

var g_prev = null;
var g_touches = 0;
var g_prev_ball_on_left = null;
var g_prev_tick = null;
var g_last_action = { x: 0, y: 0, hit: 0 };
var g_air_policy = null;
var g_group = 3;
var g_fast_attack_until = -1;
var g_fast_attack_policy = null;
var g_fast_def_profile_locked = false;
var g_serve_counter_active = false;
var g_serve_counter_last_rally = null;
var g_serve_counter_suppressed = false;

/* === [ADAPT-2] 랠리가 바뀌어도 유지되는 상대 패턴 능력치 === */
var g_adapt = {
  side: null,
  attackCount: 0,
  landingMean: 0,
  landingM2: 0,
  landingEMA: null,
  recentDepths: [],
  zoneCounts: [0, 0, 0],       // 0=뒤, 1=중앙, 2=네트 앞
  shotCounts: [0, 0, 0, 0, 0, 0], // 느림/빠름 × 아치/수평/내리꽂기
  fastCount: 0,
  downCount: 0,
  flatCount: 0,
  attackActive: false,
  lastAttackTick: -9999,
  lastRallyFrame: null,
  lastScoreSelf: null,
  lastScoreOpp: null
};

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function idiv(a, b) { return Math.floor(a / b); }

function stepBall(b) {
  /* [PATCH-SYNC] 엔진이 매 프레임 y속도를 ±40으로 자른다(BALL_MAX_Y_VELOCITY).
   * 엔진의 착지 예측기 두 곳에도 같은 상한이 들어갔으므로, 우리 모델에도
   * 넣어야 예측과 실제가 어긋나지 않는다. 파워히트는 |vy|*2 라 쉽게 40을 넘는다. */
  if (b.yV > 40) b.yV = 40; else if (b.yV < -40) b.yV = -40;
  var fx = b.x + b.xV;
  if (fx < 0 || fx > GROUND_WIDTH) b.xV = -b.xV;
  if (b.y + b.yV < 0) b.yV = 1;
  if (Math.abs(b.x - NET_X) < NET_HALF_W && b.y > NET_TOP_Y) {
    if (b.y <= NET_TOP_BOTTOM_Y) { if (b.yV > 0) b.yV = -b.yV; }
    else if (b.x < NET_X) b.xV = -Math.abs(b.xV);
    else b.xV = Math.abs(b.xV);
  }
  var fy = b.y + b.yV;
  if (fy > BALL_GROUND_Y) return true;
  b.y = fy; b.x += b.xV; b.yV += 1;
  return false;
}

function cloneBall(ball) {
  return { x: ball.x, y: ball.y, xV: ball.xVelocity, yV: ball.yVelocity };
}
function ballAfter(ball, n) {
  var b = cloneBall(ball);
  for (var i = 0; i < n; i++) if (stepBall(b)) break;
  return b;
}
function framesToLanding(ball) {
  var b = cloneBall(ball);
  for (var i = 1; i <= 200; i++) if (stepBall(b)) return i;
  return 200;
}
function powerHitLanding(b0, xAbs, yd) {
  var b = {
    x: b0.x, y: b0.y,
    xV: (b0.x < NET_X ? 1 : -1) * (xAbs + 1) * 10,
    yV: Math.max(15, Math.abs(b0.yV)) * yd * 2
  };
  for (var i = 1; i <= 200; i++) if (stepBall(b)) return { x: b.x, frames: i };
  return { x: b.x, frames: 200 };
}

function oppCanReach(b, oppX, oppMinX, oppMaxX, fSinceHit) {
  if (b.x < oppMinX - PLAYER_HALF || b.x > oppMaxX + PLAYER_HALF) return false;
  if (b.y < 76) return false;
  if (b.y < 212 && fSinceHit < 5) return false;
  return Math.abs(b.x - oppX) <= WALK_SPEED * fSinceHit + 40;
}

function microSim(me0, ball0, firstAction, action, minX, maxX, maxFrames, oppInfo) {
  var mx = me0.x, my = me0.y, vy = me0.vy, state = me0.state;
  var delay = me0.delay, frameNo = me0.frameNo;
  var b = { x: ball0.x, y: ball0.y, xV: ball0.xVelocity, yV: ball0.yVelocity };
  var collFlag = me0.collFlag === true;
  var touches = 0, powerTouches = 0, oppWindow = 0, fSinceHit = -1;

  for (var f = 1; f <= maxFrames; f++) {
    var a = (f === 1) ? firstAction : action;
    if (stepBall(b)) {
      return { landed: true, landX: b.x, frames: f, touches: touches,
        powerTouches: powerTouches, oppWindow: oppWindow };
    }
    if (fSinceHit >= 0) {
      fSinceHit += 1;
      if (oppInfo && oppCanReach(b, oppInfo.x, oppInfo.minX, oppInfo.maxX, fSinceHit)) oppWindow += 1;
    }
    if (state < 3) mx = clamp(mx + a.x * WALK_SPEED, minX, maxX);
    var futureY = my + vy;
    my = futureY;
    if (futureY < PLAYER_GROUND_Y) vy += 1;
    else { my = PLAYER_GROUND_Y; vy = 0; state = 0; }
    if (a.hit === 1 && state === 1) { delay = 5; frameNo = 0; state = 2; }
    if (state === 2) {
      if (delay < 1) { frameNo += 1; if (frameNo > 4) { frameNo = 0; state = 1; } }
      else delay -= 1;
    }
    var overlap = Math.abs(b.x - mx) <= PLAYER_HALF && Math.abs(b.y - my) <= PLAYER_HALF;
    if (overlap) {
      if (!collFlag) {
        if (b.x < mx) b.xV = -idiv(Math.abs(b.x - mx), 3);
        else if (b.x > mx) b.xV = idiv(Math.abs(b.x - mx), 3);
        var absY = Math.abs(b.yV);
        b.yV = absY < 15 ? -15 : -absY;
        if (state === 2) {
          b.xV = (b.x < NET_X ? 1 : -1) * (Math.abs(a.x) + 1) * 10;
          b.yV = Math.abs(b.yV) * a.y * 2;
          powerTouches += 1; oppWindow = 0; fSinceHit = 0;
        }
        touches += 1; collFlag = true;
      }
    } else collFlag = false;
  }
  return { landed: false, landX: b.x, frames: maxFrames, touches: touches,
    powerTouches: powerTouches, oppWindow: oppWindow };
}

function microSimSeq(me0, ball0, stages, minX, maxX, maxFrames, oppInfo) {
  var mx = me0.x, my = me0.y, vy = me0.vy, state = me0.state;
  var delay = me0.delay, frameNo = me0.frameNo;
  var b = { x: ball0.x, y: ball0.y, xV: ball0.xVelocity, yV: ball0.yVelocity };
  var collFlag = me0.collFlag === true;
  var touches = 0, powerTouches = 0, oppWindow = 0, fSinceHit = -1, lastHitFrame = 0, si = 0;

  for (var f = 1; f <= maxFrames; f++) {
    while (si < stages.length - 1 && f > stages[si].until) si += 1;
    var a = stages[si].act;
    if (stepBall(b)) {
      return { landed: true, landX: b.x, frames: f, touches: touches,
        powerTouches: powerTouches, lastHitFrame: lastHitFrame, oppWindow: oppWindow };
    }
    if (fSinceHit >= 0) {
      fSinceHit += 1;
      if (oppInfo && oppCanReach(b, oppInfo.x, oppInfo.minX, oppInfo.maxX, fSinceHit)) oppWindow += 1;
    }
    if (state < 3) mx = clamp(mx + a.x * WALK_SPEED, minX, maxX);
    if (state < 3 && a.y === -1 && my === PLAYER_GROUND_Y) { vy = -16; state = 1; }
    var futureY = my + vy;
    my = futureY;
    if (futureY < PLAYER_GROUND_Y) vy += 1;
    else { my = PLAYER_GROUND_Y; vy = 0; if (state === 1 || state === 2) state = 0; }
    if (a.hit === 1 && state === 1) { delay = 5; frameNo = 0; state = 2; }
    if (state === 2) {
      if (delay < 1) { frameNo += 1; if (frameNo > 4) { frameNo = 0; state = 1; } }
      else delay -= 1;
    }
    var overlap = Math.abs(b.x - mx) <= PLAYER_HALF && Math.abs(b.y - my) <= PLAYER_HALF;
    if (overlap) {
      if (!collFlag) {
        if (b.x < mx) b.xV = -idiv(Math.abs(b.x - mx), 3);
        else if (b.x > mx) b.xV = idiv(Math.abs(b.x - mx), 3);
        var aY = Math.abs(b.yV);
        b.yV = aY < 15 ? -15 : -aY;
        if (state === 2) {
          b.xV = (b.x < NET_X ? 1 : -1) * (Math.abs(a.x) + 1) * 10;
          b.yV = Math.abs(b.yV) * a.y * 2;
          powerTouches += 1; lastHitFrame = f; oppWindow = 0; fSinceHit = 0;
        }
        touches += 1; collFlag = true;
      }
    } else collFlag = false;
  }
  return { landed: false, landX: b.x, frames: maxFrames, touches: touches,
    powerTouches: powerTouches, lastHitFrame: lastHitFrame, oppWindow: oppWindow };
}

function findKillJump(s, minX, maxX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X;
  var oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var budget = 4 - g_touches;
  if (budget < 1) return null;
  var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };
  var me0 = {
    x: s.self.x, y: s.self.y, vy: 0, state: 0, delay: 0, frameNo: 0,
    collFlag: (Math.abs(s.ball.x - s.self.x) <= PLAYER_HALF &&
               Math.abs(s.ball.y - s.self.y) <= PLAYER_HALF)
  };
  var oppInfo = {
    x: s.opp.x,
    minX: isRight ? PLAYER_HALF : NET_X + PLAYER_HALF,
    maxX: isRight ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF
  };
  var best = null;
  var jxs = [0, 1, -1], cxs = [0, 1, -1], yds = [1, 0, -1];
  for (var i = 0; i < 3; i++) {
    var jumpAct = { x: jxs[i], y: -1, hit: 0 };
    for (var j = 0; j < 3; j++) {
      for (var k = 0; k < 3; k++) {
        var smash = { x: cxs[j], y: yds[k], hit: 1 };
        var r = microSimSeq(me0, s.ball, [
          { until: 1, act: first },
          { until: 4, act: jumpAct },
          { until: 999, act: smash }
        ], minX, maxX, 44, oppInfo);
        if (!r.landed || r.powerTouches < 1) continue;
        if (r.touches > budget) continue;
        if (r.landX <= oppMinX + 4 || r.landX >= oppMaxX - 4) continue;
        var drop = r.frames - r.lastHitFrame;
        var distFromOpp = Math.abs(r.landX - s.opp.x);
        var unreachable = distFromOpp > WALK_SPEED * drop + 44;
        var throughBall = r.oppWindow === 0;
        if (drop > 14 && !unreachable && !throughBall) continue;
        var score = 300 - drop * 6 + distFromOpp;
        if (throughBall) score += 250;
        else if (unreachable) score += 120;
        /* [DOWN-1] 이미 안전 판정을 통과한 후보끼리는 최대 하향(y=1)을 우선. */
        if (smash.y === 1 && drop <= FAST_ATTACK_CFG.DOWN_MAX_DROP &&
            (throughBall || unreachable)) {
          score += Math.round(FAST_ATTACK_CFG.DOWN_BONUS * 0.65);
        }
        if (!best || score > best.score) best = { jx: jxs[i], smash: smash, score: score };
      }
    }
  }
  return best;
}

/*
 * === [FAST-2] 반박자 빠른 공격 ===
 * v5_1의 일반 공격보다 hit 준비를 1~2프레임 앞당긴다. 다만 아래 조건을
 * 모두 통과한 경우에만 반환하고, 하나라도 실패하면 기존 v5_1로 돌아간다.
 */
function findFastAttack(s, minX, maxX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X;
  var oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var budget = 4 - g_touches;
  if (budget < 1) return null;

  var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };
  var me0 = {
    x: s.self.x, y: s.self.y, vy: 0, state: 0, delay: 0, frameNo: 0,
    collFlag: (Math.abs(s.ball.x - s.self.x) <= PLAYER_HALF &&
               Math.abs(s.ball.y - s.self.y) <= PLAYER_HALF)
  };
  var oppInfo = {
    x: s.opp.x,
    minX: isRight ? PLAYER_HALF : NET_X + PLAYER_HALF,
    maxX: isRight ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF
  };

  var best = null;
  var jxs = [0, 1, -1];
  var cxs = [1, -1, 0];
  var yds = [1, 0]; // 최대 하향을 먼저 검사하고, 안전한 수평타만 보조 후보로 둔다.

  for (var au = 0; au < FAST_ATTACK_CFG.ARM_UNTILS.length; au++) {
    var armUntil = FAST_ATTACK_CFG.ARM_UNTILS[au];
    for (var i = 0; i < jxs.length; i++) {
      // 점프와 동시에 hit를 눌러 공격 상태를 반박자 먼저 준비한다.
      var jumpAct = { x: jxs[i], y: -1, hit: 1 };
      for (var j = 0; j < cxs.length; j++) {
        for (var k = 0; k < yds.length; k++) {
          var smash = { x: cxs[j], y: yds[k], hit: 1 };
          var r = microSimSeq(me0, s.ball, [
            { until: 1, act: first },
            { until: armUntil, act: jumpAct },
            { until: 999, act: smash }
          ], minX, maxX, 38, oppInfo);

          if (!r.landed || r.powerTouches !== 1 || r.touches > budget) continue;
          // 실제 접촉은 y=1/0 타격 명령으로 전환된 뒤에만 허용한다.
          if (r.lastHitFrame <= Math.max(armUntil, g_group) ||
              r.lastHitFrame > FAST_ATTACK_CFG.MAX_CONTACT) continue;
          if (r.landX <= oppMinX + FAST_ATTACK_CFG.COURT_MARGIN ||
              r.landX >= oppMaxX - FAST_ATTACK_CFG.COURT_MARGIN) continue;

          var drop = r.frames - r.lastHitFrame;
          if (drop < 1 || drop > FAST_ATTACK_CFG.MAX_DROP) continue;
          if (smash.y === 1 && drop > FAST_ATTACK_CFG.DOWN_MAX_DROP) continue;

          var distFromOpp = Math.abs(r.landX - s.opp.x);
          var unreachable = distFromOpp > WALK_SPEED * drop + 44;
          var throughBall = r.oppWindow === 0;
          if (r.oppWindow > FAST_ATTACK_CFG.OPP_WINDOW) continue;
          if (!throughBall && !unreachable) continue;

          var score = 720 - r.lastHitFrame * FAST_ATTACK_CFG.EARLY_WEIGHT -
            drop * 12 + distFromOpp;
          if (throughBall) score += 180;
          else if (unreachable) score += 100;
          if (smash.y === 1) {
            score += FAST_ATTACK_CFG.DOWN_BONUS +
              (FAST_ATTACK_CFG.DOWN_MAX_DROP - drop) * 10;
          }
          if (Math.abs(smash.x) === 1) score += 18;

          if (!best || score > best.score) {
            best = {
              jx: jxs[i], smash: smash, score: score,
              armUntil: armUntil, contactFrame: r.lastHitFrame,
              dropFrames: drop, landX: r.landX
            };
          }
        }
      }
    }
  }
  return best;
}

function scoreAirAction(s, me0, first, act, minX, maxX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X;
  var oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var touchBudget = 4 - g_touches;
  var oppInfo = {
    x: s.opp.x,
    minX: oppMinX === 0 ? PLAYER_HALF : NET_X + PLAYER_HALF,
    maxX: oppMaxX === NET_X ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF
  };
  var r = microSim(me0, s.ball, first, act, minX, maxX, 34, oppInfo);
  if (!r.landed) return null;
  if (r.touches > touchBudget) return null;
  var onOpp = r.landX > oppMinX + 4 && r.landX < oppMaxX - 4;
  if (onOpp && r.touches > 0) {
    var distFromOpp = Math.abs(r.landX - s.opp.x);
    var score = distFromOpp - r.frames * 2;
    if (r.powerTouches > 0 && r.oppWindow === 0) score += 250;
    else if (r.powerTouches > 0 && r.oppWindow <= 2) score += 120;
    else if (distFromOpp > WALK_SPEED * r.frames + 44) score += 120;
    /* [DOWN-2] 상대 코트 착지와 낮은 대응 창이 확인된 최대 하향타만 가산. */
    if (act.hit === 1 && act.y === 1 && r.powerTouches > 0 &&
        (r.oppWindow <= FAST_ATTACK_CFG.OPP_WINDOW ||
         distFromOpp > WALK_SPEED * r.frames + 44)) {
      score += FAST_ATTACK_CFG.DOWN_BONUS;
    }
    if (r.powerTouches >= 2) score += 60;
    if (act.hit === 1) score += 10;
    if (r.frames > 36 && distFromOpp < 110 &&
        !(r.powerTouches > 0 && r.oppWindow <= 2)) score -= 120;
    return score;
  }
  if (!onOpp && r.touches === 0) return null;
  var budget = 4 - g_touches;
  if (act.hit === 0 && r.touches > 0 && budget - r.touches >= 1) return -80;
  return -500 + (act.hit === 0 ? 50 : 0);
}

function chooseAirPolicy(s, me0, minX, maxX) {
  var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };
  var hitOnly = me0.state === 2;
  var best = null;
  var hits = hitOnly ? [1] : [1, 0];
  for (var h = 0; h < hits.length; h++) {
    var hit = hits[h];
    var yds = hit === 1 ? [1, 0, -1] : [0];
    var xds = [0, 1, -1];
    for (var xi = 0; xi < 3; xi++) {
      for (var yi = 0; yi < yds.length; yi++) {
        var act = { x: xds[xi], y: yds[yi], hit: hit };
        var score = scoreAirAction(s, me0, first, act, minX, maxX);
        if (score === null) continue;
        if (!best || score > best.score) best = { action: act, score: score };
      }
    }
  }
  return best;
}

function defenseTarget(s, minX, maxX, fallback) {
  var isRight = s.side === 'RIGHT';
  var contactBall = ballAfter(s.ball, 2);
  var lands = [];
  for (var xa = 0; xa <= 1; xa++) {
    var yds = [1, 0, -1];
    for (var i = 0; i < 3; i++) {
      var land = powerHitLanding(contactBall, xa, yds[i]);
      var ours = isRight ? land.x >= NET_X : land.x <= NET_X;
      if (ours) lands.push(land);
    }
  }
  var plainFrames = framesToLanding(s.ball);
  var plainX = s.ball.expectedLandingPointX;
  var plainOurs = isRight ? plainX >= NET_X : plainX <= NET_X;
  if (plainOurs) lands.push({ x: plainX, frames: plainFrames });
  if (!lands.length) return fallback;

  var bestX = fallback, bestWorst = Infinity;
  for (var x = minX; x <= maxX; x += 4) {
    var worst = -Infinity;
    for (var k = 0; k < lands.length; k++) {
      var fr = lands[k].frames;
      var deficit = Math.abs(x - lands[k].x) - (WALK_SPEED * fr + 38);
      if (deficit > 0 && fr <= 10) deficit *= 1.6;
      else if (deficit > 0 && fr <= 16) deficit *= 1.2;
      if (deficit > worst) worst = deficit;
    }
    if (worst < bestWorst) { bestWorst = worst; bestX = x; }
  }
  return bestX;
}

function jumpYAt(k) {
  if (k <= 0) return PLAYER_GROUND_Y;
  var y = PLAYER_GROUND_Y - 16 * k + idiv(k * (k - 1), 2);
  return y > PLAYER_GROUND_Y ? PLAYER_GROUND_Y : y;
}

function estimateMyVy(s) {
  if (g_prev === null || s.self.state > 2) return -16;
  var d = Math.max(1, s.tick - g_prev_tick);
  var dy = s.self.y - g_prev.selfY;
  return dy / d + (d + 1) / 2;
}

function findIntercept(s, myPredX, minX, maxX) {
  var b = cloneBall(s.ball);
  for (var k = 1; k <= 44; k++) {
    if (stepBall(b)) break;
    if (b.yV < 0) continue;
    if (b.y < CFG.Y_LO || b.y > CFG.Y_HI) continue;
    if (b.x < minX - 20 || b.x > maxX + 20) continue;
    if (Math.abs(b.xV) > 14) continue;
    var airAge = k - LATENCY_FRAMES;
    var walkable = WALK_SPEED * (k - 1) + 8;
    if (Math.abs(b.x - myPredX) > walkable) continue;
    if (airAge >= CFG.AIR_MIN && airAge <= CFG.AIR_MAX &&
        Math.abs(jumpYAt(airAge) - b.y) <= CFG.TOL) {
      return { jump: true, targetX: b.x };
    }
    if (airAge > CFG.AIR_MAX) return { jump: false, targetX: b.x };
  }
  return null;
}

/* === [ADAPT-3] 상대가 실제로 때린 공만 감지하고 코스/속도/각도를 기록 === */
function resetAdaptiveLearning(side) {
  g_adapt.side = side;
  g_adapt.attackCount = 0;
  g_adapt.landingMean = 0;
  g_adapt.landingM2 = 0;
  g_adapt.landingEMA = null;
  g_adapt.recentDepths = [];
  g_adapt.zoneCounts = [0, 0, 0];
  g_adapt.shotCounts = [0, 0, 0, 0, 0, 0];
  g_adapt.fastCount = 0;
  g_adapt.downCount = 0;
  g_adapt.flatCount = 0;
  g_adapt.attackActive = false;
  g_adapt.lastAttackTick = -9999;
  g_adapt.lastRallyFrame = null;
  g_adapt.lastScoreSelf = null;
  g_adapt.lastScoreOpp = null;
}

function landingToDepth(landingX, isRight) {
  // 양쪽 진영을 같은 좌표로 정규화: 0=뒷벽, 216=네트.
  return clamp(isRight ? GROUND_WIDTH - landingX : landingX, 0, NET_X);
}

function depthToLanding(depth, isRight) {
  return isRight ? GROUND_WIDTH - depth : depth;
}

function classifyAdaptiveShot(ball) {
  var fast = Math.abs(ball.xVelocity) >= 15 ? 1 : 0;
  var angle = ball.yVelocity > 8 ? 2 : (ball.yVelocity < -8 ? 0 : 1);
  return fast * 3 + angle;
}

function recordOpponentAttack(s, isRight) {
  var landingX = s.ball.expectedLandingPointX;
  if (typeof landingX !== 'number' || landingX < 0 || landingX > GROUND_WIDTH) return;
  var landsOurs = isRight ? landingX >= NET_X : landingX <= NET_X;
  if (!landsOurs) return;

  var depth = landingToDepth(landingX, isRight);
  g_adapt.attackCount += 1;
  var n = g_adapt.attackCount;
  var delta = depth - g_adapt.landingMean;
  g_adapt.landingMean += delta / n;
  g_adapt.landingM2 += delta * (depth - g_adapt.landingMean);
  if (g_adapt.landingEMA === null) g_adapt.landingEMA = depth;
  else g_adapt.landingEMA += ADAPT_CFG.EMA_RATE * (depth - g_adapt.landingEMA);

  g_adapt.recentDepths.push(depth);
  if (g_adapt.recentDepths.length > ADAPT_CFG.RECENT_SIZE) g_adapt.recentDepths.shift();
  var zone = clamp(Math.floor(depth / (NET_X / 3)), 0, 2);
  g_adapt.zoneCounts[zone] += 1;

  var shot = classifyAdaptiveShot(s.ball);
  g_adapt.shotCounts[shot] += 1;
  if (shot >= 3) g_adapt.fastCount += 1;
  if (shot % 3 === 2) g_adapt.downCount += 1;
  if (shot % 3 === 1) g_adapt.flatCount += 1;
  g_adapt.lastAttackTick = s.tick;
}

function observeOpponentPattern(s) {
  var isRight = s.side === 'RIGHT';
  if (g_adapt.side === null) g_adapt.side = s.side;

  var score = s.meta && s.meta.score ? s.meta.score : null;
  var scoreSelf = score && typeof score.self === 'number' ? score.self : null;
  var scoreOpp = score && typeof score.opp === 'number' ? score.opp : null;
  var scoreReset = (scoreSelf !== null && g_adapt.lastScoreSelf !== null &&
                    scoreSelf < g_adapt.lastScoreSelf) ||
                   (scoreOpp !== null && g_adapt.lastScoreOpp !== null &&
                    scoreOpp < g_adapt.lastScoreOpp);
  if (g_adapt.side !== s.side || scoreReset) resetAdaptiveLearning(s.side);

  var rallyFrame = s.meta && typeof s.meta.rallyFrameCount === 'number' ?
    s.meta.rallyFrameCount : null;
  if (rallyFrame !== null && g_adapt.lastRallyFrame !== null &&
      rallyFrame < g_adapt.lastRallyFrame) {
    // 새 랠리에서는 순간 감지 상태만 해제하고, 누적 패턴은 보존한다.
    g_adapt.attackActive = false;
    g_fast_attack_until = -1;
    g_fast_attack_policy = null;
  }

  var towardUs = isRight ? s.ball.xVelocity > 0 : s.ball.xVelocity < 0;
  var nearOpp = Math.abs(s.ball.x - s.opp.x) <= ADAPT_CFG.HIT_X_RANGE &&
                Math.abs(s.ball.y - s.opp.y) <= ADAPT_CFG.HIT_Y_RANGE;
  var onOppHalf = isRight ? s.ball.x <= NET_X + 48 : s.ball.x >= NET_X - 48;
  var deviated = false;

  if (g_prev !== null && g_prev_tick !== null) {
    var dt = s.tick - g_prev_tick;
    if (dt > 0 && dt <= 12) {
      var predicted = ballAfter(g_prev.ball, dt);
      deviated = Math.abs(predicted.x - s.ball.x) > 2 ||
        Math.abs(predicted.yV - s.ball.yVelocity) > 3 ||
        Math.abs(predicted.xV - s.ball.xVelocity) > 3;
    }
  }

  var powerPose = s.opp.state === 2 && s.ball.isPowerHit === true;
  var attackSignal = towardUs && nearOpp && onOppHalf && (deviated || powerPose);
  if (attackSignal && !g_adapt.attackActive &&
      s.tick - g_adapt.lastAttackTick >= Math.max(2, g_group)) {
    recordOpponentAttack(s, isRight);
  }
  if (attackSignal) g_adapt.attackActive = true;
  else if (!towardUs) g_adapt.attackActive = false;

  g_adapt.lastRallyFrame = rallyFrame;
  if (scoreSelf !== null) g_adapt.lastScoreSelf = scoreSelf;
  if (scoreOpp !== null) g_adapt.lastScoreOpp = scoreOpp;
}

/* === [ADAPT-4] 표본 수 + 코스 반복도 + 분산으로 패턴 신뢰도 계산 === */
function adaptiveConfidence() {
  var n = g_adapt.attackCount;
  if (n < ADAPT_CFG.MIN_SAMPLES) return 0;
  var sample = clamp((n - ADAPT_CFG.MIN_SAMPLES + 1) /
    (ADAPT_CFG.FULL_SAMPLES - ADAPT_CFG.MIN_SAMPLES + 1), 0, 1);
  var maxZone = Math.max(g_adapt.zoneCounts[0], g_adapt.zoneCounts[1],
                         g_adapt.zoneCounts[2]);
  var dominance = maxZone / n;
  var repeat = clamp((dominance - 0.34) / 0.46, 0, 1);
  var variance = n > 1 ? g_adapt.landingM2 / (n - 1) : 99999;
  var deviation = Math.sqrt(Math.max(0, variance));
  var stability = clamp((82 - deviation) / 62, 0, 1);
  var maxShot = 0;
  for (var i = 0; i < g_adapt.shotCounts.length; i++) {
    if (g_adapt.shotCounts[i] > maxShot) maxShot = g_adapt.shotCounts[i];
  }
  var shotRepeat = clamp((maxShot / n - 0.17) / 0.58, 0, 1);
  return sample * (0.25 + 0.75 * Math.max(repeat, stability, shotRepeat * 0.75));
}

/* === [ADAPT-5] 신뢰도가 높을 때만 v5의 방어 위치를 학습 코스 쪽으로 보정 === */
function adaptiveDefenseTarget(s, baseTarget, minX, maxX) {
  var confidence = adaptiveConfidence();
  if (confidence <= 0 || g_adapt.landingEMA === null) return baseTarget;

  var recentSum = 0;
  for (var i = 0; i < g_adapt.recentDepths.length; i++) recentSum += g_adapt.recentDepths[i];
  var recentMean = g_adapt.recentDepths.length ?
    recentSum / g_adapt.recentDepths.length : g_adapt.landingMean;
  var learnedDepth = g_adapt.landingMean * 0.25 +
                     recentMean * 0.25 + g_adapt.landingEMA * 0.50;
  var learnedX = depthToLanding(learnedDepth, s.side === 'RIGHT');
  var fastRate = g_adapt.attackCount ? g_adapt.fastCount / g_adapt.attackCount : 0;
  // 빠른 공격 비율이 높을수록 예측 위치에 조금 더 일찍 붙는다.
  var speedCommit = 0.90 + fastRate * 0.10;
  var blend = Math.min(ADAPT_CFG.MAX_BLEND,
    ADAPT_CFG.MAX_BLEND * confidence * speedCommit);
  var shift = clamp((learnedX - baseTarget) * blend,
                    -ADAPT_CFG.MAX_SHIFT, ADAPT_CFG.MAX_SHIFT);
  return clamp(baseTarget + shift, minX, maxX);
}

/* 디버그/브리핑용: 게임 중 현재 학습된 능력치를 읽을 수 있다. */
function getAdaptiveStats() {
  var n = g_adapt.attackCount;
  var zone = 0;
  if (g_adapt.zoneCounts[1] > g_adapt.zoneCounts[zone]) zone = 1;
  if (g_adapt.zoneCounts[2] > g_adapt.zoneCounts[zone]) zone = 2;
  var zoneNames = ['BACK', 'MIDDLE', 'FRONT'];
  var predictedX = g_adapt.landingEMA === null ? null :
    depthToLanding(g_adapt.landingEMA, g_adapt.side === 'RIGHT');
  return {
    samples: n,
    confidence: Math.round(adaptiveConfidence() * 100),
    favoriteZone: n ? zoneNames[zone] : 'UNKNOWN',
    predictedLandingX: predictedX === null ? null : Math.round(predictedX),
    fastRate: n ? Math.round(g_adapt.fastCount * 100 / n) : 0,
    flatRate: n ? Math.round(g_adapt.flatCount * 100 / n) : 0,
    downRate: n ? Math.round(g_adapt.downCount * 100 / n) : 0
  };
}

function updateTouches(s) {
  var ballOnLeft = s.ball.x < NET_X;
  if (g_prev_ball_on_left !== null && ballOnLeft !== g_prev_ball_on_left) g_touches = 0;
  g_prev_ball_on_left = ballOnLeft;
  if (s.meta.rallyFrameCount < 4) { g_touches = 0; return; }
  if (g_prev === null) return;
  var predicted = ballAfter(g_prev.ball, s.tick - g_prev_tick);
  var deviated = Math.abs(predicted.x - s.ball.x) > 2 ||
    Math.abs(predicted.yV - s.ball.yVelocity) > 2;
  if (deviated) {
    var nearMe = Math.abs(s.ball.x - s.self.x) < 90 && Math.abs(s.ball.y - s.self.y) < 110;
    var myHalf = s.side === 'LEFT' ? s.ball.x < NET_X + 40 : s.ball.x > NET_X - 40;
    if (nearMe && myHalf) g_touches += 1;
  }
}

function walkTo(targetX, myPredX) {
  var dx = targetX - myPredX;
  if (dx > -7 && dx < 7) return 0;
  var step = WALK_SPEED * g_group;
  var best = 0, bestErr = Math.abs(dx);
  if (Math.abs(dx - step) < bestErr) { best = 1; bestErr = Math.abs(dx - step); }
  if (Math.abs(dx + step) < bestErr) best = -1;
  return best;
}

function fallbackAction(s) {
  var x = 0;
  var dx = s.ball.expectedLandingPointX - s.self.x;
  if (Math.abs(dx) > 8) x = dx > 0 ? 1 : -1;
  return { x: x, y: 0, hit: 0 };
}

/* ══════════════════════════════════════════════════════════════════════════
 * [ST] 느린 썬더 — 파워히트 자세(state 2)의 무입력 2차 파워히트
 *
 * 엔진 사실 두 가지에만 기댄다. 둘 다 정상 동작이고 경계 검사 버그가 아니다.
 *   1) 파워히트를 하면 자세가 state 2 로 10프레임 유지된다.
 *      (delayBeforeNextFrame 5칸 + frameNumber 5칸)
 *   2) 공을 튕길 때 엔진은 hit 입력이 아니라 '지금 state 2 인가'만 본다.
 *      그래서 그 10프레임 안에 공이 히트박스를 나갔다 다시 들어오면
 *      입력 없이 파워히트 공식이 한 번 더 적용된다. 각도는 그 프레임의 y 입력.
 *
 * 노림수: 네트 근처에서 수직찍기로 공을 네트 상단(y 176~192)에 맞춘다.
 *   -> 엔진이 yV 부호를 뒤집어 공이 튕겨 올라온다
 *   -> 아직 state 2 인 나에게 되돌아와 2차 파워히트, vy 가 또 2배
 *   -> 공이 네트 '위로'(y < 176) 넘어가 상대 코트 앞쪽에 꽂힌다
 * 네트를 관통하는 게 아니라 정상적으로 넘어간다.
 *
 * 안전장치: 발동 전에 stSim() 으로 끝까지 굴려보고 (a) 상대 코트에 떨어지고
 * (b) 상대가 걸어서 못 닿는 경우에만 시퀀스를 시작한다. 하나라도 어긋나면
 * null 을 돌려주고 기존 v5_3 로직이 그대로 돌아간다.
 * ══════════════════════════════════════════════════════════════════════════ */
var ST_CFG = {
  ON: 1,             /* 켜 둠. 물리적으로는 실재한다 — bot-dev/probe_slowthunder.mjs 에서
                      * 네트 상단 반사 + state 2 무입력 2차 파워히트로 8프레임 만에
                      * x=242 착지를 프레임 단위로 확인했다(네트를 관통하는 게 아니라
                      * y=156 에서 위로 넘어간다).
                      * 다만 실전 발동률은 매우 낮다: 12경기에서 후보 140만 개를 굴려
                      * 2차가 걸린 것 39개, 상대가 못 닿는 것 0개였다. 접촉 창이 x 2px
                      * 수준으로 좁고, 대회는 3프레임마다 한 번만 결정하므로 접촉 프레임을
                      * 1프레임 단위로 맞출 수 없기 때문이다.
                      * 끄려면 0. 끄면 decide 비용이 눈에 띄게 준다. */
  MAX_LEAD: 26,      // 몇 프레임 앞까지 발동 기회를 뒤질지
  MIN_MARGIN: 30,    // 착지점이 상대에게서 이만큼은 떨어져야 발동
  MAX_LAND_FRAMES: 26 // 2차 타구가 이 안에 떨어져야 '결정타'로 친다
};
var g_st_plan = null;    // 발동 중인 시퀀스 (틱 단위 입력 배열)
var g_st_idx = 0;
var g_st_rally = -1;

/* --- 엔진과 같은 순서로 한 프레임 진행하는 최소 월드 모델 --- */
function stStepBall(b) {
  if (b.yV > 40) b.yV = 40; else if (b.yV < -40) b.yV = -40;   // 패치된 상한
  if (b.x + b.xV < 0 || b.x + b.xV > GROUND_WIDTH) b.xV = -b.xV;
  if (b.y + b.yV < 0) b.yV = 1;
  if (Math.abs(b.x - NET_X) < NET_HALF_W && b.y > NET_TOP_Y) {
    if (b.y <= NET_TOP_BOTTOM_Y) { if (b.yV > 0) b.yV = -b.yV; }
    else if (b.x < NET_X) b.xV = -Math.abs(b.xV);
    else b.xV = Math.abs(b.xV);
  }
  if (b.y + b.yV > BALL_GROUND_Y) { b.landed = true; return true; }
  b.y += b.yV; b.x += b.xV; b.yV += 1;
  return false;
}
function stStepPlayer(p, act, isRight) {
  if (p.state === 0 || p.state === 1 || p.state === 2) p.x += act.x * 6;
  var lo = isRight ? NET_X + PLAYER_HALF : PLAYER_HALF;
  var hi = isRight ? GROUND_WIDTH - PLAYER_HALF : NET_X - PLAYER_HALF;
  if (p.x < lo) p.x = lo; else if (p.x > hi) p.x = hi;
  if (p.state < 3 && act.y === -1 && p.y === PLAYER_GROUND_Y) {
    p.yV = -16; p.state = 1; p.frameNo = 0;
  }
  p.y += p.yV;
  if (p.y < PLAYER_GROUND_Y) p.yV += 1;
  else if (p.y > PLAYER_GROUND_Y) { p.yV = 0; p.y = PLAYER_GROUND_Y; p.frameNo = 0; p.state = 0; }
  if (act.hit === 1 && p.state === 1) { p.delay = 5; p.frameNo = 0; p.state = 2; }
  if (p.state === 2) {
    if (p.delay < 1) { p.frameNo += 1; if (p.frameNo > 4) { p.frameNo = 0; p.state = 1; } }
    else p.delay -= 1;
  }
}
/* 충돌 처리 — 엔진의 processCollisionBetweenBallAndPlayer 와 같은 식 */
function stCollide(b, p, act) {
  if (b.x < p.x) b.xV = -idiv(Math.abs(b.x - p.x), 3);
  else if (b.x > p.x) b.xV = idiv(Math.abs(b.x - p.x), 3);
  if (b.xV === 0) b.xV = 0;                      // rand 는 예측 불가 -> 0 으로 보수적
  var av = Math.abs(b.yV);
  b.yV = -av; if (av < 15) b.yV = -15;
  if (p.state === 2) {
    b.xV = (b.x < NET_X ? 1 : -1) * (Math.abs(act.x) + 1) * 10;
    b.yV = Math.abs(b.yV) * act.y * 2;
    b.power = true;
  } else b.power = false;
}

/*
 * 시퀀스 하나를 끝까지 굴려본다.
 * @return {null|{landX,frames,doubles}} doubles = 무입력 2차 파워히트 횟수
 */
function stSim(s, plan, isRight) {
  var b = { x: s.ball.x, y: s.ball.y, xV: s.ball.xVelocity, yV: s.ball.yVelocity, landed: false };
  var p = { x: s.self.x, y: s.self.y, yV: 0, state: s.self.state, delay: 0, frameNo: 0 };
  if (p.state !== 0) return null;                 // 지상에서만 시작한다
  var latched = false, leftBox = false, doubles = 0, firstPower = false, doubleFrame = -1;
  var contactFrame = -1, touchFrame = -1;
  for (var f = 0; f < 45; f++) {
    var act = plan[idiv(f, g_group)] || { x: 0, y: 0, hit: 0 };
    if (stStepBall(b)) return { landX: b.x, frames: f + 1, doubles: doubles,
                                firstPower: firstPower, doubleFrame: doubleFrame < 0 ? 0 : doubleFrame,
                                contactFrame: contactFrame < 0 ? 0 : contactFrame,
                                touchFrame: touchFrame };
    stStepPlayer(p, act, isRight);
    var touch = Math.abs(b.x - p.x) <= PLAYER_HALF && Math.abs(b.y - p.y) <= PLAYER_HALF;
    if (touch) {
      if (!latched) {
        var wasPose = p.state === 2 && firstPower;
        if (touchFrame < 0) touchFrame = f;
        stCollide(b, p, act);
        if (b.power && wasPose && leftBox) { doubles++; if (doubleFrame < 0) doubleFrame = f; }
        if (b.power && !firstPower) { firstPower = true; contactFrame = f; }
        latched = true; leftBox = false;
      }
    } else { latched = false; leftBox = true; }
  }
  return null;
}

/*
 * 발동 가능한 시퀀스를 찾는다. 없으면 null.
 *
 * 타이밍이 핵심이다. 점프는 y(k) = 244 - 16k + k(k-1)/2 로 올라가서
 * k=11~12 프레임에 y≈120 이 된다. 수직찍기는 그 무렵 공과 만나야 하므로
 * "몇 틱 기다렸다 점프하고, 점프 뒤 몇 틱에 때리는가"를 둘 다 뒤져야 한다.
 * 공이 언제 오는지는 상황마다 다르니 시뮬레이터에게 맡기고 전수로 돌린다.
 */
function findSlowThunder(s, isRight) {
  if (!ST_CFG.ON) return null;
  if (s.self.state !== 0) return null;
  var ball = s.ball;
  var ours = isRight ? ball.x > NET_X : ball.x < NET_X;
  if (!ours) return null;
  if (4 - g_touches < 2) return null;
  var distNet = isRight ? s.self.x - NET_X : NET_X - s.self.x;
  if (distNet < 12 || distNet > 90) return null;

  var oppMinX = isRight ? PLAYER_HALF : NET_X + PLAYER_HALF;
  var oppMaxX = isRight ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF;
  var best = null;

  for (var jd = 0; jd <= 5; jd++) {          // 점프까지 기다리는 틱 수
    for (var hd = 1; hd <= 6; hd++) {        // 점프 후 타격까지의 틱 수
      for (var jx = -1; jx <= 1; jx++) {     // 점프 중 좌우 미세조정
        for (var y2 = 1; y2 >= -1; y2--) {   // 2차 파워히트 각도
         /* 되튄 공을 다시 만나려면 자세 유지 구간에도 움직여야 한다.
          * 네트 상단에 맞은 공은 위로 튕기면서 계속 네트 쪽으로 가므로,
          * 보통은 네트 쪽으로 따라붙어야 히트박스 안에 들어온다. */
         for (var x3 = 1; x3 >= -1; x3--) {
          var plan = [];
          var i;
          for (i = 0; i < jd; i++) plan.push({ x: jx, y: 0, hit: 0 });
          plan.push({ x: jx, y: -1, hit: 0 });                 // 점프
          for (i = 1; i < hd; i++) plan.push({ x: jx, y: 0, hit: 0 });
          plan.push({ x: 0, y: 1, hit: 1 });                   // 수직찍기
          for (i = 0; i < 4; i++) plan.push({ x: x3, y: y2, hit: 0 }); // 따라붙기 + 2차 각도
          var r = stSim(s, plan, isRight);
          if (!r || !r.doubles) continue;
          if (r.frames > ST_CFG.MAX_LAND_FRAMES + jd * g_group + hd * g_group) continue;
          var inOpp = isRight ? r.landX < NET_X : r.landX > NET_X;
          if (!inOpp) continue;
          if (r.landX <= oppMinX + 8 || r.landX >= oppMaxX - 8) continue;
          // 2차 타구가 나간 뒤부터 착지까지 상대가 걸어서 닿는가
          var margin = Math.abs(r.landX - s.opp.x) - WALK_SPEED * (r.frames - r.doubleFrame);
          if (margin < ST_CFG.MIN_MARGIN) continue;
          var score = margin * 2 - (r.frames - r.doubleFrame) * 6;
          if (!best || score > best.score) best = { plan: plan, score: score, info: r };
         }
        }
      }
    }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════
 * [QA] 속공 + 타점 낮추기 — 시뮬레이션으로 검증된 공격
 *
 * 나무위키 분류의 '속공'(리시브 후 아직 올라가는 공을 바로 반격)과
 * '타점 낮추기 / 점프 터치'(점프 중 무빙으로 접촉 높이를 조절)를 한 덩어리로
 * 구현한다. 둘은 사실 같은 문제다 — "언제 점프해서 어느 높이에서 어떤 각도로
 * 칠 것인가". 그래서 그 셋을 전부 전수로 뒤지고, 위 [ST]가 쓰는 것과 같은
 * 월드 모델로 끝까지 굴려본 뒤 이기는 것만 고른다.
 *
 * 접촉 높이가 중요한 이유(규칙 §6 표): 수평 강타(y=0)는 접촉 y=100~110 이면
 * 네트 여유가 +21~31 이지만 y=136 이면 네트를 스친다. 즉 같은 각도라도
 * 어느 높이에서 만나느냐로 성패가 갈린다. 시뮬레이터가 이걸 자동으로 가른다.
 *
 * findFastAttack(v5_2의 [FAST-2])을 대체하지 않고 그 앞에 선다. 실측상
 * findFastAttack 은 11,281번 호출되어 21번만 발동해 사실상 죽어 있었다.
 * ══════════════════════════════════════════════════════════════════════════ */
var QA_CFG = {
  ON: 1,
  MIN_MARGIN: 26,   // 착지점이 상대 도달 범위보다 이만큼 밖이어야 발동
  MAX_FRAMES: 40,   // 이 안에 끝나는 공격만 (길면 상대가 정비한다)
  RISING_BONUS: 40  // 올라가는 공을 잡아채면(=속공) 가산점
};
var g_qa_plan = null;
var g_qa_idx = 0;

/* 한 번의 파워히트로 끝나는 공격 시퀀스를 찾는다. 없으면 null. */
function findSimAttack(s, isRight) {
  if (!QA_CFG.ON) return null;
  if (s.self.state !== 0) return null;
  var ball = s.ball;
  var ours = isRight ? ball.x > NET_X : ball.x < NET_X;
  if (!ours) return null;
  if (4 - g_touches < 1) return null;

  var oppMinX = isRight ? PLAYER_HALF : NET_X + PLAYER_HALF;
  var oppMaxX = isRight ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF;
  var rising = ball.yVelocity < 0;            // 올라가는 공 = 속공 기회
  var best = null;

  for (var jd = 0; jd <= 4; jd++) {           // 점프까지 기다리는 틱
    for (var hd = 1; hd <= 5; hd++) {         // 점프 후 타격까지의 틱 (=접촉 높이)
      for (var jx = -1; jx <= 1; jx++) {      // 접근 방향
        for (var sy = 1; sy >= -1; sy--) {    // 스매시 각도
          for (var sxi = 0; sxi < 2; sxi++) { // 0=빠름(x≠0), 1=느림(x=0)
            var sx = sxi === 0 ? (isRight ? -1 : 1) : 0;
            var plan = [], i;
            for (i = 0; i < jd; i++) plan.push({ x: jx, y: 0, hit: 0 });
            plan.push({ x: jx, y: -1, hit: 0 });
            for (i = 1; i < hd; i++) plan.push({ x: jx, y: 0, hit: 0 });
            plan.push({ x: sx, y: sy, hit: 1 });
            plan.push({ x: sx, y: sy, hit: 1 });
            var r = stSim(s, plan, isRight);
            if (!r || !r.firstPower) continue;      // 파워히트가 안 걸림
            if (r.doubles) continue;                // 2차가 걸리면 예측이 흐트러진다
            if (r.frames > QA_CFG.MAX_FRAMES) continue;
            var inOpp = isRight ? r.landX < NET_X : r.landX > NET_X;
            if (!inOpp) continue;
            if (r.landX <= oppMinX + 8 || r.landX >= oppMaxX - 8) continue;
            var flight = r.frames - r.contactFrame;
            var margin = Math.abs(r.landX - s.opp.x) - WALK_SPEED * flight - PLAYER_HALF;
            if (margin < QA_CFG.MIN_MARGIN) continue;
            var score = margin * 3 - flight * 5 - r.contactFrame * 2;
            if (rising) score += QA_CFG.RISING_BONUS;
            if (!best || score > best.score) best = { plan: plan, score: score, info: r };
          }
        }
      }
    }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════
 * [TC] 터치 / 점프 터치 — 지상 몸통 접촉을 '조준된 터치'로 바꾼다
 *
 * 문제: 엔진 실측상 내 접촉의 31~37%가 지상 몸통 접촉(state 0)이다. 이 접촉은
 *   ball.yVelocity = -max(|vy|, 15)        // 항상 위로, 크기는 못 고름
 *   ball.xVelocity = (|ball.x - player.x| / 3) | 0    // 최대 10
 * 라서 공이 거의 수직으로 뜨고, 5회 접촉 제한도 한 칸 먹는다. 그냥 버리는 접촉이다.
 *
 * 그런데 위 식을 보면 **가로 속도는 우리가 정할 수 있다**. 공이 몸의 어느 지점에
 * 맞느냐(|ball.x - player.x|)가 그대로 vx 가 된다. 가운데로 받으면 vx≈0 이라
 * 제자리에 뜨고, 가장자리(offset 30)로 받으면 vx=10 으로 흘려보낼 수 있다.
 * 나무위키의 '터치'와 '점프 터치'가 이것이다 — 점프해서 받으면 접촉 높이까지
 * 골라 다음 공을 어디로 띄울지 정할 수 있다.
 *
 * 그래서 접촉이 불가피할 때 '어디서 받을지'를 전수로 뒤져, 튄 공이
 *   (a) 상대 코트에 떨어져 못 받으면 최고,
 *   (b) 아니면 내가 다음에 때리기 좋은 자리·높이로 오도록
 * 고른다. [QA]가 공격을 못 찾았을 때만 돈다.
 * ══════════════════════════════════════════════════════════════════════════ */
var TC_CFG = {
  ON: 1,
  LOOKAHEAD: 12,   /* 접촉이 이 안에 예상될 때만 본다. 넓게 잡으면 수비를 통째로
                    * 가로채서 무너진다 — 22로 뒀을 때 승률이 51% -> 1% 였다. */
  WIN_MARGIN: 30   // 넘긴 공을 상대가 이만큼 못 미치면 '이기는 터치'
};

/*
 * 어차피 일어날 접촉 하나를, 그대로 넘어가서 득점하는 터치로 바꿀 수 있는지만 본다.
 *
 * 중요: 한 틱만 돌려주고 시퀀스를 물고 있지 않는다. 그리고 '다음 공격을 위한
 * 셋업 터치'는 넣지 않았다 — AC 의 기존 수비 판단보다 나은지 비교할 방법이 없어서
 * 켰더니 수비가 통째로 망가졌다. 확실히 득점하는 경우에만 끼어든다.
 */
function findTouchPlan(s, isRight) {
  if (!TC_CFG.ON) return null;
  if (s.self.state !== 0) return null;
  var ball = s.ball;
  var ours = isRight ? ball.x > NET_X : ball.x < NET_X;
  if (!ours) return null;
  if (ball.yVelocity <= 0) return null;          // 내려오는 공만
  if (4 - g_touches < 1) return null;

  var oppMinX = isRight ? PLAYER_HALF : NET_X + PLAYER_HALF;
  var oppMaxX = isRight ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF;
  var best = null;

  /* 접촉 지점을 고르는 것이 전부다: 공이 몸의 어디에 맞느냐가 그대로
   * vx = (|ball.x - self.x| / 3) 이 된다. 가운데면 0, 가장자리면 10. */
  for (var jd = -1; jd <= 2; jd++) {             // -1 = 점프 안 함(그냥 터치)
    for (var a = -1; a <= 1; a++) {
      for (var b = -1; b <= 1; b++) {
        var plan = [], i;
        if (jd < 0) {
          plan.push({ x: a, y: 0, hit: 0 });
          for (i = 0; i < 5; i++) plan.push({ x: b, y: 0, hit: 0 });
        } else {
          for (i = 0; i < jd; i++) plan.push({ x: a, y: 0, hit: 0 });
          plan.push({ x: a, y: -1, hit: 0 });    // 점프 터치
          for (i = 0; i < 5; i++) plan.push({ x: b, y: 0, hit: 0 });
        }
        var r = stSim(s, plan, isRight);
        if (!r) continue;
        if (r.touchFrame < 0 || r.touchFrame > TC_CFG.LOOKAHEAD) continue;
        if (r.firstPower) continue;              // 파워히트는 [QA] 소관
        var inOpp = isRight ? r.landX < NET_X : r.landX > NET_X;
        if (!inOpp) continue;
        if (r.landX <= oppMinX + 8 || r.landX >= oppMaxX - 8) continue;
        var flight = r.frames - r.touchFrame;
        var margin = Math.abs(r.landX - s.opp.x) - WALK_SPEED * flight - PLAYER_HALF;
        if (margin < TC_CFG.WIN_MARGIN) continue;
        var score = margin * 4 - flight;
        if (!best || score > best.score) best = { plan: plan, score: score, info: r };
      }
    }
  }
  return best;
}

function counterOpponentFastServe(s, minX, maxX) {
  var rally = s.meta && typeof s.meta.rallyFrameCount === 'number' ?
    s.meta.rallyFrameCount : 0;
  var isRight = s.side === 'RIGHT';
  var sampleCount = g_adapt.attackCount;
  if (sampleCount >= 6) {
    var fastShare = g_adapt.fastCount / sampleCount;
    var middleShare = g_adapt.zoneCounts[1] / sampleCount;
    var backShare = g_adapt.zoneCounts[0] / sampleCount;
    var downShare = g_adapt.downCount / sampleCount;
    /* 반복 찍기 없이 빠른 다코스를 쓰는 상대는 깊은 대기 리시브를 역이용한다. */
    if (downShare < 0.05 &&
        ((fastShare > 0.45 && middleShare < 0.70) ||
         (backShare > 0.50 && fastShare < 0.45))) {
      g_serve_counter_suppressed = true;
    }
  }
  var newRally = g_serve_counter_last_rally === null ||
    rally < g_serve_counter_last_rally;
  if (newRally || rally <= 2) {
    var player2Serves = !!(s.meta && s.meta.isPlayer2Serve);
    g_serve_counter_active = !g_serve_counter_suppressed &&
      (isRight ? !player2Serves : player2Serves);
  }
  g_serve_counter_last_rally = rally;

  if (g_serve_counter_suppressed) g_serve_counter_active = false;
  if (!g_serve_counter_active) return null;
  if (g_touches > 0) {
    g_serve_counter_active = false;
    return null;
  }

  var towardUs = isRight ? s.ball.xVelocity > 0 : s.ball.xVelocity < 0;
  var deep = isRight ? maxX : minX;
  var predictedAtApply = clamp(
    s.self.x + g_last_action.x * WALK_SPEED * g_group,
    minX, maxX
  );

  if (s.ball.xVelocity === 0) {
    return { x: walkTo(deep, predictedAtApply), y: 0, hit: 0 };
  }
  if (!towardUs || Math.abs(s.ball.xVelocity) < FAST_DEFENSE_CFG.MIN_SPEED ||
      s.ball.isPowerHit !== true) {
    g_serve_counter_active = false;
    return null;
  }

  var b = cloneBall(s.ball);
  var contact = null;
  for (var k = 1; k <= 30; k++) {
    if (stepBall(b)) break;
    if (Math.abs(b.x - deep) <= PLAYER_HALF &&
        Math.abs(b.y - PLAYER_GROUND_Y) <= PLAYER_HALF) {
      contact = { x: b.x, frames: k };
      break;
    }
  }
  if (contact === null) {
    g_serve_counter_active = false;
    return null;
  }

  if (contact.frames <= g_group + 2) {
    var armX = contact.x > predictedAtApply ? 1 :
      (contact.x < predictedAtApply ? -1 : (isRight ? -1 : 1));
    return { x: armX, y: -1, hit: 1 };
  }
  return { x: walkTo(deep, predictedAtApply), y: 0, hit: 0 };
}

function fastDefenseAction(s, minX, maxX) {
  var isRight = s.side === 'RIGHT';
  var ball = s.ball;
  var towardUs = isRight ? ball.xVelocity > 0 : ball.xVelocity < 0;
  var ballOnOppHalf = isRight ? ball.x <= NET_X + 25 : ball.x >= NET_X - 25;
  var oppAir = s.opp.state === 1 || s.opp.state === 2;
  var ballNearOpp = Math.abs(ball.x - s.opp.x) <= FAST_DEFENSE_CFG.PREJUMP_BALL_DX &&
    Math.abs(ball.y - s.opp.y) <= FAST_DEFENSE_CFG.PREJUMP_BALL_DY;
  var front = isRight ? NET_X + FAST_DEFENSE_CFG.FRONT_FROM_NET :
    NET_X - FAST_DEFENSE_CFG.FRONT_FROM_NET;
  var predictedAtApply = clamp(
    s.self.x + g_last_action.x * WALK_SPEED * g_group,
    minX, maxX
  );

  var n = g_adapt.attackCount;
  var variance = n > 1 ? g_adapt.landingM2 / (n - 1) : 99999;
  var learnedX = g_adapt.landingEMA === null ? null :
    depthToLanding(g_adapt.landingEMA, isRight);
  var repeatsCourse = learnedX !== null &&
    Math.abs(ball.expectedLandingPointX - learnedX) <=
      FAST_DEFENSE_CFG.PROFILE_LAND_TOL;
  var immediatePose = s.opp.state === 2 &&
    Math.abs(s.opp.x - NET_X) <= FAST_DEFENSE_CFG.PREJUMP_OPP_NET;
  var profiledPose = n >= FAST_DEFENSE_CFG.PROFILE_MIN && repeatsCourse &&
    variance <= FAST_DEFENSE_CFG.PROFILE_MAX_VARIANCE;
  var middleShare = n ? g_adapt.zoneCounts[1] / n : 0;
  if (n >= 2 && middleShare >= 0.75 && g_adapt.downCount === 0) {
    g_fast_def_profile_locked = true;
  }
  var stableFastProfile = n < 3 || g_fast_def_profile_locked;
  var aligned = Math.abs(predictedAtApply - front) <=
    WALK_SPEED * g_group + FAST_DEFENSE_CFG.PREJUMP_ALIGN;

  if (oppAir && ballOnOppHalf && ballNearOpp && aligned &&
      ball.y > 52 && ball.y < 224 && (immediatePose || profiledPose)) {
    return {
      x: walkTo(front, predictedAtApply),
      y: -1,
      hit: 0
    };
  }

  if (!towardUs || Math.abs(ball.xVelocity) < FAST_DEFENSE_CFG.MIN_SPEED) {
    return null;
  }

  /* 코스가 충분히 안정적인 상대는 빠른 공이 보인 즉시 통로를 선점한다. */
  if (stableFastProfile) {
    var fastPath = cloneBall(ball);
    for (var fp = 1; fp <= FAST_DEFENSE_CFG.CORRIDOR_HORIZON; fp++) {
      if (stepBall(fastPath)) break;
      var pathOnOurCourt = isRight ? fastPath.x >= NET_X - PLAYER_HALF :
        fastPath.x <= NET_X + PLAYER_HALF;
      if (pathOnOurCourt && fastPath.y >= FAST_DEFENSE_CFG.CORRIDOR_Y_LO &&
          fastPath.y <= FAST_DEFENSE_CFG.CORRIDOR_Y_HI) {
        return {
          x: walkTo(clamp(fastPath.x, minX, maxX), predictedAtApply),
          y: -1,
          hit: 0
        };
      }
    }
  }

  /* 분산이 큰 상대에게 성급히 점프하면 빈 코트가 생기므로 기존 수비를 보존한다. */
  if (!stableFastProfile) return null;

  var b = cloneBall(ball);
  var jumpContact = null;
  var diveContact = null;
  for (var k = 1; k <= FAST_DEFENSE_CFG.CORRIDOR_HORIZON; k++) {
    if (stepBall(b)) break;
    var onOurCourt = isRight ? b.x >= NET_X - PLAYER_HALF :
      b.x <= NET_X + PLAYER_HALF;
    if (!onOurCourt || b.y < FAST_DEFENSE_CFG.CORRIDOR_Y_LO ||
        b.y > FAST_DEFENSE_CFG.CORRIDOR_Y_HI) continue;

    var moveFrames = Math.max(0, k - g_group);
    var contactX = clamp(b.x, minX, maxX);
    var gap = Math.abs(contactX - predictedAtApply) - PLAYER_HALF;
    var age = k - g_group;
    if (jumpContact === null && age >= FAST_DEFENSE_CFG.JUMP_MIN_AGE &&
        age <= FAST_DEFENSE_CFG.JUMP_MAX_AGE &&
        Math.abs(jumpYAt(age) - b.y) <= FAST_DEFENSE_CFG.JUMP_TOL &&
        gap <= WALK_SPEED * moveFrames + 14) {
      jumpContact = { x: contactX, y: b.y, frames: k };
    }
    if (diveContact === null && b.y >= 140 &&
        gap <= DIVE_SPEED * Math.min(moveFrames, 12) + PLAYER_HALF) {
      diveContact = { x: contactX, y: b.y, frames: k };
    }
  }
  if (jumpContact !== null) {
    return {
      x: walkTo(jumpContact.x, predictedAtApply),
      y: -1,
      hit: 0
    };
  }

  if (diveContact !== null &&
      diveContact.frames <= FAST_DEFENSE_CFG.DIVE_MAX_FRAMES) {
    return { x: diveContact.x > predictedAtApply ? 1 : -1, y: 0, hit: 1 };
  }
  return null;
}

function decideCore(s) {
  var cfg = s.config || {};
  var tf = cfg.tickFrameGroupSize || 0;
  g_group = tf > 0 ? tf : 3;

  var isRight = s.side === 'RIGHT';
  var minX = isRight ? NET_X + PLAYER_HALF : PLAYER_HALF;
  var maxX = isRight ? GROUND_WIDTH - PLAYER_HALF : NET_X - PLAYER_HALF;
  var towardNet = isRight ? -1 : 1;

  updateTouches(s);
  observeOpponentPattern(s); // [ADAPT-6] 매 판단마다 새 상대 타격만 한 번 기록
  var me = s.self, ball = s.ball;

  /* [ST-1] 랠리가 바뀌면 진행 중이던 느린썬더 시퀀스를 버린다.
   * 남겨두면 다음 랠리 첫 틱에 엉뚱한 점프/타격이 나간다. */
  var stRally = s.meta ? s.meta.rallyFrameCount : 0;
  if (g_st_rally < 0 || stRally < g_st_rally) {
    g_st_plan = null; g_st_idx = 0; g_qa_plan = null; g_qa_idx = 0;
  }
  g_st_rally = stRally;

  /* [ST-2] 시퀀스 실행 중이면 그대로 흘려보낸다. 오픈루프라 중간에
   * 판단을 섞으면 타이밍이 깨진다. 끝나면 기존 로직으로 복귀. */
  if (g_st_plan !== null) {
    if (g_st_idx < g_st_plan.length) return g_st_plan[g_st_idx++];
    g_st_plan = null; g_st_idx = 0;
  }

  if (me.state >= 3) return { x: 0, y: 0, hit: 0 };

  /* [V6-SERVE] Reserve the first touch for a verified fast-serve return. */
  var serveDefense = counterOpponentFastServe(s, minX, maxX);
  if (serveDefense !== null) return serveDefense;

  /* [V6-CORRIDOR] Defence has priority over optional trick-shot plans. */
  var corridorDefense = fastDefenseAction(s, minX, maxX);
  if (corridorDefense !== null) return corridorDefense;

  /* [ST-3] 발동 검사. 자기 시뮬레이션이 '상대 코트에 꽂히고 상대가 못 닿는다'고
   * 할 때만 시작한다. 아니면 null 이라 아래 기존 v5_3 로직이 그대로 돈다. */
  var st = findSlowThunder(s, isRight);
  if (st !== null) {
    g_st_plan = st.plan; g_st_idx = 1;
    return st.plan[0];
  }

  /* [QA-1] 실행 중인 공격 시퀀스가 있으면 흘려보낸다 */
  if (g_qa_plan !== null) {
    if (g_qa_idx < g_qa_plan.length) return g_qa_plan[g_qa_idx++];
    g_qa_plan = null; g_qa_idx = 0;
  }
  /* [QA-2] 시뮬레이션이 '상대가 못 받는다'고 할 때만 공격을 건다 */
  var qa = findSimAttack(s, isRight);
  if (qa !== null) {
    g_qa_plan = qa.plan; g_qa_idx = 1;
    return qa.plan[0];
  }

  /* [TC] 어차피 일어날 접촉이 그대로 득점이 되는 경우에만 한 틱 개입한다.
   * 시퀀스를 물지 않으므로 다음 틱에는 다시 기존 판단이 돈다. */
  var tc = findTouchPlan(s, isRight);
  if (tc !== null) return tc.plan[0];

  var myPredX = clamp(me.x + g_last_action.x * WALK_SPEED * LATENCY_FRAMES, minX, maxX);

  if (me.state === 1 || me.state === 2) {
    var vy = estimateMyVy(s);
    var me0 = {
      x: me.x, y: me.y, vy: vy, state: me.state,
      delay: (me.state === 2 && me.frameNumber === 0) ? 3 : 0,
      frameNo: me.state === 2 ? me.frameNumber : 0,
      collFlag: (Math.abs(ball.x - me.x) <= PLAYER_HALF &&
                 Math.abs(ball.y - me.y) <= PLAYER_HALF)
    };
    var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };

    /* [FAST-3] 직전 시뮬레이션과 현재 궤적이 모두 안전할 때만 빠른 공격 유지. */
    if (g_fast_attack_policy !== null && g_fast_attack_until >= s.tick) {
      var fastScore = scoreAirAction(s, me0, first, g_fast_attack_policy, minX, maxX);
      if (fastScore !== null && fastScore > FAST_ATTACK_CFG.ABORT_SCORE) {
        g_air_policy = g_fast_attack_policy;
        return g_fast_attack_policy;
      }
      // 공 궤적이 예상과 달라지면 즉시 포기하고 기존 v5_1 공중 판단으로 복귀.
      g_fast_attack_until = -1;
      g_fast_attack_policy = null;
    }

    var curScore = null;
    if (g_air_policy !== null) curScore = scoreAirAction(s, me0, first, g_air_policy, minX, maxX);
    var pol = chooseAirPolicy(s, me0, minX, maxX);
    if (curScore !== null && curScore > -400) {
      if (pol === null || pol.score <= curScore + 15) return g_air_policy;
    }
    if (pol !== null && pol.score > -400) { g_air_policy = pol.action; return pol.action; }
    g_air_policy = null;
    var landingOurs = isRight ? ball.expectedLandingPointX >= NET_X
                              : ball.expectedLandingPointX <= NET_X;
    var moveTo = landingOurs ? clamp(ball.expectedLandingPointX, minX, maxX)
                             : (isRight ? NET_X + 108 : NET_X - 108);
    return { x: walkTo(moveTo, myPredX), y: 0, hit: 0 };
  }

  g_air_policy = null;
  g_fast_attack_until = -1;
  g_fast_attack_policy = null;
  var landingX = ball.expectedLandingPointX;
  var ballOurs = isRight ? landingX >= NET_X : landingX <= NET_X;
  var landFrames = framesToLanding(ball);
  var ballOnOurHalf = isRight ? ball.x >= NET_X : ball.x <= NET_X;
  var oppMayHit = CFG.BAND === 1 && !ballOnOurHalf && Math.abs(ball.x - s.opp.x) < 130;
  var standbyC = isRight ? NET_X + 108 : NET_X - 108;

  if (!ballOurs || oppMayHit) {
    var oppImminent = s.opp.state === 1 || s.opp.state === 2 ||
      (Math.abs(ball.x - s.opp.x) < 90 && Math.abs(ball.y - s.opp.y) < 130);
    var standbyT;
    if (oppImminent) {
      var originalDefense = defenseTarget(s, minX, maxX, standbyC);
      standbyT = adaptiveDefenseTarget(s, originalDefense, minX, maxX);
    }
    else if (!ballOurs) standbyT = adaptiveDefenseTarget(s, standbyC, minX, maxX);
    else standbyT = clamp(landingX, standbyC - 45, standbyC + 45);
    return { x: walkTo(standbyT, myPredX), y: 0, hit: 0 };
  }

  /* [FAST-4] 수비 분기가 끝난 뒤에만 빠른 공격을 검사한다. */
  var fastAttack = findFastAttack(s, minX, maxX);
  if (fastAttack !== null) {
    g_fast_attack_policy = fastAttack.smash;
    g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS;
    g_air_policy = fastAttack.smash;
    return { x: fastAttack.jx, y: -1, hit: 1 };
  }

  var kill = findKillJump(s, minX, maxX);
  if (kill !== null) { g_air_policy = kill.smash; return { x: kill.jx, y: -1, hit: 0 }; }

  var icept = findIntercept(s, myPredX, minX, maxX);
  if (icept !== null) {
    var jx = walkTo(icept.targetX, myPredX);
    return { x: jx, y: icept.jump ? -1 : 0, hit: 0 };
  }

  var offset;
  if (g_touches >= 3) offset = 18;
  else {
    var upV = Math.max(15, Math.abs(ballAfter(ball, landFrames - 1).yV));
    var flight = 2 * upV + 2;
    var hoverX = isRight ? NET_X + 12 : NET_X - 12;
    var needXv = (hoverX - landingX) / flight;
    offset = clamp(Math.round(3 * Math.abs(needXv)) + 1, 4, 26);
  }
  var targetX = clamp(landingX - towardNet * offset, minX, maxX);
  var dx = targetX - myPredX;
  var x = walkTo(targetX, myPredX);

  var dist = Math.abs(dx);
  if (landFrames < 24 && dist > WALK_SPEED * landFrames + 6 &&
      dist <= DIVE_SPEED * landFrames + 44 && (ball.y > 140 || landFrames <= 10)) {
    return { x: dx > 0 ? 1 : -1, y: 0, hit: 1 };
  }
  return { x: x, y: 0, hit: 0 };
}

function savePrev(s) {
  g_prev = {
    ball: { x: s.ball.x, y: s.ball.y, xVelocity: s.ball.xVelocity, yVelocity: s.ball.yVelocity },
    selfY: s.self.y
  };
  g_prev_tick = s.tick;
}

function decide(s) {
  var action;
  try { action = decideCore(s); } catch (e) { action = fallbackAction(s); }
  g_last_action = action;
  savePrev(s);
  return action;
}


decide.__v6 = {
  skills: [
    'quick-attack', 'contact-height', 'slow-thunder', 'aimed-touch',
    'fast-serve-receive', 'corridor-intercept', 'profile-prejump', 'emergency-dive'
  ],
  thunderServe: false,
  adaptiveStats: getAdaptiveStats
};
