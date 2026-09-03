'use strict';
/* ==========================================================================

 * Disaster_v1 adversarial training build
 * — OurBot_v11 thunder serve + AdaptiveCounter_v5_2 general play
 * — V13 fast-corridor defence, conditional pre-jump, and fast-serve counter
 *
 * Hardened in-place against DisasterCounter_v1 on 2026-09-02. The original
 * build_v12 generator is not present in this workspace, so this file is now
 * the authoritative standalone tournament source.

 * ========================================================================== */

/* ---------- OurBot_v11 thunder serve: intentionally preserved as hard priority ---------- */
var TH = {
  seenScore: -1,
  armed: false,
  dead: false,
  fEst: -1
};

var TH_YTABLE = (function () {
  var t = {}, y = 0, vy = 1;
  for (var k = 0; k < 20; k++) { y += vy; vy += 1; t[y] = k + 1; }
  return t;
})();

/* LEFT-normalised open-loop sequences captured and verified in OurBot_v11. */
var TH_SEQS = [
  null,
  [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[1,-1,0],[0,0,0],[1,0,0],[1,0,0],
   [1,0,0],[1,0,0],[1,0,0],[1,0,0],[0,-1,0],[0,0,0],[0,0,0],[1,-1,1],[0,0,0],[0,0,0],
   [0,0,0],[0,0,0],[0,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0]],
  [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],
   [1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],[-1,0,0],[-1,0,0],[0,0,0],[1,0,0],[1,0,0],
   [0,0,0],[0,-1,0],[1,-1,1],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[1,1,1],[0,1,0],
   [0,1,0],[0,1,0]]
];

/* Returns an action only while thunder owns the tick; otherwise null. */
function thunderAction(snapshot) {
  var s = snapshot;
  var isRight = s.side === 'RIGHT';
  var score = s.meta && s.meta.score ? s.meta.score : { self: 0, opp: 0 };
  var scoreTotal = (score.self || 0) + (score.opp || 0);
  if (scoreTotal !== TH.seenScore) {
    TH.seenScore = scoreTotal; TH.armed = false; TH.dead = false; TH.fEst = -1;
  }

  var bx = isRight ? 432 - s.ball.x : s.ball.x;
  var bvx = isRight ? -s.ball.xVelocity : s.ball.xVelocity;
  var myServeDrop = bvx === 0 && bx === 56;
  if (myServeDrop) {
    var fresh = s.ball.y === 0 ||
      (TH_YTABLE[s.ball.y] !== undefined && TH.fEst >= 0 && TH_YTABLE[s.ball.y] < TH.fEst);
    if (fresh) { TH.armed = false; TH.dead = false; TH.fEst = -1; }
  }

  if (TH.dead) return null;
  if (myServeDrop && s.ball.y === 0) {
    TH.armed = true; TH.fEst = -1;
    return { x: 0, y: 0, hit: 0 };
  }
  if (myServeDrop && TH_YTABLE[s.ball.y] !== undefined) {
    TH.fEst = TH_YTABLE[s.ball.y];
    TH.armed = true;
  } else if (TH.armed) {
    if (TH.fEst < 0) TH.armed = false;
    else TH.fEst += 3;
  }

  if (!TH.armed || TH.fEst < 0) return null;
  var phase = (3 - (TH.fEst % 3)) % 3;
  var tickIndex = ((TH.fEst - (TH.fEst % 3)) / 3) + 1;
  var planIndex = (phase + 2) % 3;
  var planTick = tickIndex - 1;
  var seq = TH_SEQS[planIndex];
  if (seq === null || planTick >= seq.length) {
    TH.dead = true; TH.armed = false;
    return null;
  }
  var e = seq[planTick];
  return isRight ? { x: -e[0], y: e[1], hit: e[2] } : { x: e[0], y: e[1], hit: e[2] };
}

/* AdaptiveCounter_v5_2
 * v5_1의 적응형 수비를 그대로 유지한다. 공격 시뮬레이션이 성공을 보장하는
 * 상황에서만 반박자 빠른 타격을 쓰고, 안전한 최대 하향 스파이크를 우선한다. */


/* [V6-ENSEMBLE] Profile A is the generation-13 no-Thunder counter policy:
 * it shut out Lion v3 and Adaptive v2 in checkpoint screening. Profile B is
 * the final Disaster policy, retained as a comeback mode against adversarial
 * mirrors. Mode changes only when a point has ended. */
var g_v6_current_profile = false;
var g_v6_profile_latched = false;
var g_v6_last_mode_self = null;
var g_v6_last_mode_opp = null;
var g_v6_loss_streak = 0;

function v6ApplyCounterProfile() {
  CFG.AIR_MIN = 4;
  CFG.AIR_MAX = 14;
  CFG.Y_LO = 113;
  CFG.Y_HI = 234;
  CFG.TOL = 20;
  CFG.BAND = 0;
  ADAPT_CFG.MIN_SAMPLES = 2;
  ADAPT_CFG.FULL_SAMPLES = 13;
  ADAPT_CFG.EMA_RATE = 0.34;
  ADAPT_CFG.MAX_BLEND = 0.62;
  ADAPT_CFG.MAX_SHIFT = 68;
  ADAPT_CFG.RECENT_SIZE = 8;
  ADAPT_CFG.HIT_X_RANGE = 105;
  ADAPT_CFG.HIT_Y_RANGE = 125;
  FAST_ATTACK_CFG.ARM_UNTILS = [2,3];
  FAST_ATTACK_CFG.MAX_CONTACT = 8;
  FAST_ATTACK_CFG.MAX_DROP = 14;
  FAST_ATTACK_CFG.DOWN_MAX_DROP = 12;
  FAST_ATTACK_CFG.COURT_MARGIN = 10;
  FAST_ATTACK_CFG.OPP_WINDOW = 2;
  FAST_ATTACK_CFG.COMMIT_TICKS = 15;
  FAST_ATTACK_CFG.ABORT_SCORE = -280;
  FAST_ATTACK_CFG.DOWN_BONUS = 145;
  FAST_ATTACK_CFG.EARLY_WEIGHT = 11;
  FAST_DEFENSE_CFG.MIN_SPEED = 15;
  FAST_DEFENSE_CFG.CORRIDOR_Y_LO = 104;
  FAST_DEFENSE_CFG.CORRIDOR_Y_HI = 225;
  FAST_DEFENSE_CFG.CORRIDOR_HORIZON = 44;
  FAST_DEFENSE_CFG.FRONT_FROM_NET = 63;
  FAST_DEFENSE_CFG.PREJUMP_BALL_DX = 114;
  FAST_DEFENSE_CFG.PREJUMP_BALL_DY = 136;
  FAST_DEFENSE_CFG.PREJUMP_OPP_NET = 132;
  FAST_DEFENSE_CFG.PREJUMP_ALIGN = 22;
  FAST_DEFENSE_CFG.PROFILE_MIN = 3;
  FAST_DEFENSE_CFG.PROFILE_MAX_VARIANCE = 2159;
  FAST_DEFENSE_CFG.PROFILE_LAND_TOL = 44;
  FAST_DEFENSE_CFG.JUMP_TOL = 27;
  FAST_DEFENSE_CFG.JUMP_MIN_AGE = 0;
  FAST_DEFENSE_CFG.JUMP_MAX_AGE = 16;
  FAST_DEFENSE_CFG.DIVE_MAX_FRAMES = 13;
}

function v6ApplyCurrentProfile() {
  CFG.AIR_MIN = 4;
  CFG.AIR_MAX = 12;
  CFG.Y_LO = 117;
  CFG.Y_HI = 240;
  CFG.TOL = 23;
  CFG.BAND = 0;
  ADAPT_CFG.MIN_SAMPLES = 2;
  ADAPT_CFG.FULL_SAMPLES = 16;
  ADAPT_CFG.EMA_RATE = 0.378;
  ADAPT_CFG.MAX_BLEND = 0.562;
  ADAPT_CFG.MAX_SHIFT = 53;
  ADAPT_CFG.RECENT_SIZE = 9;
  ADAPT_CFG.HIT_X_RANGE = 99;
  ADAPT_CFG.HIT_Y_RANGE = 127;
  FAST_ATTACK_CFG.ARM_UNTILS = [2,3];
  FAST_ATTACK_CFG.MAX_CONTACT = 11;
  FAST_ATTACK_CFG.MAX_DROP = 16;
  FAST_ATTACK_CFG.DOWN_MAX_DROP = 12;
  FAST_ATTACK_CFG.COURT_MARGIN = 10;
  FAST_ATTACK_CFG.OPP_WINDOW = 3;
  FAST_ATTACK_CFG.COMMIT_TICKS = 13;
  FAST_ATTACK_CFG.ABORT_SCORE = -280;
  FAST_ATTACK_CFG.DOWN_BONUS = 170;
  FAST_ATTACK_CFG.EARLY_WEIGHT = 11;
  FAST_DEFENSE_CFG.MIN_SPEED = 17;
  FAST_DEFENSE_CFG.CORRIDOR_Y_LO = 93;
  FAST_DEFENSE_CFG.CORRIDOR_Y_HI = 226;
  FAST_DEFENSE_CFG.CORRIDOR_HORIZON = 40;
  FAST_DEFENSE_CFG.FRONT_FROM_NET = 63;
  FAST_DEFENSE_CFG.PREJUMP_BALL_DX = 106;
  FAST_DEFENSE_CFG.PREJUMP_BALL_DY = 139;
  FAST_DEFENSE_CFG.PREJUMP_OPP_NET = 111;
  FAST_DEFENSE_CFG.PREJUMP_ALIGN = 18;
  FAST_DEFENSE_CFG.PROFILE_MIN = 3;
  FAST_DEFENSE_CFG.PROFILE_MAX_VARIANCE = 2056;
  FAST_DEFENSE_CFG.PROFILE_LAND_TOL = 30;
  FAST_DEFENSE_CFG.JUMP_TOL = 27;
  FAST_DEFENSE_CFG.JUMP_MIN_AGE = 0;
  FAST_DEFENSE_CFG.JUMP_MAX_AGE = 18;
  FAST_DEFENSE_CFG.DIVE_MAX_FRAMES = 13;
}

function v6ChooseProfile(s) {
  var score = s.meta && s.meta.score ? s.meta.score : { self: 0, opp: 0 };
  var profileSamples = g_adapt.attackCount;
  var frontShare = profileSamples ?
    g_adapt.zoneCounts[2] / profileSamples : 0;
  var middleShare = profileSamples ?
    g_adapt.zoneCounts[1] / profileSamples : 0;
  var fastShare = profileSamples ?
    g_adapt.fastCount / profileSamples : 0;
  void frontShare;
  void middleShare;
  void fastShare;
  var pointEnded = g_v6_last_mode_self !== null &&
    (score.self !== g_v6_last_mode_self || score.opp !== g_v6_last_mode_opp);
  if (pointEnded) {
    if (score.opp > g_v6_last_mode_opp) g_v6_loss_streak += 1;
    else if (score.self > g_v6_last_mode_self) g_v6_loss_streak = 0;
    if ((profileSamples >= 3 && frontShare >= 0.65) || score.opp - score.self >= 3) g_v6_profile_latched = true;
  }
  
  g_v6_last_mode_self = score.self;
  g_v6_last_mode_opp = score.opp;
  g_v6_current_profile = g_v6_profile_latched;
  if (g_v6_current_profile) v6ApplyCurrentProfile();
  else v6ApplyCounterProfile();
}

function v6ComebackAirborneEnabled(s) {
  var score = s.meta && s.meta.score ? s.meta.score : { self: 0, opp: 0 };
  var samples = g_adapt.attackCount;
  var front = samples ? g_adapt.zoneCounts[2] / samples : 0;
  void score;
  void front;
  return false;
}

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

var CFG = { AIR_MIN: 4, AIR_MAX: 12, Y_LO: 117, Y_HI: 240, TOL: 23, BAND: 0 };

/* === [ADAPT-1] 적응 강도: 초반에는 v5 그대로, 표본이 쌓일수록 서서히 반영 === */
var ADAPT_CFG = {
  MIN_SAMPLES: 2,       // 이 횟수 전에는 학습값을 수비에 사용하지 않음
  FULL_SAMPLES: 16,     // 이 정도 관측하면 표본 신뢰도를 최대로 봄
  EMA_RATE: 0.378,       // 최근 공격 코스에 반응하는 속도
  MAX_BLEND: 0.562,      // 기존 v5 수비 판단을 최소 38% 보존
  MAX_SHIFT: 53,        // 학습 때문에 한 번에 치우칠 수 있는 최대 거리
  RECENT_SIZE: 9,
  HIT_X_RANGE: 99,
  HIT_Y_RANGE: 127
};

/* === [FAST-1] 빠른 공격은 엄격한 성공 조건을 통과할 때만 사용 === */
var FAST_ATTACK_CFG = {
  ARM_UNTILS: [2, 3],   // v5_1의 4프레임 대기보다 1~2프레임 먼저 타격 준비
  MAX_CONTACT: 11,      // 너무 늦게 만나는 공은 '반박자 빠른 공격'에서 제외
  MAX_DROP: 16,
  DOWN_MAX_DROP: 12,    // 하향 공격은 접촉 뒤 11프레임 안에 떨어져야 함
  COURT_MARGIN: 10,
  OPP_WINDOW: 3,        // 상대가 대응 가능한 프레임 창
  COMMIT_TICKS: 13,
  ABORT_SCORE: -280,
  DOWN_BONUS: 170,
  EARLY_WEIGHT: 11
};

/* === [V13-DEF] 고속 강타와 타격 직전 자세를 위한 독립 방어 계층 ===
 * 일반 공격 계획보다 먼저 실행하되, 확정적인 고속 통로나 반복 공격 자세가
 * 보일 때만 개입한다. 기존 범용 수비/공격의 상성을 최대한 보존하는 것이 목적이다. */
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
      if (oppInfo && v12OppCanReach(b, oppInfo, fSinceHit)) oppWindow += 1;
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
      if (oppInfo && v12OppCanReach(b, oppInfo, fSinceHit)) oppWindow += 1;
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
    x: s.opp.x, y: s.opp.y, state: s.opp.state, divingDirection: s.opp.divingDirection,
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
    x: s.opp.x, y: s.opp.y, state: s.opp.state, divingDirection: s.opp.divingDirection,
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
    x: s.opp.x, y: s.opp.y, state: s.opp.state, divingDirection: s.opp.divingDirection,
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
  if (!V12_INFER_VY) {
    if (g_prev === null || s.self.state > 2) return -16;
    var elapsed = Math.max(1, s.tick - g_prev_tick);
    var deltaY = s.self.y - g_prev.selfY;
    return deltaY / elapsed + (elapsed + 1) / 2;
  }
  return v12InferVy(s.self.state, s.self.y,
    g_prev === null ? null : g_prev.selfY, g_group);
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
  g_fast_def_profile_locked = false;
  g_serve_counter_suppressed = false;
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
function adaptiveDefenseTargetBase(s, baseTarget, minX, maxX) {
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
    landingDeviation: n > 1 ?
      Math.round(Math.sqrt(Math.max(0, g_adapt.landingM2 / (n - 1)))) : null,
    zones: g_adapt.zoneCounts.slice(),
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

/*
 * 상대 Thunder 계열 서브의 수평 강타를 첫 접촉에서 바로 되받아친다.
 * 미리 점프하지 않고 깊은 끝에서 기다린 뒤, 지상 충돌이 4~5프레임 앞으로
 * 들어왔을 때만 지연 입력을 고려해 점프+hit을 예약한다.
 */
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

/*
 * 고속 공은 기존 findIntercept()의 느린 셋업 공과 성격이 다르다.
 * 여기서는 공격 후보를 찾지 않고, 현재 궤적이 우리 코트의 점프 높이 통로를
 * 지나는 첫 시점을 찾아 즉시 점프/다이빙한다. 또한 상대가 state=2로 강타를
 * 장전했거나 반복 코스가 확인되면 접촉 전에 네트 앞에서 먼저 뜬다.
 */
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
  if (me.state >= 3) return { x: 0, y: 0, hit: 0 };

  var myPredX = clamp(me.x + g_last_action.x * WALK_SPEED * LATENCY_FRAMES, minX, maxX);

  /* [V13-SERVE] 상대의 결정적 고속 서브는 일반 공중/지상 계획보다 먼저 처리. */
  var serveCounter = counterOpponentFastServe(s, minX, maxX);
  if (serveCounter !== null) return serveCounter;

  if ((me.state === 1 || me.state === 2) &&
      v6ComebackAirborneEnabled(s)) {
    var comebackSave = fastDefenseAction(s, minX, maxX);
    if (comebackSave !== null) return comebackSave;
  }

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

  /* [V13-DEF] 공격 계획보다 확정적인 강타 수비를 먼저 처리한다. */
  var urgentDefense = fastDefenseAction(s, minX, maxX);
  if (urgentDefense !== null) return urgentDefense;

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

function adaptiveDecide(s) {
  var action;
  try { action = decideCore(s); } catch (e) { action = fallbackAction(s); }
  g_last_action = action;
  savePrev(s);
  return action;
}

/* ---------- OurBot_v11 situation-key defence, layered over AdaptiveCounter ---------- */
/* OFF by default: A/B against kyu_v15 was 82.8% ON vs 84.5% OFF. */
const V12_DFN_ENABLED = 0;
const V12_DFN_LEAD = 4;
const V12_DFN_BX = 24;
const V12_DFN_BY = 30;
const V12_DFN_MIN = 1;
const V12_DFN_HOLD = 12;
const V12_DFN_BACK = 52;
const V12_DFN_ADAPT_STEP = 24;

var v12DfnTable = Object.create(null);
var v12DfnHist = [], v12DfnPrevHist = [];
var v12DfnLastBall = null, v12DfnPrevRally = -1;
var v12DfnLatch = null, v12DfnLatchLeft = 0, v12DfnLatchBack = 0;
var v12DfnUsedKey = null, v12DfnPrevUsedKey = null;
var v12DfnPrevSelfScore = -1, v12DfnPrevOppScore = -1;

function v12DfnKey(bx, by) {
  return 'b' + (Math.floor(bx / V12_DFN_BX) * V12_DFN_BX) + '_' +
    (Math.floor(by / V12_DFN_BY) * V12_DFN_BY);
}

function v12ResetDfn() {
  v12DfnTable = Object.create(null);
  v12DfnHist = []; v12DfnPrevHist = [];
  v12DfnLastBall = null; v12DfnPrevRally = -1;
  v12DfnLatch = null; v12DfnLatchLeft = 0; v12DfnLatchBack = 0;
  v12DfnUsedKey = null; v12DfnPrevUsedKey = null;
}

function v12ObserveDefence(s) {
  if (!V12_DFN_ENABLED) return;
  var isLeft = s.side === 'LEFT';
  var ball = s.ball, opp = s.opp;
  var score = s.meta && s.meta.score ? s.meta.score : { self: 0, opp: 0 };
  var selfScore = typeof score.self === 'number' ? score.self : 0;
  var oppScore = typeof score.opp === 'number' ? score.opp : 0;
  if ((v12DfnPrevSelfScore >= 0 && selfScore < v12DfnPrevSelfScore) ||
      (v12DfnPrevOppScore >= 0 && oppScore < v12DfnPrevOppScore)) v12ResetDfn();

  var nbx = isLeft ? ball.x : GROUND_WIDTH - ball.x;
  var oppAir = opp.state === 1 || opp.state === 2;
  var ballOpp = isLeft ? ball.x >= NET_X : ball.x < NET_X;
  var rally = s.meta && typeof s.meta.rallyFrameCount === 'number' ?
    s.meta.rallyFrameCount : 0;

  if (rally < v12DfnPrevRally) {
    v12DfnPrevHist = v12DfnHist;
    v12DfnHist = [];
    v12DfnLatch = null; v12DfnLatchLeft = 0;
    v12DfnPrevUsedKey = v12DfnUsedKey; v12DfnUsedKey = null;
  } else v12DfnLastBall = nbx;
  v12DfnPrevRally = rally;
  v12DfnHist.push(oppAir && ballOpp ? v12DfnKey(nbx, ball.y) : null);
  if (v12DfnHist.length > 60) v12DfnHist.shift();

  if (v12DfnPrevOppScore >= 0 && oppScore > v12DfnPrevOppScore) {
    var landN = v12DfnLastBall;
    if (landN !== null && landN < NET_X) {
      var last = -1;
      for (var i = v12DfnPrevHist.length - 1; i >= 0; i--) {
        if (v12DfnPrevHist[i]) { last = i; break; }
      }
      var key = null;
      if (last >= 0) {
        var start = last;
        while (start > 0 && v12DfnPrevHist[start - 1]) start--;
        key = v12DfnPrevHist[Math.max(start, last - V12_DFN_LEAD)];
      }
      if (key) {
        var entry = v12DfnTable[key];
        if (entry) {
          entry.land = (entry.land * entry.n + landN) / (entry.n + 1);
          entry.n++;
        } else v12DfnTable[key] = { land: landN, n: 1, back: V12_DFN_BACK };
      }
    }
    if (v12DfnPrevUsedKey && v12DfnTable[v12DfnPrevUsedKey] && landN !== null) {
      var used = v12DfnTable[v12DfnPrevUsedKey];
      var stood = used.land - used.back;
      if (landN < stood - PLAYER_HALF) used.back = Math.min(96, used.back + V12_DFN_ADAPT_STEP);
      else if (landN > stood + PLAYER_HALF && landN < NET_X)
        used.back = Math.max(0, used.back - V12_DFN_ADAPT_STEP);
    }
  }
  v12DfnPrevSelfScore = selfScore;
  v12DfnPrevOppScore = oppScore;
}

function v12SituationalDefenceTarget(s, fallback, minX, maxX) {
  if (!V12_DFN_ENABLED) return fallback;
  var isLeft = s.side === 'LEFT';
  var oppAir = s.opp.state === 1 || s.opp.state === 2;
  var ballOpp = isLeft ? s.ball.x >= NET_X : s.ball.x < NET_X;
  if (oppAir && ballOpp) {
    var nbx = isLeft ? s.ball.x : GROUND_WIDTH - s.ball.x;
    var key = v12DfnKey(nbx, s.ball.y);
    var entry = v12DfnTable[key];
    if (entry && entry.n >= V12_DFN_MIN) {
      v12DfnLatch = entry.land;
      v12DfnLatchBack = entry.back;
      v12DfnLatchLeft = V12_DFN_HOLD;
      v12DfnUsedKey = key;
    }
  }
  if (v12DfnLatchLeft <= 0 || v12DfnLatch === null) return fallback;
  v12DfnLatchLeft--;
  var normalised = v12DfnLatch - v12DfnLatchBack;
  var target = isLeft ? normalised : GROUND_WIDTH - normalised;
  return clamp(target, minX, maxX);
}

function adaptiveDefenseTarget(s, baseTarget, minX, maxX) {
  var adaptiveTarget = adaptiveDefenseTargetBase(s, baseTarget, minX, maxX);
  return v12SituationalDefenceTarget(s, adaptiveTarget, minX, maxX);
}

/* ---------- Sajamokneun_v3_2 state-aware motion and reach model ----------
 * Both switches are OFF by default after A/B testing. Exact vertical inference
 * helped kyu_v15 by 2.1pp but lost 6.2pp vs Adaptive and 8.3pp vs built-in AI;
 * state-aware reach was neutral in 240-point and 12-game comparisons. */
const V12_INFER_VY = 0;
const V12_STATE_REACH = 0;
var V12_JUMP_Y = [], V12_JUMP_VY = [], V12_DIVE_Y = [], V12_DIVE_VY = [];
(function () {
  var y = PLAYER_GROUND_Y, vy = -16;
  for (var i = 0; i < 40; i++) {
    V12_JUMP_Y.push(y); V12_JUMP_VY.push(vy);
    var ny = y + vy;
    if (ny < PLAYER_GROUND_Y) { y = ny; vy++; }
    else if (ny > PLAYER_GROUND_Y) break;
    else y = ny;
  }
  y = PLAYER_GROUND_Y; vy = -5;
  for (var j = 0; j < 40; j++) {
    V12_DIVE_Y.push(y); V12_DIVE_VY.push(vy);
    var nd = y + vy;
    if (nd < PLAYER_GROUND_Y) { y = nd; vy++; }
    else if (nd > PLAYER_GROUND_Y) break;
    else y = nd;
  }
})();

function v12InferVy(state, y, prevY, frameGroup) {
  if (state !== 1 && state !== 2 && state !== 3) return 0;
  var ys = state === 3 ? V12_DIVE_Y : V12_JUMP_Y;
  var vys = state === 3 ? V12_DIVE_VY : V12_JUMP_VY;
  var count = 0, only = 0, latest = 0;
  for (var k = 0; k < ys.length; k++) if (ys[k] === y) {
    if (count === 0) { only = vys[k]; latest = vys[k]; }
    else if (vys[k] > latest) latest = vys[k];
    count++;
  }
  if (count === 0) return 0;
  if (count === 1) return only;
  if (prevY !== null && prevY !== undefined) {
    for (var n = 0; n < ys.length; n++) if (ys[n] === y) {
      var previousVy = vys[n] - frameGroup;
      if (y - (frameGroup * previousVy +
          Math.floor(frameGroup * (frameGroup - 1) / 2)) === prevY) return vys[n];
    }
  }
  return latest;
}

function v12OpponentReach(info, frames) {
  var state = info.state | 0, x = info.x, y = info.y;
  var vy = v12InferVy(state, y, null, g_group);
  var remaining = frames, locked = 0;
  if (state === 3) {
    var direction = info.divingDirection < 0 ? -1 : 1;
    while (remaining > 0 && y < PLAYER_GROUND_Y) {
      x = clamp(x + direction * DIVE_SPEED, info.minX, info.maxX);
      remaining--;
      var diveY = y + vy;
      if (diveY > PLAYER_GROUND_Y) { y = PLAYER_GROUND_Y; state = 4; locked = 5; }
      else { y = diveY; if (diveY < PLAYER_GROUND_Y) vy++; }
    }
  } else if (state === 4) locked = 5;

  if ((state === 1 || state === 2) && remaining > 0) {
    while (remaining > 0 && y < PLAYER_GROUND_Y) {
      remaining--;
      var airY = y + vy;
      if (airY > PLAYER_GROUND_Y) { y = PLAYER_GROUND_Y; break; }
      y = airY; if (airY < PLAYER_GROUND_Y) vy++;
    }
  }
  if (locked > 0) remaining = Math.max(0, remaining - locked);
  var radius = PLAYER_HALF + remaining * WALK_SPEED;
  return {
    lo: clamp(x - radius, info.minX - PLAYER_HALF, info.maxX + PLAYER_HALF),
    hi: clamp(x + radius, info.minX - PLAYER_HALF, info.maxX + PLAYER_HALF)
  };
}

function v12OppCanReach(ball, info, framesSinceHit) {
  if (!V12_STATE_REACH) {
    return oppCanReach(ball, info.x, info.minX, info.maxX, framesSinceHit);
  }
  if (ball.x < info.minX - PLAYER_HALF || ball.x > info.maxX + PLAYER_HALF) return false;
  if (ball.y < 76) return false;
  if (ball.y < 212 && framesSinceHit < 5) return false;
  var reach = v12OpponentReach(info, framesSinceHit);
  return ball.x >= reach.lo && ball.x <= reach.hi;
}

/* Keep AdaptiveCounter's one-frame latency model aligned with the action that
 * thunder actually emitted. Adaptive still observes every snapshot so its
 * rally/score learning state never goes stale. */
function adaptiveCommitExternalAction(action) {
  g_last_action = { x: action.x, y: action.y, hit: action.hit };
  g_air_policy = null;
  g_fast_attack_until = -1;
  g_fast_attack_policy = null;
}

function v12Sanitize(action) {
  var a = action || {};
  var clampDir = function (v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); };
  return { x: clampDir(a.x | 0), y: clampDir(a.y | 0), hit: a.hit ? 1 : 0 };
}

function decide(snapshot) {
  v6ChooseProfile(snapshot);
  try { v12ObserveDefence(snapshot); } catch (e) { /* defence learning is optional */ }
  var th = null;
  try { th = g_v6_current_profile ? thunderAction(snapshot) : null; } catch (e) {
    TH.armed = false; TH.dead = true;
  }

  /* Run the primary controller on every tick for coherent observations. */
  var base = adaptiveDecide(snapshot);
  if (th !== null) {
    adaptiveCommitExternalAction(th);
    return v12Sanitize(th);
  }
  return v12Sanitize(base);
}

decide.__v6 = {
  thunderState: function () {
    return { seenScore: TH.seenScore, armed: TH.armed, dead: TH.dead, fEst: TH.fEst };
  },
  adaptiveStats: getAdaptiveStats,
  ensembleState: function () {
    return { currentProfile: g_v6_current_profile,
      latched: g_v6_profile_latched, lossStreak: g_v6_loss_streak };
  },
  skills: [
    'safe-phase-thunder', 'model-serve', 'fast-serve-receive',
    'corridor-intercept', 'profile-prejump', 'emergency-dive',
    'front-pattern-airborne-save',
    'predictive-quick-attack', 'contact-height-smash',
    'score-adaptive-counter-profile'
  ]
};
