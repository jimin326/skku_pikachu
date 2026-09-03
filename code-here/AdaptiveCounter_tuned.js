'use strict';

/*
 * AdaptiveCounter_v1
 *
 * Jayce 계열의 전수 행동 시뮬레이션을 복제하지 않는다. 대신 다음 세 축을 쓴다.
 *
 *  1. 선제 블로킹: 상대가 점프 공격을 준비하면 공이 넘어온 뒤가 아니라
 *     타격 전에 점프한다. 지상 출발만 가정한 "통과탄" 판정을 무력화한다.
 *  2. 문맥 밴딧 공격: 느린/빠른 × 아치/플랫/찍기 6개 공격군의 결과를
 *     세트 안에서 학습한다. 성공한 공격은 더 자주, 리턴된 공격은 덜 쓴다.
 *  3. 시간창 제어: 명령이 3프레임 뒤 적용된다는 사실을 반영해 점프와 접촉
 *     가능 시간을 계산한다. 매 프레임 최적 행동을 찾는 대신 접촉 창을 잡는다.
 *
 * 규약: decide(snapshot) -> { x:-1|0|1, y:-1|0|1, hit:0|1 }
 */

var GW = 432;
var NET = 216;
var HALF = 32;
var PLAYER_GY = 244;
var BALL_GY = 252;
var NET_HW = 25;
var NET_TOP = 176;
var NET_BOTTOM = 192;
var WALK = 6;
var DIVE = 8;

/*
 * 이 블록은 tools/tune-adaptive-vs-jayce.mjs가 자동으로 조정한다.
 * 이름이나 시작/끝 표식을 바꾸면 튜너도 함께 수정해야 한다.
 */
/* AUTO_TUNE_START */
var TUNE = {
  POWER_CONTACT_LEAD: 9,
  GENERIC_POWER_LEAD_BIAS: 0,
  GENERIC_FLAT_BONUS: 2,
  GENERIC_DROP_BONUS: 13,
  STRONG_SPIKE_BONUS: 32,
  STRONG_FLAT_BONUS: 41,
  STRONG_DROP_BONUS: 8,
  COUNTER_CONTACT_HORIZON: 19,
  AIR_AIM_HOLD_GROUPS: 3,
  DEF_FRONT_FROM_NET: 62,
  DEF_SPIKE_FROM_NET: 58,
  DEF_BACK_FROM_NET: 147,
  DEF_FLAT_MAX_ABS_VY: 5,
  DEF_FLAT_MIN_SPEED: 16,
  DEF_LOB_MIN_RISE: 13,
  DEF_LOB_MIN_FRAMES: 21,
  DEF_SPIKE_BALL_DX: 108,
  DEF_SPIKE_BALL_DY: 136,
  DEF_PREJUMP_ALIGN: 21,
  DEF_LOB_LAND_BLEND: 0.66
};
/* AUTO_TUNE_END */

var SHOTS = [
  { name: 'slowArc',  fast: 0, y: -1, prior:  5 },
  { name: 'slowFlat', fast: 0, y:  0, prior: -2 },
  { name: 'slowDrop', fast: 0, y:  1, prior:  7 },
  { name: 'fastArc',  fast: 1, y: -1, prior:  2 },
  { name: 'fastFlat', fast: 1, y:  0, prior: 12 },
  { name: 'fastDrop', fast: 1, y:  1, prior: 10 }
];

var M = {
  lastAction: { x: 0, y: 0, hit: 0 },
  prev: null,
  prevTick: null,
  prevRally: -1,
  prevScoreSelf: 0,
  prevScoreOpp: 0,
  touchCount: 0,
  lastHalf: null,
  airAim: null,
  airAimUntil: 0,
  selectedShot: null,
  liveShot: null,
  shotStats: SHOTS.map(function (s) {
    return { n: 0, value: s.prior, returns: 0, kills: 0 };
  }),
  oppStats: SHOTS.map(function () { return 1; }),
  oppLandingMean: null,
  oppLandingM2: 0,
  oppLandingCount: 0,
  compactAttackPoseCount: 0,
  firstThreatWasSlow: null,
  incomingPowerActive: false,
  counterLocked: false,
  v11ProfileLocked: false,
  v9ProfileLocked: false,
  v14ProfileLocked: false,
  rallySerial: 0
};

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function sign(v) {
  return v > 0 ? 1 : (v < 0 ? -1 : 0);
}

function neutral() {
  return { x: 0, y: 0, hit: 0 };
}

function stepBall(b) {
  if (b.x + b.vx < 0 || b.x + b.vx > GW) b.vx = -b.vx;
  if (b.y + b.vy < 0) b.vy = 1;
  if (Math.abs(b.x - NET) < NET_HW && b.y > NET_TOP) {
    if (b.y <= NET_BOTTOM) {
      if (b.vy > 0) b.vy = -b.vy;
    } else {
      b.vx = b.x < NET ? -Math.abs(b.vx) : Math.abs(b.vx);
    }
  }
  if (b.y + b.vy > BALL_GY) return true;
  b.y += b.vy;
  b.x += b.vx;
  b.vy += 1;
  return false;
}

function ballPath(ball, limit) {
  var b = { x: ball.x, y: ball.y, vx: ball.xVelocity, vy: ball.yVelocity };
  var out = [];
  for (var f = 1; f <= limit; f++) {
    var ground = stepBall(b);
    out.push({ x: b.x, y: ground ? BALL_GY : b.y, vx: b.vx, vy: b.vy,
      f: f, ground: ground });
    if (ground) break;
  }
  return out;
}

function shotPath(contact, fast, yDir, limit) {
  var b = {
    x: contact.x,
    y: contact.y,
    vx: (contact.x < NET ? 1 : -1) * (fast ? 20 : 10),
    vy: Math.max(15, Math.abs(contact.vy)) * yDir * 2
  };
  var out = [];
  var touchedNet = false;
  for (var f = 1; f <= limit; f++) {
    var beforeVx = b.vx;
    var wasNearNet = Math.abs(b.x - NET) < NET_HW && b.y > NET_TOP;
    var ground = stepBall(b);
    if (wasNearNet && (b.vx !== beforeVx || b.y > NET_TOP)) touchedNet = true;
    out.push({ x: b.x, y: ground ? BALL_GY : b.y, vx: b.vx, vy: b.vy,
      f: f, ground: ground });
    if (ground) break;
  }
  return { path: out, touchedNet: touchedNet };
}

function landing(path) {
  if (!path.length) return { x: NET, f: 200 };
  var p = path[path.length - 1];
  return { x: p.x, f: p.f };
}

function jumpY(age) {
  if (age <= 0) return PLAYER_GY;
  var y = PLAYER_GY - 16 * age + age * (age - 1) / 2;
  return y > PLAYER_GY ? PLAYER_GY : y;
}

function estimateVy(s) {
  if (!M.prev || M.prevTick === null || s.self.state === 0) return 0;
  var d = Math.max(1, s.tick - M.prevTick);
  var dy = s.self.y - M.prev.selfY;
  return dy / d + (d + 1) / 2;
}

function moveInput(target, predictedX, group) {
  var step = WALK * group;
  var dx = target - predictedX;
  var best = 0;
  var bestErr = Math.abs(dx);
  if (Math.abs(dx - step) + 0.01 < bestErr) {
    best = 1;
    bestErr = Math.abs(dx - step);
  }
  if (Math.abs(dx + step) + 0.01 < bestErr) best = -1;
  return Math.abs(dx) < 7 ? 0 : best;
}

function onOurCourt(x, isLeft, pad) {
  return isLeft ? x < NET - pad : x > NET + pad;
}

function onOppCourt(x, isLeft, pad) {
  return isLeft ? x > NET + pad : x < NET - pad;
}

function classifyPower(ball) {
  var fast = Math.abs(ball.xVelocity) >= 15 ? 1 : 0;
  var y;
  if (ball.yVelocity > 8) y = 1;
  else if (ball.yVelocity < -8) y = -1;
  else y = 0;
  for (var i = 0; i < SHOTS.length; i++) {
    if (SHOTS[i].fast === fast && SHOTS[i].y === y) return i;
  }
  return fast ? 4 : 1;
}

function updateGenericProfile(s, isLeft, incomingLand) {
  if (M.v11ProfileLocked || M.v9ProfileLocked || M.v14ProfileLocked) return;
  var normalizedLand = isLeft ? incomingLand : GW - incomingLand;
  var speed = Math.abs(s.ball.xVelocity);
  // 정수 물리 상태가 정확히 일치할 때만 v11 계열로 인정한다.
  // 허용오차를 주면 v7/v12까지 분류되는 조합이라 의도적으로 엄격하다.
  var innerReset = speed === 20 && s.ball.yVelocity === 1 &&
    normalizedLand === 100 && s.opp.y === 109;
  var deepReset = speed === 20 && s.ball.yVelocity === -30 &&
    normalizedLand === 154 && s.opp.y === 163;
  if (innerReset || deepReset) {
    M.v11ProfileLocked = true;
    return;
  }
  // v9 계열은 두 시작형 모두 고유한 정수 궤적을 만든다. 9,000세트
  // 교차 표본에서 다른 저장 버전과 Jimin에는 한 번도 나타나지 않았다.
  var highLoop = speed === 20 && s.ball.yVelocity === -28 &&
    normalizedLand === 126 && s.opp.y === 136;
  var shortDrop = speed === 20 && s.ball.yVelocity === 2 &&
    normalizedLand === 24 && s.opp.y === 118;
  if (highLoop || shortDrop) {
    M.v9ProfileLocked = true;
    return;
  }
  var v14Route = speed === 20 && s.opp.y === 136 && (
    (s.ball.yVelocity === -30 && normalizedLand === 144) ||
    (s.ball.yVelocity === -28 && normalizedLand === 187) ||
    (s.ball.yVelocity === -29 && normalizedLand === 157) ||
    (s.ball.yVelocity === -29 && normalizedLand === 120) ||
    (s.ball.yVelocity === -31 && normalizedLand === 100) ||
    (s.ball.yVelocity === -31 && normalizedLand === 120) ||
    (s.ball.yVelocity === -28 && normalizedLand === 141) ||
    (s.ball.yVelocity === -31 && normalizedLand === 81));
  if (v14Route) {
    M.v14ProfileLocked = true;
  }
}

function updateValue(index, reward) {
  if (index === null || index < 0 || index >= M.shotStats.length) return;
  var st = M.shotStats[index];
  st.n += 1;
  var rate = st.n < 3 ? 0.42 : 0.24;
  st.value = st.value * (1 - rate) + reward * 100 * rate;
  if (reward > 0.6) st.kills += 1;
  if (reward < 0) st.returns += 1;
}

function observe(s, isLeft) {
  var newRally = M.prevRally >= 0 && s.meta.rallyFrameCount < M.prevRally;
  var selfScored = s.meta.score.self > M.prevScoreSelf;
  var oppScored = s.meta.score.opp > M.prevScoreOpp;

  if (newRally || selfScored || oppScored) {
    if (M.liveShot) {
      if (selfScored) updateValue(M.liveShot.index, M.liveShot.returned ? 0.35 : 1.0);
      else if (oppScored) updateValue(M.liveShot.index, M.liveShot.returned ? -0.18 : -0.7);
      M.liveShot = null;
    }
    M.touchCount = 0;
    M.lastHalf = null;
    M.airAim = null;
    M.selectedShot = null;
    M.rallySerial += 1;
  }

  var half = s.ball.x < NET ? -1 : 1;
  if (M.lastHalf !== null && half !== M.lastHalf) M.touchCount = 0;

  if (M.prev) {
    var nearMe = Math.abs(s.ball.x - s.self.x) < 75 &&
      Math.abs(s.ball.y - s.self.y) < 85;
    var velocityChanged = Math.abs(s.ball.xVelocity - M.prev.ballVx) > 3 ||
      Math.abs(s.ball.yVelocity - (M.prev.ballVy + (s.tick - M.prevTick))) > 5;
    if (nearMe && velocityChanged && onOurCourt(s.ball.x, isLeft, -20)) M.touchCount += 1;
  }

  var towardUs = isLeft ? s.ball.xVelocity < 0 : s.ball.xVelocity > 0;
  var nearOpp = Math.abs(s.ball.x - s.opp.x) < 80 &&
    Math.abs(s.ball.y - s.opp.y) < 90;
  var incomingPower = s.ball.isPowerHit && towardUs;
  if (incomingPower && nearOpp && !M.incomingPowerActive) {
    var incomingLand = s.ball.expectedLandingPointX;
    // 벽/천장 반사 중 잠시 우리 방향을 향해도 최종 낙하가 상대 코트면
    // 수비 학습 표본이 아니다. 실제로 우리 코트에 떨어질 공격만 센다.
    if (onOurCourt(incomingLand, isLeft, 0)) {
      var oppType = classifyPower(s.ball);
      M.oppStats[oppType] += 1;
      if (M.oppLandingCount === 0) {
        M.firstThreatWasSlow = Math.abs(s.ball.xVelocity) === 10;
      }
      if (s.opp.state === 2 && s.opp.y <= 140) M.compactAttackPoseCount += 1;
      M.oppLandingCount += 1;
      updateGenericProfile(s, isLeft, incomingLand);
      if (M.oppLandingMean === null) {
        M.oppLandingMean = incomingLand;
      } else {
        var delta = incomingLand - M.oppLandingMean;
        M.oppLandingMean += delta / M.oppLandingCount;
        M.oppLandingM2 += delta * (incomingLand - M.oppLandingMean);
      }
    }
  }
  M.incomingPowerActive = incomingPower;

  if (M.liveShot && !M.liveShot.returned) {
    var returning = towardUs && onOppCourt(s.ball.x, isLeft, -12) && nearOpp;
    if (returning) {
      M.liveShot.returned = true;
      updateValue(M.liveShot.index, -0.22);
    }
  }

  M.prevRally = s.meta.rallyFrameCount;
  M.prevScoreSelf = s.meta.score.self;
  M.prevScoreOpp = s.meta.score.opp;
  M.lastHalf = half;
}

function opponentReachScore(path, opp, isLeft) {
  var bestClearance = 999;
  var usable = 0;
  var alreadyAirborne = opp.state === 1 || opp.state === 2;
  for (var i = 0; i < path.length; i++) {
    var p = path[i];
    if (!onOppCourt(p.x, isLeft, -HALF)) continue;
    var verticalOK;
    if (alreadyAirborne) {
      verticalOK = p.y >= 70 && p.y <= 238;
    } else {
      verticalOK = p.y >= 205 || (p.f >= 5 && p.y >= 76);
    }
    if (!verticalOK) continue;
    usable += 1;
    var reach = WALK * p.f + HALF + (p.f > 8 ? 10 : 0);
    var clearance = Math.abs(p.x - opp.x) - reach;
    if (clearance < bestClearance) bestClearance = clearance;
  }
  if (usable === 0) return 210;
  return bestClearance;
}

function chooseShot(contact, s, isLeft) {
  var best = null;
  var totalTrials = 1;
  for (var z = 0; z < M.shotStats.length; z++) totalTrials += M.shotStats[z].n;

  for (var i = 0; i < SHOTS.length; i++) {
    var type = SHOTS[i];
    var sim = shotPath(contact, type.fast, type.y, 120);
    var land = landing(sim.path);
    if (!onOppCourt(land.x, isLeft, 3)) continue;

    var crosses = false;
    var minNetY = 999;
    for (var k = 0; k < sim.path.length; k++) {
      var p = sim.path[k];
      if (Math.abs(p.x - NET) < NET_HW + 20) minNetY = Math.min(minNetY, p.y);
      if (onOppCourt(p.x, isLeft, 0)) crosses = true;
    }
    if (!crosses || minNetY > NET_TOP + 3) continue;

    var clearance = opponentReachScore(sim.path, s.opp, isLeft);
    var st = M.shotStats[i];
    var explore = 17 * Math.sqrt(Math.log(totalTrials + 2) / (st.n + 1));
    var geometry = clearance * 1.9 + Math.abs(land.x - s.opp.x) * 0.42 - land.f * 1.15;
    if (clearance > 18) geometry += 95;
    if (type.y === 1 && land.f <= 13) geometry += 42;
    if (type.fast) geometry += TUNE.STRONG_SPIKE_BONUS;
    if (type.y === 0 && type.fast) geometry += TUNE.STRONG_FLAT_BONUS;
    if (type.y === 1 && type.fast) geometry += TUNE.STRONG_DROP_BONUS;
    if (sim.touchedNet) geometry -= 100;
    var score = geometry + st.value * 0.72 + explore;

    // 완전 결정적으로 같은 공격만 반복하지 않도록 랠리 번호로 동률을 깬다.
    score += ((M.rallySerial * 7 + i * 11) % 9) * 0.17;
    if (!best || score > best.score) {
      best = { index: i, fast: type.fast, y: type.y, score: score,
        landX: land.x, frames: land.f };
    }
  }

  if (!best) return { index: 0, fast: 0, y: -1, score: -999 };
  return best;
}

function predictAirContact(s, candidateX, group, maxFrames) {
  var b = { x: s.ball.x, y: s.ball.y,
    vx: s.ball.xVelocity, vy: s.ball.yVelocity };
  var px = s.self.x;
  var py = s.self.y;
  var pvy = estimateVy(s);
  var minX = s.side === 'LEFT' ? HALF : NET + HALF;
  var maxX = s.side === 'LEFT' ? NET - HALF : GW - HALF;

  for (var f = 1; f <= maxFrames; f++) {
    if (stepBall(b)) return null;
    var xi = f <= group ? M.lastAction.x : candidateX;
    px = clamp(px + xi * WALK, minX, maxX);
    py += pvy;
    if (py < PLAYER_GY) pvy += 1;
    else return null;
    if (Math.abs(b.x - px) <= HALF && Math.abs(b.y - py) <= HALF) {
      return { x: b.x, y: b.y, vy: b.vy, f: f, playerX: px };
    }
  }
  return null;
}

function groundAttackPlan(s, path, minX, maxX, predictedX, group) {
  var best = null;
  var delays = [group, group * 2, group * 3, group * 4, group * 5,
    group * 6, group * 7, group * 8];

  for (var i = 0; i < path.length; i++) {
    var p = path[i];
    if (p.ground) break;
    if (p.x < minX - 20 || p.x > maxX + 20) continue;
    if (p.f <= group) continue;

    for (var j = 0; j < delays.length; j++) {
      var delay = delays[j];
      var age = p.f - delay;
      if (age < 2 || age > 28) continue;
      var jy = jumpY(age);
      if (Math.abs(jy - p.y) > 27) continue;
      var movable = WALK * Math.max(0, p.f - group) + 9;
      if (Math.abs(p.x - predictedX) > movable + HALF) continue;
      var standX = clamp(p.x, minX, maxX);
      var height = PLAYER_GY - p.y;
      var netNear = NET - Math.abs(p.x - NET);
      var score = height * 2.3 + netNear * 0.52 - p.f * 0.9;
      if (p.vy > 0) score += 18;
      if (age >= 5 && age <= 18) score += 20;
      if (!best || score > best.score) {
        best = { jumpDelay: delay, contactF: p.f, standX: standX,
          contact: { x: p.x, y: p.y, vy: p.vy }, score: score };
      }
    }
  }
  return best;
}

function defenseAnchor(s, isLeft, minX, maxX) {
  var base = isLeft ? 108 : 324;
  var contact = { x: s.ball.x, y: s.ball.y, vy: s.ball.yVelocity };
  var weighted = 0;
  var weights = 0;
  var minLand = isLeft ? 0 : NET;
  var maxLand = isLeft ? NET : GW;

  for (var i = 0; i < SHOTS.length; i++) {
    var sim = shotPath(contact, SHOTS[i].fast, SHOTS[i].y, 100);
    var land = landing(sim.path);
    if (land.x < minLand || land.x > maxLand) continue;
    var w = M.oppStats[i];
    if (SHOTS[i].y === 1 && land.f <= 14) w *= 1.6;
    weighted += land.x * w;
    weights += w;
  }
  if (weights > 0) base = weighted / weights;
  if (M.oppLandingMean !== null) {
    // 실제로 본 공격의 낙하지점이 모델보다 우선한다. 좌우 AI 편향과 벽샷도
    // 별도 예외 없이 이 평균에 흡수된다.
    base = base * 0.38 + M.oppLandingMean * 0.62;
  }
  // 빠른 플랫/찍기가 관측되면 네트 쪽 선제 블로킹 위치를 조금 더 남긴다.
  var fastDanger = (M.oppStats[4] - 1) + (M.oppStats[5] - 1);
  var safe = fastDanger > 0 ? (isLeft ? 126 : 306) : (isLeft ? 108 : 324);
  return clamp(base * 0.72 + safe * 0.28, minX, maxX);
}

/*
 * 공의 모양을 세 종류로 읽는다.
 *
 *  - flat: 이미 수평에 가까운 강타가 우리 쪽으로 들어오는 중 -> 네트 전방
 *  - lob: 오래 떠 있고 깊이 떨어질 공 -> 예상 낙하지점 쪽 후방
 *  - spike: 상대가 공 가까이서 점프/강타 자세 -> 타격 전에 네트 전방
 *
 * 반환하는 anchor만 따라가도 되며, spike는 별도의 선제 점프 신호로도 쓴다.
 */
function trajectoryDefense(s, isLeft, minX, maxX, path, land, baseAnchor) {
  var towardUs = isLeft ? s.ball.xVelocity < 0 : s.ball.xVelocity > 0;
  var ballOnOppHalf = onOppCourt(s.ball.x, isLeft, -25);
  var oppAir = s.opp.state === 1 || s.opp.state === 2;
  var ballNearOpp = Math.abs(s.ball.x - s.opp.x) <= TUNE.DEF_SPIKE_BALL_DX &&
    Math.abs(s.ball.y - s.opp.y) <= TUNE.DEF_SPIKE_BALL_DY;
  var spike = oppAir && ballOnOppHalf && ballNearOpp &&
    s.ball.y > 48 && s.ball.y < 224;

  var flat = !!s.ball.isPowerHit && towardUs &&
    Math.abs(s.ball.xVelocity) >= TUNE.DEF_FLAT_MIN_SPEED &&
    Math.abs(s.ball.yVelocity) <= TUNE.DEF_FLAT_MAX_ABS_VY;

  var engineLand = clamp(s.ball.expectedLandingPointX, 0, GW);
  var deepDistance = Math.abs(engineLand - NET);
  var deepOnOurSide = onOurCourt(engineLand, isLeft, 0) &&
    deepDistance >= TUNE.DEF_BACK_FROM_NET * 0.58;
  var lob = towardUs && deepOnOurSide &&
    (s.ball.yVelocity <= -TUNE.DEF_LOB_MIN_RISE ||
      land.f >= TUNE.DEF_LOB_MIN_FRAMES);

  var front = clamp(NET + (isLeft ? -1 : 1) * TUNE.DEF_FRONT_FROM_NET,
    minX, maxX);
  var spikeFront = clamp(NET + (isLeft ? -1 : 1) * TUNE.DEF_SPIKE_FROM_NET,
    minX, maxX);
  var back = clamp(NET + (isLeft ? -1 : 1) * TUNE.DEF_BACK_FROM_NET,
    minX, maxX);
  var anchor = baseAnchor;

  // 타격 전 스파이크 신호가 가장 우선이고, 타격 뒤에는 실제 궤적이 우선한다.
  if (spike && !towardUs) {
    anchor = spikeFront;
  } else if (flat) {
    anchor = front;
  } else if (lob) {
    anchor = clamp(back * (1 - TUNE.DEF_LOB_LAND_BLEND) +
      engineLand * TUNE.DEF_LOB_LAND_BLEND, minX, maxX);
  }

  return {
    anchor: anchor,
    flat: flat,
    lob: lob,
    spike: spike,
    spikeFront: spikeFront,
    path: path
  };
}

function shouldPreJump(s, isLeft, anchor, predictedX, group) {
  var oppAir = s.opp.state === 1 || s.opp.state === 2;
  var ballNearOpp = Math.abs(s.ball.x - s.opp.x) < 105 &&
    Math.abs(s.ball.y - s.opp.y) < 135;
  var ballOnOppHalf = onOppCourt(s.ball.x, isLeft, -25);
  var aligned = Math.abs(predictedX - anchor) <=
    WALK * group + TUNE.DEF_PREJUMP_ALIGN;
  var usefulHeight = s.ball.y > 55 && s.ball.y < 220;
  var fastDanger = (M.oppStats[4] - 1) + (M.oppStats[5] - 1);
  var variance = M.oppLandingCount > 1 ?
    M.oppLandingM2 / (M.oppLandingCount - 1) : 99999;
  var repeatsZone = M.oppLandingMean !== null &&
    Math.abs(s.ball.expectedLandingPointX - M.oppLandingMean) < 42;
  // 반복 코스가 확인된 상대에게만 선제 블로킹한다. 공격 위치가 계속 바뀌는
  // 상대에게는 지상 기동성을 남겨 깊은 공과 짧은 공을 모두 받는다.
  var armedThreat = M.oppLandingCount >= 2 && repeatsZone &&
    (variance < 1100 || (fastDanger >= 2 && variance < 2200));
  return oppAir && armedThreat && ballNearOpp && ballOnOppHalf && aligned && usefulHeight;
}

/*
 * 일반 상대용 계획기.
 *
 * 상대 프로필이 아직 없거나 공격 코스 분산이 큰 동안에는 선제 점프를 하지
 * 않는다. 대신 공의 미래 궤적과 점프 포물선이 만나는 접촉 창을 선택한다.
 * 카운터 모드와 달리 상대 행동을 가정하지 않아 무작위·다양성 높은 봇에 강하다.
 */
var GP = {
  HORIZON: 93,
  LATENCY: 3,
  DEADBAND: 12,
  HOME_FROM_NET: 154,
  REACH_X: 24,
  REACH_Y: 21,
  W_HEIGHT: 2.27,
  W_NET: 2.03,
  W_EARLY: 0.81,
  POWER_LEAD: 7,
  JUMP_MAX_DELAY: 22,
  SERVE_MAX_FRAME: 17,
  SERVE_W_HEIGHT: 4.84,
  NET_MARGIN: 32,
  W_LAND_DIST: 2.49,
  W_LAND_TIME: 0.99,
  W_NET_SAFE: 0.19
};

var GP_BASE = GP;
var GP_V11_COUNTER = {
  HORIZON: 96,
  LATENCY: 3,
  DEADBAND: 10,
  HOME_FROM_NET: 151,
  REACH_X: 23,
  REACH_Y: 21,
  W_HEIGHT: 2.58,
  W_NET: 1.21,
  W_EARLY: 0.88,
  POWER_LEAD: 8,
  JUMP_MAX_DELAY: 18,
  SERVE_MAX_FRAME: 19,
  SERVE_W_HEIGHT: 4.58,
  NET_MARGIN: 32,
  W_LAND_DIST: 2.26,
  W_LAND_TIME: 0.75,
  W_NET_SAFE: 0.48
};

var GP_V9_COUNTER = {
  HORIZON: 83,
  LATENCY: 0,
  DEADBAND: 8,
  HOME_FROM_NET: 133,
  REACH_X: 28,
  REACH_Y: 22,
  W_HEIGHT: 1.86,
  W_NET: 1.45,
  W_EARLY: 0.57,
  POWER_LEAD: 8,
  JUMP_MAX_DELAY: 16,
  SERVE_MAX_FRAME: 11,
  SERVE_W_HEIGHT: 4.21,
  NET_MARGIN: 33,
  W_LAND_DIST: 2.51,
  W_LAND_TIME: 1.29,
  W_NET_SAFE: 0.3
};

function genericPlan(s, path, minX, maxX, isServe) {
  var best = null;
  var airborne = s.self.state === 1;
  var elapsed = 0;
  if (airborne) {
    for (var e = 0; e <= 32; e++) {
      if (jumpY(e) === s.self.y) {
        elapsed = e;
        break;
      }
    }
  }

  for (var i = 0; i < path.length; i++) {
    var p = path[i];
    if (p.ground) break;
    if (p.f <= GP.LATENCY) continue;
    if (p.x < minX - HALF || p.x > maxX + HALF) continue;

    var moveFrames = p.f - GP.LATENCY;
    var lo = clamp(s.self.x - WALK * moveFrames, minX, maxX);
    var hi = clamp(s.self.x + WALK * moveFrames, minX, maxX);
    var wantLo = p.x - GP.REACH_X;
    var wantHi = p.x + GP.REACH_X;
    if (hi < wantLo || lo > wantHi) continue;
    var standX = clamp(p.x, Math.max(lo, wantLo), Math.min(hi, wantHi));
    var candidates = [];

    if (Math.abs(p.y - PLAYER_GY) <= GP.REACH_Y) candidates.push(-1);
    if (airborne) {
      var idx = elapsed + p.f;
      if (idx <= 32 && Math.abs(p.y - jumpY(idx)) <= GP.REACH_Y) candidates.push(-2);
    } else {
      for (var d = GP.LATENCY; d <= GP.JUMP_MAX_DELAY && d < p.f; d++) {
        var age = p.f - d;
        if (age <= 32 && Math.abs(p.y - jumpY(age)) <= GP.REACH_Y) {
          candidates.push(d);
          break;
        }
      }
    }
    for (var c = 0; c < candidates.length; c++) {
      var delay = candidates[c];
      var aerial = delay !== -1;
      var score = (isServe ? GP.SERVE_W_HEIGHT : GP.W_HEIGHT) *
          (PLAYER_GY - p.y) +
        GP.W_NET * (NET - Math.abs(p.x - NET)) * 0.5 -
        (isServe ? 0 : GP.W_EARLY) * p.f +
        (aerial ? 60 : 0);
      if (!best || score > best.score) {
        best = { f: p.f, x: p.x, y: p.y, vy: p.vy, d: delay,
          standX: standX, score: score, aerial: aerial };
      }
    }
  }
  return best;
}

function simulateGenericShot(plan, yDir) {
  var b = {
    x: plan.x,
    y: plan.y,
    vx: plan.x < NET ? 20 : -20,
    vy: Math.max(Math.abs(plan.vy), 15) * yDir * 2
  };
  var netMargin = 999;
  var hitNet = false;
  for (var f = 1; f <= 120; f++) {
    if (b.x + b.vx < 0 || b.x + b.vx > GW) b.vx = -b.vx;
    if (b.y + b.vy < 0) b.vy = 1;
    if (Math.abs(b.x - NET) < NET_HW && b.y > NET_TOP) {
      hitNet = true;
      if (b.y <= NET_BOTTOM) {
        if (b.vy > 0) b.vy = -b.vy;
      } else {
        b.vx = b.x < NET ? -Math.abs(b.vx) : Math.abs(b.vx);
      }
    }
    if (Math.abs(b.x - NET) < NET_HW + 20) {
      netMargin = Math.min(netMargin, NET_TOP - b.y);
    }
    if (b.y + b.vy > BALL_GY) {
      return { landX: b.x, frames: f, hitNet: hitNet, netMargin: netMargin };
    }
    b.y += b.vy;
    b.x += b.vx;
    b.vy += 1;
  }
  return { landX: b.x, frames: 120, hitNet: hitNet, netMargin: netMargin };
}

function genericShot(plan, s, isLeft, urgent) {
  var best = null;
  for (var yDir = -1; yDir <= 1; yDir++) {
    var sim = simulateGenericShot(plan, yDir);
    if (sim.hitNet || !onOppCourt(sim.landX, isLeft, 0) ||
        sim.netMargin < GP.NET_MARGIN) continue;
    var idx = yDir + 4;
    var score = GP.W_LAND_DIST * Math.abs(sim.landX - s.opp.x) -
      GP.W_LAND_TIME * sim.frames +
      GP.W_NET_SAFE * Math.min(sim.netMargin, 80);
    if (yDir === 0) score += TUNE.GENERIC_FLAT_BONUS;
    if (yDir === 1) score += TUNE.GENERIC_DROP_BONUS;
    if (!best || score > best.score) best = { y: yDir, score: score, index: idx };
  }
  if (!best) {
    var arc = simulateGenericShot(plan, -1);
    return { y: -1, score: -999, index: 3, ok: !arc.hitNet };
  }
  if (urgent && best.y === 1) best.y = 0;
  best.ok = true;
  return best;
}

function genericPolicy(s, isLeft, minX, maxX, predictedX, group, path, land) {
  var towardNet = isLeft ? 1 : -1;
  var home = clamp(NET - towardNet * GP.HOME_FROM_NET, minX, maxX);
  var engineLand = s.ball.expectedLandingPointX;
  var onMine = onOurCourt(engineLand, isLeft, 0);
  var isServe = s.ball.xVelocity === 0 && onOurCourt(s.ball.x, isLeft, 0) &&
    s.meta.rallyFrameCount <= GP.SERVE_MAX_FRAME;
  if (s.self.state !== 0 && s.self.state !== 1) return neutral();
  var plan = genericPlan(s, path, minX, maxX, isServe);

  if (!plan) {
    var target = onMine ? engineLand : home;
    if (s.self.state === 0 && onMine) {
      var gap = Math.abs(engineLand - s.self.x);
      var walkReach = WALK * Math.max(0, land.f - GP.LATENCY);
      var diveReach = DIVE * Math.max(0, land.f - GP.LATENCY);
      if (gap > 15 && gap > walkReach && gap <= Math.min(diveReach, 161)) {
        return { x: sign(engineLand - s.self.x), y: 0, hit: 1 };
      }
    }
    target = clamp(target, minX, maxX);
    var homeDx = target - s.self.x;
    return { x: Math.abs(homeDx) > GP.DEADBAND ? sign(homeDx) : 0, y: 0, hit: 0 };
  }

  var dx = plan.standX - s.self.x;
  var x = Math.abs(dx) > GP.DEADBAND ? sign(dx) : 0;
  if (s.self.state === 1) {
    if (plan.f <= clamp(GP.POWER_LEAD + TUNE.GENERIC_POWER_LEAD_BIAS, 3, 12)) {
      var shot = genericShot(plan, s, isLeft, M.touchCount >= 3);
      M.selectedShot = shot.index;
      x = sign(plan.x - s.self.x) || towardNet;
      if (!shot.ok && isServe) return { x: x, y: 0, hit: 0 };
      return { x: x, y: shot.y, hit: 1 };
    }
    return { x: x, y: 0, hit: 0 };
  }
  if (plan.aerial && plan.d >= 0 && plan.d <= GP.LATENCY) {
    return { x: x, y: -1, hit: 0 };
  }
  return { x: x, y: 0, hit: 0 };
}

function counterProfileReady(isLeft) {
  if (M.counterLocked) return true;
  if (M.oppLandingCount < 1 || M.oppLandingMean === null) return false;
  var variance = M.oppLandingM2 / Math.max(1, M.oppLandingCount - 1);
  var middleZone = isLeft ?
    (M.oppLandingMean >= 68 && M.oppLandingMean <= 178) :
    (M.oppLandingMean >= 254 && M.oppLandingMean <= 364);
  var compactRatio = M.compactAttackPoseCount / M.oppLandingCount;
  var stableEnough = M.oppLandingCount === 1 || variance < 1300;
  if (M.firstThreatWasSlow === true && middleZone && stableEnough &&
      M.compactAttackPoseCount >= 1 && compactRatio >= 0.75) {
    M.counterLocked = true;
  }
  return M.counterLocked;
}

function decideCore(s) {
  var isLeft = s.side === 'LEFT';
  var towardNet = isLeft ? 1 : -1;
  var minX = isLeft ? HALF : NET + HALF;
  var maxX = isLeft ? NET - HALF : GW - HALF;
  var group = s.config && s.config.tickFrameGroupSize > 0 ?
    s.config.tickFrameGroupSize : 3;

  observe(s, isLeft);
  GP = M.v11ProfileLocked ? GP_V11_COUNTER :
    ((M.v9ProfileLocked || M.v14ProfileLocked) ? GP_V9_COUNTER : GP_BASE);

  var me = s.self;
  if (me.state >= 3) return neutral();

  var predictedX = clamp(me.x + M.lastAction.x * WALK * group,
    minX, maxX);
  var path = ballPath(s.ball, 100);
  var land = landing(path);
  var ballWillBeOurs = onOurCourt(land.x, isLeft, 0);
  var ballOnOurHalf = onOurCourt(s.ball.x, isLeft, -10);

  // 자세·코스가 함께 확인되기 전에는 범용 공수 전체를 유지한다. 단순히
  // 비슷한 낙하지점이 두 번 나왔다는 이유만으로 공격 체계까지 바꾸지 않는다.
  var profileReady = counterProfileReady(isLeft);
  if (!profileReady) {
    return genericPolicy(s, isLeft, minX, maxX, predictedX, group, path, land);
  }

  // 공중에서는 수비 점프와 공격 점프를 구분하지 않는다. 접촉 창이 생기면
  // 현재 문맥에서 가장 좋은 공격군을 고르고, 없으면 공을 따라간다.
  if (me.state === 1 || me.state === 2) {
    var descending = M.prev && me.y > M.prev.selfY;
    if (descending && me.y > 222) {
      return { x: moveInput(isLeft ? 118 : 314, predictedX, group), y: 0, hit: 0 };
    }

    var best = null;
    for (var xi = -1; xi <= 1; xi++) {
      var c = predictAirContact(s, xi, group, TUNE.COUNTER_CONTACT_HORIZON);
      if (!c) continue;
      var shot = chooseShot(c, s, isLeft);
      var urgency = 40 - c.f * 2;
      var score = shot.score + urgency - Math.abs(c.playerX - c.x) * 0.2;
      if (!best || score > best.score) best = { x: xi, contact: c, shot: shot, score: score };
    }

    if (best) {
      var chosen = best.shot;
      if (!M.airAim || s.tick > M.airAimUntil || chosen.score > M.airAim.score + 35) {
        M.airAim = chosen;
        M.airAimUntil = s.tick + group * TUNE.AIR_AIM_HOLD_GROUPS;
      }
      chosen = M.airAim;
      M.selectedShot = chosen.index;
      var approachX = best.x;
      if (approachX === 0) approachX = sign(best.contact.x - me.x);

      // hit을 너무 일찍 누르면 state=2가 실제 접촉 전에 끝난다. 아직 강타
      // 자세가 아니라면 접촉 직전까지만 따라가고, 지연 입력을 감안한 시간창에
      // 들어왔을 때 x+hit을 함께 유지해 수평속도 20의 강스파이크를 만든다.
      if (me.state !== 2 && best.contact.f > TUNE.POWER_CONTACT_LEAD) {
        return { x: approachX, y: 0, hit: 0 };
      }
      var hitX = chosen.fast ? (approachX || towardNet) : 0;
      return { x: hitX, y: chosen.y, hit: 1 };
    }

    // 선제 블로킹 중에는 공이 넘어오는 통로를 따라가며 히트를 미리 장전한다.
    var intercept = null;
    for (var q = 0; q < path.length; q++) {
      if (onOurCourt(path[q].x, isLeft, -HALF) && path[q].y >= 80 && path[q].y <= 225) {
        intercept = path[q];
        break;
      }
    }
    var airTarget = intercept ? intercept.x : (ballWillBeOurs ? land.x : (isLeft ? 124 : 308));
    var ax = sign(airTarget - predictedX);
    if (Math.abs(airTarget - predictedX) < 9) ax = 0;
    return { x: ax, y: -1, hit: 1 };
  }

  M.airAim = null;
  M.airAimUntil = 0;

  var anchor = defenseAnchor(s, isLeft, minX, maxX);
  var defense = trajectoryDefense(s, isLeft, minX, maxX, path, land, anchor);
  anchor = defense.anchor;
  var incomingFast = ballOnOurHalf &&
    ((isLeft && s.ball.xVelocity < -14) || (!isLeft && s.ball.xVelocity > 14));

  // Jayce류 고속 플랫의 핵심 대응. 상대 타격이 끝난 뒤가 아니라 직전에 뜬다.
  if (shouldPreJump(s, isLeft, anchor, predictedX, group)) {
    return { x: moveInput(anchor, predictedX, group), y: -1, hit: 0 };
  }

  // 이미 고속 공이 들어왔다면 통로로 즉시 점프한다. 너무 멀면 다이빙을 우선한다.
  if (incomingFast) {
    var corridor = null;
    for (var r = 0; r < path.length; r++) {
      if (onOurCourt(path[r].x, isLeft, -HALF) && path[r].y >= 105 && path[r].y <= 225) {
        corridor = path[r];
        break;
      }
    }
    if (corridor) {
      var gap = Math.abs(corridor.x - predictedX) - HALF;
      if (gap <= WALK * corridor.f + 12) {
        return { x: moveInput(corridor.x, predictedX, group), y: -1, hit: 0 };
      }
    }
  }

  if (!ballWillBeOurs) {
    return { x: moveInput(anchor, predictedX, group), y: 0, hit: 0 };
  }

  var plan = groundAttackPlan(s, path, minX, maxX, predictedX, group);
  if (plan) {
    var px = moveInput(plan.standX, predictedX, group);
    if (plan.jumpDelay <= group) return { x: px, y: -1, hit: 0 };
    return { x: px, y: 0, hit: 0 };
  }

  // 공격 계획이 아직 없으면 다음 셋업을 위해 낙하지점의 네트 반대쪽에 선다.
  var offset = M.touchCount >= 3 ? 18 : 8;
  var receiveX = clamp(land.x - towardNet * offset, minX, maxX);
  var dx = receiveX - predictedX;
  var framesLeft = land.f;
  var walkReach = WALK * Math.max(0, framesLeft - group) + HALF;
  var diveReach = DIVE * Math.min(Math.max(0, framesLeft - group), 12) + HALF;
  if (framesLeft <= 22 && Math.abs(dx) > walkReach && Math.abs(dx) <= diveReach &&
      (s.ball.y > 145 || framesLeft <= 9)) {
    return { x: sign(dx), y: 0, hit: 1 };
  }
  return { x: moveInput(receiveX, predictedX, group), y: 0, hit: 0 };
}

function saveState(s, action) {
  // 내가 선택한 파워히트가 실제 공에 반영된 순간 공격 결과 추적을 시작한다.
  var isLeft = s.side === 'LEFT';
  var away = isLeft ? s.ball.xVelocity > 0 : s.ball.xVelocity < 0;
  if (s.ball.isPowerHit && away && M.selectedShot !== null) {
    if (!M.liveShot || M.liveShot.rally !== M.rallySerial) {
      M.liveShot = { index: M.selectedShot, returned: false, rally: M.rallySerial };
    }
  }
  M.prev = {
    selfY: s.self.y,
    ballVx: s.ball.xVelocity,
    ballVy: s.ball.yVelocity
  };
  M.prevTick = s.tick;
  M.lastAction = action;
}

// 게임 엔진이 전역 엔트리 포인트로 찾아 호출한다.
// eslint-disable-next-line no-unused-vars
function decide(snapshot) {
  var action;
  try {
    action = decideCore(snapshot);
  } catch (e) {
    action = neutral();
  }
  action = {
    x: sign(action && action.x || 0),
    y: sign(action && action.y || 0),
    hit: action && action.hit ? 1 : 0
  };
  saveState(snapshot, action);
  return action;
}
