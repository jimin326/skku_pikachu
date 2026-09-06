'use strict';
/* (궤적 예측 + 스매시 결과 역산 봇)에
   발톱 스킬(발동·회피)만 얹은 버전. 스킬 로직은 파일 하단 finalize에 모아뒀다. */

var GW = 432, HALF = 216, BR = 20, GY = 252, PY = 244, PHL = 32;
/* 공 중심의 이동 범위. 양쪽 벽 모두 공 중심이 화면 끝에 닿을 때 반사한다 —
   왼쪽을 BR(20)로 쓰면 엔진과 어긋난다. */
var BOUNCE_MIN_X = 0, BOUNCE_MAX_X = GW;
var NET_TOP = 176, NET_BOT = 192, NET_HW = 25;

/* --- 스킬 상수 (skills.md 참고) --- */
var CLAW_COST = 55;
var CLAW_WIDTH = 60;
var CLAW_WARN = 25;                        /* 발톱 예고 프레임 */
var CLAW_DANGER = CLAW_WIDTH / 2 + PHL;    /* = 62. |self.x - centerX|가 이하면 위험 */
var DODGE_MIN_FRAMES = 7;                  /* 남은 프레임이 이 이하면 이미 늦음 */

/* 점프 아크: ARC[t] = 점프 t프레임 후 플레이어 y (yVelocity=-16, 중력 +1) */
var ARC = (function () {
  var a = [PY], y = PY, yv = -16;
  for (var t = 1; t < 40; t++) {
    y += yv;
    if (y < PY) { yv += 1; a.push(y); } else { a.push(PY); break; }
  }
  return a;
})();
var AIR = ARC.length - 1;

/* 엔진의 월드 스텝을 그대로 재현한 궤적 시뮬레이터 */
function simTraj(x, y, xv, yv, maxF) {
  var out = [];
  for (var f = 1; f <= maxF; f++) {
    if (x + xv < BOUNCE_MIN_X || x + xv > BOUNCE_MAX_X) xv = -xv;
    if (y + yv < 0) yv = 1;
    if (Math.abs(x - HALF) < NET_HW && y > NET_TOP) {
      if (y <= NET_BOT) { if (yv > 0) yv = -yv; }
      else { xv = x < HALF ? -Math.abs(xv) : Math.abs(xv); }
    }
    var fy = y + yv;
    if (fy > GY) { out.push({ x: x, y: GY, yv: -yv, ground: true }); return out; }
    y = fy; x = x + xv; yv += 1;
    out.push({ x: x, y: y, yv: yv, ground: false });
  }
  return out;
}
function landing(x, y, xv, yv) {
  var t = simTraj(x, y, xv, yv, 250), l = t[t.length - 1];
  return { x: l.x, frames: t.length, ground: l.ground };
}
function smashOut(bx, by, byv, xd, yd) {
  var nxv = bx < HALF ? (Math.abs(xd) + 1) * 10 : -(Math.abs(xd) + 1) * 10;
  return landing(bx, by, nxv, Math.abs(byv) * yd * 2);
}
function bumpOut(bx, by, byv, off) {
  var xv = off > 0 ? (Math.abs(off) / 3) | 0 : off < 0 ? -((Math.abs(off) / 3) | 0) : 0;
  var a = Math.abs(byv);
  return landing(bx, by, xv, -(a < 15 ? 15 : a));
}

var prevY = PY, prevTick = -99, prevOppX = HALF;

/* 스킬 마무리 — 결정된 (x, y, hit)에 회피 오버라이드와 skillX를 얹는다.
   회피가 필요하면 x를 좌우 도피 방향으로 덮어쓴다 (스매시 조준 등이
   깨지지만, 기절 1.8초를 맞는 것보다 낫다).
   발동 가능하면 상대의 8틱(≈24프레임) 뒤 예측 위치를 노려서 쏜다. */
function finalize(x, y, hit, s) {
  var c = s.opp.claw;
  if (c && c.framesUntilStrike >= DODGE_MIN_FRAMES) {
    var offset = s.self.x - c.centerX;
    if (Math.abs(offset) <= CLAW_DANGER) {
      if (offset === 0) x = s.side === 'LEFT' ? -1 : 1;
      else x = offset > 0 ? 1 : -1;
    }
  }

  var skillX = null;
  if (s.self.gauge >= CLAW_COST && s.self.claw === null && s.self.state < 4) {
    var vx = s.opp.x - prevOppX;                 /* 틱당 이동량 */
    var target = s.opp.x + vx * 8;               /* 예고 25프레임 ≈ 8틱 */
    if (target < 0) target = 0;
    if (target > GW) target = GW;
    skillX = target;
  }

  prevOppX = s.opp.x;

  return skillX !== null
    ? { x: x, y: y, hit: hit, skillX: skillX }
    : { x: x, y: y, hit: hit };
}

function decide(s) {
  try {
    if (s.tick - prevTick > 30) { prevY = PY; prevOppX = s.opp.x; }
    prevTick = s.tick;

    var isR = s.side === 'RIGHT', sgn = isR ? -1 : 1;
    var myMin = isR ? HALF + PHL : PHL, myMax = isR ? GW - PHL : HALF - PHL;
    var oppMin = isR ? BR : HALF, oppMax = isR ? HALF : GW;
    var me = s.self, ball = s.ball, opp = s.opp;
    var mine = function (x) { return isR ? x >= HALF : x <= HALF; };
    var cl = function (x) { return Math.max(myMin, Math.min(myMax, x)); };

    var traj = simTraj(ball.x, ball.y, ball.xVelocity, ball.yVelocity, 90);
    var end = traj[traj.length - 1];

    /* 현재 체공 시간 역산 (전역 prevY로 상승/하강 판별) */
    var airT = -1;
    if (me.state === 1 || me.state === 2) {
      var rising = me.y < prevY, bd = 1e9;
      for (var t = 1; t <= AIR; t++) {
        if ((ARC[t] < ARC[t - 1]) !== rising) continue;
        var d = Math.abs(ARC[t] - me.y);
        if (d < bd) { bd = d; airT = t; }
      }
      if (airT < 0) airT = 1;
    }
    prevY = me.y;

    var scoreLand = function (r, k) {
      if (!r.ground) return -1e9;
      if (!mine(r.x)) {
        if (r.x < oppMin + 24 || r.x > oppMax - 24) return -1e9;
        return 1000 + Math.abs(r.x - opp.x) * 2 - k * 0.5;
      }
      if (r.frames < 22) return -1e9;
      return 300 + r.frames * 5 - k * 0.5;
    };

    var best = null;
    var consider = function (sc, a) { if (sc > -1e8 && (!best || sc > best.sc)) { a.sc = sc; best = a; } };

    for (var k = 1; k <= traj.length; k++) {
      var b = traj[k - 1];
      if (b.ground) break;
      if (!mine(b.x)) continue;
      var px = cl(b.x);
      if (Math.abs(px - b.x) > PHL) continue;
      var gap = Math.abs(px - me.x);

      /* --- 공중 파워히트 --- */
      if (gap <= 6 * k + 10) {
        var tryT = function (tt, jd) {
          if (tt < 1 || tt > AIR || Math.abs(b.y - ARC[tt]) > 31) return;
          for (var xi = 0; xi < 2; xi++) for (var yd = -1; yd <= 1; yd++) {
            var xd = xi;
            var r = smashOut(b.x, b.y, b.yv, xd, yd);
            var sc = scoreLand(r, k);
            if (sc <= -1e8) continue;
            var safe = true;                       /* ±1프레임 오차 내성 */
            for (var o = -1; o <= 1; o += 2) {
              var bb = traj[k - 1 + o];
              if (!bb || bb.ground) continue;
              var rr = smashOut(bb.x, bb.y, bb.yv, xd, yd);
              if (!rr.ground || mine(rr.x)) { safe = false; break; }
            }
            if (!safe) continue;
            consider(sc + 150, { mode: 1, k: k, jd: jd, xd: xd, yd: yd, tx: px });
          }
        };
        if (airT > 0) tryT(airT + k, 0);
        else for (var j = 0; j <= 30; j++) tryT(k - j, j);
      }

      /* --- 지상 몸통 접촉 / 다이빙 --- */
      if (airT < 0 && me.state !== 3 && me.state !== 4 && Math.abs(b.y - PY) <= 31) {
        for (var off = -30; off <= 30; off += 6) {
          var tx = cl(b.x - off);
          if (Math.abs(b.x - tx) > PHL) continue;
          var g = Math.abs(tx - me.x), dive = g > 6 * k + 10;
          if (dive && g > 8 * k + 10) continue;
          var rb = bumpOut(b.x, b.y, b.yv, b.x - tx);
          consider(scoreLand(rb, k) - (dive ? 400 : 0), { mode: dive ? 2 : 3, k: k, tx: tx });
        }
      }
    }

    var x = 0, y = 0, hit = 0, dx;

    if (best) {
      dx = best.tx - me.x;
      if (Math.abs(dx) > 5) x = dx > 0 ? 1 : -1;
      if (best.mode === 1) {
        if (me.state === 0 && best.jd <= 1) y = -1;
        else if ((me.state === 1 || me.state === 2) && best.k <= 6) {
          hit = 1; y = best.yd;
          if (best.xd === 0) x = 0; else if (x === 0) x = sgn;
        }
      } else if (best.mode === 2 && me.state === 0) {
        if (x === 0) x = dx > 0 ? 1 : -1;
        hit = 1;
      }
      return finalize(x, y, hit, s);
    }

    /* 접촉 불가: 낙하지점 추격, 최후에 다이빙 */
    if (mine(end.x)) {
      dx = cl(end.x - sgn * 22) - me.x;
      if (Math.abs(dx) > 5) x = dx > 0 ? 1 : -1;
      if (me.state === 0 && Math.abs(dx) > 6 * traj.length && Math.abs(dx) > 40) {
        hit = 1; if (x === 0) x = dx > 0 ? 1 : -1;
      }
      return finalize(x, 0, hit, s);
    }

    /* 상대 코트로 갈 공: 대기 위치로 */
    dx = cl(isR ? HALF + 125 : GW - HALF - 125) - me.x;
    if (Math.abs(dx) > 5) x = dx > 0 ? 1 : -1;
    return finalize(x, 0, 0, s);
  } catch (e) {
    return { x: 0, y: 0, hit: 0 };   /* 어떤 예외에도 무입력으로 안전 종료 */
  }
}
