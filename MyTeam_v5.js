/* ==========================================================================
 *  MyTeam_v5.js  —  피카츄 배구 봇 (자동 튜닝 산출물 / 카운터픽)
 *
 *  v4와 같은 로직, 다른 파라미터 해(解). 서로 물고 물리는 관계라 둘 다 남긴다.
 *
 *  홀드아웃(새 시드 40판)
 *    vs 내장 AI :  7승 33패   (v4는 14승)
 *    vs v4      : 26승  4패   <- v4를 이긴다
 *    vs v2      : 30승  0패
 *
 *  즉 절대 실력은 v4가 위지만 v4를 상대로는 v5가 강하다.
 *  대회 상대 스타일에 따라 바꿔 낼 수 있는 카드로 보관.
 * ========================================================================== */

/* ---------- 0. 엔진 고정 상수 ---------- */
var GROUND_WIDTH    = 432;
var NET_X           = 216;
var PLAYER_GROUND_Y = 244;

/* ---------- 1. 튜닝 파라미터 ---------- */
var P = {
  /* 이동 */
  DEADBAND:        5,
  HOME_FROM_NET:  88,    // v2:110 -> 네트 쪽으로 전진 (공격 각 확보)
  WALL_MARGIN:    29,

  /* 타격 사거리 (파워히트 판정) */
  HIT_DX:         51,
  HIT_DY:         79,
  LEAD_FRAMES:     9,    // 몇 프레임 뒤 공 위치를 보고 미리 칠지 (지연 보상)
  GRAVITY:         0.87,    // 프레임당 yVelocity 증가량

  /* 각도 결정 — 네트와의 거리로 스매시 종류를 고른다 */
  SMASH_HARD_DIST: 86,   // 이 안 + 공 높음 -> y=1 강스매시
  SMASH_HARD_BALL_Y: 184,
  SMASH_FLAT_DIST:83,   // 이 안 -> y=0 직선 (기본, 가장 확실히 넘어감)
                         // 그 밖 -> y=-1 아치

  /* 점프 제어 */
  JUMP_ALIGN:     20,
  JUMP_HIT_Y:    208,
  JUMP_LEAD:      22,
  JUMP_CEIL_Y:   131,
  JUMP_COOLDOWN:   2,

  /* 지상 파워히트 */
  GROUND_HIT_DX:  48,
  GROUND_HIT_DY:  51,
  GROUND_HIT_NET_MAX: 43,  // 네트에서 이보다 멀면 지상 타격 안 함(어차피 안 넘어감)

  /* 긴급 모드 — 자기 코트 무한 토스 방지 */
  URGENT_TICKS:   4,    // 공이 내 코트에 이 틱 이상 머물면 발동
  URGENT_BONUS:   28,    // 발동 시 사거리 확대량

  /* 기타 */
  DIVE_ENABLE: false,
  SAFE_TOUCH:      3,    // 우리 진영 접촉 추정이 이 이상이면 무조건 넘기기 모드
  DEBUG:       false
};

/* ---------- 2. 전역 상태 ---------- */
var G = {
  tick: 0, prevBallVy: 0, prevBallSide: 0,
  ownTouch: 0, ownSideTicks: 0,
  lastJumpTick: -999, jumpCount: 0, hitCount: 0
};

/* ---------- 3. 유틸 ---------- */
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

/* f 프레임 뒤 공 위치 예측 (등가속 낙하) */
function predictBall(ball, f) {
  return {
    x: ball.x + ball.xVelocity * f,
    y: ball.y + ball.yVelocity * f + 0.5 * P.GRAVITY * f * f
  };
}
/* 공이 targetY 높이에 닿기까지 남은 프레임 */
function framesUntilY(ball, targetY) {
  var d = targetY - ball.y;
  if (d <= 0) return 0;
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

  c.netDist    = Math.abs(s.self.x - NET_X);
  c.oppNetDist = Math.abs(s.opp.x - NET_X);
  c.alignErr   = Math.abs(s.ball.expectedLandingPointX - s.self.x);

  /* 지금 공 위치와, LEAD 프레임 뒤 예측 위치 — 둘 중 하나라도 사거리면 친다 */
  c.now  = { dx: s.ball.x - s.self.x, dy: s.ball.y - s.self.y };
  var pb = predictBall(s.ball, P.LEAD_FRAMES);
  c.pred = { dx: pb.x - s.self.x, dy: pb.y - s.self.y };

  /* 긴급 모드: 내 코트 체류가 길거나 접촉이 쌓임 */
  c.urgent = (G.ownSideTicks >= P.URGENT_TICKS) || (G.ownTouch >= P.SAFE_TOUCH);
  c.bonus  = c.urgent ? P.URGENT_BONUS : 0;
  return c;
}

/* ---------- 5. 접촉·체류 추적 ---------- */
function updateCounters(s, c) {
  var side = c.ballOnMySide ? -1 : 1;
  if (side !== G.prevBallSide) { G.ownTouch = 0; G.ownSideTicks = 0; G.prevBallSide = side; }
  if (c.ballOnMySide) {
    G.ownSideTicks++;
    if (G.prevBallVy > 0 && s.ball.yVelocity < 0) G.ownTouch++;   // 아래->위 반전 = 누가 침
  }
  G.prevBallVy = s.ball.yVelocity;
}

/* ---------- 6. 사거리 판정 ---------- */
function inRange(c, rx, ry) {
  var r = P.HIT_DX + c.bonus, q = P.HIT_DY + c.bonus;
  if (rx !== undefined) { r = rx + c.bonus; q = ry + c.bonus; }
  return (Math.abs(c.now.dx)  < r && Math.abs(c.now.dy)  < q) ||
         (Math.abs(c.pred.dx) < r && Math.abs(c.pred.dy) < q);
}

/* ---------- 7. 각도 선택 ----------
 *  y =  1  아래로 꽂는 강스매시 : 짧고 빠름. 네트 아주 가깝고 공 높을 때만
 *  y =  0  직선 스매시          : 넘기기 성공률 최고. 기본값
 *  y = -1  위로 아치            : 깊게. 네트에서 멀 때의 유일한 선택 */
function pickAngle(s, c) {
  if (c.netDist >= P.SMASH_FLAT_DIST) return -1;                 // 너무 멀면 아치뿐
  if (!c.urgent && c.netDist < P.SMASH_HARD_DIST &&
      s.ball.y < P.SMASH_HARD_BALL_Y &&
      c.oppNetDist >= P.SMASH_HARD_DIST) return 1;               // 상대가 뒤에 있을 때만 꽂기
  return 0;                                                       // 기본: 직선
}

/* ---------- 8. 행동 결정 ---------- */
function chooseAction(s, c) {
  var out = { x: 0, y: 0, hit: 0 };
  var st = s.self.state;
  if (st !== 0 && st !== 1) return out;

  /* --- 공중: 예측 사거리에 들어오면 파워히트 --- */
  if (st === 1) {
    out.x = (Math.abs(c.now.dx) > P.DEADBAND) ? sign(c.now.dx) : 0;
    if (inRange(c)) {
      out.hit = 1;
      out.x = (c.now.dx !== 0) ? sign(c.now.dx) : c.towardNet;   // nonzero = 타구 속도 2배
      out.y = pickAngle(s, c);
      G.hitCount++;
    }
    return out;
  }

  /* --- 지상 --- */
  var targetX = c.mine ? s.ball.expectedLandingPointX : c.homeX;
  if (c.urgent && c.mine) {
    targetX = targetX + c.towardNet * 18;                        // 살짝 전진해서 넘길 각 확보
  }
  targetX = clamp(targetX, c.minX + P.WALL_MARGIN, c.maxX - P.WALL_MARGIN);

  var dx = targetX - s.self.x;
  out.x = (Math.abs(dx) > P.DEADBAND) ? sign(dx) : 0;

  if (!c.mine) return out;

  /* (a) 지상 파워히트 — 네트에서 너무 멀면 어차피 못 넘기니 시도조차 안 한다.
         멀리서는 몸으로 받아 띄우고(무입력) 그 사이 네트 쪽으로 전진 -> 다음 터치에 공격.
         주의: 지상에서 hit=1 + x!=0 은 다이빙이므로 x를 0으로 눌러야 파워히트가 나감 */
  if (c.netDist < P.GROUND_HIT_NET_MAX &&
      inRange(c, P.GROUND_HIT_DX, P.GROUND_HIT_DY)) {
    out.x = 0;
    out.y = (c.netDist < P.SMASH_FLAT_DIST) ? 0 : -1;            // 직선 우선
    out.hit = 1;
    G.hitCount++;
    return out;
  }

  /* (b) 점프 — 칠 수 있을 때만. 긴급 모드에선 조건 완화 */
  var cooled  = (G.tick - G.lastJumpTick) > P.JUMP_COOLDOWN;
  var aligned = c.alignErr < (P.JUMP_ALIGN + c.bonus);
  var falling = s.ball.yVelocity > 0;
  var high    = s.ball.y < P.JUMP_CEIL_Y;
  var timing  = framesUntilY(s.ball, P.JUMP_HIT_Y) <= (P.JUMP_LEAD + c.bonus);

  if (cooled && aligned && falling && high && timing) {
    out.y = -1;
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
    updateCounters(snapshot, c);
    var out = chooseAction(snapshot, c);

    if (P.DEBUG && G.tick % 60 === 0) {
      console.log('[t' + G.tick + ']', snapshot.side,
        'st', snapshot.self.state, 'netD', c.netDist,
        'ball', snapshot.ball.x + ',' + snapshot.ball.y,
        'stay', G.ownSideTicks, 'touch', G.ownTouch, 'urgent', c.urgent,
        '| jump', G.jumpCount, 'hit', G.hitCount, '->', JSON.stringify(out));
    }
    return out;
  } catch (e) {
    if (P.DEBUG) console.error('decide error', e);
    return { x: 0, y: 0, hit: 0 };
  }
}