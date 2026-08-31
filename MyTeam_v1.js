/* ==========================================================================
 *  MyTeam_v1.js  —  피카츄 배구 봇 (SKKU x HYU CSE 교류전 AI 부문)
 *  단일 파일 / 최상위에 decide(snapshot) -> {x, y, hit}
 *
 *  구조 (현장 대응용으로 일부러 3단 분리)
 *    readContext()  : 스냅샷 -> 방향/거리 등 파생값
 *    computeTarget(): "어디로 갈 것인가"
 *    chooseAction() : "무엇을 누를 것인가"
 *  => 당일 스킬 추가 시 대부분 chooseAction 안에서만 손보면 됨
 * ========================================================================== */

/* ---------- 0. 엔진 고정 상수 (건드리지 말 것) ---------- */
var GROUND_WIDTH      = 432;
var NET_X             = 216;   // 네트 x
var PLAYER_GROUND_Y   = 244;   // 땅에 서 있을 때 캐릭터 y
var BALL_GROUND_Y     = 252;
var BALL_RADIUS       = 20;
var PLAYER_HALF       = 32;

/* ---------- 1. 튜닝 파라미터 (현장에서 여기만 만진다) ---------- */
var P = {
  DEADBAND:        8,    // 목표 x와 이만큼 이상 벌어져야 이동 (1틱 지연 진동 방지)
  HOME_FROM_NET: 100,    // 공이 상대 코트일 때 대기 위치 (네트로부터 거리)
  WALL_MARGIN:    25,    // 벽/네트에 끼지 않도록 남기는 여유

  JUMP_DX:        45,    // 공과 수평거리가 이 안일 때만 점프
  JUMP_Y_MIN:     40,    // 공이 이보다 아래(y가 큼)이고
  JUMP_Y_MAX:    190,    //   이보다 위(y가 작음)일 때 점프

  HIT_DX:         50,    // 파워히트 발동 수평 허용 오차
  HIT_DY:         50,    // 파워히트 발동 수직 허용 오차
  SMASH_NET_DIST: 80,    // 네트에서 이 안이면 강스매시(y=1), 밖이면 아치(y=-1)

  DIVE_ENABLE:  true,
  DIVE_BALL_Y:   200,    // 공이 이보다 낮고(y가 크고)
  DIVE_DX_MIN:    50,    //   수평거리가 이 구간이면 다이빙
  DIVE_DX_MAX:   115,

  SAFE_TOUCH:      3,    // 자기 진영 접촉이 이 횟수 이상이면 무조건 넘기기 (5회룰 방어)
  DEBUG:       false     // true면 100틱마다 로그
};

/* ---------- 2. 틱 사이 유지되는 전역 상태 ---------- */
var G = {
  tick:        0,
  prevBallVy:  0,
  prevBallSide: 0,   // -1 = 내 코트, 1 = 상대 코트
  ownTouch:    0     // 이번에 내 코트로 넘어온 뒤 우리 쪽 접촉 추정 횟수
};

/* ---------- 3. 유틸 ---------- */
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function sign(v)          { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

/* ---------- 4. 컨텍스트: 스냅샷 -> 파생값 ---------- */
function readContext(s) {
  var isLeft = (s.side === 'LEFT');
  var c = {
    isLeft:    isLeft,
    towardNet: isLeft ? 1 : -1,                    // 네트 쪽으로 가는 x 부호
    minX:      isLeft ? 0     : NET_X,
    maxX:      isLeft ? NET_X : GROUND_WIDTH,
    ball:      s.ball,
    self:      s.self,
    opp:       s.opp
  };
  c.homeX = NET_X - c.towardNet * P.HOME_FROM_NET; // 대기 위치

  // 공이 내 코트에 있는가 / 내 코트로 떨어질 예정인가
  c.ballOnMySide  = isLeft ? (s.ball.x < NET_X) : (s.ball.x >= NET_X);
  c.landingOnMine = isLeft ? (s.ball.expectedLandingPointX <  NET_X)
                           : (s.ball.expectedLandingPointX >= NET_X);

  c.bdx    = s.ball.x - s.self.x;        // 공까지 수평 (부호 있음)
  c.bdy    = s.ball.y - s.self.y;        // 음수면 공이 내 머리 위
  c.absbdx = Math.abs(c.bdx);
  c.netDist = Math.abs(s.self.x - NET_X); // 내가 네트에서 떨어진 거리
  return c;
}

/* ---------- 5. 5회 연속 접촉 룰 방어용 접촉 추정 ----------
 * 스냅샷에 접촉 횟수 필드가 없으므로 추정한다.
 * - 공이 네트를 건너면 카운터 리셋
 * - 내 코트에서 yVelocity 부호가 (아래→위)로 뒤집히면 = 누군가 쳤다 -> +1
 */
function updateTouchCounter(s, c) {
  var side = c.ballOnMySide ? -1 : 1;
  if (side !== G.prevBallSide) { G.ownTouch = 0; G.prevBallSide = side; }
  if (c.ballOnMySide && G.prevBallVy > 0 && s.ball.yVelocity < 0) { G.ownTouch++; }
  G.prevBallVy = s.ball.yVelocity;
}

/* ---------- 6. 목표 위치 ---------- */
function computeTarget(s, c) {
  var t;
  if (c.landingOnMine || c.ballOnMySide) {
    t = s.ball.expectedLandingPointX;   // 매 틱 새로 읽는다 (캐시 금지)
  } else {
    t = c.homeX;                        // 상대 턴이면 홈 포지션 복귀
  }
  return clamp(t, c.minX + P.WALL_MARGIN, c.maxX - P.WALL_MARGIN);
}

/* ---------- 7. 행동 결정 ---------- */
function chooseAction(s, c, targetX) {
  var out = { x: 0, y: 0, hit: 0 };
  var st  = s.self.state;

  // state 2(파워히트) / 3(다이빙) / 4(누움) / 5,6(라운드 종료) -> 입력 무시됨
  if (st !== 0 && st !== 1) return out;

  // (a) 이동: 목표 x를 향해, 데드밴드 적용
  var dx = targetX - s.self.x;
  out.x = (Math.abs(dx) > P.DEADBAND) ? sign(dx) : 0;

  // (b) 공중: 히트박스에 들어오면 파워히트
  if (st === 1) {
    out.x = (c.absbdx > P.DEADBAND) ? sign(c.bdx) : 0;  // 공중에선 공을 직접 추적
    if (c.absbdx < P.HIT_DX && Math.abs(c.bdy) < P.HIT_DY) {
      out.hit = 1;
      // 스매시 각도: 네트에서 멀면 y=1은 자책골. 아치(y=-1)로 안전하게.
      var forceSafe = (G.ownTouch >= P.SAFE_TOUCH);        // 5회룰 임박 -> 확실히 넘긴다
      out.y = (!forceSafe && c.netDist < P.SMASH_NET_DIST) ? 1 : -1;
    }
    return out;
  }

  // (c) 지상: 다이빙 (state 0 + x!=0 + hit=1 세 조건 동시 충족해야 발동)
  if (P.DIVE_ENABLE && (c.landingOnMine || c.ballOnMySide) &&
      s.ball.yVelocity > 0 && s.ball.y > P.DIVE_BALL_Y &&
      c.absbdx > P.DIVE_DX_MIN && c.absbdx < P.DIVE_DX_MAX) {
    out.x = sign(c.bdx);
    out.hit = 1;
    return out;
  }

  // (d) 지상: 점프 (땅에서 y=-1 = 점프)
  if ((c.landingOnMine || c.ballOnMySide) &&
      c.absbdx < P.JUMP_DX &&
      s.ball.y > P.JUMP_Y_MIN && s.ball.y < P.JUMP_Y_MAX) {
    out.y = -1;
  }

  return out;
}

/* ---------- 8. 엔트리 포인트 ---------- */
function decide(snapshot) {
  G.tick++;
  try {
    var c = readContext(snapshot);
    updateTouchCounter(snapshot, c);
    var targetX = computeTarget(snapshot, c);
    var out = chooseAction(snapshot, c, targetX);

    if (P.DEBUG && G.tick % 100 === 0) {
      console.log('[t' + G.tick + ']', snapshot.side,
                  'self', snapshot.self.x, 'st', snapshot.self.state,
                  'ball', snapshot.ball.x + ',' + snapshot.ball.y,
                  'lp', snapshot.ball.expectedLandingPointX,
                  'touch', G.ownTouch, '->', JSON.stringify(out));
    }
    return out;
  } catch (e) {
    // 예외 발생 틱은 어차피 무입력 처리. 로그만 남기고 안전값 반환.
    if (P.DEBUG) console.error('decide error', e);
    return { x: 0, y: 0, hit: 0 };
  }
}