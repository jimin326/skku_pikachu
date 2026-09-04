'use strict';

function decide(s) {
  var NET_X = 216;              // GROUND_HALF_WIDTH
  var GROUND_WIDTH = 432;
  var PLAYER_HALF_LENGTH = 32;
  var towardNet = s.side === 'RIGHT' ? -1 : 1;

  var ownNearBoundary = s.side === 'RIGHT' ? NET_X : 0;
  var ownFarBoundary  = s.side === 'RIGHT' ? GROUND_WIDTH : NET_X;
  var standbyX = (ownNearBoundary + ownFarBoundary) / 2;

  var landingOnOwnSide =
    s.ball.expectedLandingPointX > ownNearBoundary &&
    s.ball.expectedLandingPointX < ownFarBoundary;

  var targetX;
  if (landingOnOwnSide) {
    // 공이 진짜 우리 쪽으로 온다 -- 낙하지점보다 살짝 "네트 반대쪽"에 서서
    // 몸의 네트쪽 면으로 공을 받는다 (=> 공이 네트 쪽으로 튀어나감).
    targetX = s.ball.expectedLandingPointX - towardNet * 12;
  } else {
    // 아직 상대 쪽에 있다 -- 뒤로 물러나 대기.
    targetX = standbyX;
  }

  var dx = targetX - s.self.x;
  var x = 0;
  if (Math.abs(dx) > 6) {
    x = dx > 0 ? 1 : -1;
  }

  // 점프 조건: 엄격하게 (윗해설 참고)
  var y = 0;
  var xAligned = Math.abs(s.ball.x - s.self.x) < PLAYER_HALF_LENGTH;
  var ballSlowSideways = Math.abs(s.ball.xVelocity) < 5;
  var ballClearlyHigh = s.ball.y < 150;
  if (
    s.self.state === 0 &&
    xAligned &&
    ballSlowSideways &&
    ballClearlyHigh &&
    s.ball.yVelocity > 0
  ) {
    y = -1;   // 점프 = 땅에서 y = -1
  }

  // hit은 항상 0 -- 파워히트도, 다이빙도 없음.
  return { x: x, y: y, hit: 0 };
}