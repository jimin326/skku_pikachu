'use strict';
/*
 * OurBot_v9.js — leonyi(피카츄) 배구 봇  [JavaScript]
 * ============================================================================
 * v8 → v9 변경 요약
 *   1) 실제 입력 흐름(1프레임 지연 + tick 위상 0/1/2 무작위 + READY 구간 사전결정)에서
 *      3위상 모두를 대상으로 튠. (v8은 위상 0에 과적합)
 *   2) 공이 상대 코트로 가면(내 스매시 직후 포함, 공중에서도) 즉시 대기 위치로 복귀.
 *      → v8의 "스매시 후 공을 따라가다 구석에 몰리는" 패턴 제거.
 *   3) 파워히트 예측 수정: 접촉 시 vy = max(|vy|,15)·yDir·2 (엔진과 동일). v8은 max 누락.
 *   4) 스매시 순간의 x 입력을 예측에 쓴 xDir과 일치시킴(|x|=1 → vx 20, 0 → 10).
 *   5) 도달 불가 공: 걷기로 못 닿으면 다이빙(도달 시간 계산 기반).
 *   6) 착지 직전 hit 홀드 해제 → 착지 순간 의도치 않은 다이빙 방지.
 *   7) 당일 스킬 대비 훅: 스냅샷의 새 필드 자동 로깅 + skillPolicy() 자리.
 *
 * 규약: decide(snapshot) → {x:-1|0|1, y:-1|0|1, hit:0|1}. 매 3프레임 호출, 결과는 다음 3프레임 유지.
 * DEBUG=true면 F12 콘솔에 스매시 로그(점프당 1회) + 첫 tick에 스냅샷 새 필드 로그.
 * ============================================================================
 */
const DEBUG = true;

// ── 엔진 상수(physics.js) ──────────────────────────────────────────────────
const NET_X = 216, GW = 432, HALF = 32, PLAYER_LEN = 64;
const NET_HALF = 25, NTT = 176, NTB = 192, BALL_GY = 252, PLAYER_GY = 244;

// ── 튜닝 상수(param_search.mjs가 이 블록을 통째로 교체) ──────────────────
//@PARAMS_BEGIN
const STANDBY_FRAC = 0.52;   // 대기 위치: 내 코트 안쪽에서의 비율(0=벽, 1=네트)
const WALK_DB = 6;         // 걷기 데드밴드(px) — 결정 1회=3프레임=18px 이동이라 9 이상이어야 진동 안 함
const BODY_OFF = 5;         // 낙하점 대비 몸 위치 오프셋(네트 반대쪽 +)
const JUMP_ALIGN = 32;      // 점프 허용 |ball.x-me.x|
const JUMP_MIN_Y = 32;     // 점프 고려 공 높이대(하강 중)
const JUMP_MAX_Y = 162;
const JUMP_MAX_VX = 10;      // 점프 허용 공 |vx|
const HOLD_K = 10;          // 접촉이 이 프레임 안에 예측되면 파워히트 홀드
const OPP_CLOSE = 40;       // 상대가 이 거리 안이면 아치샷(y=-1) 강제
const DIVE_Y = 155;         // 다이빙 고려 최소 공 높이
const DIVE_SLACK = 8;       // 걷기 도달 판정 여유(px)
const DIVE_REACH = 20;      // 다이빙 도달 여유(px)
const LAND_GUARD = 218;     // 이 y 아래(=지면 근처)에서 하강 중이면 hit 해제
const TRACK_AHEAD = 3;      // 공중 추적: 몇 프레임 뒤 공 x를 따라갈지
const TRACK_DB = 4;
const FAR_DX = 110;          // 공중 추적: 공이 이보다 멀면 낙하점 기준
const MUST_CROSS_AT = 3;    // 내 연속 접촉이 이 수 이상이면 다음 접촉은 반드시 넘긴다(5회면 실점)
const PRESS_BODY_OFF = 2;   // 압박 시 몸 오프셋(몸통 바운스가 네트 쪽으로 가게)
const JUMP_HIT_K = 3;       // 점프 직후 이 프레임 안에 접촉 예측 시 점프+파워히트 동시 입력(0=끔)
//@PARAMS_END

let prevMeY = PLAYER_GY, loggedThisJump = false, loggedFields = false;
// 터치 리밋(한쪽 연속 5회 접촉 = 실점) 대비: 내 연속 접촉 수 추정. ELP는 선수 접촉 때만 바뀐다.
let prevELP = null, prevOnMySide = null, myTouches = 0, prevRally = -1;

// 공 궤적 시뮬(physics.js와 동일한 벽/네트/천장 처리) → {x: 착지 x, frames}
function flight(x, y, vx, vy) {
  let n = 0;
  while (n++ < 1000) {
    if (x + vx < 0 || x + vx > GW) vx = -vx;
    if (y + vy < 0) vy = 1;
    if (Math.abs(x - NET_X) < NET_HALF && y > NTT) {
      if (y < NTB) { if (vy > 0) vy = -vy; }
      else { vx = x < NET_X ? -Math.abs(vx) : Math.abs(vx); }
    }
    if (y + vy > BALL_GY) break;
    y += vy; x += vx; vy += 1;
  }
  return { x, frames: n };
}
// 공이 y >= targetY 에 도달하기까지 프레임 수(그 시점 x 포함)
function framesUntilY(x, y, vx, vy, targetY) {
  let n = 0;
  while (n < 400) {
    if (y >= targetY && vy > 0) break;
    if (x + vx < 0 || x + vx > GW) vx = -vx;
    if (y + vy < 0) vy = 1;
    if (Math.abs(x - NET_X) < NET_HALF && y > NTT) {
      if (y < NTB) { if (vy > 0) vy = -vy; }
      else { vx = x < NET_X ? -Math.abs(vx) : Math.abs(vx); }
    }
    y += vy; x += vx; vy += 1; n++;
    if (y > BALL_GY) break;
  }
  return { n, x };
}
// n프레임 뒤 공 x
function stepN(x, y, vx, vy, n) {
  for (let i = 0; i < n; i++) {
    if (x + vx < 0 || x + vx > GW) vx = -vx;
    if (y + vy < 0) vy = 1;
    if (Math.abs(x - NET_X) < NET_HALF && y > NTT) {
      if (y < NTB) { if (vy > 0) vy = -vy; }
      else { vx = x < NET_X ? -Math.abs(vx) : Math.abs(vx); }
    }
    if (y + vy > BALL_GY) break;
    y += vy; x += vx; vy += 1;
  }
  return x;
}
// 파워히트 결과 예측(엔진 규칙: vx=±(|xDir|+1)·10, vy=max(|vy|,15)·yDir·2)
function powerHitLanding(xDir, yDir, bx, by, bvy) {
  const vx = bx < NET_X ? (Math.abs(xDir) + 1) * 10 : -(Math.abs(xDir) + 1) * 10;
  const vy = Math.max(Math.abs(bvy), 15) * yDir * 2;
  return flight(bx, by, vx, vy);
}
// 점프 궤적 테이블(엔진: vy=-16 시작, 매 프레임 +1) — JUMP_Y[t], JUMP_VY[t]: 점프 후 t프레임째 y와 그 시점 vy
const JUMP_Y = [], JUMP_VY = [];
{ let yy = PLAYER_GY, vv = -16; for (let t = 0; t < 40; t++) { yy += vv; if (yy < PLAYER_GY) vv += 1; else { yy = PLAYER_GY; vv = 0; } JUMP_Y.push(yy); JUMP_VY.push(vv); if (yy === PLAYER_GY) break; } }
function jumpVy(y, descending) {            // 현재 y와 하강 여부로 수직속도 추정
  let best = 0;
  for (let t = 0; t < JUMP_Y.length; t++) if (JUMP_Y[t] === y && ((t > 15) === descending)) return JUMP_VY[t];
  for (let t = 0; t < JUMP_Y.length; t++) if (JUMP_Y[t] === y) best = JUMP_VY[t];
  return best;
}
// 앞으로 maxK프레임 동안 공(월드 충돌 포함)·나(점프 궤적, x는 xIn·6/f)를 전진시켜 첫 충돌(|dx|<=32,|dy|<=32) 예측
function predictContact(ball, me, meVy, xIn, maxK) {
  let bx = ball.x, by = ball.y, bvx = ball.xVelocity, bvy = ball.yVelocity;
  let px = me.x, py = me.y, pvy = meVy;
  for (let k = 1; k <= maxK; k++) {
    if (bx + bvx < 0 || bx + bvx > GW) bvx = -bvx;
    if (by + bvy < 0) bvy = 1;
    if (Math.abs(bx - NET_X) < NET_HALF && by > NTT) {
      if (by < NTB) { if (bvy > 0) bvy = -bvy; }
      else { bvx = bx < NET_X ? -Math.abs(bvx) : Math.abs(bvx); }
    }
    if (by + bvy > BALL_GY) return null;      // 공이 먼저 땅에
    by += bvy; bx += bvx; bvy += 1;
    px += xIn * 6; py += pvy;
    if (py < PLAYER_GY) pvy += 1; else return null;   // 내가 먼저 착지
    if (Math.abs(bx - px) <= HALF && Math.abs(by - py) <= HALF) return { x: bx, y: by, vy: bvy, k, py };
  }
  return null;
}
// 상대 코트에 떨어지는 샷 중 "상대가 이동해도 가장 못 닿는" 샷. 없으면 null.
function choosePowerHit(ball, oppX, isP2) {
  let best = null;
  for (const xDir of [1, 0]) for (const yDir of [-1, 0, 1]) {
    const f = powerHitLanding(xDir, yDir, ball.x, ball.y, ball.yVelocity);
    const oppSide = isP2 ? f.x < NET_X : f.x > NET_X;
    if (!oppSide) continue;
    // 상대가 비행시간 동안 6px/f로 이동 + 몸 32 + 다이빙 여유 → 그래도 남는 거리
    const margin = Math.abs(f.x - oppX) - Math.min(6 * f.frames, 200) - HALF;
    const score = margin + (yDir === 1 ? 15 : 0) - f.frames * 0.5; // 빠른 샷 선호
    if (!best || score > best.score) best = { xDir, yDir, score, land: f.x, frames: f.frames, margin };
  }
  return best;
}

// ── 당일 스킬 대비 훅 ────────────────────────────────────────────────────
// 스냅샷에 새 필드가 생기면 첫 tick에 F12 콘솔로 전체 키를 보여준다.
const KNOWN = { top: ['tick', 'side', 'self', 'opp', 'ball', 'meta', 'config'],
  self: ['x', 'y', 'state', 'frameNumber', 'divingDirection'],
  ball: ['x', 'y', 'xVelocity', 'yVelocity', 'isPowerHit', 'expectedLandingPointX'],
  meta: ['score', 'isPlayer2Serve', 'rallyFrameCount'], config: ['tickFrameGroupSize'] };
function logNewFields(s) {
  if (loggedFields) return; loggedFields = true;
  const extra = [];
  for (const k of Object.keys(s)) if (!KNOWN.top.includes(k)) extra.push(`${k}=${JSON.stringify(s[k])}`);
  for (const sec of ['self', 'ball', 'meta', 'config']) if (s[sec]) for (const k of Object.keys(s[sec])) if (!KNOWN[sec].includes(k)) extra.push(`${sec}.${k}=${JSON.stringify(s[sec][k])}`);
  if (s.opp) for (const k of Object.keys(s.opp)) if (!KNOWN.self.includes(k)) extra.push(`opp.${k}=${JSON.stringify(s.opp[k])}`);
  console.log(`[OurBot ${s.side}] 새 스냅샷 필드: ${extra.length ? extra.join(', ') : '없음'}`);
}
// 당일: 게이지/스킬 필드를 읽어 기본 행동(base)을 바꾸는 자리. 지금은 그대로 반환.
function skillPolicy(s, base) { return base; }

// 규약 안전장치: 예외가 나도 중립 입력을 돌려주고(라운드 무효화 방지) 오류는 종류별로 1번만 콘솔에 남긴다.
// 반환값도 항상 규약 범위(x,y ∈ {-1,0,1}, hit ∈ {0,1})로 정리한다.
let lastErr = '';
function decide(s) {
  try {
    const a = decideCore(s) || {};
    const cl = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
    return { x: cl(a.x | 0), y: cl(a.y | 0), hit: a.hit ? 1 : 0 };
  } catch (e) {
    const m = String((e && e.message) || e);
    if (m !== lastErr) { lastErr = m; console.error(`[OurBot] decide 오류 → 중립 입력으로 대체: ${m}`); }
    return { x: 0, y: 0, hit: 0 };
  }
}

function decideCore(s) {
  const me = s.self, opp = s.opp, ball = s.ball, isLeft = s.side === 'LEFT', isP2 = !isLeft;
  const towardNet = isLeft ? 1 : -1;
  const courtMin = isLeft ? 0 : NET_X, courtMax = isLeft ? NET_X : GW;
  const moveMin = courtMin + HALF, moveMax = courtMax - HALF;
  const standbyX = isLeft ? courtMin + NET_X * STANDBY_FRAC : courtMax - NET_X * STANDBY_FRAC;
  if (DEBUG) logNewFields(s);

  const meDescending = me.y > prevMeY; prevMeY = me.y;
  const fl = flight(ball.x, ball.y, ball.xVelocity, ball.yVelocity);
  const ballMine = isLeft ? fl.x < NET_X : fl.x > NET_X;   // 벽(0/432) 착지도 내 공

  // 내 연속 접촉 수 추정(새 랠리/네트 통과 시 리셋, 내 근처에서 ELP가 바뀌면 +1)
  const onMySide = isLeft ? ball.x < NET_X : ball.x > NET_X;
  if (s.meta.rallyFrameCount < prevRally) { myTouches = 0; prevELP = null; prevOnMySide = null; }
  prevRally = s.meta.rallyFrameCount;
  if (prevOnMySide !== null && onMySide !== prevOnMySide) myTouches = 0;
  if (onMySide && prevELP !== null && ball.expectedLandingPointX !== prevELP &&
      Math.abs(ball.x - me.x) < 90 && Math.abs(ball.y - me.y) < 90) myTouches++;
  prevELP = ball.expectedLandingPointX; prevOnMySide = onMySide;
  const pressure = myTouches >= MUST_CROSS_AT;           // 다음 접촉은 꼭 넘겨야 함
  let x = 0, y = 0, hit = 0;

  const walkTo = (tx) => { tx = tx < moveMin ? moveMin : tx > moveMax ? moveMax : tx; const d = tx - me.x; return Math.abs(d) > WALK_DB ? (d > 0 ? 1 : -1) : 0; };

  // 다이빙/누움 중: 입력 무의미
  if (me.state === 3 || me.state === 4) return skillPolicy(s, { x: 0, y: 0, hit: 0 });

  if (me.state === 0) {
    loggedThisJump = false;
    if (!ballMine) return skillPolicy(s, { x: walkTo(standbyX), y: 0, hit: 0 });

    // 공이 내 코트로 온다: 낙하점(몸 오프셋) 으로 이동. 압박 시엔 몸통 바운스가 네트로 가게 더 뒤에 선다
    const target = fl.x - towardNet * (pressure ? PRESS_BODY_OFF : BODY_OFF);
    x = walkTo(target);

    // 점프: 공 하강 중 + 정렬 + 높이대 + 옆속도 제한 (압박 시 창을 넓혀 파워히트 기회 확보)
    const jMaxY = pressure ? 200 : JUMP_MAX_Y, jAlign = pressure ? JUMP_ALIGN + 10 : JUMP_ALIGN, jVx = pressure ? JUMP_MAX_VX + 4 : JUMP_MAX_VX;
    if (ball.yVelocity > 0 && Math.abs(ball.xVelocity) < jVx &&
        Math.abs(ball.x - me.x) < jAlign && ball.y > JUMP_MIN_Y && ball.y < jMaxY) y = -1;
    // 늦은 점프 보정: 점프 직후 접촉이 예측되면 점프와 동시에 파워히트(엔진은 같은 프레임에 점프→state1→파워히트 처리).
    // 몸통 바운스(자기 쪽으로 튀어 터치 누적) 대신 최소한 로브(y=-1)로 넘긴다.
    if (y === -1 && JUMP_HIT_K > 0) {
      const cj = predictContact(ball, { x: me.x, y: PLAYER_GY }, -16, x, JUMP_HIT_K);
      if (cj) hit = 1;
    }

    // 다이빙: 걷기로는 착지 전에 못 닿고, 다이빙(8px/f, ~10f)이면 닿을 때
    const tg = fl.frames - 1;                              // 공이 바닥에 닿기까지 남은 프레임
    const need = Math.abs(fl.x - me.x) - HALF;             // 몸 폭 제외하고 좁혀야 하는 거리
    if (ball.y > DIVE_Y && need > 6 * tg + DIVE_SLACK && need <= 8 * Math.min(tg, 10) + DIVE_REACH) {
      hit = 1; x = fl.x > me.x ? 1 : -1; y = 0;
    }
    return skillPolicy(s, { x, y, hit });
  }

  // ── 공중(state 1/2) ──
  if (!ballMine) {                       // 내 스매시 직후 등: 공중에서도 대기 위치로 복귀
    return skillPolicy(s, { x: walkTo(standbyX), y: 0, hit: 0 });
  }
  // 공이 가까우면 3프레임 뒤 공 x를, 멀면(상대 코트 등) 낙하점을 따라간다
  const ballFar = Math.abs(ball.x - me.x) > FAR_DX || (isLeft ? ball.x > NET_X : ball.x < NET_X);
  const trackX = ballFar ? fl.x : stepN(ball.x, ball.y, ball.xVelocity, ball.yVelocity, TRACK_AHEAD);
  const tdx = trackX - me.x;
  x = Math.abs(tdx) > TRACK_DB ? (tdx > 0 ? 1 : -1) : 0;

  // 접촉 예측: 앞으로 HOLD_K프레임 안에 공이 내 히트박스에 들어오면 파워히트 홀드(각도는 접촉점 기준)
  const meVy = jumpVy(me.y, meDescending);
  const c = predictContact(ball, me, meVy, x, HOLD_K);
  const landingSoon = meDescending && me.y > LAND_GUARD;   // 착지 직전엔 hit 금지(다이빙 오발 방지)
  if (c && !landingSoon) {
    const shot = choosePowerHit({ x: c.x, y: c.y, yVelocity: c.vy }, opp.x, isP2);
    if (shot) {
      y = shot.yDir;
      if (Math.abs(opp.x - me.x) < OPP_CLOSE && y !== -1) y = -1;
      // 접촉 순간 |x|가 공 속도를 정함(1→20, 0→10). 방향은 추적 방향 유지.
      if (shot.xDir === 0) x = 0; else if (x === 0) x = tdx >= 0 ? 1 : -1;
      hit = 1;
      if (DEBUG && !loggedThisJump) { console.log(`[OurBot ${s.side}] SMASH t${s.tick} ball(${ball.x | 0},${ball.y | 0}) self(${me.x | 0},${me.y | 0}) -> x${x} y${y} contact+${c.k}f(${c.x | 0},${c.y | 0}) land~${shot.land | 0} margin${shot.margin | 0}`); loggedThisJump = true; }
    }
  }
  return skillPolicy(s, { x, y, hit });
}