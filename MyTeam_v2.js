/* ==========================================================================
 *  MyTeam_v2.js  —  피카츄 배구 봇
 *  v1 대비 변경점
 *   1) 점프 남발 억제 : "칠 수 있는 공"에만 점프 (낙하 도달시간 예측 + 정렬 + 쿨다운)
 *   2) 지상 파워히트  : 낮게 오는 공은 점프 없이 지상에서 처리
 *   3) 공격력 강화    : 공중 파워히트 시 x를 반드시 nonzero로 -> 타구 속도 2배
 *   4) 각도 선택      : 상대 위치를 보고 강스매시(짧고 빠름) / 아치(깊게) 선택
 * ========================================================================== */

/* ---------- 0. 엔진 고정 상수 ---------- */
var GROUND_WIDTH    = 432;
var NET_X           = 216;
var PLAYER_GROUND_Y = 244;
var BALL_GROUND_Y   = 252;

/* ---------- 1. 튜닝 파라미터 (현장에서 여기만 만진다) ---------- */
var P = {
  /* 이동 */
  DEADBAND:         8,   // 목표 x와 이만큼 벌어져야 이동 (진동 방지)
  HOME_FROM_NET:  110,   // 상대 턴일 때 대기 위치 (네트로부터 거리)
  WALL_MARGIN:     25,

  /* 점프 억제 — v2 핵심 */
  JUMP_ALIGN:      32,   // 낙하지점과 이 안으로 정렬됐을 때만 점프
  JUMP_HIT_Y:     195,   // 점프해서 때리려는 목표 높이
  JUMP_LEAD:       15,   // 공이 그 높이 도달까지 남은 프레임이 이 이하면 점프
  JUMP_CEIL_Y:    180,   // 공이 이보다 낮으면(y가 크면) 점프 포기 -> 지상 처리
  JUMP_COOLDOWN:    5,   // 착지 후 재점프 금지 틱 수
  GRAVITY:          1,   // 프레임당 yVelocity 증가량 (낙하 예측용)

  /* 공중 파워히트 */
  HIT_DX:          55,
  HIT_DY:          55,
  SMASH_NET_DIST:  95,   // 네트에서 이 안일 때만 강스매시(y=1) 허용
  SMASH_MIN_BALL_Y:215,  // 공이 이보다 높을 때(y<값)만 강스매시
  OPP_NEAR_NET:    95,   // 상대가 네트에서 이 안이면 아치로 뒤를 노림

  /* 지상 파워히트 (구제용) */
  GROUND_HIT_DX:   42,
  GROUND_HIT_DY:   48,

  /* 기타 */
  DIVE_ENABLE:  false,   // 다이빙은 실패 시 누움(state4) 패널티가 커서 기본 OFF
  DIVE_BALL_Y:    205,
  DIVE_DX_MIN:     50,
  DIVE_DX_MAX:    115,
  SAFE_TOUCH:       3,   // 우리 진영 접촉 추정치가 이 이상이면 무조건 안전하게 넘김
  DEBUG:        false
};

/* ---------- 2. 틱 사이 유지되는 전역 상태 ---------- */
var G = {
  tick: 0, prevBallVy: 0, prevBallSide: 0, ownTouch: 0,
  lastJumpTick: -999, jumpCount: 0, hitCount: 0
};

/* ---------- 3. 유틸 ---------- */
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function sign(v)          { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

/* 공이 targetY 높이에 닿기까지 남은 프레임 수 (등가속 낙하 가정)
 *   y(t) = y + vy*t + 0.5*g*t^2  ->  t = (-vy + sqrt(vy^2 + 2*g*d)) / g   */
function framesUntilY(ball, targetY) {
  var d = targetY - ball.y;
  if (d <= 0) return 0;                       // 이미 그 높이보다 아래
  var vy = ball.yVelocity, g = P.GRAVITY;
  var disc = vy * vy + 2 * g * d;
  if (disc < 0) return 999;
  return (-vy + Math.sqrt(disc)) / g;
}

/* ---------- 4. 컨텍스트 ---------- */
function readContext(s) {
  var isLeft = (s.side === 'LEFT');
  var c = {
    isLeft: isLeft,
    towardNet: isLeft ? 1 : -1,
    minX: isLeft ? 0 : NET_X,
    maxX: isLeft ? NET_X : GROUND_WIDTH
  };
  c.homeX = NET_X - c.towardNet * P.HOME_FROM_NET;

  c.ballOnMySide  = isLeft ? (s.ball.x <  NET_X) : (s.ball.x >= NET_X);
  c.landingOnMine = isLeft ? (s.ball.expectedLandingPointX <  NET_X)
                           : (s.ball.expectedLandingPointX >= NET_X);
  c.mine = c.ballOnMySide || c.landingOnMine;

  c.bdx      = s.ball.x - s.self.x;
  c.bdy      = s.ball.y - s.self.y;
  c.absbdx   = Math.abs(c.bdx);
  c.netDist  = Math.abs(s.self.x - NET_X);
  c.oppNetDist = Math.abs(s.opp.x - NET_X);
  c.alignErr = Math.abs(s.ball.expectedLandingPointX - s.self.x);
  return c;
}

/* ---------- 5. 5회 연속 접촉 룰 방어 (접촉 추정) ---------- */
function updateTouchCounter(s, c) {
  var side = c.ballOnMySide ? -1 : 1;
  if (side !== G.prevBallSide) { G.ownTouch = 0; G.prevBallSide = side; }
  if (c.ballOnMySide && G.prevBallVy > 0 && s.ball.yVelocity < 0) G.ownTouch++;
  G.prevBallVy = s.ball.yVelocity;
}

/* ---------- 6. 목표 위치 ---------- */
function computeTarget(s, c) {
  var t = c.mine ? s.ball.expectedLandingPointX : c.homeX;
  return clamp(t, c.minX + P.WALL_MARGIN, c.maxX - P.WALL_MARGIN);
}

/* ---------- 7. 스매시 각도 선택 ----------
 *  y = 1  : 아래로 꽂는 강스매시 (짧고 빠름) — 네트 근처 + 공이 높을 때만 안전
 *  y = -1 : 위로 아치 (깊고 안전)
 *  상대가 네트 앞에 붙어 있으면 아치로 뒤를 노리고, 뒤에 있으면 강스매시로 앞을 친다. */
function pickSmashAngle(s, c) {
  if (G.ownTouch >= P.SAFE_TOUCH) return -1;                 // 5회룰 임박 -> 무조건 안전
  var canSmash = (c.netDist < P.SMASH_NET_DIST) &&
                 (s.ball.y < P.SMASH_MIN_BALL_Y);
  if (!canSmash) return -1;                                  // 멀거나 낮으면 자책 위험
  return (c.oppNetDist < P.OPP_NEAR_NET) ? -1 : 1;           // 상대 전진 -> 뒤로 아치
}

/* ---------- 8. 행동 결정 ---------- */
function chooseAction(s, c, targetX) {
  var out = { x: 0, y: 0, hit: 0 };
  var st = s.self.state;
  if (st !== 0 && st !== 1) return out;   // 2/3/4/5/6 은 입력 무시 구간

  /* --- 공중 (state 1) : 공을 직접 추적하고, 범위 들어오면 파워히트 --- */
  if (st === 1) {
    out.x = (c.absbdx > P.DEADBAND) ? sign(c.bdx) : 0;
    if (c.absbdx < P.HIT_DX && Math.abs(c.bdy) < P.HIT_DY) {
      out.hit = 1;
      // 파워히트 순간 x가 0이 아니면 타구 속도 2배. 반드시 nonzero로 강제.
      out.x = (c.bdx !== 0) ? sign(c.bdx) : c.towardNet;
      out.y = pickSmashAngle(s, c);
      G.hitCount++;
    }
    return out;
  }

  /* --- 지상 (state 0) --- */
  var dx = targetX - s.self.x;
  out.x = (Math.abs(dx) > P.DEADBAND) ? sign(dx) : 0;

  if (!c.mine) return out;                // 상대 턴이면 홈 복귀만

  // (a) 다이빙 (기본 OFF)
  if (P.DIVE_ENABLE && s.ball.yVelocity > 0 && s.ball.y > P.DIVE_BALL_Y &&
      c.absbdx > P.DIVE_DX_MIN && c.absbdx < P.DIVE_DX_MAX) {
    out.x = sign(c.bdx); out.hit = 1;
    return out;
  }

  // (b) 지상 파워히트 — 점프할 여유가 없는 낮은 공 구제
  //     주의: 지상에서 hit=1 + x!=0 은 다이빙이 되므로 x를 0으로 눌러야 파워히트가 나감
  if (c.absbdx < P.GROUND_HIT_DX && Math.abs(c.bdy) < P.GROUND_HIT_DY) {
    out.x = 0;
    out.y = -1;          // 지상 타구는 속도 2배가 안 되므로 아치로 안전하게
    out.hit = 1;
    G.hitCount++;
    return out;
  }

  // (c) 점프 — 아래 4조건 전부 만족할 때만 (v2 핵심: 남발 억제)
  var cooled  = (G.tick - G.lastJumpTick) > P.JUMP_COOLDOWN;
  var aligned = c.alignErr < P.JUMP_ALIGN;      // 낙하지점에 이미 도착해 있고
  var falling = s.ball.yVelocity > 0;           // 공이 내려오는 중이고
  var high    = s.ball.y < P.JUMP_CEIL_Y;       // 아직 점프로 닿을 높이에 있고
  var timing  = framesUntilY(s.ball, P.JUMP_HIT_Y) <= P.JUMP_LEAD;  // 타이밍이 맞을 때

  if (cooled && aligned && falling && high && timing) {
    out.y = -1;                                  // 지상에서 y=-1 = 점프
    G.lastJumpTick = G.tick;
    G.jumpCount++;
  }
  return out;
}

/* ---------- 9. 엔트리 포인트 ---------- */
function decide(snapshot) {
  G.tick++;
  try {
    var c = readContext(snapshot);
    updateTouchCounter(snapshot, c);
    var out = chooseAction(snapshot, c, computeTarget(snapshot, c));

    if (P.DEBUG && G.tick % 100 === 0) {
      console.log('[t' + G.tick + ']', snapshot.side,
        'self', snapshot.self.x, 'st', snapshot.self.state,
        'ball', snapshot.ball.x + ',' + snapshot.ball.y,
        'lp', snapshot.ball.expectedLandingPointX,
        'jump', G.jumpCount, 'hit', G.hitCount, 'touch', G.ownTouch,
        '->', JSON.stringify(out));
    }
    return out;
  } catch (e) {
    if (P.DEBUG) console.error('decide error', e);
    return { x: 0, y: 0, hit: 0 };
  }
}