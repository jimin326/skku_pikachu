'use strict';
// Probe_v1.js — 실제 게임의 입력 지연/tick 위상 측정용 봇. 경기력은 없음(가만히 서서 가끔 한 tick만 오른쪽으로 이동).
// 로그: [PROBE] 접두어. 지연 L프레임이면 이동 명령 다음 스냅샷에서 self.x가 6*(3-L)만큼, 그 다음에 6*L만큼 변함.
let n = 0, phaseArmed = true, lastBallY = null, moveTick = -1, x0 = 0, seen = 0;
function decide(s) {
  n++;
  // (1) 위상: READY 동안 공 y=0(정지) → 처음 y>0이 되는 스냅샷의 y가 6/3/1이면 위상 0/1/2
  if (s.ball.y === 0 && Math.abs(s.ball.xVelocity) === 0) { phaseArmed = true; }
  else if (phaseArmed && s.ball.y > 0 && s.ball.yVelocity > 0 && Math.abs(s.ball.xVelocity) === 0 && (s.ball.x === 56 || s.ball.x === 376)) {
    phaseArmed = false;
    console.log(`[PROBE] ${s.side} serve-first-y=${s.ball.y} tick=${s.tick} rally=${s.meta.rallyFrameCount}`);
  }
  // (2) 지연: 지상에 서 있고 공이 멀 때, 한 tick만 x=+1 → 다음 두 스냅샷의 dx 기록
  let x = 0;
  if (moveTick < 0 && s.self.state === 0 && n % 40 === 20 && Math.abs(s.ball.x - s.self.x) > 120 && s.self.x < 150 + (s.side === 'RIGHT' ? 216 : 0)) {
    moveTick = s.tick; x0 = s.self.x; x = 1; seen = 0;
  } else if (moveTick >= 0) {
    seen++;
    console.log(`[PROBE] ${s.side} latency-probe dx${seen}=${s.self.x - x0} (tick ${s.tick}, cmd at ${moveTick})`);
    x0 = s.self.x;
    if (seen >= 2) moveTick = -1;
  }
  // 상대(AI)가 이기게 두되 너무 빨리 끝나지 않게: 아무것도 안 함
  return { x, y: 0, hit: 0 };
}
