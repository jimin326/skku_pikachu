/* 자동 튜닝 산출물 — tools/tune.mjs
 * 버전 v11 / 세대 3
 * 적합도 17.44 (내장AI 마진 7.3, 챔피언 마진 8.8)
 * P 블록의 숫자만 자동 조정되었고 로직은 베이스와 동일하다.
 */
/* ==========================================================================
 *  MyTeam_v8.js  —  피카츄 배구 봇 (타구 결과 시뮬레이션 + 슬라이드)
 *
 *  홀드아웃(튜닝에 쓰지 않은 새 시드 40판)
 *    vs 내장 AI : 40승 0패 (400:66)
 *    vs v7      : 30승 0패 (300:36)   <- 직접 대결 완승
 *
 *  v7 대비 변경
 *   1) 타구 결과 시뮬레이션
 *      치기 전에 y=-1/0/1 세 각도를 각각 끝까지 시뮬레이션해서
 *      "네트를 넘는가 / 어디에 떨어지는가 / 몇 프레임 만에 떨어지는가" 를 확인하고 고른다.
 *      네트 여유(NET_MARGIN)가 부족한 각도는 아예 후보에서 제외 -> 아슬아슬한 타구 소멸.
 *
 *      LEFT 서브(x=56) 실측 — 접촉 높이별 수평강타(y=0)의 네트 여유:
 *        접촉 y=100 -> 여유 31 (낙하 x=396, 18프레임)  OK
 *        접촉 y=110 -> 여유 21 (낙하 x=396, 18프레임)  OK
 *        접촉 y=120 -> 여유 11                          기각
 *        접촉 y=136 -> 여유 -5  (네트 스침)             기각  <- v7이 여기서 불안정했다
 *      즉 충분히 높은 지점에서 잡았을 때만 수평 스파이크를 쓰고,
 *      낮게 잡히면 아치(y=-1, 여유 125~149)로 안전하게 넘긴다.
 *
 *   2) 공격 목표 선정
 *      상대 위치에서 가장 멀고, 가장 빨리 떨어지는 낙하점을 만드는 각도를 고른다.
 *      (W_LAND_DIST / W_LAND_TIME) 파워히트의 코스 자체는 엔진이 정하므로,
 *      실제로 조작 가능한 각도·속도 안에서 최선을 고르는 방식.
 *
 *   3) 슬라이드(다이빙)
 *      걸어서는 못 미치는 공을 다이빙으로 살린다. 엔진상 다이빙은 수평속도 6 -> 8.
 *      실패 시 누움(state 4) 패널티가 크므로 "걸어서 못 갈 때만" 발동한다.
 *
 *  엔진 소스에서 확인한 사실 — 설계 근거
 *   - 공 중력 yVelocity += 1 / 프레임, 벽 반사는 x+vx 가 0 미만 또는 432 초과일 때
 *   - 이동 6px/프레임, 다이빙 8px/프레임
 *   - 점프 yVelocity=-16 -> 최고점 y=108(16프레임), 체공 약 32프레임
 *   - 충돌 |ball.x-player.x| <= 32 AND |ball.y-player.y| <= 32
 *   - 파워히트는 state===1(점프 중)에서만. 지상 파워히트는 존재하지 않는다.
 *   - 파워히트가 아닌 접촉은 yVelocity = -max(|vy|,15) -> 무조건 위로 뜬다.
 *   - 파워히트 타구: xVelocity = ±(|x입력|+1)*10, yVelocity = max(|vy|,15) * y입력 * 2
 * ========================================================================== */

/* ---------- 0. 엔진 고정 상수 ---------- */
var GROUND_WIDTH      = 432;
var NET_X             = 216;
var PLAYER_GROUND_Y   = 244;
var BALL_GROUND_Y     = 252;
var HALF              = 32;    // 충돌 반경 (x, y 공통)
var PLAYER_SPEED      = 6;     // 프레임당 수평 이동
var NET_PILLAR_HW     = 25;
var NET_TOP_TOP_Y     = 176;
var NET_TOP_BOTTOM_Y  = 192;

/* ---------- 1. 튜닝 파라미터 ---------- */
var P = {
  HORIZON:        83,   // 몇 프레임 앞까지 공 궤적을 예측할지
  LATENCY:         0,   // 입력이 반영되기까지의 프레임 (3프레임 주기 + 1틱 지연)
  DEADBAND:        8,   // 목표 x와 이만큼 벌어져야 이동
  HOME_FROM_NET:  133,   // 상대 턴일 때 대기 위치
  WALL_MARGIN:    38,   // 코트 끝에서 남길 여유 (플레이어 반폭이 32)

  REACH_X:        28,   // 충돌 32 중 실제로 노릴 여유 (예측 오차 마진)
  REACH_Y:        22,

  /* 타격 지점 선호도 (점수가 높은 계획을 고른다) */
  W_HEIGHT:      1.86,  // 높은 곳에서 칠수록 가산 (y가 작을수록)
  W_NET:         1.45,  // 네트에 가까울수록 가산
  W_EARLY:       0.57,  // 빨리 칠수록 가산

  /* 파워히트 타이밍 */
  POWER_LEAD:      8,   // 접촉 몇 프레임 전부터 hit=1 을 눌러둘지
  JUMP_MAX_DELAY: 16,   // 몇 프레임 뒤 점프까지 계획에 넣을지

  /* 각도 결정 (파워히트 순간의 y 입력) */
  FLAT_MAX_Y:    117,   // 접촉 높이가 이보다 위(y<값)일 때만 y=0 수평강타 허용
  SMASH_MAX_Y:   95,   // 이보다 더 위 + 네트 근처면 y=1 내리꽂기
  SMASH_NET_DIST: 30,
  OPP_NEAR_NET:   141,   // 상대가 네트에 붙어 있으면 내리꽂기 대신 아치로 뒤를 노림

  /* 서브 전용 — 궤적이 결정적이므로 별도 처리 */
  SERVE_MAX_FRAME: 11,  // 랠리 시작 후 이 프레임 안쪽이면 서브 상황
  SERVE_FLAT_MAX_Y:214, // 서브 접촉이 이보다 위(y<값)면 y=0 수평 스파이크
  SERVE_W_HEIGHT:  4.21, // 서브 때는 높은 접촉을 훨씬 강하게 선호
  SERVE_COMMIT:    25,  // 서브는 접촉까지 멀어도 점프 계획을 실행

  /* 타구 결과 시뮬레이션 (v8 신규) */
  NET_MARGIN:     33,   // 네트 통과 시 이만큼 여유가 없으면 그 각도는 버린다
  W_LAND_DIST:   2.51,  // 낙하지점이 상대에게서 멀수록 가산
  W_LAND_TIME:   1.29,  // 빨리 떨어질수록 가산 (반응 시간을 뺏음)
  W_NET_SAFE:    0.3,  // 네트 여유가 클수록 가산

  /* 다이빙 (슬라이드) */
  DIVE_ENABLE:  true,
  DIVE_SPEED:      8,   // 다이빙 수평 속도 (엔진값)
  DIVE_MAX_GAP:  178,   // 걸어서 못 가는 거리가 이 안쪽이면 다이빙으로 시도
  DIVE_MIN_GAP:    20,   // 이보다 가까우면 굳이 다이빙 안 함

  /* 안전 장치 */
  SAFE_TOUCH:      1,   // 우리 진영 접촉 추정이 이 이상이면 무조건 안전하게 넘김
  DEBUG:       false
};

/* ---------- 2. 전역 상태 ---------- */
var G = {
  tick: 0, prevBallVy: 0, prevBallSide: 0,
  ownTouch: 0, ownSideTicks: 0,
  planHits: 0, jumps: 0, dives: 0
};

/* ---------- 3. 점프 궤적 테이블 (한 번만 계산) ----------
 * 점프 입력 프레임을 0으로 두고, 그 이후 n프레임 뒤 플레이어 y.
 * physics.js 의 점프/중력 처리를 그대로 재현. */
var JUMP_Y = (function () {
  var t = [PLAYER_GROUND_Y], y = PLAYER_GROUND_Y, vy = -16;
  for (var i = 0; i < 40; i++) {
    y = y + vy;
    if (y < PLAYER_GROUND_Y) { vy += 1; }
    else { y = PLAYER_GROUND_Y; vy = 0; }
    t.push(y);
    if (i > 2 && y === PLAYER_GROUND_Y) break;   // 착지
  }
  return t;
})();
var JUMP_LEN = JUMP_Y.length - 1;                // 체공 프레임 수

/* ---------- 4. 공 궤적 예측 ----------
 * physics.js 의 processCollisionBetweenBallAndWorldAndSetBallPosition 를
 * 프레임 단위로 그대로 재현한다. 벽 반사, 천장, 네트, 바닥 전부 포함. */
function predictPath(ball, frames) {
  var x = ball.x, y = ball.y, vx = ball.xVelocity, vy = ball.yVelocity;
  var path = [];
  for (var f = 1; f <= frames; f++) {
    if (x + vx < 0 || x + vx > GROUND_WIDTH) { vx = -vx; }      // 벽
    if (y + vy < 0) { vy = 1; }                                  // 천장
    if (Math.abs(x - NET_X) < NET_PILLAR_HW && y > NET_TOP_TOP_Y) {   // 네트
      if (y <= NET_TOP_BOTTOM_Y) { if (vy > 0) { vy = -vy; } }
      else { vx = (x < NET_X) ? -Math.abs(vx) : Math.abs(vx); }
    }
    if (y + vy > BALL_GROUND_Y) {                                // 바닥 -> 랠리 종료
      path.push({ x: x, y: BALL_GROUND_Y, vy: vy, vx: vx, ground: true, f: f });
      return path;
    }
    y = y + vy; x = x + vx; vy += 1;
    path.push({ x: x, y: y, vy: vy, vx: vx, ground: false, f: f });
  }
  return path;
}

/* ---------- 5. 유틸 ---------- */
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

/* ---------- 6. 접촉·체류 추적 (5회 룰 방어) ---------- */
function updateCounters(s, onMySide) {
  var side = onMySide ? -1 : 1;
  if (side !== G.prevBallSide) { G.ownTouch = 0; G.ownSideTicks = 0; G.prevBallSide = side; }
  if (onMySide) {
    G.ownSideTicks++;
    if (G.prevBallVy > 0 && s.ball.yVelocity < 0) { G.ownTouch++; }
  }
  G.prevBallVy = s.ball.yVelocity;
}

/* ---------- 7. 계획 수립 ----------
 * 가능한 (점프 지연 d, 접촉 프레임 f) 조합을 훑어 가장 좋은 타격 계획을 고른다.
 * 반환: {f, x, y, d, score} 또는 null
 *   f = 접촉 프레임, x/y = 그때 공 위치, d = 몇 프레임 뒤 점프할지(-1이면 지상 접촉) */
function makePlan(s, path, minX, maxX, isServe) {
  var best = null;
  var selfX = s.self.x;
  var airborne = (s.self.state === 1);

  for (var i = 0; i < path.length; i++) {
    var p = path[i];
    if (p.ground) break;
    var f = p.f;
    if (p.x < minX - HALF || p.x > maxX + HALF) continue;   // 내 코트 밖
    if (f <= P.LATENCY) continue;                            // 지금 명령해도 못 미침

    /* 수평 도달 가능성: 지연을 뺀 시간만큼 6px/frame 으로 움직일 수 있다 */
    var moveFrames = f - P.LATENCY;
    var lo = clamp(selfX - PLAYER_SPEED * moveFrames, minX, maxX);
    var hi = clamp(selfX + PLAYER_SPEED * moveFrames, minX, maxX);
    var wantLo = p.x - P.REACH_X, wantHi = p.x + P.REACH_X;
    if (hi < wantLo || lo > wantHi) continue;                // 못 간다
    var standX = clamp(p.x, Math.max(lo, wantLo), Math.min(hi, wantHi));

    /* 세로: 지상 접촉인지, 점프해야 닿는지 */
    var candidates = [];
    if (Math.abs(p.y - PLAYER_GROUND_Y) <= P.REACH_Y) candidates.push(-1);   // 서서 닿음
    if (airborne) {
      /* 이미 공중 — 현재 점프의 남은 궤적으로 닿는지 본다 */
      var elapsed = 0;
      for (var k = 0; k <= JUMP_LEN; k++) { if (JUMP_Y[k] === s.self.y) { elapsed = k; break; } }
      var idx = elapsed + f;
      if (idx <= JUMP_LEN && Math.abs(p.y - JUMP_Y[idx]) <= P.REACH_Y) candidates.push(-2);
    } else {
      for (var d = P.LATENCY; d <= P.JUMP_MAX_DELAY && d < f; d++) {
        var j = f - d;
        if (j <= JUMP_LEN && Math.abs(p.y - JUMP_Y[j]) <= P.REACH_Y) { candidates.push(d); break; }
      }
    }
    if (candidates.length === 0) continue;

    for (var ci = 0; ci < candidates.length; ci++) {
      var d2 = candidates[ci];
      var aerial = (d2 !== -1);
      /* 점수: 높이 + 네트 근접 + 빠른 처리. 지상 접촉은 파워히트가 안 되므로 크게 감점 */
      var score =
        (isServe ? P.SERVE_W_HEIGHT : P.W_HEIGHT) * (PLAYER_GROUND_Y - p.y) +
        P.W_NET * (NET_X - Math.abs(p.x - NET_X)) * 0.5 -
        (isServe ? 0 : P.W_EARLY) * f +
        (aerial ? 60 : 0);
      if (best === null || score > best.score) {
        best = { f: f, x: p.x, y: p.y, vy: p.vy, d: d2, standX: standX, score: score, aerial: aerial };
      }
    }
  }
  return best;
}

/* ---------- 8. 타구 결과 시뮬레이션 ----------
 * 파워히트 공식 (physics.js processCollisionBetweenBallAndPlayer, playerState===2)
 *   xVelocity = ±(|x입력| + 1) * 10        (부호는 공이 네트 어느 쪽에 있느냐로 결정)
 *   yVelocity = max(|현재 vy|, 15) * y입력 * 2
 * 이 공식으로 타구 초기 속도를 만든 뒤, 월드 물리를 그대로 돌려
 * "네트를 넘는가 / 어디에 떨어지는가 / 몇 프레임 만에 떨어지는가" 를 미리 본다.
 * 아슬아슬하게 네트를 넘는 위험한 타구는 여기서 걸러진다. */
function simulateShot(bx, by, vyAtContact, xIn, yIn) {
  var vx = (bx < NET_X) ? (Math.abs(xIn) + 1) * 10 : -(Math.abs(xIn) + 1) * 10;
  var vy = Math.max(Math.abs(vyAtContact), 15) * yIn * 2;
  var x = bx, y = by;
  var netMargin = 999, hitNet = false;

  for (var f = 1; f <= 120; f++) {
    if (x + vx < 0 || x + vx > GROUND_WIDTH) { vx = -vx; }
    if (y + vy < 0) { vy = 1; }
    if (Math.abs(x - NET_X) < NET_PILLAR_HW && y > NET_TOP_TOP_Y) {
      hitNet = true;                                   // 네트에 걸렸다
      if (y <= NET_TOP_BOTTOM_Y) { if (vy > 0) { vy = -vy; } }
      else { vx = (x < NET_X) ? -Math.abs(vx) : Math.abs(vx); }
    }
    /* 네트 기둥 위를 지나는 순간의 여유 높이를 기록 */
    if (Math.abs(x - NET_X) < NET_PILLAR_HW + 20) {
      var m = NET_TOP_TOP_Y - y;
      if (m < netMargin) netMargin = m;
    }
    if (y + vy > BALL_GROUND_Y) {
      return { landX: x, frames: f, hitNet: hitNet, netMargin: netMargin };
    }
    y = y + vy; x = x + vx; vy += 1;
  }
  return { landX: x, frames: 120, hitNet: hitNet, netMargin: netMargin };
}

/* y 입력 -1/0/1 을 모두 시뮬레이션해서 가장 좋은 것을 고른다.
 * 반환 {y, ok} — ok=false 면 어떤 각도도 안전하지 않다는 뜻 */
function chooseShot(s, plan, isLeft, urgent) {
  var oppMinX = isLeft ? NET_X : 0;
  var oppMaxX = isLeft ? GROUND_WIDTH : NET_X;
  var best = null;

  for (var yi = -1; yi <= 1; yi++) {
    var r = simulateShot(plan.x, plan.y, plan.vy, 1, yi);
    if (r.hitNet) continue;                                   // 네트에 걸림 -> 탈락
    if (r.landX < oppMinX || r.landX > oppMaxX) continue;      // 내 코트에 떨어짐 -> 탈락
    if (r.netMargin < P.NET_MARGIN) continue;                  // 아슬아슬 -> 탈락
    var score =
      P.W_LAND_DIST * Math.abs(r.landX - s.opp.x) -
      P.W_LAND_TIME * r.frames +
      P.W_NET_SAFE * Math.min(r.netMargin, 80);
    if (best === null || score > best.score) {
      best = { y: yi, score: score, land: r.landX, frames: r.frames };
    }
  }
  if (best === null) {
    /* 전부 위험 -> 그 중 네트라도 넘는 것 (아치가 가장 안전) */
    var arc = simulateShot(plan.x, plan.y, plan.vy, 1, -1);
    return { y: -1, ok: !arc.hitNet };
  }
  if (urgent) return { y: best.y === 1 ? 0 : best.y, ok: true };   // 급하면 덜 위험한 각도
  return { y: best.y, ok: true };
}

/* ---------- 9. 엔트리 포인트 ---------- */
function decide(snapshot) {
  G.tick++;
  try {
    var s = snapshot;
    var isLeft = (s.side === 'LEFT');
    var minX = isLeft ? HALF : NET_X + HALF;
    var maxX = isLeft ? NET_X - HALF : GROUND_WIDTH - HALF;
    var towardNet = isLeft ? 1 : -1;
    var homeX = clamp(NET_X - towardNet * P.HOME_FROM_NET, minX, maxX);

    var onMySide = isLeft ? (s.ball.x < NET_X) : (s.ball.x >= NET_X);
    updateCounters(s, onMySide);
    var urgent = (G.ownTouch >= P.SAFE_TOUCH);
    /* 서브 판정: 아직 아무도 안 친 공은 xVelocity 가 정확히 0 (엔진 초기값) */
    var isServe = (s.ball.xVelocity === 0 && onMySide &&
                   s.meta.rallyFrameCount <= P.SERVE_MAX_FRAME);

    var st = s.self.state;
    var out = { x: 0, y: 0, hit: 0 };
    if (st !== 0 && st !== 1) return out;      // 2/3/4/5/6 은 입력 무시 구간

    var path = predictPath(s.ball, P.HORIZON);
    var plan = makePlan(s, path, minX, maxX, isServe);

    /* --- 계획 없음: 예상 낙하지점 근처에서 대기 --- */
    if (plan === null) {
      var lp = s.ball.expectedLandingPointX;
      var landsMine = isLeft ? (lp < NET_X) : (lp >= NET_X);

      /* 걸어서는 못 미치지만 다이빙(슬라이드)이면 닿는 공을 살린다.
         엔진: state 0 + x!=0 + hit=1 -> 다이빙. 수평속도 6 -> 8 로 올라간다.
         실패하면 누움(state 4) 패널티가 있으므로 "걸어서 못 갈 때만" 쓴다. */
      if (P.DIVE_ENABLE && st === 0 && landsMine) {
        var gap = Math.abs(lp - s.self.x);
        var framesLeft = 0;
        for (var pi = 0; pi < path.length; pi++) { if (path[pi].ground) { framesLeft = path[pi].f; break; } }
        var walkReach = PLAYER_SPEED * Math.max(0, framesLeft - P.LATENCY);
        var diveReach = P.DIVE_SPEED * Math.max(0, framesLeft - P.LATENCY);
        if (gap > P.DIVE_MIN_GAP && gap > walkReach &&
            gap <= Math.min(diveReach, P.DIVE_MAX_GAP)) {
          out.x = sign(lp - s.self.x);
          out.hit = 1;                                  // 다이빙 발동
          G.dives++;
          return out;
        }
      }

      var t = clamp(landsMine ? lp : homeX, minX, maxX);
      var dx0 = t - s.self.x;
      out.x = (Math.abs(dx0) > P.DEADBAND) ? sign(dx0) : 0;
      return out;
    }

    /* --- 수평 이동: 타격 지점으로 --- */
    var dx = plan.standX - s.self.x;
    out.x = (Math.abs(dx) > P.DEADBAND) ? sign(dx) : 0;

    /* --- 공중: 접촉이 임박하면 파워히트 --- */
    if (st === 1) {
      if (plan.f <= P.POWER_LEAD) {
        out.hit = 1;
        out.x = (plan.x !== s.self.x) ? sign(plan.x - s.self.x) : towardNet;  // nonzero = 타구 속도 2배
        var shot = chooseShot(s, plan, isLeft, urgent);
        out.y = shot.y;
        if (!shot.ok && isServe) { out.hit = 0; out.y = 0; }   // 서브는 무리하지 않는다
        G.planHits++;
      }
      return out;
    }

    /* --- 지상: 계획이 "지금 점프" 라고 하면 점프 --- */
    if (plan.aerial && plan.d >= 0 && plan.d <= P.LATENCY) {
      out.y = -1;
      G.jumps++;
    }

    if (P.DEBUG && G.tick % 60 === 0) {
      console.log('[t' + G.tick + ']', s.side, 'st', st,
        'ball', s.ball.x + ',' + s.ball.y,
        'plan f' + plan.f + ' @' + plan.x + ',' + plan.y + ' d' + plan.d,
        'touch', G.ownTouch, '| jump', G.jumps, 'hit', G.planHits,
        '->', JSON.stringify(out));
    }
    return out;
  } catch (e) {
    if (P.DEBUG) console.error('decide error', e);
    return { x: 0, y: 0, hit: 0 };
  }
}