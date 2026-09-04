'use strict';
/* NetCamper_v2 — 검증용 네트 캠퍼 v2 (bot-dev/blockcounter/make_camper_v2.mjs 생성, 기반 AdaptiveCounter_v5_2.js).
 * 상대 서브 동안 네트 옆(정규화 x=248)에 서서 급강하를 막고, 상대가 뒤로(착지 x≥330) 치는 것을 1회 보면
 * 캠프 지점을 x=272 로 옮겨 급강하(서서)와 평타(점프 요격)를 함께 막는다. 넘어오는 공은 엔진 규칙 롤아웃 플래너로 요격, 그 뒤 기반 봇 랠리.
 * knobs: {"NET_SPOT":248,"BACK_SPOT":272,"DEEP_X":330,"DEEP_N":1,"PLAN":1,"HORIZON":24,"SELF_SET":0,"LOB_MAX":45,"LOG":60,"REACT_JUMP":0,"PLAN_MAXK":8,"RET_PREF":2} */
var CamperBase = (function () {
'use strict';
/* AdaptiveCounter_v5_2
 * v5_1의 적응형 수비를 그대로 유지한다. 공격 시뮬레이션이 성공을 보장하는
 * 상황에서만 반박자 빠른 타격을 쓰고, 안전한 최대 하향 스파이크를 우선한다. */

var GROUND_WIDTH = 432;
var NET_X = 216;
var PLAYER_GROUND_Y = 244;
var BALL_GROUND_Y = 252;
var BALL_MAX_Y_VELOCITY = 40;
var PLAYER_HALF = 32;
var NET_HALF_W = 25;
var NET_TOP_Y = 176;
var NET_TOP_BOTTOM_Y = 192;
var WALK_SPEED = 6;
var DIVE_SPEED = 8;
var LATENCY_FRAMES = 1;

var CFG = { AIR_MIN: 3, AIR_MAX: 16, Y_LO: 120, Y_HI: 218, TOL: 26, BAND: 0 };

/* === [ADAPT-1] 적응 강도: 초반에는 v5 그대로, 표본이 쌓일수록 서서히 반영 === */
var ADAPT_CFG = {
  MIN_SAMPLES: 3,       // 이 횟수 전에는 학습값을 수비에 사용하지 않음
  FULL_SAMPLES: 12,     // 이 정도 관측하면 표본 신뢰도를 최대로 봄
  EMA_RATE: 0.34,       // 최근 공격 코스에 반응하는 속도
  MAX_BLEND: 0.62,      // 기존 v5 수비 판단을 최소 38% 보존
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

var g_prev = null;
var g_touches = 0;
var g_prev_ball_on_left = null;
var g_prev_tick = null;
var g_last_action = { x: 0, y: 0, hit: 0 };
var g_air_policy = null;
var g_group = 3;
var g_fast_attack_until = -1;
var g_fast_attack_policy = null;

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
  b.yV = clamp(b.yV, -BALL_MAX_Y_VELOCITY, BALL_MAX_Y_VELOCITY);
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
  if (me.state >= 3) return { x: 0, y: 0, hit: 0 };

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
  return decide;
})();
/* ── NetCamper_v2 래퍼: 네트 캠프 + "뒤로 치는 것을 배우면" 뒤까지 막는 요격 플래너 ──
 *   1) 상대 서브 공(자기 기준 x=56, y≤6)을 보면 캠프 지점에 서서 기다린다. 처음엔 네트 옆 NET_SPOT(248).
 *   2) 상대 파워히트가 오면 스냅샷의 expectedLandingPointX(정보)로 깊이를 기록한다. 깊은 킬(착지 x ≥ DEEP_X)을 DEEP_N 번 보면
 *      "뒤도 막는" 모드: 캠프 지점을 BACK_SPOT(272)으로 옮긴다. 이 지점은 급강하(착지 248)를 서서 막고 평타(388/+14)에는 +3 반응으로 점프가 닿는다.
 *   3) 공이 우리 쪽으로 오면(파워히트 또는 네트 통과) 요격 플래너: 엔진 규칙(걷기 6, 점프 -16.., 다이빙 -5/8px, 상자 32)을 그대로 굴려
 *      18개 매크로(x방향 × y방향 × 파워히트) 중 가장 좋은 리턴(네트 넘김·빠름·상대와 먼 착지 / 자기편 높은 세트)을 고른다. 못 닿으면 기반 봇.
 *   4) 우리가 공을 건드리면(자유낙하 예측과 어긋남) 캠프 종료 → 기반 봇(AC)이 랠리. 점수가 바뀌면 랠리 결과를 기록한다. */
var NET_SPOT = 248;    // 초기 캠프 지점(정규화, 네트 옆)
var BACK_SPOT = 272;  // 깊은 킬을 배운 뒤 캠프 지점(급강하 서서 블록 + 평타 점프 도달 구간 260~280; 실제로는 18px 격자라 270 에 선다)
var DEEP_X = 330;        // 공이 우리 코트에서 이 x 까지 날아가면(착지 전 경로의 최대 x) "뒤로 친 것". 착지점(ELP)만 보면 뒷벽에 맞고 되돌아오는 평타(Lion v5_1, ELP 64)를 놓친다
var DEEP_N = 1;        // 이만큼 보면 뒤 커버 시작(0=처음부터 BACK_SPOT)
var PLAN = 1;            // 1=요격 플래너 사용, 0=v1 처럼 공이 넘어오면 기반 봇에 바로 넘김
var HORIZON = 24;      // 플래너 롤아웃 프레임 수
var SELF_SET = 0;    // 1=자기편에 높게 띄우는 세트(≥30프레임 체공)를 느린 로브보다 선호
var LOB_MAX = 45;      // 네트를 넘기는 리턴이 이 프레임 안에 착지하면 "빠른 공"
var LOG = 60;              // 콘솔 로그 줄 수 상한(0=끔). 태그 '[bot NetCamper'
var REACT_JUMP = 0; // 1=캠프 중 상대가 점프(state 1·2)하면 즉시 점프(검증용 옵션, 기본 0)
var PLAN_MAXK = 8;  // 첫 접촉이 이 프레임보다 늦은(느린 공: AC 서브·로브) 계획은 버리고 기반 봇에 넘긴다
var RET_PREF = 2;    // 리턴 선호: 0=빠른 넘김 우선, 1=상대와 먼 착지 가중 ×3, 2=파워 리턴은 x입력 있는 쪽(vx 20, 천장 로브) 우선(기본; LionBC_v4 상대 요격 56/56 승)

var CAMP = {
  camping: false, lastScore: -1, back: DEEP_N <= 0, deepSeen: 0, nearSeen: 0, logged: 0,
  cur: null, prevBall: null, prevSelfY: 244, last: { x: 0, y: 0, hit: 0 },
  stats: { net: { n: 0, won: 0, touched: 0 }, back: { n: 0, won: 0, touched: 0 }, plans: {} }
};
var JUMP_Y = (function () { var a = [], y = 244, vy = -16; for (var m = 0; m < 40; m++) { y += vy; a.push(y); if (y < 244) vy += 1; else break; } return a; })();
var DIVE_Y = (function () { var a = [], y = 244, vy = -5; for (var m = 0; m < 20; m++) { y += vy; if (y >= 244) break; a.push(y); vy += 1; } return a; })();

function campLog(msg) { if (LOG > 0 && CAMP.logged < LOG) { CAMP.logged++; console.log('[bot NetCamper] ' + msg); } }

/* 공 1프레임(엔진 processCollisionBetweenBallAndWorldAndSetBallPosition 과 동일, 정규화 좌표는 좌우 대칭이라 그대로). 착지면 true */
function ballStep(b) {
  if (b.vy > 40) b.vy = 40; else if (b.vy < -40) b.vy = -40;
  var fx = b.x + b.vx; if (fx < 0 || fx > 432) b.vx = -b.vx;
  var fy = b.y + b.vy; if (fy < 0) b.vy = 1;
  if (Math.abs(b.x - 216) < 25 && b.y > 176) {
    if (b.y <= 192) { if (b.vy > 0) b.vy = -b.vy; }
    else { b.vx = b.x < 216 ? -Math.abs(b.vx) : Math.abs(b.vx); }
  }
  fy = b.y + b.vy;
  if (fy > 252) { b.y = 252; return true; }
  b.y = fy; b.x += b.vx; b.vy += 1;
  return false;
}
/* 착지 전까지 공이 도달하는 최대 x(뒷벽 반사 포함): 얼마나 뒤로 쳤는지 */
function pathMaxX(b0) {
  var b = { x: b0.x, y: b0.y, vx: b0.vx, vy: b0.vy }, m = b.x, n = 0;
  while (n < 150 && !ballStep(b)) { if (b.x > m) m = b.x; n++; }
  return m;
}
/* 플레이어 1프레임(processPlayerMovementAndSetPlayerPosition, 우측 플레이어 정규화: x∈[248,400]) */
function playerStep(p, a) {
  if (p.state === 4) { p.lie--; if (p.lie < -1) p.state = 0; return; }
  var vx = p.state < 3 ? a.x * 6 : p.dd * 8;
  p.x += vx; if (p.x < 248) p.x = 248; else if (p.x > 400) p.x = 400;
  if (p.state < 3 && a.y === -1 && p.y === 244) { p.vy = -16; p.state = 1; }
  p.y += p.vy;
  if (p.y < 244) p.vy += 1;
  else if (p.y > 244) { p.vy = 0; p.y = 244; if (p.state === 3) { p.state = 4; p.lie = 3; } else p.state = 0; }
  if (a.hit === 1) {
    if (p.state === 1) { p.state = 2; p.delay = 5; p.fn = 0; }
    else if (p.state === 0 && a.x !== 0) { p.state = 3; p.dd = a.x; p.vy = -5; }
  }
  if (p.state === 2) { if (p.delay < 1) { p.fn++; if (p.fn > 4) { p.fn = 0; p.state = 1; } } else p.delay--; }
}
/* 스냅샷의 플레이어 상태를 롤아웃용으로 복원(수직 속도는 점프/다이빙 궤적표에서 역산) */
function playerFrom(x, y, state, dd, prevY) {
  var p = { x: x, y: y, vy: 0, state: state, dd: dd || 1, lie: 1, delay: 5, fn: 0 };
  if (y < 244) {
    var asc = prevY >= 244 || y < prevY, tab = state === 3 ? DIVE_Y : JUMP_Y, m = -1;
    for (var k = 0; k < tab.length; k++) { if (tab[k] === y && ((asc && k <= tab.length / 2) || (!asc && k >= tab.length / 2))) { m = k; break; } }
    if (m < 0) for (k = 0; k < tab.length; k++) { if (tab[k] === y) { m = k; break; } }
    if (m < 0) m = 0;
    p.vy = (state === 3 ? -5 : -16) + m + 1;
  }
  return p;
}
/* 접촉 뒤 공 속도(processCollisionBetweenBallAndPlayer) → 착지까지 굴려 리턴 품질 점수 */
function returnScore(b, p, a, st, ox, k) {
  var nb = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
  if (nb.x < p.x) nb.vx = -((Math.abs(nb.x - p.x) / 3) | 0); else if (nb.x > p.x) nb.vx = (Math.abs(nb.x - p.x) / 3) | 0;
  var ay = Math.abs(nb.vy); nb.vy = ay < 15 ? -15 : -ay;
  if (st === 2) { nb.vx = -(Math.abs(a.x) + 1) * 10; nb.vy = Math.abs(nb.vy) * a.y * 2; }
  var n = 0; while (n < 150 && !ballStep(nb)) n++;
  var score;
  var far = Math.abs(nb.x - ox) * (RET_PREF === 1 ? 1.5 : 0.5);
  if (nb.x < 216) {
    score = n <= LOB_MAX ? 1000 + (LOB_MAX - n) * 10 + far : 700 + far;          // 네트를 넘김: 빠를수록, 상대와 멀수록
    if (RET_PREF === 2 && st === 2) score = 1000 + (a.x !== 0 ? 300 : 0) + far;   // 파워 리턴은 vx 20 쪽(천장 로브)이 실측 승률 우위
  } else score = (SELF_SET && n >= 30) ? 800 + n : 400 + Math.min(n, 60) * 2;    // 자기편: 체공이 길수록(기반 봇이 공격)
  return { score: score - k, landX: nb.x, frames: n, power: st === 2 };
}
/* 요격 플래너: 지연 1 프레임(첫 프레임은 직전 행동) 뒤 매크로를 HORIZON 프레임 유지했을 때 첫 접촉과 그 리턴을 평가.
 * only 가 있으면 그 매크로만 다시 굴린다(이미 고른 계획 유지: 틱마다 매크로가 바뀌면 점프 중 방향이 뒤집혀 접촉을 놓친다). */
function planIntercept(b0, p0, ox, last, only) {
  var best = null, xs = [-1, 0, 1], ys = [-1, 0, 1], hs = [0, 1];
  for (var hi = 0; hi < hs.length; hi++) for (var yi = 0; yi < ys.length; yi++) for (var xi = 0; xi < xs.length; xi++) {
    var a = only ? only : { x: xs[xi], y: ys[yi], hit: hs[hi] };
    if (only && (hi || yi || xi)) break;
    if (a.hit === 0 && a.y === 1) continue;                    // 아래 방향은 파워히트 때만 의미
    var b = { x: b0.x, y: b0.y, vx: b0.vx, vy: b0.vy };
    var p = { x: p0.x, y: p0.y, vy: p0.vy, state: p0.state, dd: p0.dd, lie: p0.lie, delay: p0.delay, fn: p0.fn };
    var col = Math.abs(b.x - p.x) <= 32 && Math.abs(b.y - p.y) <= 32;
    for (var k = 1; k <= HORIZON; k++) {
      var act = k === 1 ? last : a;
      if (ballStep(b)) break;
      playerStep(p, act);
      var c = Math.abs(b.x - p.x) <= 32 && Math.abs(b.y - p.y) <= 32;
      if (c && !col) {
        var r = returnScore(b, p, act, p.state, ox, k);
        if (!best || r.score > best.score) best = { score: r.score, a: a, k: k, bx: b.x, by: b.y, st: p.state, landX: r.landX, frames: r.frames, power: r.power };
        break;
      }
      col = c;
    }
  }
  return best;
}
function campEndRally(won) {
  var c = CAMP.cur; if (!c) return;
  var S = c.back ? CAMP.stats.back : CAMP.stats.net;
  S.n++; if (won) S.won++; if (c.touched) S.touched++;
  if (c.plan) { var P = CAMP.stats.plans[c.plan] || (CAMP.stats.plans[c.plan] = { n: 0, won: 0 }); P.n++; if (won) P.won++; }
  campLog('rally ' + (won ? 'WON' : 'lost') + ' spot=' + (c.back ? BACK_SPOT : NET_SPOT) + ' deep=' + c.deep + (c.elp !== undefined ? '(elp ' + c.elp + ' maxX ' + c.maxX + ')' : '') + ' plan=' + (c.plan || '-') + ' touched=' + c.touched + ' | net ' + CAMP.stats.net.won + '/' + CAMP.stats.net.n + ' back ' + CAMP.stats.back.won + '/' + CAMP.stats.back.n);
  CAMP.cur = null;
}
function decide(s) {
  var base = CamperBase(s);
  var isRight = s.side === 'RIGHT';
  var nx = function (x) { return isRight ? x : 432 - x; };
  var bx = nx(s.ball.x), by = s.ball.y, bvx = isRight ? s.ball.xVelocity : -s.ball.xVelocity, bvy = s.ball.yVelocity;
  var mx = nx(s.self.x), my = s.self.y, ox = nx(s.opp.x);
  var self0 = (s.meta.score.self | 0), opp0 = (s.meta.score.opp | 0), total = self0 + opp0;
  if (total !== CAMP.lastScore) {
    if (CAMP.lastScore >= 0 && CAMP.cur) campEndRally(self0 === CAMP.cur.self + 1);
    CAMP.lastScore = total; CAMP.camping = false; CAMP.cur = null; CAMP.prevBall = null;
  }
  var out = base;
  if (bvx === 0 && bx === 56 && by <= 6 && !CAMP.camping) {
    CAMP.camping = true; CAMP.prevBall = null;
    CAMP.cur = { self: self0, deep: null, back: CAMP.back, plan: null, macro: null, touched: false };
    if (CAMP.logged < 3) campLog('camping side=' + s.side + ' tick=' + s.tick + ' spot=' + (CAMP.back ? BACK_SPOT : NET_SPOT));
  }
  if (CAMP.camping && CAMP.cur) {
    var c = CAMP.cur;
    /* 정보: 상대 파워히트의 예상 착지점으로 "뒤로 쳤는지" 학습 */
    if (c.deep === null && s.ball.isPowerHit && bvx > 0) {
      var elp = nx(s.ball.expectedLandingPointX), mX = pathMaxX({ x: bx, y: by, vx: bvx, vy: bvy });
      if (mX >= 216) { c.deep = mX >= DEEP_X; c.elp = elp; c.maxX = mX; }   // 상대 쪽에 머무는 파워히트(자기 세트)는 킬이 아니다: 다음 틱에 다시 본다
      if (c.deep === true) CAMP.deepSeen++; else if (c.deep === false) CAMP.nearSeen++;
      if (c.deep === true && !CAMP.back && CAMP.deepSeen >= DEEP_N) { CAMP.back = true; campLog('back cover ON: deep kills seen ' + CAMP.deepSeen + ' (elp ' + elp + ', maxX ' + mX + ') → spot ' + BACK_SPOT); }
    }
    /* 우리(또는 누군가)가 공을 건드렸는지: 직전 스냅샷에서 3프레임 자유낙하 예측과 비교 */
    if (CAMP.prevBall) {
      var pb = { x: CAMP.prevBall.x, y: CAMP.prevBall.y, vx: CAMP.prevBall.vx, vy: CAMP.prevBall.vy }, landed = false;
      for (var f = 0; f < 3 && !landed; f++) landed = ballStep(pb);
      if (!landed && (pb.x !== bx || pb.y !== by) && (CAMP.prevBall.x >= 216 || (Math.abs(bx - mx) <= 60 && Math.abs(by - my) <= 60))) c.touched = true;   // 우리 쪽에 있던 공의 경로가 바뀌면 우리가 건드린 것
    }
    CAMP.prevBall = { x: bx, y: by, vx: bvx, vy: bvy };
    if (c.touched) { CAMP.camping = false; return base; }
    var elpN = nx(s.ball.expectedLandingPointX);
    /* 요격 대상: 우리 쪽에 있는 공, 우리 쪽으로 오는 파워히트, 또는 3프레임 안에 네트를 넘을 공. 상대 쪽에서 아직 튀는 공(상대가 다시 칠 수 있음)은 제외 */
    var coming = bx >= 216 || (bvx > 0 && elpN >= 216 && (s.ball.isPowerHit || bx + 3 * bvx >= 216));
    var x = 0, y = 0, hit = 0;
    /* 플래너는 뒤로 오는 공(착지 x ≥ DEEP_X)에만 쓴다. 네트 앞 급강하는 v1 처럼 기반 봇이 서서 막는 편이 낫다(Lion v4 상대 175/175 vs 플래너 37/57). */
    if (coming && PLAN && (c.deep === true || (s.ball.isPowerHit && bvx > 0 && pathMaxX({ x: bx, y: by, vx: bvx, vy: bvy }) >= DEEP_X))) {
      var dd = isRight ? s.self.divingDirection : -s.self.divingDirection;
      var p0 = playerFrom(mx, my, s.self.state, dd, CAMP.prevSelfY);
      var last = { x: isRight ? CAMP.last.x : -CAMP.last.x, y: CAMP.last.y, hit: CAMP.last.hit };
      var b0 = { x: bx, y: by, vx: bvx, vy: bvy };
      var best = c.macro ? planIntercept(b0, p0, ox, last, c.macro) : null;   // 이미 고른 계획이 아직 닿으면 유지
      if (!best) {
        best = planIntercept(b0, p0, ox, last, null);
        if (!c.plan && !c.noPlan) { c.noPlan = true; if (!best || best.k > PLAN_MAXK) campLog('no plan' + (best ? ' (slow k=' + best.k + ')' : '') + ' ball(' + bx + ',' + by + ' v' + bvx + ',' + bvy + ') me(' + mx + ',' + my + ' st' + s.self.state + ') last ' + JSON.stringify(last)); }
        if (best && best.k > PLAN_MAXK && !c.macro) best = null;   // 느린 공은 기반 봇
      }
      if (best) {
        x = best.a.x; y = best.a.y; hit = best.a.hit; c.macro = best.a;
        if (!c.plan) { c.plan = (best.a.y === -1 && p0.y === 244 ? 'jump' : best.a.hit && p0.state === 0 && best.a.x !== 0 ? 'dive' : best.a.hit ? 'hit' : 'walk') + (best.power ? '+power' : '') + '@' + best.k + '/y' + by; campLog('intercept ' + c.plan + ' contact(' + best.bx + ',' + best.by + ') st' + best.st + ' → land ' + best.landX + ' +' + best.frames + ' ball(' + bx + ',' + by + ' v' + bvx + ',' + bvy + ') me(' + mx + ',' + my + ') elp ' + elpN); }
        CAMP.prevSelfY = my; CAMP.last = { x: isRight ? x : -x, y: y, hit: hit };
        return CAMP.last;
      }
    }
    /* 공이 실제로 우리 쪽에 왔는데 요격 계획이 없으면 기반 봇에 넘긴다. 아직 상대 쪽에서 튀는 공이면 자리를 지킨다. */
    if (bx >= 216 || (s.ball.isPowerHit && bvx > 0 && elpN >= 216)) { CAMP.camping = false; CAMP.prevSelfY = my; CAMP.last = base; return base; }
    var spot = CAMP.back ? BACK_SPOT : NET_SPOT;
    /* 한 틱(3프레임)에 18px 움직이므로 ±2 허용으로는 270↔288 을 왕복한다. 움직여서 더 가까워질 때만 움직인다(도달 가능한 자리는 리셋 위치 396 기준 18px 격자: 252·270·288). */
    var dl = Math.abs(Math.max(248, mx - 18) - spot), dr = Math.abs(Math.min(400, mx + 18) - spot), d0 = Math.abs(mx - spot);
    if (dl < d0 && dl <= dr) x = -1; else if (dr < d0) x = 1;
    if (REACT_JUMP && s.opp.state >= 1 && s.opp.state <= 2 && my === 244) y = -1;
    out = { x: isRight ? x : -x, y: y, hit: 0 };
  }
  CAMP.prevSelfY = my; CAMP.last = out;
  return out;
}
decide.__camp = CAMP;
