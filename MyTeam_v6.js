/* ==========================================================================
 *  MyTeam_v6.js  —  피카츄 배구 봇 (탄도 예측 플래너 + 자동 튜닝)
 *
 *  v5까지의 반응형 휴리스틱을 버리고, 엔진 물리를 그대로 재현한 예측 위에서
 *  "언제 어디서 어떻게 칠지"를 매 틱 계획한다. 이후 P 블록 숫자를 자동 튜닝.
 *
 *  홀드아웃(튜닝에 쓰지 않은 새 시드 40판)
 *    vs 내장 AI : 40승 0패 (397:49)      <- v4는 14승, v5는 7승
 *    vs v4      : 29승 1패
 *    vs v5      : 30승 0패
 *
 *  엔진 소스(physics.js)에서 확인한 사실 — 이 봇의 설계 근거
 *   - 공 중력: yVelocity += 1 / 프레임 (정확히 1)
 *   - 벽 반사: x+vx 가 0 미만이거나 432 초과면 vx 부호 반전
 *   - 천장  : y+vy < 0 이면 vy = 1
 *   - 네트  : |x-216| < 25 이고 y > 176 일 때 기둥 위/옆 충돌 분기
 *   - 이동  : 프레임당 6px (다이빙 8px)
 *   - 점프  : yVelocity = -16, 중력 +1 -> 최고점 y=108 (약 16프레임), 체공 약 32프레임
 *   - 충돌  : |ball.x-player.x| <= 32 AND |ball.y-player.y| <= 32
 *   - ★ 파워히트는 state===1(점프 중)에서만 발동한다. 지상 파워히트는 존재하지 않는다.
 *        지상 hit=1 + x!=0 은 다이빙일 뿐이고, x=0 이면 아무 일도 일어나지 않는다.
 *   - ★ 파워히트가 아닌 접촉은 yVelocity = -max(|vy|,15) -> 무조건 위로 뜬다.
 *        "제자리에서 공만 띄우는" 현상의 정체가 바로 이것.
 *   - ★ 파워히트 타구: xVelocity = ±(|x입력|+1)*10, yVelocity = |vy| * y입력 * 2
 *        y=0 이면 yVelocity가 0 -> 완전 수평 강타. 가장 강력하지만 접촉이 낮으면 네트행.
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
  HORIZON:        79,   // 몇 프레임 앞까지 공 궤적을 예측할지
  LATENCY:         3,   // 입력이 반영되기까지의 프레임 (3프레임 주기 + 1틱 지연)
  DEADBAND:        8,   // 목표 x와 이만큼 벌어져야 이동
  HOME_FROM_NET:  96,   // 상대 턴일 때 대기 위치
  WALL_MARGIN:    30,   // 코트 끝에서 남길 여유 (플레이어 반폭이 32)

  REACH_X:        23,   // 충돌 32 중 실제로 노릴 여유 (예측 오차 마진)
  REACH_Y:        18,

  /* 타격 지점 선호도 (점수가 높은 계획을 고른다) */
  W_HEIGHT:      1.2,  // 높은 곳에서 칠수록 가산 (y가 작을수록)
  W_NET:         0.92,  // 네트에 가까울수록 가산
  W_EARLY:       0.41,  // 빨리 칠수록 가산

  /* 파워히트 타이밍 */
  POWER_LEAD:      9,   // 접촉 몇 프레임 전부터 hit=1 을 눌러둘지
  JUMP_MAX_DELAY: 17,   // 몇 프레임 뒤 점프까지 계획에 넣을지

  /* 각도 결정 (파워히트 순간의 y 입력) */
  FLAT_MAX_Y:    111,   // 접촉 높이가 이보다 위(y<값)일 때만 y=0 수평강타 허용
  SMASH_MAX_Y:   111,   // 이보다 더 위 + 네트 근처면 y=1 내리꽂기
  SMASH_NET_DIST: 63,
  OPP_NEAR_NET:   174,   // 상대가 네트에 붙어 있으면 내리꽂기 대신 아치로 뒤를 노림

  /* 안전 장치 */
  SAFE_TOUCH:      3,   // 우리 진영 접촉 추정이 이 이상이면 무조건 안전하게 넘김
  DEBUG:       false
};

/* ---------- 2. 전역 상태 ---------- */
var G = {
  tick: 0, prevBallVy: 0, prevBallSide: 0,
  ownTouch: 0, ownSideTicks: 0,
  planHits: 0, jumps: 0
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
      path.push({ x: x, y: BALL_GROUND_Y, ground: true, f: f });
      return path;
    }
    y = y + vy; x = x + vx; vy += 1;
    path.push({ x: x, y: y, ground: false, f: f });
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
function makePlan(s, path, minX, maxX) {
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
        P.W_HEIGHT * (PLAYER_GROUND_Y - p.y) +
        P.W_NET * (NET_X - Math.abs(p.x - NET_X)) * 0.5 -
        P.W_EARLY * f +
        (aerial ? 60 : 0);
      if (best === null || score > best.score) {
        best = { f: f, x: p.x, y: p.y, d: d2, standX: standX, score: score, aerial: aerial };
      }
    }
  }
  return best;
}

/* ---------- 8. 파워히트 각도 ---------- */
function pickAngle(s, plan, netDistAtHit, oppNetDist, urgent) {
  /* y=0 수평강타는 접촉이 충분히 높을 때만. 낮으면 네트에 그대로 박는다. */
  if (urgent || plan.y > P.FLAT_MAX_Y) return -1;             // 아치 (안전)
  if (plan.y < P.SMASH_MAX_Y && netDistAtHit < P.SMASH_NET_DIST &&
      oppNetDist >= P.OPP_NEAR_NET) return 1;                 // 내리꽂기
  return 0;                                                    // 수평강타 (기본 공격)
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

    var st = s.self.state;
    var out = { x: 0, y: 0, hit: 0 };
    if (st !== 0 && st !== 1) return out;      // 2/3/4/5/6 은 입력 무시 구간

    var path = predictPath(s.ball, P.HORIZON);
    var plan = makePlan(s, path, minX, maxX);

    /* --- 계획 없음: 예상 낙하지점 근처에서 대기 --- */
    if (plan === null) {
      var lp = s.ball.expectedLandingPointX;
      var landsMine = isLeft ? (lp < NET_X) : (lp >= NET_X);
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
        out.y = pickAngle(s, plan, Math.abs(plan.x - NET_X),
                          Math.abs(s.opp.x - NET_X), urgent);
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