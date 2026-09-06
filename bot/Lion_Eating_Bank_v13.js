'use strict';
/* Lion_Eating_Bank_v13.js — 사자먹는은행 제출 봇. v12 + 플레이어 물리 예측 수정 3건(F1 이륙 직후 vy 추정, F2 y=244 공중 프레임, F3 누운 상대 몸 접촉). 그 외 동작 동일.
 *   수정 내용·검증: competition/Lion_Eating_Bank_v13.md. 설계·근거·벤치·당일 절차: src/code-here/Lion_Eating_Bank_v12.md (§번호는 이 파일의 주석과 대응)
 *   구조: §0 당일 노브 → §1 Thunder 서브(오픈루프 3위상 + 밴딧) → §2 ACCore(랠리: 확정킬·수비 위치·넘기기·다이빙) → §3 오케스트레이터(decide)
 *   좌표: 코트 432, 네트 x 216, 지상 y 244, 공 착지 y 252, 몸 반폭 32, 걷기 6/프레임. 스냅샷은 3프레임마다, 입력 지연 1프레임. */

/* ══ §0 당일 노브 — 대회 당일 손댈 수 있는 값. 깊은 노브는 KILL_GATE·DEF_CFG(§2.0) ══ */
const DEBUG = true;          // F12 로그(썬더 발동·포기, 새 스냅샷 필드, 예외 1회). 매 틱 로그 없음
const LAT_GUARD = 1;         // 최근 LAT_WINDOW 관측에서 지연2 증거 > 지연1 이면 썬더 포기(지연2 에서 썬더는 0%)
const LAT_WINDOW = 30;
const SELF_CHECK = 1;        // 썬더 자기검증: 틱마다 기대 공 위치(TH_EXPECT)와 비교, 어긋나면 즉시 AC
const SELF_CHECK_TOL = 2;    //   허용 오차 px
const CAMP_ABORT_X = 0;      // 스파이크 틱에 상대가 네트 앞(정규화 x ≤ 값)이면 썬더 포기. 0 = 끔, 확인된 네트 캠퍼에만 262
const THUNDER_SERVE = 1;     // 1 = 3위상 오픈루프 서브(§1). 0 = 서브도 랠리 로직(md §1.5 비용 참조)
const SERVE_BANDIT = 1;      // 위상별 서브 모드 밴딧(thunder / ac / flat), 점수 (승+1)/(시도+2)
const BANDIT_BLOCKWIN = 0.5; //   블록당하고도 이긴 썬더 랠리의 승 가중치
const BANDIT_MODES = 'thunder,ac,flat';   // 밴딧 팔과 우선순위. steep = 이탈 끈 썬더
const CAMP_ESCAPE = 1;       // 킬 틱 이탈: 상대가 킬 궤적에 닿을 수 있으면 평타. 1 = 예측 즉시, 2·3 = 블록 1·2회 관측 뒤, 0 = 끔
const AC_LOSS_COMEBACK = 1;  // ac 서브 랠리를 지면 그 위상 기록을 비우고 썬더 복귀
const NEW_GAME_RESET = 1;    // 0:0 복귀(새 게임)에 밴딧 기록 초기화. Worker 가 Apply 사이에 살아 상대 교체 시 이월되는 것을 막음
const EXP_DRIFT_ATTACK = 1;  // 낙하점이 상대 코트여도 공이 내 코트·상대 공중이면 킬 탐색 먼저. 2 = 확정/관통 킬만
const EXP_S2_TRACK = 1;      // 내 출력으로 state2 delay/frameNumber 를 정확히 추적
const EXP_REACH = 1;         // 상태 인지형 상대 도달 모델(oppTouch) + 체공 방향 전환 킬 계획
const MAX_BLEND = 0;         // 학습 수비 편향 혼합 비율. 0 = 끔(미지 상대 기본), 코스가 반복되는 상대만 0.62

/* 스킬 어댑터(당일용). SK.on=false 면 아무 것도 안 함. 최종 출력 직전에 한 번 적용(§3). md §0.2 */
var SK = {
  on:    false,
  gauge: 'self.gauge',
  ogauge:'opp.gauge',
  full:  100,
  key:   'skill',
  fire:  0,
  guard: 1
};
function skPick(o, path) {
  var p = path.split('.'), v = o;
  for (var i = 0; i < p.length; i++) { if (v == null) return undefined; v = v[p[i]]; }
  return v;
}
function skFull(v) { return typeof v === 'number' && v >= SK.full; }
function applySkill(s, a) {
  if (!SK.on || !a) return a;
  try {
    if (SK.guard && skFull(skPick(s, SK.ogauge)) && a.hit === 1 && a.y === 1) a.y = -1;
    if (SK.fire && skFull(skPick(s, SK.gauge)) && a.hit === 1 && s.self.state === 1) a[SK.key] = 1;
  } catch (e) { }
  return a;
}

/* ══ §1 Thunder — 3위상 오픈루프 서브. TH_SEQS[0]=phase1, [1]=phase2, [2]=phase0 (LEFT 기준, RIGHT 는 x 부호 반전). md §1
 *   위상 = 내 서브 공이 떨어지기 시작한 프레임과 스냅샷 격자의 위상(fEst % 3). 지연 1프레임·틱그룹 3 전제(아니면 스스로 꺼짐). */
var Thunder = (function () {
var TH = { seenScore: -1, armed: false, dead: false, fEst: -1, state: 'IDLE', logged: false, devCount: 0, campCount: 0 };
var TH_YTABLE = (function () {
  var t = {}, y = 0, vy = 1;
  for (var k = 0; k < 20; k++) { y += vy; vy += 1; t[y] = k + 1; }
  return t;
})();
var TH_SEQS = [
  [
    [0,0,0],[0,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[1,0,0],[-1,0,0],[-1,-1,0],
    [-1,-1,0],[-1,-1,0],[-1,-1,1],[-1,-1,0],[-1,-1,0],[-1,-1,1],[1,-1,0],[1,-1,0],
    [1,-1,1],[1,0,0],[0,0,0],[-1,0,0],[1,-1,0],[1,-1,0],[1,-1,1],[0,-1,0],
    [0,-1,0],[1,-1,0],[-1,-1,0],[1,-1,1],[1,1,0]
  ],
  [
    [0,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[1,0,0],[1,0,0],[0,0,0],[-1,-1,0],
    [-1,-1,0],[-1,-1,0],[-1,-1,0],[-1,-1,0],[-1,-1,0],[-1,-1,0],[1,-1,0],[1,-1,1],
    [1,-1,0],[1,0,0],[1,-1,0],[-1,-1,1],[1,-1,0],[1,-1,0],[1,-1,1],[-1,-1,0],
    [0,-1,0],[0,-1,0],[1,-1,0],[1,1,1]
  ],
  [
    [0,0,0],[0,0,0],[0,0,0],[1,0,0],[1,0,0],[1,0,0],[-1,0,0],[-1,0,0],
    [-1,0,0],[-1,-1,1],[1,-1,0],[1,-1,0],[1,-1,1],[1,-1,0],[1,-1,0],[0,-1,0],
    [1,-1,0],[1,-1,0],[0,-1,0],[0,-1,1],[1,0,0],[0,0,0],[-1,-1,0],[1,1,1]
  ]
];

/* 위상별 기대 공 위치 [x,y] (planTick 순, LEFT 기준). SELF_CHECK 가 매 틱 대조 */
var TH_EXPECT = [[[56,3],[56,15],[56,36],[56,66],[56,105],[56,153],[56,210],[60,188],[66,131],[72,83],[78,44],[84,14],[90,9],[96,21],[102,42],[108,72],[114,111],[120,159],[144,196],[204,202],[144,217],[108,217],[120,178],[132,148],[144,127],[156,115],[168,112],[180,118],[192,133]],[[56,1],[56,10],[56,28],[56,55],[56,91],[56,136],[56,190],[52,209],[40,149],[28,98],[16,56],[4,23],[8,7],[20,16],[32,34],[44,61],[56,97],[68,142],[80,196],[123,182],[132,143],[141,113],[150,92],[159,80],[168,77],[177,83],[186,98],[195,122]],[null,[56,6],[56,21],[56,45],[56,78],[56,120],[56,171],[56,231],[35,168],[14,114],[7,69],[28,33],[49,6],[70,12],[91,27],[112,51],[133,84],[142,42],[151,9],[160,3],[169,15],[178,36],[187,66],[196,105]]];

/* 위상별 스파이크(마지막 파워히트) 틱 = CAMP_ABORT_X 검사 시점 */
var TH_SPIKE_TICK = [27,27,23];

/* 위상별 킬 틱·상대가 닿을 수 있는 점 [x,y,step]·평타 이탈 입력(kill s90 (208,167) → 착지 248, flat → 388) */
var TH_KILL = [{"killTick":28,"touchPts":[[228,197,5],[248,228,6]],"escape":[1,0,0]},{"killTick":27,"touchPts":[[227,198,5],[247,229,6]],"escape":[1,0,1]},{"killTick":23,"touchPts":[[228,209,5],[248,248,6]],"escape":[1,0,1]}];

/* 블록 대처: 위상(planIndex)별 서브 모드 밴딧 + 킬 틱 평타 이탈. md §1.3
 *   모드 thunder(시퀀스) / ac(썬더 생략, AC 서브) / flat(킬 틱에 무조건 평타). 랠리 결과는 점수 +1 로만 판정. 블록 = 킬 뒤 공이 isPowerHit 를 잃음 */
var BC = {
  modes: BANDIT_MODES.split(','),
  mode: ['thunder', 'thunder', 'thunder'],
  stats: [{}, {}, {}],
  cur: null, lastSelf: 0, lastOpp: 0,
  prevOppX: -1, curOppX: -1, prevOppY: 244, curOppY: 244, margin: 6,
  switches: 0, escapes: 0, comebacks: 0, resets: 0, log: []
};
var BC_JUMP_Y = (function () { var a = [], y = 244, vy = -16; for (var m = 0; m < 40; m++) { y += vy; a.push(y); if (y < 244) vy += 1; else break; } return a; })();
function bcScore(pi, mode) { var st = BC.stats[pi][mode] || { n: 0, won: 0 }; return (st.won + 1) / (st.n + 2); }
/* 위상 pi 의 서브 모드: 점수 (승+1)/(시도+2) 최대, 동점이면 BANDIT_MODES 앞선 것 */
function bcModeFor(pi) {
  if (!SERVE_BANDIT) return 'thunder';
  var best = 'thunder', bestV = -1;
  for (var i = 0; i < BC.modes.length; i++) {
    var m = BC.modes[i];
    if (m === 'flat' && !(TH_KILL[pi].escape && TH_KILL[pi].escape.length)) continue;
    var v = bcScore(pi, m);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}
function bcServeStart(pi, mode) {
  BC.cur = { pi: pi, mode: mode, killSeen: false, phSeen: false, blocked: false, escaped: false };
  var st = BC.stats[pi][mode] || (BC.stats[pi][mode] = { n: 0, won: 0, blocked: 0 });
  st.n++;
}
/* 점수 변경 = 직전 서브 랠리 결과 반영. NEW_GAME_RESET 이면 0:0 에서 기록 초기화, AC_LOSS_COMEBACK 이면 ac 패 뒤 썬더 복귀 */
function bcOnScoreChange(score, side) {
  var self = score.self | 0, opp = score.opp | 0;
  if (NEW_GAME_RESET && self === 0 && opp === 0 && BC.lastSelf + BC.lastOpp > 0) {
    BC.stats = [{}, {}, {}]; BC.mode = ['thunder', 'thunder', 'thunder']; BC.cur = null; BC.resets++;
    if (DEBUG) console.log('[OurBot v4bc ' + side + '] 새 게임: 서브 모드 초기화 (이전 ' + BC.lastSelf + ':' + BC.lastOpp + ')');
  }
  if (BC.cur) {
    var won = self === BC.lastSelf + 1 && opp === BC.lastOpp, lost = opp === BC.lastOpp + 1 && self === BC.lastSelf;
    if (won || lost) {
      var st = BC.stats[BC.cur.pi][BC.cur.mode];
      if (st) { if (won) st.won += (BC.cur.blocked ? BANDIT_BLOCKWIN : 1); if (BC.cur.blocked) st.blocked++; }
      var before = BC.mode[BC.cur.pi], comeback = false;
      if (AC_LOSS_COMEBACK && lost && BC.cur.mode === 'ac') {
        BC.stats[BC.cur.pi] = {}; BC.mode[BC.cur.pi] = 'thunder'; BC.comebacks++; comeback = true;
      } else BC.mode[BC.cur.pi] = bcModeFor(BC.cur.pi);
      if (BC.log.length < 120) BC.log.push({ pi: BC.cur.pi, mode: BC.cur.mode, won: won, blocked: BC.cur.blocked, escaped: BC.cur.escaped, next: BC.mode[BC.cur.pi] });
      if (before !== BC.mode[BC.cur.pi]) {
        BC.switches++;
        if (DEBUG) console.log('[OurBot v4bc ' + side + '] 서브 모드 전환 phase=' + ((BC.cur.pi + 1) % 3) + ' ' + before + ' → ' + BC.mode[BC.cur.pi] + ' (' + BC.cur.mode + (won ? ' 승' : ' 패') + (BC.cur.blocked ? ', 블록당함' : '') + (BC.cur.escaped ? ', 이탈' : '') + (comeback ? ', 기록 초기화 후 썬더 복귀' : '') + ')');
      }
    }
    BC.cur = null;
  }
  BC.lastSelf = self; BC.lastOpp = opp;
}
function bcTrack(s) {
  BC.prevOppX = BC.curOppX; BC.prevOppY = BC.curOppY;
  BC.curOppX = s.side === 'RIGHT' ? 432 - s.opp.x : s.opp.x; BC.curOppY = s.opp.y;
}

/* 이 스냅샷의 상대가 위상 pi 의 킬 궤적에 닿을 수 있는가. x 는 직전 틱 대비 속도(±6 클램프)로 외삽, 공중이면 점프 궤적(BC_JUMP_Y)으로 그 스텝의 y */
function bcBlockable(s, pi) {
  var ox = BC.curOppX, oy = BC.curOppY, vx = 0;
  if (BC.prevOppX >= 0) { vx = (ox - BC.prevOppX) / 3; if (vx < -6) vx = -6; if (vx > 6) vx = 6; }
  var pts = TH_KILL[pi].touchPts, m = -1;
  if (oy < 244) {
    var asc = BC.prevOppY >= 244 || oy < BC.prevOppY;
    for (var k = 0; k < BC_JUMP_Y.length; k++) { if (BC_JUMP_Y[k] === oy && ((asc && k <= 15) || (!asc && k >= 15))) { m = k; break; } }
    if (m < 0) m = 15;
  }
  for (var i = 0; i < pts.length; i++) {
    var bx = pts[i][0], by = pts[i][1], d = pts[i][2];
    if (ox + vx * d > bx + 32 + BC.margin) continue;
    if (oy >= 244) return true;
    var yy = (m + d < BC_JUMP_Y.length) ? BC_JUMP_Y[m + d] : 244;
    if (Math.abs(by - yy) <= 32) return true;
    if (m + d >= BC_JUMP_Y.length) return true;
  }
  return false;
}

/* CAMP_ESCAPE 2·3 = 이 위상에서 블록을 1·2회 이상 본 뒤에만 이탈 */
function bcEscapeAllowed(pi) {
  if (CAMP_ESCAPE < 2) return true;
  var st = BC.stats[pi].thunder;
  return !!st && (st.blocked | 0) >= CAMP_ESCAPE - 1;
}
/* 킬 뒤 파워히트 공이 isPowerHit 를 잃으면 블록당한 것 */
function bcObserve(s) {
  if (!BC.cur || !BC.cur.killSeen) return;
  var bvx = s.side === 'RIGHT' ? -s.ball.xVelocity : s.ball.xVelocity;
  if (s.ball.isPowerHit && bvx > 0) BC.cur.phSeen = true;
  else if (BC.cur.phSeen && !s.ball.isPowerHit) BC.cur.blocked = true;
}
function reset() { TH.armed = false; TH.dead = false; TH.fEst = -1; TH.state = 'IDLE'; TH.logged = false; }
/* 매 틱: 점수 변경 → 밴딧 반영·리셋 / 내 서브 공(x 56, vx 0) 낙하 프레임(fEst)으로 위상·planTick 결정 / 모드 ac 면 생략 /
 *   SELF_CHECK 궤적 대조 / CAMP_ABORT_X / 킬 틱 이탈 / 시퀀스 입력 반환. null 이면 AC 가 맡는다. */
function step(s) {
  var isRight = s.side === 'RIGHT';
  var score = s.meta && s.meta.score ? s.meta.score : { self: 0, opp: 0 };
  var scoreTotal = (score.self | 0) + (score.opp | 0);
  if (scoreTotal !== TH.seenScore) {
    bcOnScoreChange(score, s.side);
    TH.seenScore = scoreTotal; TH.armed = false; TH.dead = false; TH.fEst = -1;
    TH.state = 'IDLE'; TH.logged = false;
  }
  bcTrack(s); bcObserve(s);
  var group = s.config && s.config.tickFrameGroupSize;
  if (group && group !== 3) { TH.state = 'NO_GROUP'; TH.dead = true; return null; }
  var bx = isRight ? 432 - s.ball.x : s.ball.x;
  var bvx = isRight ? -s.ball.xVelocity : s.ball.xVelocity;
  var myServeDrop = bvx === 0 && bx === 56;
  if (myServeDrop) {
    var fresh = s.ball.y === 0 ||
      (TH_YTABLE[s.ball.y] !== undefined && TH.fEst >= 0 && TH_YTABLE[s.ball.y] < TH.fEst);
    if (fresh) reset();
  }
  if (!THUNDER_SERVE) { TH.state = 'OFF'; TH.dead = true; TH.armed = false; return null; }
  if (TH.dead) return null;
  if (myServeDrop && s.ball.y === 0) { TH.armed = true; TH.fEst = -1; return { x: 0, y: 0, hit: 0 }; }
  if (myServeDrop && TH_YTABLE[s.ball.y] !== undefined) { TH.fEst = TH_YTABLE[s.ball.y]; TH.armed = true; }
  else if (TH.armed) { if (TH.fEst < 0) TH.armed = false; else TH.fEst += 3; }
  if (!TH.armed || TH.fEst < 0) return null;
  var phase = (3 - (TH.fEst % 3)) % 3;
  var tickIndex = ((TH.fEst - (TH.fEst % 3)) / 3) + 1;
  var planIndex = (phase + 2) % 3;
  var planTick = tickIndex - 1;
  var seq = TH_SEQS[planIndex];
  if (seq === null || planTick >= seq.length) {
    TH.state = seq === null ? 'NO_PLAN' : 'DONE';
    TH.dead = true; TH.armed = false;
    return null;
  }
  if (!BC.cur) {
    var bcMode = bcModeFor(planIndex);
    bcServeStart(planIndex, bcMode);
    if (bcMode === 'ac') {
      if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 생략 phase=' + phase + ': 서브 모드 ac (밴딧 ' + JSON.stringify(BC.stats[planIndex]) + ')');
      kill('MODE_AC');
      return null;
    }
  }
  if (SELF_CHECK) {
    var ex = TH_EXPECT[planIndex] && TH_EXPECT[planIndex][planTick];
    if (ex && (Math.abs(bx - ex[0]) > SELF_CHECK_TOL || Math.abs(s.ball.y - ex[1]) > SELF_CHECK_TOL)) {
      TH.devCount++;
      if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 포기: 궤적 이탈 planTick=' + planTick + ' 기대(' + ex[0] + ',' + ex[1] + ') 관측(' + bx + ',' + s.ball.y + ')');
      kill('ABORT_DEVIATION');
      return null;
    }
  }
  if (CAMP_ABORT_X > 0 && planTick === TH_SPIKE_TICK[planIndex]) {
    var ox = isRight ? 432 - s.opp.x : s.opp.x;
    if (ox <= CAMP_ABORT_X) {
      TH.campCount++;
      if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 포기: 상대가 네트 앞 x=' + ox + ' (planTick ' + planTick + ') → AC 공격');
      kill('ABORT_CAMP');
      return null;
    }
  }
  if (!TH.logged) {
    TH.logged = true; TH.state = 'ACTIVE';
    if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 발동 phase=' + phase + ' (TH_SEQS[' + planIndex + '], ' + seq.length + ' ticks) tick=' + s.tick);
  }
  var e = seq[planTick];
  var K = TH_KILL[planIndex];
  if (BC.cur && planTick === K.killTick) {
    BC.cur.killSeen = true;
    if (K.escape && (BC.cur.mode === 'flat' || (CAMP_ESCAPE && BC.cur.mode === 'thunder' && bcBlockable(s, planIndex) && bcEscapeAllowed(planIndex)))) {
      e = K.escape; BC.cur.escaped = true; BC.escapes++;
      if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 이탈 phase=' + phase + ': 킬 틱에 상대 x=' + BC.curOppX + ' y=' + BC.curOppY + ' state=' + s.opp.state + ' → 평타');
    }
  }
  return isRight ? { x: -e[0], y: e[1], hit: e[2] } : { x: e[0], y: e[1], hit: e[2] };
}
function kill(reason) { TH.dead = true; TH.armed = false; TH.state = reason || 'ABORT'; }
function tickIndexNow() { return TH.fEst < 0 ? -1 : Math.floor(TH.fEst / 3); }
return { step: step, kill: kill, tickIndexNow: tickIndexNow, TH: TH, EXPECT: TH_EXPECT, SPIKE_TICK: TH_SPIKE_TICK, KILL: TH_KILL, BC: BC };
})();

/* ══ §2 ACCore — 랠리 로직. 모든 판단은 엔진 복제 물리(stepBall·microSim)로 시뮬레이션한다. md §2 ══ */
var ACCore = (function () {
'use strict';

var GROUND_WIDTH = 432;
var NET_X = 216;
var PLAYER_GROUND_Y = 244;
var BALL_GROUND_Y = 252;
var BALL_MAX_Y_VELOCITY = 40;
var PLAYER_HALF = 32;
var NET_HALF_W = 25;
var NET_TOP_Y = 176;
var NET_TOP_BOTTOM_Y = 192;
var WALK_SPEED = 6;
var LATENCY_FRAMES = 1;

/* 학습 수비(MAX_BLEND 0 이면 무효, adaptiveDefenseTarget 이 기본 자리를 그대로 돌려준다). md §2.9 */
var ADAPT_CFG = {
  MIN_SAMPLES: 3,
  FULL_SAMPLES: 12,
  EMA_RATE: 0.34,
  MAX_BLEND: MAX_BLEND,   // §0 노브
  MAX_SHIFT: 72,
  RECENT_SIZE: 8,
  HIT_X_RANGE: 105,
  HIT_Y_RANGE: 125
};

/* 반박자 빠른 공격(점프와 동시에 hit) 설정. md §2.4 */
var FAST_ATTACK_CFG = {
  ARM_UNTILS: [4],      // 점프+hit 유지 프레임 후보(스매시 x 이동은 5프레임째부터)
  MAX_CONTACT: 13,      // 이보다 늦은 접촉은 빠른 공격 아님
  MAX_DROP: 15,
  DOWN_MAX_DROP: 11,    // 하향타는 접촉 뒤 11프레임 안에 떨어져야
  COURT_MARGIN: 10,
  OPP_WINDOW: 2,        // 상대가 대응 가능한 프레임 창 허용치
  COMMIT_TICKS: 15,
  ABORT_SCORE: -280,
  DOWN_BONUS: 145,
  EARLY_WEIGHT: 11
};

/* 틱 사이 상태 */
var g_prev = null;
var g_touches = 0;
var g_touch_score = null;      // 마지막으로 본 점수 키 "self:opp" (새 랠리 감지, §2.8)
var g_prev_ball_on_left = null;
var g_prev_tick = null;
var g_last_action = { x: 0, y: 0, hit: 0 };
var g_air_policy = null;
var g_pass_jump_until = -1;    // 이 틱까지 공중 파워히트에 AIR_GATE 면제(의도한 점프)
var g_group = 3;
var g_fast_attack_until = -1;
var g_fast_attack_policy = null;
var g_prev_action = { x: 0, y: 0, hit: 0 };   // 직전 틱 출력(a_{s-6})
var g_self = { y: 244, vy: 0, state: 0, delay: 0, fn: 0, tick: null };   // 내 상태 모델(state2 delay 추적)
/* 내 몸 1프레임 진행(엔진 복제): 점프 vy −16, 파워히트 delay 5 → frameNumber 0..4 → state 1 복귀 */
function selfStep(m, a) {
  if (m.state === 4) return;
  if (m.state < 3 && a.y === -1 && m.y === PLAYER_GROUND_Y) { m.vy = -16; m.state = 1; m.fn = 0; }
  var fy = m.y + m.vy; m.y = fy;
  if (fy < PLAYER_GROUND_Y) m.vy += 1;
  else if (fy > PLAYER_GROUND_Y) { m.vy = 0; m.y = PLAYER_GROUND_Y; m.fn = 0; m.state = m.state === 3 ? 4 : 0; }
  if (a.hit === 1) { if (m.state === 1) { m.delay = 5; m.fn = 0; m.state = 2; } else if (m.state === 0 && a.x !== 0) { m.state = 3; m.fn = 0; m.vy = -5; } }
  if (m.state === 1) m.fn = (m.fn + 1) % 3;
  else if (m.state === 2) { if (m.delay < 1) { m.fn += 1; if (m.fn > 4) { m.fn = 0; m.state = 1; } } else m.delay -= 1; }
}

/* 스냅샷 s 까지 처리된 3프레임 = a_{s-6}, a_{s-3}, a_{s-3}. 관측과 어긋나면 관측으로 재동기화 */
function selfSync(s) {
  var m = g_self;
  if (m.tick !== null && s.tick - m.tick === g_group) { selfStep(m, g_prev_action); for (var i = 1; i < g_group; i++) selfStep(m, g_last_action); }
  else { m.y = s.self.y; m.vy = 0; m.state = s.self.state; m.delay = s.self.state === 2 && s.self.frameNumber === 0 ? 3 : 0; m.fn = s.self.frameNumber; }
  m.tick = s.tick;
  if (m.state !== s.self.state || m.y !== s.self.y) { m.y = s.self.y; m.state = s.self.state; m.fn = s.self.frameNumber; if (s.self.state === 2) m.delay = s.self.frameNumber === 0 ? 3 : 0; if (s.self.state < 3 && s.self.y === PLAYER_GROUND_Y) m.vy = 0; }
  else if (s.self.state === 2 && s.self.frameNumber > 0) { m.delay = 0; m.fn = s.self.frameNumber; }
}

/* 상대 공격 패턴 누적(랠리를 넘어 유지, 새 게임·진영 교체에서 초기화) */
var g_adapt = {
  side: null,
  attackCount: 0,
  landingMean: 0,
  landingM2: 0,
  landingEMA: null,
  recentDepths: [],
  zoneCounts: [0, 0, 0],
  shotCounts: [0, 0, 0, 0, 0, 0],
  fastCount: 0,
  downCount: 0,
  flatCount: 0,
  attackActive: false,
  lastAttackTick: -9999,
  lastRallyFrame: null,
  lastScoreSelf: null,
  lastScoreOpp: null
};

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function idiv(a, b) { return Math.floor(a / b); }

/* 공 1프레임 물리(엔진 복제): vy 클램프 ±40, 벽 반사, 천장, 네트(176~192 상단 반사 / 그 아래 옆면 반사), 착지 y>252 → true. md §2.1 */
function stepBall(b) {
  b.yV = clamp(b.yV, -BALL_MAX_Y_VELOCITY, BALL_MAX_Y_VELOCITY);
  var fx = b.x + b.xV;
  if (fx < 0 || fx > GROUND_WIDTH) b.xV = -b.xV;
  if (b.y + b.yV < 0) b.yV = 1;
  if (Math.abs(b.x - NET_X) < NET_HALF_W && b.y > NET_TOP_Y) {
    if (b.y <= NET_TOP_BOTTOM_Y) { if (b.yV > 0) b.yV = -b.yV; }
    else if (b.x < NET_X) b.xV = -Math.abs(b.xV);
    else b.xV = Math.abs(b.xV);
  }
  var fy = b.y + b.yV;
  if (fy > BALL_GROUND_Y) return true;
  b.y = fy; b.x += b.xV; b.yV += 1;
  return false;
}

function cloneBall(ball) {
  return { x: ball.x, y: ball.y, xV: ball.xVelocity, yV: ball.yVelocity };
}
/* n 프레임 뒤 공(착지하면 그 자리) */
function ballAfter(ball, n) {
  var b = cloneBall(ball);
  for (var i = 0; i < n; i++) if (stepBall(b)) break;
  return b;
}
/* 착지까지 프레임(상한 200) */
function framesToLanding(ball) {
  var b = cloneBall(ball);
  for (var i = 1; i <= 200; i++) if (stepBall(b)) return i;
  return 200;
}

/* ══ §2.0 깊은 노브 — 당일 손댈 수 있는 것: REACT·MARGIN·FLAT_RELAX·DEF_CFG.REACT·KILL_MAX_CONTACT·NET_HAZ·TH_RETREAT*. md §2.0 ══ */
/* 확정킬 판정(§2.3). 스파이크는 "상대가 절대 받을 수 없는" 경우에만 — 받히면 그 랠리를 59~72% 진다 */
var KILL_GATE = {
  REACT: 3,        // 상대 반응 지연(물리 스텝). 2 = 가장 보수적
  MARGIN: 6,       // 도달 판정 여유 px. 크면 스파이크를 덜 한다(당일 최후 안전판 999)
  FLAT_RELAX: 1, FLAT_REACT: 1, FLAT_DEEP: 140   // 낮은 평타→깊은 착지(>FLAT_DEEP) 후보만 상대 반응 +FLAT_REACT 로 판정
};

/* 수비·리시브 설정. 원칙: 점프는 확정킬·안전한 넘기기·서브만, 수비는 최소 움직임으로 모든 경우를 막는 자리, 다이빙은 꼭 필요할 때만 */
var DEF_CFG = {
  REACT: 4,              // 내 반응 지연(물리 스텝) = 결정주기 3 + 입력지연 1 의 최악 위상
  DIVE_REACT: 1,         // 다이빙 발동 판정의 반응 지연(실측: 지금 명령한 다이빙은 스텝 2 시작)
  STANDBY_OFF: 92,       // 위협이 없을 때 대기 자리의 폴백 = 네트에서 이 거리
  CANON_CX: 8,           // 표준 위협 집합의 접촉 x = 네트에서 상대 쪽 8·24·40 px
  MAX_CONTACT: 30,       // 상대 접촉 후보를 몇 스텝 앞까지 볼지
  MAX_SAMPLES: 8,        // 접촉 후보 최대 표본 수(계산량 상한)
  X_STEP: 8,             // 수비 자리 후보 격자 px
  MOVE_HYST: 4,          // 못 막는 상태에서 이동을 정당화하는 최소 개선 px
  SAFE_HYST: 24,         // 이미 안전한 상태에서 이동을 정당화하는 최소 개선 px(구석에 머물지 않게)
  SAFE_SLACK: 0,         // 현재 자리를 "안전"으로 보는 최악 여유 px
  FAST_STEPS: 14,        // 착지까지 이 스텝 이하인 샷은 "빠른 샷"(먼저 막는다)
  SET_MAX_TOUCH: 1,      // 세트(네트 앞 띄우기)를 허용하는 최대 터치 수. 1 = 첫 터치만
  KILL_MAX_CONTACT: 16,  // 킬 점프는 접촉이 이 프레임 안에 오는 공에만(먼 접촉은 확정이 아니다)
  TOUCH_MARGIN: 9,       // 지상 리시브 자리의 접촉 여유(32−|접촉x−자리|)가 이 미만이면 크게 감점
  TOUCH_MARGIN_EXACT: 9, //   수직 낙하 공(접촉 x 확정)일 때의 기준
  NET_HAZ: 0,            // 파워히트 접촉 x 가 네트에서 이 거리 안이면 후보 제외. 0 = 끔(3 은 이득 후보, md §2.0)
  PASS_SIM_W: 10,        // 넘기기 채점: 상대 최선 공격 뒤 내 여유 부족 1px 당 감점(여유 ≥ 0 은 +100000)
  PASS_SIM_HORIZON: 90,  //   넘긴 공에 대한 상대 접촉 탐색 스텝 상한(천장 로브 70프레임 포함)
  PASS_JUMP_COMMIT: 20,  // 의도한 점프 뒤 공중 정책에서 AIR_GATE 를 면제하는 틱 수
  STALE_N: 3,            // 내 마지막 N 터치가 같은 공이면(교착) 같은 자리 후보를 감점
  TH_FLAT_Y: 180, TH_FLAT_DEEP: 110, TH_FLAT_ALPHA: 0.5,   // 상대 서브 시퀀스의 깊은 평타 감지(공 y ≤ 200·|vy| ≤ 6, 착지가 네트에서 ≥110) EMA 계수
  TH_RETREAT: 1, TH_RETREAT_K: 4, TH_RETREAT_ZONE: 72, TH_RETREAT_OPP_NET: 64, TH_RETREAT_SERVE_ONLY: 1,   // 상대 썬더 리시브: 네트 위 공격자 접촉 ≤K 스텝 전, 내가 네트 ZONE 안이면 한 걸음 후퇴(§2.7)
  TH_RETREAT_ADAPT: 2, TH_RETREAT_TH: 0.5, TH_RETREAT_NEED: 1, TH_RETREAT_NEED_MARGIN: 2, TH_RETREAT_KILL_Y: 171   // ADAPT 2 = 그 순번에 깊은 평타 EMA ≥ TH 를 본 뒤에만, NEED = 지금 자리에서 못 받을 때만
};

/* 점프 m 스텝 뒤 몸 y (vy −16 부터 +1) */
var KG_JUMP_Y = (function () {
  var a = [], y = 244, vy = -16;
  for (var m = 0; m < 40; m++) { y += vy; a.push(y); if (y < 244) vy += 1; else break; }
  return a;
})();

/* 다이빙 m 프레임째 몸(엔진 실측): m=1 x+6 y244, m=2..13 x+8/프레임 y 239→229→244, m=14..18 누움(이동 0, 닿을 수는 있음). 좌우 대칭. md §2.2 */
var DIVE_Y_TABLE = [239, 235, 232, 230, 229, 229, 230, 232, 235, 239, 244, 244];
var DIVE_TOUCH_FRAMES = 18;
function diveBodyCalc(m) {
  if (m < 1 || m > DIVE_TOUCH_FRAMES) return null;
  if (m === 1) return { dx: WALK_SPEED, y: PLAYER_GROUND_Y };
  if (m <= 13) return { dx: WALK_SPEED + 8 * (m - 1), y: DIVE_Y_TABLE[m - 2] };
  return { dx: WALK_SPEED + 8 * 12, y: PLAYER_GROUND_Y };
}

var DIVE_BODY_TABLE = (function () { var t = []; for (var m = 0; m <= DIVE_TOUCH_FRAMES; m++) t.push(diveBodyCalc(m)); return t; })();
function diveBody(m) { return (m < 1 || m > DIVE_TOUCH_FRAMES) ? null : DIVE_BODY_TABLE[m]; }

/* 상대 상태(0 지상 / 1·2 공중 / 3 다이빙 / 4 누움)에 따라 k 스텝 뒤 닿을 수 있는 몸 y 집합(ys, null = 자유)과 x 이동량(walk).
 *   누움: 몸(244)은 계속 공을 튕기고, 이동은 스냅샷에 남은 시간이 없어 "다음 스텝에 일어난다"로 보수 처리. 다이빙: 입력이 안 먹는 수동적인 몸(xoff 변위, passive = 몸터치만, startAt = 자유 시작 스텝) */
function kgOppMotion(opp, k, react) {
  var st = opp.state | 0;
  if (st === 4) {
    var lie = (opp.lyingDownDurationLeft === undefined) ? 0 : (opp.lyingDownDurationLeft | 0);
    /* 누운 동안(입력 불가)에도 몸(y 244)은 공과 충돌한다(엔진은 state 4 에도 충돌 판정). 이동·점프·다이빙은 일어난 뒤(lie+2 스텝)부터 */
    if (k <= lie + 1) return { ys: [PLAYER_GROUND_Y], walk: 0, grounded: true, startAt: lie + 2 };
    return { ys: [244], walk: (k - lie - 1) * WALK_SPEED, grounded: true };
  }
  if (st === 1 || st === 2) {
    var y = opp.y, vy = (opp.yVelocity === undefined) ? 0 : (opp.yVelocity | 0);
    var ys = [];
    for (var i = 0; i < k; i++) { y += vy; if (y < 244) vy += 1; else { y = 244; vy = 0; } }
    ys.push(y);
    var walkAir = Math.max(0, k - react + 1) * WALK_SPEED;
    if (y >= 244) {
      return { ys: ys, walk: walkAir, grounded: true };
    }
    return { ys: ys, walk: walkAir, grounded: false };
  }
  if (st === 3 && opp.diveIdx) {
    var m0 = opp.diveIdx | 0, dir = opp.dir || 1, idx = m0 + k;
    var xoff = 8 * dir * Math.max(0, Math.min(k, 12 - m0));
    if (idx <= 11) return { ys: [RX_DIVE[idx]], walk: 0, grounded: false, xoff: xoff, passive: true };
    if (idx <= 17) return { ys: [PLAYER_GROUND_Y], walk: 0, grounded: false, xoff: xoff, passive: true };
    var startAt = Math.max(react, 18 - m0);
    return { ys: null, walk: Math.max(0, k - startAt + 1) * WALK_SPEED, grounded: true, xoff: xoff, startAt: startAt };
  }
  return { ys: null, walk: Math.max(0, k - react + 1) * WALK_SPEED, grounded: true };
}

/* 상대가 이 궤적(traj = 접촉 후 스텝별 공 위치)에 서기·점프·다이빙 중 어느 것으로든 닿을 수 있는가. 확정킬이려면 false */
function kgOppCanReach(traj, opp, oppMinX, oppMaxX, react, margin) {
  var clampX = function (x) { return x < oppMinX ? oppMinX : (x > oppMaxX ? oppMaxX : x); };
  for (var t = 0; t < traj.length; t++) {
    var p = traj[t];
    if (p.n <= 0) continue;
    var m = kgOppMotion(opp, p.n, react);
    var ox = opp.x + (m.xoff || 0), st0 = (m.startAt !== undefined) ? m.startAt : react;
    var lo = clampX(ox - m.walk), hi = clampX(ox + m.walk);
    var xok = (p.x + PLAYER_HALF + margin >= lo) && (p.x - PLAYER_HALF - margin <= hi);
    if (!xok) continue;
    if (m.ys !== null && m.ys.length === 0) continue;
    if (m.ys !== null && !m.grounded) {
      if (Math.abs(p.y - m.ys[0]) <= PLAYER_HALF) return true;
      continue;
    }
    if (Math.abs(p.y - PLAYER_GROUND_Y) <= PLAYER_HALF) return true;
    for (var j = st0; j <= p.n; j++) {
      var mm = p.n - j;
      if (mm < KG_JUMP_Y.length && Math.abs(p.y - KG_JUMP_Y[mm]) <= PLAYER_HALF) return true;
    }
    for (var j2 = st0; j2 <= p.n; j2++) {
      var db2 = diveBody(p.n - j2);
      if (db2 === null) continue;
      var reach = WALK_SPEED * Math.max(0, j2 - st0) + db2.dx;
      var dlo = clampX(ox - reach), dhi = clampX(ox + reach);
      if (p.x + PLAYER_HALF + margin >= dlo && p.x - PLAYER_HALF - margin <= dhi &&
          Math.abs(p.y - db2.y) <= PLAYER_HALF) return true;
    }
  }
  return false;
}

/* 접촉 직후 공 상태 → 착지까지 궤적 [{n, x, y, landed}] */
function kgTrajectory(b0, maxN) {
  var b = { x: b0.x, y: b0.y, xV: b0.xV, yV: b0.yV };
  var out = [];
  for (var n = 1; n <= maxN; n++) {
    if (stepBall(b)) { out.push({ n: n, x: b.x, y: b.y, landed: true }); break; }
    out.push({ n: n, x: b.x, y: b.y, landed: false });
  }
  return out;
}

/* microSim 결과 r 이 확정킬인가: 상대 코트 착지 + gateOppReach 가 false */
function kgIsGuaranteedKill(s, r, oppMinX, oppMaxX) {
  if (!r || !r.landed || !r.contactBall) return false;
  if (r.landX <= oppMinX + 4 || r.landX >= oppMaxX - 4) return false;
  return !gateOppReach(r.contactBall, r.lastHitFrame || 0, s, oppMinX, oppMaxX);
}

/* 상대 x 속도(직전 스냅샷 대비, ±6 클램프) — 접촉 시점 상대 위치 외삽용 */
var kg_prevOppX = null, kg_prevTick = -1, kg_lastVx = 0;
function kgOppVx(s) {
  if (kg_prevOppX === null || s.tick <= kg_prevTick) return 0;
  var d = s.tick - kg_prevTick;
  if (d <= 0 || d > 6) return 0;
  var v = (s.opp.x - kg_prevOppX) / d;
  if (v > WALK_SPEED) v = WALK_SPEED;
  if (v < -WALK_SPEED) v = -WALK_SPEED;
  return v;
}
function kgTrack(s) { kg_prevOppX = s.opp.x; kg_prevTick = s.tick; }

/* 상태 인지형 상대 도달 모델(oppTouch): 상대가 지금 상태(지상 / 점프 m프레임째 / 다이빙 m프레임째 / 누움)에서 매 프레임 자유 입력으로
 *   파워히트 뒤 궤적에 닿는 첫 프레임(없으면 −1). pre = 내 접촉까지 상대가 먼저 움직일 수 있는 프레임. 정확 모델 대비 위험 불일치 0 검증. md §2.3 */
var RX_JUMP = (function () { var a = [PLAYER_GROUND_Y]; for (var m = 1; m <= 33; m++) a.push(PLAYER_GROUND_Y - 16 * m + idiv(m * (m - 1), 2)); return a; })();
var RX_DIVE = (function () { var a = [PLAYER_GROUND_Y]; for (var m = 1; m <= 11; m++) a.push(PLAYER_GROUND_Y - 5 * m + idiv(m * (m - 1), 2)); return a; })();
function rxJumpIndex(y, asc) { for (var m = 1; m <= 33; m++) if (RX_JUMP[m] === y && ((asc && m <= 16) || (!asc && m >= 16))) return m; return asc ? 1 : 33; }
function rxDiveIndex(y, asc) { for (var m = 1; m <= 11; m++) if (RX_DIVE[m] === y && ((asc && m <= 5) || (!asc && m >= 6))) return m; return asc ? 1 : 11; }
var g_oppm = null;
var g_kill_plan = null;
/* 스냅샷 → 상대 모델(점프·다이빙 인덱스는 y 와 직전 y 의 상승/하강으로 복원. 스냅샷에 yVelocity 가 없다) */
function oppModelOf(s) {
  var o = s.opp, isP2 = s.side === 'LEFT';
  var m = { x: o.x, state: o.state, dir: o.divingDirection || 1, air: 0, dive: 0,
    lo: isP2 ? NET_X + PLAYER_HALF : PLAYER_HALF, hi: isP2 ? GROUND_WIDTH - PLAYER_HALF : NET_X - PLAYER_HALF };
  var prevY = (g_prev !== null && g_prev.oppY !== undefined) ? g_prev.oppY : null;
  var asc = prevY === null ? true : (o.y < prevY || prevY === PLAYER_GROUND_Y);
  if (o.state === 1 || o.state === 2) m.air = rxJumpIndex(o.y, asc);
  else if (o.state === 3) m.dive = rxDiveIndex(o.y, asc);
  return m;
}
function oppTouch(traj, o, pre, noPre) {
  pre = pre | 0;
  var L = traj.length, x0 = o.x, lo0 = o.lo, hi0 = o.hi;
  var landAt = 0, freeAt = 1, groundAt = 1;
  if (o.air) { landAt = 34 - o.air; groundAt = landAt; }
  else if (o.dive) { landAt = 12 - o.dive; freeAt = landAt + 6; groundAt = freeAt; }
  else if (o.state === 4) { freeAt = 2; groundAt = 2; }
  var freeMove = noPre ? Math.max(freeAt, pre + 1) : freeAt;
  for (var i = 1; i < L; i++) {
    var n = pre + i;
    var bx = traj[i - 1].x, by = traj[i - 1].y;
    var base = clamp(o.dive ? x0 + o.dir * 8 * Math.min(n, landAt) : x0, lo0, hi0);
    var w = 6 * Math.max(0, n - freeMove + 1);
    var wlo = clamp(base - w, lo0, hi0), whi = clamp(base + w, lo0, hi0);
    var xok = bx >= wlo - PLAYER_HALF && bx <= whi + PLAYER_HALF;
    var y = (o.air && n < landAt) ? RX_JUMP[o.air + n] : (o.dive && n < landAt) ? RX_DIVE[o.dive + n] : PLAYER_GROUND_Y;
    if (xok && Math.abs(by - y) <= PLAYER_HALF) return n;
    if (xok && n >= groundAt) {
      var mMax = Math.min(33, n - groundAt + 1);
      for (var m = 1; m <= mMax; m++) if (Math.abs(by - RX_JUMP[m]) <= PLAYER_HALF) return n;
    }
    if (n - 1 >= groundAt) {
      var m2Max = Math.min(16, n - groundAt);
      for (var m2 = 1; m2 <= m2Max; m2++) {
        var yd = m2 <= 11 ? RX_DIVE[m2] : PLAYER_GROUND_Y;
        if (Math.abs(by - yd) > PLAYER_HALF) continue;
        var j = n - m2;
        if (noPre && j <= pre) continue;
        var baseJ = clamp(o.dive ? x0 + o.dir * 8 * Math.min(j - 1, landAt) : x0, lo0, hi0);
        var reach = 6 * Math.max(0, j - 1 - freeMove + 1) + 6 + 8 * Math.min(m2, 11);
        if (bx >= clamp(baseJ - reach, lo0, hi0) - PLAYER_HALF && bx <= clamp(baseJ + reach, lo0, hi0) + PLAYER_HALF) return n;
      }
    }
  }
  return -1;
}

/* 접촉 직후 공 → oppTouch 용 궤적 [{x,y}], 마지막 원소 = 착지 프레임 */
function rxTrajOf(contactBall, maxN) {
  var b = { x: contactBall.x, y: contactBall.y, xV: contactBall.xV, yV: contactBall.yV }, out = [];
  for (var n = 1; n <= maxN; n++) { var landed = stepBall(b); out.push({ x: b.x, y: b.y }); if (landed) break; }
  return out;
}

/* 상대 vy 추정(점프 인덱스 −16+m, 다이빙 −5+m). 스냅샷에 없어서 복원한다 — 없으면 공중 블로커를 "멈춰 있다"로 보고 킬을 내줬다 */
function oppVyEst(s) {
  if (g_oppm !== null) { if (g_oppm.air) return -16 + g_oppm.air; if (g_oppm.dive) return -5 + g_oppm.dive; }
  return 0;
}

/* FLAT_RELAX: 낮은 평타→깊은 착지 후보는 상대 반응을 FLAT_REACT 만큼 늦춰 판정 */
function flatDeepCand(landX, isRight) { var rel = isRight ? NET_X - landX : landX - NET_X; return rel > KILL_GATE.FLAT_DEEP; }
function flatRelaxGate(s, r, oppMinX, oppMaxX) {
  var r0 = KILL_GATE.REACT, ok;
  KILL_GATE.REACT = r0 + KILL_GATE.FLAT_REACT;
  try { ok = kgIsGuaranteedKill(s, r, oppMinX, oppMaxX); } finally { KILL_GATE.REACT = r0; }
  return ok;
}
/* 게이트 술어: "내가 pre 프레임 뒤에 contactBall 로 공을 보내면 상대가 닿을 수 있는가". 상대 위치는 관측 속도로 pre 만큼 외삽,
 *   공중 상대는 pre 동안 궤적 진행(착지하면 지상), 다이빙 상대는 인덱스 +pre. 그 뒤 kgOppCanReach(REACT·MARGIN) */
function gateOppReach(contactBall, pre, s, oppMinX, oppMaxX) {
  var opp = { x: clamp(s.opp.x + kg_lastVx * pre, oppMinX, oppMaxX), y: s.opp.y, state: s.opp.state,
              yVelocity: oppVyEst(s), lyingDownDurationLeft: s.opp.lyingDownDurationLeft };
  if ((opp.state === 1 || opp.state === 2) && pre > 0) {
    var oy = opp.y, ovy = opp.yVelocity | 0;
    for (var pf = 0; pf < pre; pf++) { oy += ovy; if (oy < PLAYER_GROUND_Y) ovy += 1; else { oy = PLAYER_GROUND_Y; ovy = 0; break; } }
    if (oy >= PLAYER_GROUND_Y) { opp.state = 0; opp.y = PLAYER_GROUND_Y; opp.yVelocity = 0; } else { opp.y = oy; opp.yVelocity = ovy; }
  }
  if (opp.state === 3 && g_oppm !== null && g_oppm.dive) {
    var dm0 = g_oppm.dive, ddir = s.opp.divingDirection || 1;
    opp.x = clamp(s.opp.x + 8 * ddir * Math.max(0, Math.min(pre, 12 - dm0)), oppMinX, oppMaxX);
    opp.diveIdx = dm0 + pre; opp.dir = ddir;
  }
  return kgOppCanReach(kgTrajectory(contactBall, 60), opp, oppMinX, oppMaxX, KILL_GATE.REACT, KILL_GATE.MARGIN);
}

/* microSim 의 거친 상대 대응창 계산(oppWindow) — 게이트가 아니라 채점 보조 */
function oppCanReach(b, oppX, oppMinX, oppMaxX, fSinceHit) {
  if (b.x < oppMinX - PLAYER_HALF || b.x > oppMaxX + PLAYER_HALF) return false;
  if (b.y < 76) return false;
  if (b.y < 212 && fSinceHit < 5) return false;
  return Math.abs(b.x - oppX) <= WALK_SPEED * fSinceHit + 40;
}

/* 나+공 동시 시뮬(엔진 복제): 첫 프레임 firstAction, 이후 action. 접촉·파워히트(xV = 방향×(|x|+1)×10, yV = max(15,|vy|)×y×2)·몸리시브(xV = ±|dx|/3, yV = −max(15,|vy|)) 반영.
 *   반환: 착지 x, 프레임, 터치 수, 마지막 파워히트 프레임(lastHitFrame), 접촉 직후 공(contactBall), 상대 대응창(oppWindow). md §2.1 */
function microSim(me0, ball0, firstAction, action, minX, maxX, maxFrames, oppInfo, trajOut) {
  var mx = me0.x, my = me0.y, vy = me0.vy, state = me0.state;
  var delay = me0.delay, frameNo = me0.frameNo;
  var b = { x: ball0.x, y: ball0.y, xV: ball0.xVelocity, yV: ball0.yVelocity };
  var collFlag = me0.collFlag === true;
  var touches = 0, powerTouches = 0, oppWindow = 0, fSinceHit = -1;
  var lastHitFrame = 0, contactBall = null;
  for (var f = 1; f <= maxFrames; f++) {
    var a = (f === 1) ? firstAction : action;
    if (stepBall(b)) {
      if (trajOut && fSinceHit >= 0) trajOut.push({ x: b.x, y: b.y });
      return { landed: true, landX: b.x, frames: f, touches: touches,
        powerTouches: powerTouches, oppWindow: oppWindow, lastHitFrame: lastHitFrame, contactBall: contactBall };
    }
    if (trajOut && fSinceHit >= 0) trajOut.push({ x: b.x, y: b.y });
    if (fSinceHit >= 0) {
      fSinceHit += 1;
      if (oppInfo && oppCanReach(b, oppInfo.x, oppInfo.minX, oppInfo.maxX, fSinceHit)) oppWindow += 1;
    }
    if (state < 3) mx = clamp(mx + a.x * WALK_SPEED, minX, maxX);
    var futureY = my + vy;
    my = futureY;
    if (futureY < PLAYER_GROUND_Y) vy += 1;
    else if (futureY > PLAYER_GROUND_Y) { my = PLAYER_GROUND_Y; vy = 0; state = 0; }   // 정확히 244 인 프레임은 엔진이 공중(state·vy 유지, 파워히트 가능)으로 둔다. physics.js 착지 분기와 동일
    if (a.hit === 1 && state === 1) { delay = 5; frameNo = 0; state = 2; }
    if (state === 2) {
      if (delay < 1) { frameNo += 1; if (frameNo > 4) { frameNo = 0; state = 1; } }
      else delay -= 1;
    }
    var overlap = Math.abs(b.x - mx) <= PLAYER_HALF && Math.abs(b.y - my) <= PLAYER_HALF;
    if (overlap) {
      if (!collFlag) {
        if (b.x < mx) b.xV = -idiv(Math.abs(b.x - mx), 3);
        else if (b.x > mx) b.xV = idiv(Math.abs(b.x - mx), 3);
        var absY = Math.abs(b.yV);
        b.yV = absY < 15 ? -15 : -absY;
        if (state === 2) {
          b.xV = (b.x < NET_X ? 1 : -1) * (Math.abs(a.x) + 1) * 10;
          b.yV = Math.abs(b.yV) * a.y * 2;
          powerTouches += 1; oppWindow = 0; fSinceHit = 0;
          lastHitFrame = f; contactBall = { x: b.x, y: b.y, xV: b.xV, yV: b.yV };
        }
        touches += 1; collFlag = true;
      }
    } else collFlag = false;
  }
  return { landed: false, landX: b.x, frames: maxFrames, touches: touches,
    powerTouches: powerTouches, oppWindow: oppWindow, lastHitFrame: lastHitFrame, contactBall: contactBall };
}

/* microSim 의 단계 입력판: stages = [{until, act}] (until 프레임까지 act). 첫 터치 프레임·공(firstTouchFrame, touchBall)도 반환 */
function microSimSeq(me0, ball0, stages, minX, maxX, maxFrames, oppInfo, trajOut) {
  var mx = me0.x, my = me0.y, vy = me0.vy, state = me0.state;
  var delay = me0.delay, frameNo = me0.frameNo;
  var b = { x: ball0.x, y: ball0.y, xV: ball0.xVelocity, yV: ball0.yVelocity };
  var collFlag = me0.collFlag === true;
  var touches = 0, powerTouches = 0, oppWindow = 0, fSinceHit = -1, lastHitFrame = 0, si = 0;
  var contactBall = null, firstTouchFrame = 0, touchBall = null;
  for (var f = 1; f <= maxFrames; f++) {
    while (si < stages.length - 1 && f > stages[si].until) si += 1;
    var a = stages[si].act;
    if (stepBall(b)) {
      if (trajOut && fSinceHit >= 0) trajOut.push({ x: b.x, y: b.y });
      return { landed: true, landX: b.x, frames: f, touches: touches,
        powerTouches: powerTouches, lastHitFrame: lastHitFrame, oppWindow: oppWindow, contactBall: contactBall,
        firstTouchFrame: firstTouchFrame, touchBall: touchBall };
    }
    if (trajOut && fSinceHit >= 0) trajOut.push({ x: b.x, y: b.y });
    if (fSinceHit >= 0) {
      fSinceHit += 1;
      if (oppInfo && oppCanReach(b, oppInfo.x, oppInfo.minX, oppInfo.maxX, fSinceHit)) oppWindow += 1;
    }
    if (state < 3) mx = clamp(mx + a.x * WALK_SPEED, minX, maxX);
    if (state < 3 && a.y === -1 && my === PLAYER_GROUND_Y) { vy = -16; state = 1; }
    var futureY = my + vy;
    my = futureY;
    if (futureY < PLAYER_GROUND_Y) vy += 1;
    else if (futureY > PLAYER_GROUND_Y) { my = PLAYER_GROUND_Y; vy = 0; if (state === 1 || state === 2) state = 0; }   // F2: microSim 과 같은 엔진 규칙
    if (a.hit === 1 && state === 1) { delay = 5; frameNo = 0; state = 2; }
    if (state === 2) {
      if (delay < 1) { frameNo += 1; if (frameNo > 4) { frameNo = 0; state = 1; } }
      else delay -= 1;
    }
    var overlap = Math.abs(b.x - mx) <= PLAYER_HALF && Math.abs(b.y - my) <= PLAYER_HALF;
    if (overlap) {
      if (!collFlag) {
        if (b.x < mx) b.xV = -idiv(Math.abs(b.x - mx), 3);
        else if (b.x > mx) b.xV = idiv(Math.abs(b.x - mx), 3);
        var aY = Math.abs(b.yV);
        b.yV = aY < 15 ? -15 : -aY;
        if (state === 2) {
          b.xV = (b.x < NET_X ? 1 : -1) * (Math.abs(a.x) + 1) * 10;
          b.yV = Math.abs(b.yV) * a.y * 2;
          powerTouches += 1; lastHitFrame = f; oppWindow = 0; fSinceHit = 0;
          contactBall = { x: b.x, y: b.y, xV: b.xV, yV: b.yV };
        }
        if (touches === 0) { firstTouchFrame = f; touchBall = { x: b.x, y: b.y, xV: b.xV, yV: b.yV }; }
        touches += 1; collFlag = true;
      }
    } else collFlag = false;
  }
  return { landed: false, landX: b.x, frames: maxFrames, touches: touches,
    powerTouches: powerTouches, lastHitFrame: lastHitFrame, oppWindow: oppWindow, contactBall: contactBall,
    firstTouchFrame: firstTouchFrame, touchBall: touchBall };
}

/* 지상 킬 점프 탐색: 점프 x(3) × 체공 방향 전환 h 틱(0..3) × 전환 x(3) × 스매시 x(3)·y(3) 후보를 microSimSeq 로 굴려
 *   상대 코트 착지·터치 예산·KILL_MAX_CONTACT·NET_HAZ·확정킬 게이트(FLAT_RELAX 또는 kgIsGuaranteedKill)를 통과한 것 중 최고 점수. h>0 은 oppTouch 확정일 때만. md §2.4 */
function findKillJump(s, minX, maxX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X;
  var oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var budget = 4 - g_touches;
  if (budget < 1) return null;
  var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };
  var me0 = {
    x: s.self.x, y: s.self.y, vy: 0, state: 0, delay: 0, frameNo: 0,
    collFlag: (Math.abs(s.ball.x - s.self.x) <= PLAYER_HALF &&
               Math.abs(s.ball.y - s.self.y) <= PLAYER_HALF)
  };
  var oppInfo = {
    x: s.opp.x,
    minX: isRight ? PLAYER_HALF : NET_X + PLAYER_HALF,
    maxX: isRight ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF
  };
  var best = null;
  var jxs = [0, 1, -1], cxs = [0, 1, -1], yds = [1, 0, -1];
  var flyTicks = EXP_REACH ? [0, 1, 2, 3] : [0];
  var traj = [];
  for (var i = 0; i < 3; i++) {
    var jumpAct = { x: jxs[i], y: -1, hit: 0 };
    for (var hi = 0; hi < flyTicks.length; hi++) {
      var h = flyTicks[hi];
      for (var ci = 0; ci < (h > 0 ? 3 : 1); ci++) {
        var flyAct = { x: cxs[ci], y: 0, hit: 0 };
        for (var j = 0; j < 3; j++) {
          for (var k = 0; k < 3; k++) {
            var smash = { x: cxs[j], y: yds[k], hit: 1 };
            var stages = [{ until: 1, act: first }, { until: 4, act: jumpAct }];
            if (h > 0) stages.push({ until: 4 + 3 * h, act: flyAct });
            stages.push({ until: 999, act: smash });
            traj.length = 0;
            var r = microSimSeq(me0, s.ball, stages, minX, maxX, 44, oppInfo, EXP_REACH ? traj : null);
            if (!r.landed || r.powerTouches < 1) continue;
            if (r.touches > budget) continue;
            if (r.landX <= oppMinX + 4 || r.landX >= oppMaxX - 4) continue;
            if (DEF_CFG.NET_HAZ && r.contactBall && Math.abs(r.contactBall.x - NET_X) < DEF_CFG.NET_HAZ) continue;
            if (r.lastHitFrame > DEF_CFG.KILL_MAX_CONTACT) continue;
            var drop = r.frames - r.lastHitFrame;
            var distFromOpp = Math.abs(r.landX - s.opp.x);
            var unreachable = distFromOpp > WALK_SPEED * drop + 44;
            var throughBall = r.oppWindow === 0;
            if (KILL_GATE.FLAT_RELAX && smash.y === 0 && flatDeepCand(r.landX, isRight)) { if (!flatRelaxGate(s, r, oppMinX, oppMaxX)) continue; }
            else if (!kgIsGuaranteedKill(s, r, oppMinX, oppMaxX)) continue;
            var confirmed = EXP_REACH && g_oppm !== null && r.powerTouches === 1 && oppTouch(traj, g_oppm, r.lastHitFrame) < 0;
            if (h > 0 && !confirmed) continue;
            if (drop > 14 && !unreachable && !throughBall && !confirmed) continue;
            var score = 300 - drop * 6 + distFromOpp;
            if (confirmed) score += 400 - r.lastHitFrame * 4;
            else if (throughBall) score += 250;
            else if (unreachable) score += 120;
            if (smash.y === 1 && drop <= FAST_ATTACK_CFG.DOWN_MAX_DROP &&
                (throughBall || unreachable || confirmed)) {
              score += Math.round(FAST_ATTACK_CFG.DOWN_BONUS * 0.65);
            }
            if (!best || score > best.score) best = { jx: jxs[i], smash: smash, score: score, fly: h > 0 ? flyAct : null, flyTicks: h, confirmed: confirmed, through: throughBall, landX: r.landX };
          }
        }
      }
    }
  }
  return best;
}

/* 반박자 빠른 공격: 점프와 동시에 hit 를 눌러 상승 중 강타. 같은 게이트 + 접촉 프레임 ≤ MAX_CONTACT·대응창 ≤ OPP_WINDOW. md §2.4 */
function findFastAttack(s, minX, maxX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X;
  var oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var budget = 4 - g_touches;
  if (budget < 1) return null;
  var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };
  var me0 = {
    x: s.self.x, y: s.self.y, vy: 0, state: 0, delay: 0, frameNo: 0,
    collFlag: (Math.abs(s.ball.x - s.self.x) <= PLAYER_HALF &&
               Math.abs(s.ball.y - s.self.y) <= PLAYER_HALF)
  };
  var oppInfo = {
    x: s.opp.x,
    minX: isRight ? PLAYER_HALF : NET_X + PLAYER_HALF,
    maxX: isRight ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF
  };
  var best = null;
  var jxs = [0, 1, -1];
  var cxs = [1, -1, 0];
  var yds = [1, 0];
  var traj = [];
  for (var au = 0; au < FAST_ATTACK_CFG.ARM_UNTILS.length; au++) {
    var armUntil = FAST_ATTACK_CFG.ARM_UNTILS[au];
    for (var i = 0; i < jxs.length; i++) {
      var jumpAct = { x: jxs[i], y: -1, hit: 1 };
      for (var j = 0; j < cxs.length; j++) {
        for (var k = 0; k < yds.length; k++) {
          var smash = { x: cxs[j], y: yds[k], hit: 1 };
          traj.length = 0;
          var r = microSimSeq(me0, s.ball, [
            { until: 1, act: first },
            { until: armUntil, act: jumpAct },
            { until: 999, act: smash }
          ], minX, maxX, 38, oppInfo, EXP_REACH ? traj : null);
          if (!r.landed || r.powerTouches !== 1 || r.touches > budget) continue;
          if (r.lastHitFrame <= Math.max(armUntil, g_group) ||
              r.lastHitFrame > FAST_ATTACK_CFG.MAX_CONTACT) continue;
          if (r.landX <= oppMinX + FAST_ATTACK_CFG.COURT_MARGIN ||
              r.landX >= oppMaxX - FAST_ATTACK_CFG.COURT_MARGIN) continue;
          if (DEF_CFG.NET_HAZ && r.contactBall && Math.abs(r.contactBall.x - NET_X) < DEF_CFG.NET_HAZ) continue;
          var drop = r.frames - r.lastHitFrame;
          if (drop < 1 || drop > FAST_ATTACK_CFG.MAX_DROP) continue;
          if (smash.y === 1 && drop > FAST_ATTACK_CFG.DOWN_MAX_DROP) continue;
          var distFromOpp = Math.abs(r.landX - s.opp.x);
          var unreachable = distFromOpp > WALK_SPEED * drop + 44;
          var throughBall = r.oppWindow === 0;
          var confirmed = EXP_REACH && g_oppm !== null && oppTouch(traj, g_oppm, r.lastHitFrame) < 0;
          if (r.oppWindow > FAST_ATTACK_CFG.OPP_WINDOW && !confirmed) continue;
          if (!throughBall && !unreachable && !confirmed) continue;
          if (KILL_GATE.FLAT_RELAX && smash.y === 0 && flatDeepCand(r.landX, isRight)) { if (!flatRelaxGate(s, r, oppMinX, oppMaxX)) continue; }
          else if (!kgIsGuaranteedKill(s, r, oppMinX, oppMaxX)) continue;
          var score = 720 - r.lastHitFrame * FAST_ATTACK_CFG.EARLY_WEIGHT -
            drop * 12 + distFromOpp;
          if (confirmed) score += 300;
          else if (throughBall) score += 180;
          else if (unreachable) score += 100;
          if (smash.y === 1) {
            score += FAST_ATTACK_CFG.DOWN_BONUS +
              (FAST_ATTACK_CFG.DOWN_MAX_DROP - drop) * 10;
          }
          if (Math.abs(smash.x) === 1) score += 18;
          if (!best || score > best.score) {
            best = {
              jx: jxs[i], smash: smash, score: score,
              armUntil: armUntil, contactFrame: r.lastHitFrame,
              dropFrames: drop, landX: r.landX, confirmed: confirmed, through: throughBall
            };
          }
        }
      }
    }
  }
  return best;
}

/* 공중 후보 act 의 점수. 상대 코트 착지면 거리·대응창·확정 여부·하향 가산(SAFE_PASS: 바닥 −70), 우리 코트에 남으면 −80 이하.
 *   AIR_GATE: 공중에서 새로 휘두르는 스매시(state 1)도 확정킬이어야 한다(의도한 점프 뒤 PASS_JUMP_COMMIT 틱은 면제) */
function scoreAirAction(s, me0, first, act, minX, maxX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X;
  var oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var touchBudget = 4 - g_touches;
  var oppInfo = {
    x: s.opp.x,
    minX: oppMinX === 0 ? PLAYER_HALF : NET_X + PLAYER_HALF,
    maxX: oppMaxX === NET_X ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF
  };
  var traj = [];
  var r = microSim(me0, s.ball, first, act, minX, maxX, 34, oppInfo, EXP_REACH ? traj : null);
  if (!r.landed) return null;
  if (r.touches > touchBudget) return null;
  if (DEF_CFG.NET_HAZ && act.hit === 1 && me0.state === 1 && r.powerTouches > 0 && r.contactBall && Math.abs(r.contactBall.x - NET_X) < DEF_CFG.NET_HAZ) return null;
  if (act.hit === 1 && me0.state === 1 && r.powerTouches > 0 &&
      !(g_pass_jump_until >= s.tick) &&
      !kgIsGuaranteedKill(s, r, oppMinX, oppMaxX)) return null;
  var onOpp = r.landX > oppMinX + 4 && r.landX < oppMaxX - 4;
  if (onOpp && r.touches > 0) {
    var distFromOpp = Math.abs(r.landX - s.opp.x);
    var score = distFromOpp - r.frames * 2;
    var confirmed = EXP_REACH && g_oppm !== null && r.powerTouches > 0 && oppTouch(traj, g_oppm, r.frames - traj.length) < 0;
    if (confirmed) score += 350;
    else if (r.powerTouches > 0 && r.oppWindow === 0) score += 250;
    else if (r.powerTouches > 0 && r.oppWindow <= 2) score += 120;
    else if (distFromOpp > WALK_SPEED * r.frames + 44) score += 120;
    if (act.hit === 1 && act.y === 1 && r.powerTouches > 0 &&
        (confirmed || r.oppWindow <= FAST_ATTACK_CFG.OPP_WINDOW ||
         distFromOpp > WALK_SPEED * r.frames + 44)) {
      score += FAST_ATTACK_CFG.DOWN_BONUS;
    }
    if (r.powerTouches >= 2) score += 60;
    if (act.hit === 1) score += 10;
    if (r.frames > 36 && distFromOpp < 110 &&
        !(r.powerTouches > 0 && r.oppWindow <= 2)) score -= 120;
    if (score < -70) score = -70;
    return score;
  }
  if (!onOpp && r.touches === 0) return null;
  var budget = 4 - g_touches;
  if (act.hit === 0 && r.touches > 0 && budget - r.touches >= 1) return -80;
  return -500 + (act.hit === 0 ? 50 : 0);
}

/* 공중 매 틱 재계획: hit 1(y 3종) / hit 0 × x 3종 중 최고 점수(state 2 면 hit 만) */
function chooseAirPolicy(s, me0, minX, maxX) {
  var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };
  var hitOnly = me0.state === 2;
  var best = null;
  var hits = hitOnly ? [1] : [1, 0];
  for (var h = 0; h < hits.length; h++) {
    var hit = hits[h];
    var yds = hit === 1 ? [1, 0, -1] : [0];
    var xds = [0, 1, -1];
    for (var xi = 0; xi < 3; xi++) {
      for (var yi = 0; yi < yds.length; yi++) {
        var act = { x: xds[xi], y: yds[yi], hit: hit };
        var score = scoreAirAction(s, me0, first, act, minX, maxX);
        if (score === null) continue;
        if (!best || score > best.score) best = { action: act, score: score };
      }
    }
  }
  return best;
}

/* 접촉 직후 속도로 착지까지 궤적(n = 접촉 후 스텝) */
function defTraj(x, y, xV, yV) {
  var b = { x: x, y: y, xV: xV, yV: yV }, out = [];
  for (var n = 1; n <= 90; n++) {
    var landed = stepBall(b);
    out.push({ n: n, x: b.x, y: b.y, landed: landed });
    if (landed) break;
  }
  return out;
}

/* 상대가 공에 닿을 수 있는 접촉 시점들 [{k, ball, air, ground}]. 상대는 계획하는 쪽이라 반응 지연 없이 다음 스텝부터 움직인다.
 *   엔진 충돌 래치: 스냅샷에서 공이 이미 상대 몸과 겹쳐 있으면(방금 친 공) 떨어질 때까지 다시 닿을 수 없다. 표본은 MAX_SAMPLES 로 균등 추림(첫 접촉 포함). md §2.5 */
function defOppContacts(s, oppMinX, oppMaxX) {
  var isRight = s.side === 'RIGHT';
  var opp = { x: s.opp.x, y: s.opp.y, state: s.opp.state | 0, yVelocity: oppVyEst(s),   // 스냅샷에 yVelocity 없음 → 복원
              lyingDownDurationLeft: s.opp.lyingDownDurationLeft,
              diveIdx: (g_oppm !== null && g_oppm.dive) ? g_oppm.dive : 0, dir: s.opp.divingDirection || 1 };
  var oLo = oppMinX + PLAYER_HALF, oHi = oppMaxX - PLAYER_HALF;
  var b = cloneBall(s.ball);
  var out = [];
  var latch = Math.abs(s.ball.x - s.opp.x) <= PLAYER_HALF && Math.abs(s.ball.y - s.opp.y) <= PLAYER_HALF;   // 엔진 충돌 래치
  for (var k = 1; k <= DEF_CFG.MAX_CONTACT; k++) {
    if (stepBall(b)) break;
    if (latch) { if (Math.abs(b.x - s.opp.x) <= PLAYER_HALF && Math.abs(b.y - s.opp.y) <= PLAYER_HALF) continue; latch = false; }
    var onOpp = isRight ? b.x < NET_X : b.x > NET_X;
    if (!onOpp) continue;
    var m = kgOppMotion(opp, k, 1);
    if (m.ys !== null && m.ys.length === 0) continue;
    var ox = opp.x + (m.xoff || 0), st0 = (m.startAt !== undefined) ? m.startAt : 1;
    var lo = clamp(ox - m.walk, oLo, oHi), hi = clamp(ox + m.walk, oLo, oHi);
    var xok = !(b.x + PLAYER_HALF < lo || b.x - PLAYER_HALF > hi);
    var air = false, ground = false;
    if (m.ys !== null && !m.grounded) {
      if (xok && Math.abs(b.y - m.ys[0]) <= PLAYER_HALF) { if (m.passive) ground = true; else air = true; }
    } else {
      if (xok && Math.abs(b.y - PLAYER_GROUND_Y) <= PLAYER_HALF) ground = true;
      if (xok) for (var j = st0; j <= k; j++) {
        var mm = k - j;
        if (mm < KG_JUMP_Y.length && Math.abs(b.y - KG_JUMP_Y[mm]) <= PLAYER_HALF) { air = true; break; }
      }
      if (!air && !ground) {
        for (var jd = st0; jd <= k; jd++) {
          var db = diveBody(k - jd + 1);
          if (db === null || Math.abs(b.y - db.y) > PLAYER_HALF) continue;
          var dreach = WALK_SPEED * (jd - st0) + db.dx;
          var dlo = clamp(ox - dreach, oLo, oHi), dhi = clamp(ox + dreach, oLo, oHi);
          if (b.x + PLAYER_HALF >= dlo && b.x - PLAYER_HALF <= dhi) { ground = true; break; }
        }
      }
    }
    if (!air && !ground) continue;
    out.push({ k: k, ball: { x: b.x, y: b.y, xV: b.xV, yV: b.yV }, air: air, ground: ground });
  }
  if (out.length > DEF_CFG.MAX_SAMPLES) {
    var picked = [], step = (out.length - 1) / (DEF_CFG.MAX_SAMPLES - 1);
    for (var i = 0; i < DEF_CFG.MAX_SAMPLES; i++) picked.push(out[Math.round(i * step)]);
    out = picked;
  }
  return out;
}

/* 한 접촉 시점에서 상대가 만들 수 있는 샷: 공중이면 파워히트 6종(x 1·2 × y −1·0·1), 지상이면 몸리시브 3종. 내 코트 착지만 */
function defShotTrajs(c, isRight) {
  var toMe = isRight ? 1 : -1;
  var trs = [], t;
  if (c.air) {
    for (var xa = 0; xa <= 1; xa++) for (var yd = -1; yd <= 1; yd++) {
      t = defTraj(c.ball.x, c.ball.y, toMe * (xa + 1) * 10, Math.max(15, Math.abs(c.ball.yV)) * yd * 2);
      trs.push(t);
    }
  }
  if (c.ground) {
    var up = -Math.max(15, Math.abs(c.ball.yV)), bvs = [10, 5, 1];
    for (var i = 0; i < bvs.length; i++) trs.push(defTraj(c.ball.x, c.ball.y, toMe * bvs[i], up));
  }
  var mine = [];
  for (var q = 0; q < trs.length; q++) {
    var L = trs[q][trs[q].length - 1];
    if (!L.landed) continue;
    if (isRight ? L.x > NET_X : L.x < NET_X) mine.push(trs[q]);
  }
  return mine;
}

/* 내가 x0(지상)에서 react 스텝 뒤부터 걷기(6)/다이빙(6 후 8)으로 궤적에 닿는 최대 여유 px(음수면 부족) */
function defReachSlack(traj, x0, react, isRight) {
  var best = -Infinity;
  for (var t = 0; t < traj.length; t++) {
    var p = traj[t];
    if (p.landed) break;
    if (p.y < PLAYER_GROUND_Y - 48) continue;
    if (isRight ? p.x < NET_X : p.x > NET_X) continue;
    var need = Math.abs(p.x - x0) - PLAYER_HALF; if (need < 0) need = 0;
    var n = p.n - react + 1; if (n < 0) n = 0;
    if (Math.abs(p.y - PLAYER_GROUND_Y) <= PLAYER_HALF) {
      var sl = WALK_SPEED * n - need;
      if (sl > best) best = sl;
    }
    for (var m = 1; m <= DIVE_TOUCH_FRAMES; m++) {
      var db = diveBody(m);
      if (Math.abs(p.y - db.y) > PLAYER_HALF) continue;
      var j = p.n - m; if (j < react) continue;
      var sl2 = WALK_SPEED * (j - react) + db.dx - need;
      if (sl2 > best) best = sl2;
    }
  }
  return best;
}

/* defReachSlack 을 걷기/다이빙/지금 시작하는 다이빙(diveNow)으로 나눠 반환. 다이빙 판정(§2.6)용 */
function defReachSplit(traj, x0, react, isRight) {
  var walk = -Infinity, dive = -Infinity, diveNow = -Infinity, diveDir = 0;
  var nowWindow = react + (g_group - 1);
  for (var t = 0; t < traj.length; t++) {
    var p = traj[t];
    if (p.landed) break;
    if (isRight ? p.x < NET_X : p.x > NET_X) continue;
    var need = Math.abs(p.x - x0) - PLAYER_HALF; if (need < 0) need = 0;
    var n = p.n - react; if (n < 0) n = 0;   // 스냅샷 스텝은 이전 입력(myPredX 반영) → 새 입력으로 걷는 프레임은 p.n−react
    if (Math.abs(p.y - PLAYER_GROUND_Y) <= PLAYER_HALF) { var sl = WALK_SPEED * n - need; if (sl > walk) walk = sl; }
    for (var m = 1; m <= DIVE_TOUCH_FRAMES; m++) {
      var db = diveBody(m);
      if (Math.abs(p.y - db.y) > PLAYER_HALF) continue;
      var j = p.n - m; if (j < react) continue;
      var sl2 = WALK_SPEED * (j - react) + db.dx - need;
      if (sl2 > dive) dive = sl2;
      if (j <= nowWindow && sl2 > diveNow) { diveNow = sl2; diveDir = p.x >= x0 ? 1 : -1; }
    }
  }
  return { walk: walk, dive: dive, diveNow: diveNow, diveDir: diveDir };
}

/* 위협이 없을 때 대기 자리: 표준 위협 집합(네트 앞 접촉 8·24·40px × 높이 171·108 × 파워히트 6종)에 대한 최악 여유 최대 x. 좌우별 1회 계산. md §2.5 */
var g_neutral_cache = { L: null, R: null };
function standbyCenter(isRight, minX, maxX) {
  var key = isRight ? 'R' : 'L';
  if (g_neutral_cache[key] !== null) return g_neutral_cache[key];
  var trs = [], offs = [DEF_CFG.CANON_CX, DEF_CFG.CANON_CX + 16, DEF_CFG.CANON_CX + 32], cys = [171, 108], yvsBy = { 171: [19, 30], 108: [0, 12] };
  for (var ci = 0; ci < offs.length; ci++) {
    var cx = isRight ? NET_X - offs[ci] : NET_X + offs[ci];
    for (var yi = 0; yi < cys.length; yi++) {
      var yvs = yvsBy[cys[yi]];
      for (var vi = 0; vi < yvs.length; vi++) {
        var ts = defShotTrajs({ ball: { x: cx, y: cys[yi], xV: 0, yV: yvs[vi] }, air: true, ground: false }, isRight);
        for (var q = 0; q < ts.length; q++) trs.push(ts[q]);
      }
    }
  }
  var bestX = isRight ? NET_X + DEF_CFG.STANDBY_OFF : NET_X - DEF_CFG.STANDBY_OFF, best = -Infinity;
  for (var x = minX; x <= maxX; x += 4) {
    var worst = Infinity;
    for (var k = 0; k < trs.length; k++) { var sl = defReachSlack(trs[k], x, DEF_CFG.REACT, isRight); if (sl < worst) worst = sl; }
    var win = worst > best;
    var tie = worst === best;
    if (win || (tie && Math.abs(x - NET_X) < Math.abs(bestX - NET_X))) { best = worst; bestX = x; }
  }
  g_neutral_cache[key] = bestX;
  return bestX;
}

/* 수비 자리: 상대의 모든 접촉 시점 × 샷 궤적에 대한 내 최악 여유를 최대화하는 x (빠른 샷 여유 먼저). 후보는 접촉 전까지 걸어 닿는 자리로 제한.
 *   MIN_MOVE: 지금 자리가 안전하면 SAFE_HYST, 아니면 MOVE_HYST 이상 개선일 때만 이동. 동률이면 fallback 에 가까운 x. md §2.5 */
function defenseTarget(s, minX, maxX, fallback, curX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X, oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var contacts = defOppContacts(s, oppMinX, oppMaxX);
  var trs = [], fast = [], ks = [];
  if (isRight ? s.ball.expectedLandingPointX >= NET_X : s.ball.expectedLandingPointX <= NET_X) {   // 상대가 안 쳐도 내 코트에 떨어지는 지금 궤적도 위협
    var keepT = defTraj(s.ball.x, s.ball.y, s.ball.xVelocity, s.ball.yVelocity);
    var keepL = keepT[keepT.length - 1];
    if (keepL.landed) { trs.push(keepT); fast.push(keepL.n <= DEF_CFG.FAST_STEPS); ks.push(0); }
  }
  for (var i = 0; i < contacts.length; i++) {
    var ts = defShotTrajs(contacts[i], isRight);
    for (var q = 0; q < ts.length; q++) {
      var L = ts[q][ts[q].length - 1];
      trs.push(ts[q]); ks.push(contacts[i].k);
      fast.push(contacts[i].k + L.n <= DEF_CFG.FAST_STEPS);
    }
  }
  if (!trs.length) return fallback;
  var evalX = function (x) {
    var wf = Infinity, wa = Infinity, ca = 0, cf = 0;
    for (var k = 0; k < trs.length; k++) {
      var xe = x;
      if (curX !== undefined) {
        var span = WALK_SPEED * ks[k], dxa = x - curX;
        xe = dxa > span ? curX + span : (dxa < -span ? curX - span : x);
      }
      var sl = defReachSlack(trs[k], xe, DEF_CFG.REACT, isRight);
      if (sl >= 0) { ca++; if (fast[k]) cf++; }
      if (sl < wa) wa = sl;
      if (fast[k] && sl < wf) wf = sl;
    }
    return { f: wf, a: wa, ca: ca, cf: cf };
  };
  var better = function (p, q) {
    if (p.f !== q.f) return p.f > q.f;
    return p.a > q.a;
  };
  var cur = curX !== undefined ? evalX(curX) : null;
  var bestX = fallback, best = null;
  var cands = [];
  for (var gx2 = minX; gx2 <= maxX; gx2 += DEF_CFG.X_STEP) cands.push(gx2);
  for (var ci2 = 0; ci2 < cands.length; ci2++) {
    var x = cands[ci2];
    var e = evalX(x);
    if (best === null || better(e, best) ||
        (e.f === best.f && e.a === best.a && e.ca === best.ca && e.cf === best.cf && Math.abs(x - fallback) < Math.abs(bestX - fallback))) { best = e; bestX = x; }
  }
  if (cur !== null) {
    var gain = best.f !== cur.f ? best.f - cur.f : best.a - cur.a;
    var hyst = cur.a >= DEF_CFG.SAFE_SLACK ? DEF_CFG.SAFE_HYST : DEF_CFG.MOVE_HYST;
    if (gain < hyst) return curX;
  }
  return bestX;
}

/* 지상 몸리시브 자리(§2.6): 목표 x 마다 실제 컨트롤러(3프레임마다 갱신, 지연 1)를 그대로 돌려 첫 접촉 (k, p) 를 찾고 같은 (k,p) 는 한 번만 채점.
 *   우선순위 ① 상대가 못 닿는 넘기기 ② 첫 터치면 네트 앞 세트 ③ 넘어가는 것 중 상대 최선 공격 뒤 내 여유가 큰 것 */
function gpMoveToward(cur, target) { var d = target - cur; return d > 9 ? 1 : (d < -9 ? -1 : 0); }
var g_recv_p = null;

/* 스냅샷 공의 프레임별 상태(속도 포함) */
function gpTraj(b0, maxN) {
  var b = { x: b0.x, y: b0.y, xV: b0.xV, yV: b0.yV }, out = [];
  for (var n = 1; n <= maxN; n++) {
    var landed = stepBall(b);
    out.push({ n: n, x: b.x, y: b.y, xV: b.xV, yV: b.yV, landed: landed });
    if (landed) break;
  }
  return out;
}
/* 목표 targetP 로 걷는 컨트롤러를 굴려 첫 접촉 프레임 k·내 위치 p·그때 공 t. 못 닿으면 null */
function gpWalkContact(px1, targetP, traj, minX, maxX, coll0) {
  var p = px1, a = 0, coll = coll0;
  for (var k = 1; k <= traj.length; k++) {
    if (k >= 2) {
      if ((k - 2) % g_group === 0) a = gpMoveToward(p, targetP);
      p = clamp(p + WALK_SPEED * a, minX, maxX);
    }
    var t = traj[k - 1];
    if (t.landed) return null;
    var over = Math.abs(t.x - p) <= PLAYER_HALF && Math.abs(t.y - PLAYER_GROUND_Y) <= PLAYER_HALF;
    if (over && !coll) return { k: k, p: p, t: t, first: gpMoveToward(px1, targetP) };
    coll = over;
  }
  return null;
}

/* 내 세트(cb)에 상대가 닿을 수 있는가(SET_SAFE) */
function setReachable(s, cb, ox, oppMinX, oppMaxX) {
  var s2 = { side: s.side, self: s.self, tick: s.tick,
             ball: { x: cb.x, y: cb.y, xVelocity: cb.xV, yVelocity: cb.yV, isPowerHit: false },
             opp: { x: ox, y: s.opp.y, state: s.opp.state, frameNumber: s.opp.frameNumber, yVelocity: s.opp.yVelocity, lyingDownDurationLeft: s.opp.lyingDownDurationLeft } };
  var mc0 = DEF_CFG.MAX_CONTACT; DEF_CFG.MAX_CONTACT = DEF_CFG.PASS_SIM_HORIZON;
  var n = defOppContacts(s2, oppMinX, oppMaxX).length; DEF_CFG.MAX_CONTACT = mc0;
  return n > 0;
}
/* 넘긴 공(cb)에 대한 상대의 최선 공격 뒤 내 최악 여유 px(PASS_SIM). 접촉 후보가 없으면 Infinity */
function passThreatSlack(s, cb, ox, p, isRight, oppMinX, oppMaxX) {
  var s2 = { side: s.side, self: s.self, tick: s.tick,
             ball: { x: cb.x, y: cb.y, xVelocity: cb.xV, yVelocity: cb.yV, isPowerHit: false },
             opp: { x: ox, y: s.opp.y, state: s.opp.state, frameNumber: s.opp.frameNumber, yVelocity: s.opp.yVelocity, lyingDownDurationLeft: s.opp.lyingDownDurationLeft } };
  var mc0 = DEF_CFG.MAX_CONTACT; DEF_CFG.MAX_CONTACT = DEF_CFG.PASS_SIM_HORIZON;
  var contacts = defOppContacts(s2, oppMinX, oppMaxX);
  DEF_CFG.MAX_CONTACT = mc0;
  var worst = Infinity;
  for (var i = 0; i < contacts.length; i++) {
    var ts = defShotTrajs(contacts[i], isRight), span = WALK_SPEED * contacts[i].k;
    for (var q = 0; q < ts.length; q++) {
      var L = ts[q][ts[q].length - 1], dxa = L.x - p;
      var xe = dxa > span ? p + span : (dxa < -span ? p - span : L.x);
      var sl = defReachSlack(ts[q], xe, DEF_CFG.REACT, isRight);
      if (sl < worst) worst = sl;
    }
  }
  return worst;
}
function groundPassPlan(s, isRight, minX, maxX, myPredX) {
  var oppMinX = isRight ? 0 : NET_X, oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var hoverX = isRight ? NET_X + 12 : NET_X - 12;
  var traj = gpTraj(cloneBall(s.ball), 90);
  var coll0 = Math.abs(s.ball.x - s.self.x) <= PLAYER_HALF && Math.abs(s.ball.y - s.self.y) <= PLAYER_HALF;
  var seen = {}, bestPass = null, bestSet = null, anyCross = false;
  var stale = staleTouch();
  var serveBall = g_touches === 0 && s.meta.rallyFrameCount < 60 && s.ball.xVelocity === 0 && s.ball.x === (isRight ? 376 : 56);   // 내 서브 공 첫 터치는 세트 금지
  for (var tp = minX; tp <= maxX; tp += 2) {
    var c = gpWalkContact(myPredX, tp, traj, minX, maxX, coll0);
    if (c === null) continue;
    var key = c.k + ':' + c.p;
    if (seen[key] !== undefined) continue;
    seen[key] = 1;
    var dxc = c.t.x - c.p;
    var nx = dxc < 0 ? -idiv(-dxc, 3) : (dxc > 0 ? idiv(dxc, 3) : 0);
    var ny = -Math.max(15, Math.abs(c.t.yV));
    var cb = { x: c.t.x, y: c.t.y, xV: nx, yV: ny };
    var tr2 = rxTrajOf(cb, 150);
    var landX = tr2[tr2.length - 1].x, flight = tr2.length;
    var reTouch = false;
    for (var q = 1; q < tr2.length - 1; q++) {
      var u = tr2[q];
      if (Math.abs(u.x - c.p) <= PLAYER_HALF && Math.abs(u.y - PLAYER_GROUND_Y) <= PLAYER_HALF) { reTouch = true; break; }
    }
    var crosses = landX > oppMinX + 8 && landX < oppMaxX - 8;
    var tmargin = PLAYER_HALF - Math.abs(dxc);
    var edgePenalty = (DEF_CFG.TOUCH_MARGIN > 0 && tmargin < (s.ball.xVelocity === 0 ? DEF_CFG.TOUCH_MARGIN_EXACT : DEF_CFG.TOUCH_MARGIN)) ? 1 : 0;
    var sticky = (g_recv_p !== null && Math.abs(c.p - g_recv_p) <= 9) ? 40 : 0;
    if (stale !== null && Math.abs(c.p - stale.px) <= 3) sticky -= 1000000;
    if (crosses) {
      anyCross = true;
      var ox = clamp(s.opp.x + kg_lastVx * c.k, oppMinX + PLAYER_HALF, oppMaxX - PLAYER_HALF);
      var reach = gateOppReach(cb, c.k, s, oppMinX, oppMaxX);
      var sc = Math.abs(landX - ox) - flight * 2 + ((reach || edgePenalty) ? 0 : 1000)
             - edgePenalty * (500 + (DEF_CFG.TOUCH_MARGIN - tmargin) * 50) + sticky;
      var ptsV = Infinity;
      if (reach || edgePenalty) {
        var pts = passThreatSlack(s, cb, ox, c.p, isRight, oppMinX, oppMaxX);
        ptsV = pts;
        sc += pts >= 0 ? 100000 : pts * DEF_CFG.PASS_SIM_W;
      }
      if (bestPass === null || sc > bestPass.sc) bestPass = { p: c.p, first: c.first, tp: tp, sc: sc, unreachable: !reach && !edgePenalty, pts: ptsV };
    } else if (!reTouch) {
      var d = Math.abs(landX - hoverX) + edgePenalty * 100 - sticky;
      if (d <= 30 && (bestSet === null || d < bestSet.d) &&
          !(g_touches < DEF_CFG.SET_MAX_TOUCH && setReachable(s, cb, clamp(s.opp.x + kg_lastVx * c.k, oppMinX + PLAYER_HALF, oppMaxX - PLAYER_HALF), oppMinX, oppMaxX)))
        bestSet = { p: c.p, first: c.first, tp: tp, d: d };
    }
  }
  var pick = null, kind = null;
  if (bestPass !== null && bestPass.unreachable) { pick = bestPass; kind = 'point'; }
  else if (g_touches < DEF_CFG.SET_MAX_TOUCH && bestSet !== null && !serveBall) { pick = bestSet; kind = 'set'; }
  else if (bestPass !== null) { pick = bestPass; kind = 'pass'; }
  if (stale !== null && pick !== null && Math.abs(pick.p - stale.px) <= 3) pick = null;   // 교착: 같은 자리뿐이면 계획을 비워 넘기기 점프로
  if (pick === null) { g_recv_p = null; return { standX: null, anyCross: stale !== null ? false : anyCross, kind: null, act: null }; }
  g_recv_p = pick.p;
  return { standX: pick.p, anyCross: anyCross, kind: kind, act: { x: pick.first, y: 0, hit: 0 }, pts: (kind === 'pass' || kind === 'point') ? pick.pts : null };
}

/* 지상으로는 못 넘기는 공(벽 구석 등)을 점프+파워히트로 넘긴다. 게이트 없음(안 넘기면 터치초과). y=1 제외 */
function findPassJump(s, minX, maxX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X, oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var budget = 4 - g_touches;
  if (budget < 1) return null;
  var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };
  var me0 = { x: s.self.x, y: s.self.y, vy: 0, state: 0, delay: 0, frameNo: 0,
    collFlag: (Math.abs(s.ball.x - s.self.x) <= PLAYER_HALF && Math.abs(s.ball.y - s.self.y) <= PLAYER_HALF) };
  var oppInfo = { x: s.opp.x, minX: isRight ? PLAYER_HALF : NET_X + PLAYER_HALF, maxX: isRight ? NET_X - PLAYER_HALF : GROUND_WIDTH - PLAYER_HALF };
  var best = null, jxs = [0, 1, -1], cxs = [0, 1, -1], yds = [-1, 0];
  for (var i = 0; i < 3; i++) {
    var jumpAct = { x: jxs[i], y: -1, hit: 0 };
    for (var j = 0; j < 3; j++) for (var k = 0; k < yds.length; k++) {
      var smash = { x: cxs[j], y: yds[k], hit: 1 };
      var r = microSimSeq(me0, s.ball, [{ until: 1, act: first }, { until: 4, act: jumpAct }, { until: 999, act: smash }], minX, maxX, 60, oppInfo);
      if (!r.landed || r.powerTouches < 1 || r.touches > budget) continue;
      if (r.landX <= oppMinX + 8 || r.landX >= oppMaxX - 8) continue;
      if (DEF_CFG.NET_HAZ && r.contactBall && Math.abs(r.contactBall.x - NET_X) < DEF_CFG.NET_HAZ) continue;
      var ox = clamp(s.opp.x + kg_lastVx * r.lastHitFrame, oppMinX + PLAYER_HALF, oppMaxX - PLAYER_HALF);
      var score = Math.abs(r.landX - ox) + (r.frames - r.lastHitFrame);
      if (!best || score > best.score) best = { jx: jxs[i], smash: smash, score: score };
    }
  }
  return best;
}

/* 내 vy 추정. 공중(state 1·2)의 (y, vy) 는 항상 244 에서 vy=-16 으로 시작한 점프 포물선 RX_JUMP 위의 점이다(엔진 physics.js).
 *   1) 직전 스냅샷부터 d 프레임 전부 공중이면 dy/d + (d+1)/2 가 정확 → 그 값이 표의 (y, vy) 쌍이면 채택(정점 통과 포함).
 *   2) 아니면 구간 중 이륙(244 → 공중)이 있었다. 스냅샷은 그 프레임 물리 전에 찍히고 응답은 다음 프레임부터 적용되므로
 *      이륙 후 첫 스냅샷은 공중 2프레임뿐이라 1) 은 항상 틀린다(y=213 → -8.33, 실제 -14). 상승부에서 y 로 역조회.
 *   m 프레임 뒤 vy = -16+m. 단 m=33(y=244 공중 프레임)은 엔진이 vy 를 올리지 않아 16. */
function jumpVyAt(m) { return m < 33 ? -16 + m : 16; }
function estimateMyVy(s) {
  var y = s.self.y, m;
  if (s.self.state > 2) return -16;
  if (g_prev !== null) {
    var d = Math.max(1, s.tick - g_prev_tick);
    var v = (y - g_prev.selfY) / d + (d + 1) / 2;
    if (v === Math.round(v)) for (m = 1; m <= 33; m++) if (RX_JUMP[m] === y && jumpVyAt(m) === v) return v;
  }
  for (m = 1; m <= 16; m++) if (RX_JUMP[m] === y) return jumpVyAt(m);
  if (y === PLAYER_GROUND_Y) return 16;
  return -16;
}

/* 새 게임·진영 교체: 학습 상태 전부 초기화 */
function resetAdaptiveLearning(side) {
  g_adapt.side = side;
  g_adapt.attackCount = 0;
  g_adapt.landingMean = 0;
  g_adapt.landingM2 = 0;
  g_adapt.landingEMA = null;
  g_adapt.recentDepths = [];
  g_adapt.zoneCounts = [0, 0, 0];
  g_adapt.shotCounts = [0, 0, 0, 0, 0, 0];
  g_adapt.fastCount = 0;
  g_adapt.downCount = 0;
  g_adapt.flatCount = 0;
  g_nt.flat = [null, null, null, null, null]; g_nt.n = [0, 0, 0, 0, 0]; g_nt.prevPH = false; g_nt.oppT = 0; g_nt.seq = false; g_nt.prevOnOpp = null;
  g_adapt.attackActive = false;
  g_adapt.lastAttackTick = -9999;
  g_adapt.lastRallyFrame = null;
  g_adapt.lastScoreSelf = null;
  g_adapt.lastScoreOpp = null;
}

function landingToDepth(landingX, isRight) {
  return clamp(isRight ? GROUND_WIDTH - landingX : landingX, 0, NET_X);
}

function depthToLanding(depth, isRight) {
  return isRight ? GROUND_WIDTH - depth : depth;
}

function classifyAdaptiveShot(ball) {
  var fast = Math.abs(ball.xVelocity) >= 15 ? 1 : 0;
  var angle = ball.yVelocity > 8 ? 2 : (ball.yVelocity < -8 ? 0 : 1);
  return fast * 3 + angle;
}

/* 상대 타격 1회 기록(착지 깊이 평균·EMA·구역·샷 종류) */
function recordOpponentAttack(s, isRight) {
  var landingX = s.ball.expectedLandingPointX;
  if (typeof landingX !== 'number' || landingX < 0 || landingX > GROUND_WIDTH) return;
  var landsOurs = isRight ? landingX >= NET_X : landingX <= NET_X;
  if (!landsOurs) return;
  var depth = landingToDepth(landingX, isRight);
  g_adapt.attackCount += 1;
  var n = g_adapt.attackCount;
  var delta = depth - g_adapt.landingMean;
  g_adapt.landingMean += delta / n;
  g_adapt.landingM2 += delta * (depth - g_adapt.landingMean);
  if (g_adapt.landingEMA === null) g_adapt.landingEMA = depth;
  else g_adapt.landingEMA += ADAPT_CFG.EMA_RATE * (depth - g_adapt.landingEMA);
  g_adapt.recentDepths.push(depth);
  if (g_adapt.recentDepths.length > ADAPT_CFG.RECENT_SIZE) g_adapt.recentDepths.shift();
  var zone = clamp(Math.floor(depth / (NET_X / 3)), 0, 2);
  g_adapt.zoneCounts[zone] += 1;
  var shot = classifyAdaptiveShot(s.ball);
  g_adapt.shotCounts[shot] += 1;
  if (shot >= 3) g_adapt.fastCount += 1;
  if (shot % 3 === 2) g_adapt.downCount += 1;
  if (shot % 3 === 1) g_adapt.flatCount += 1;
  g_adapt.lastAttackTick = s.tick;
}

/* 상대 서브 시퀀스(공이 처음 내 코트로 넘어오기 전) 관측: 상대 터치 순번(oppT)별 "네트 근처 파워히트가 깊은 평타였는가" EMA(flat[t]). TH_RETREAT 의 근거. md §2.7 */
var g_nt = { flat: [null, null, null, null, null], n: [0, 0, 0, 0, 0], prevPH: false, oppT: 0, seq: false, prevOnOpp: null };
var g_tr_count = 0, g_tr_active = false;   // 후퇴 발동 횟수(검사용) / 후퇴 진행 중(접촉까지 유지)
/* 매 틱: 서브 공 낙하 = 시퀀스 시작, 궤적 이탈 = 상대 터치 +1, 파워히트 상승 에지에서 평타/급강하 분류해 flat[oppT] 갱신, 넘어오면 시퀀스 끝 */
function ntObserve(s) {
  var isRight = s.side === 'RIGHT';
  var onOpp = isRight ? s.ball.x < NET_X : s.ball.x > NET_X;
  if (onOpp && s.ball.xVelocity === 0 && s.ball.x === (isRight ? 56 : 376) && !s.ball.isPowerHit) {
    g_nt.seq = true; g_nt.oppT = 0; g_nt.prevOnOpp = onOpp; g_nt.prevPH = false;
    return;
  }
  if (!g_nt.seq) { g_nt.prevPH = s.ball.isPowerHit === true; g_nt.prevOnOpp = onOpp; return; }
  var dev = false;
  if (g_prev !== null && g_prev_tick !== null) {
    var dtN = s.tick - g_prev_tick;
    if (dtN > 0 && dtN <= 12) { var prN = ballAfter(g_prev.ball, dtN); dev = Math.abs(prN.x - s.ball.x) > 2 || Math.abs(prN.yV - s.ball.yVelocity) > 2; }
  }
  if (dev) g_nt.oppT++;
  var ph = s.ball.isPowerHit === true;
  if (ph && !g_nt.prevPH) {
    var towardUs = isRight ? s.ball.xVelocity > 0 : s.ball.xVelocity < 0;
    var rel = isRight ? s.ball.expectedLandingPointX - NET_X : NET_X - s.ball.expectedLandingPointX;
    var flatLike = s.ball.y <= DEF_CFG.TH_FLAT_Y + 20 && Math.abs(s.ball.yVelocity) <= 6;
    var dropLike = s.ball.yVelocity >= 20;
    if (towardUs && Math.abs(s.ball.x - NET_X) <= 72 && (flatLike || dropLike) && rel > 0) {
      var t = Math.min(4, Math.max(1, g_nt.oppT));
      var deep = (flatLike && rel >= DEF_CFG.TH_FLAT_DEEP) ? 1 : 0;
      g_nt.flat[t] = g_nt.flat[t] === null ? deep : g_nt.flat[t] + DEF_CFG.TH_FLAT_ALPHA * (deep - g_nt.flat[t]);
      g_nt.n[t]++;
    }
  }
  g_nt.prevPH = ph;
  if (g_nt.prevOnOpp !== null && !onOpp) g_nt.seq = false;
  g_nt.prevOnOpp = onOpp;
}
/* 매 틱: 새 게임 감지 → 초기화, 새 랠리 → 순간 상태 해제, 상대가 실제로 때린 공만 recordOpponentAttack */
function observeOpponentPattern(s) {
  var isRight = s.side === 'RIGHT';
  if (g_adapt.side === null) g_adapt.side = s.side;
  var score = s.meta && s.meta.score ? s.meta.score : null;
  var scoreSelf = score && typeof score.self === 'number' ? score.self : null;
  var scoreOpp = score && typeof score.opp === 'number' ? score.opp : null;
  var scoreReset = (scoreSelf !== null && g_adapt.lastScoreSelf !== null &&
                    scoreSelf < g_adapt.lastScoreSelf) ||
                   (scoreOpp !== null && g_adapt.lastScoreOpp !== null &&
                    scoreOpp < g_adapt.lastScoreOpp);
  if (g_adapt.side !== s.side || scoreReset) resetAdaptiveLearning(s.side);
  var rallyFrame = s.meta && typeof s.meta.rallyFrameCount === 'number' ?
    s.meta.rallyFrameCount : null;
  if (rallyFrame !== null && g_adapt.lastRallyFrame !== null &&
      rallyFrame < g_adapt.lastRallyFrame) {
    g_adapt.attackActive = false;
    g_fast_attack_until = -1;
    g_fast_attack_policy = null;
  }
  var towardUs = isRight ? s.ball.xVelocity > 0 : s.ball.xVelocity < 0;
  var nearOpp = Math.abs(s.ball.x - s.opp.x) <= ADAPT_CFG.HIT_X_RANGE &&
                Math.abs(s.ball.y - s.opp.y) <= ADAPT_CFG.HIT_Y_RANGE;
  var onOppHalf = isRight ? s.ball.x <= NET_X + 48 : s.ball.x >= NET_X - 48;
  var deviated = false;
  if (g_prev !== null && g_prev_tick !== null) {
    var dt = s.tick - g_prev_tick;
    if (dt > 0 && dt <= 12) {
      var predicted = ballAfter(g_prev.ball, dt);
      deviated = Math.abs(predicted.x - s.ball.x) > 2 ||
        Math.abs(predicted.yV - s.ball.yVelocity) > 3 ||
        Math.abs(predicted.xV - s.ball.xVelocity) > 3;
    }
  }
  var powerPose = s.opp.state === 2 && s.ball.isPowerHit === true;
  var attackSignal = towardUs && nearOpp && onOppHalf && (deviated || powerPose);
  if (attackSignal && !g_adapt.attackActive &&
      s.tick - g_adapt.lastAttackTick >= Math.max(2, g_group)) {
    recordOpponentAttack(s, isRight);
  }
  if (attackSignal) g_adapt.attackActive = true;
  else if (!towardUs) g_adapt.attackActive = false;
  g_adapt.lastRallyFrame = rallyFrame;
  if (scoreSelf !== null) g_adapt.lastScoreSelf = scoreSelf;
  if (scoreOpp !== null) g_adapt.lastScoreOpp = scoreOpp;
}

/* 표본 수 + 코스 반복도 + 분산 → 패턴 신뢰도 0..1 */
function adaptiveConfidence() {
  var n = g_adapt.attackCount;
  if (n < ADAPT_CFG.MIN_SAMPLES) return 0;
  var sample = clamp((n - ADAPT_CFG.MIN_SAMPLES + 1) /
    (ADAPT_CFG.FULL_SAMPLES - ADAPT_CFG.MIN_SAMPLES + 1), 0, 1);
  var maxZone = Math.max(g_adapt.zoneCounts[0], g_adapt.zoneCounts[1],
                         g_adapt.zoneCounts[2]);
  var dominance = maxZone / n;
  var repeat = clamp((dominance - 0.34) / 0.46, 0, 1);
  var variance = n > 1 ? g_adapt.landingM2 / (n - 1) : 99999;
  var deviation = Math.sqrt(Math.max(0, variance));
  var stability = clamp((82 - deviation) / 62, 0, 1);
  var maxShot = 0;
  for (var i = 0; i < g_adapt.shotCounts.length; i++) {
    if (g_adapt.shotCounts[i] > maxShot) maxShot = g_adapt.shotCounts[i];
  }
  var shotRepeat = clamp((maxShot / n - 0.17) / 0.58, 0, 1);
  return sample * (0.25 + 0.75 * Math.max(repeat, stability, shotRepeat * 0.75));
}

/* 신뢰도 × MAX_BLEND 만큼 기본 자리를 학습 코스 쪽으로 이동(MAX_BLEND 0 = 그대로) */
function adaptiveDefenseTarget(s, baseTarget, minX, maxX) {
  var confidence = adaptiveConfidence();
  if (confidence <= 0 || g_adapt.landingEMA === null) return baseTarget;
  var recentSum = 0;
  for (var i = 0; i < g_adapt.recentDepths.length; i++) recentSum += g_adapt.recentDepths[i];
  var recentMean = g_adapt.recentDepths.length ?
    recentSum / g_adapt.recentDepths.length : g_adapt.landingMean;
  var learnedDepth = g_adapt.landingMean * 0.25 +
                     recentMean * 0.25 + g_adapt.landingEMA * 0.50;
  var learnedX = depthToLanding(learnedDepth, s.side === 'RIGHT');
  var fastRate = g_adapt.attackCount ? g_adapt.fastCount / g_adapt.attackCount : 0;
  var speedCommit = 0.90 + fastRate * 0.10;
  var blend = Math.min(ADAPT_CFG.MAX_BLEND,
    ADAPT_CFG.MAX_BLEND * confidence * speedCommit);
  var shift = clamp((learnedX - baseTarget) * blend,
                    -ADAPT_CFG.MAX_SHIFT, ADAPT_CFG.MAX_SHIFT);
  return clamp(baseTarget + shift, minX, maxX);
}

/* 검사용 */
function getAdaptiveStats() {
  var n = g_adapt.attackCount;
  var zone = 0;
  if (g_adapt.zoneCounts[1] > g_adapt.zoneCounts[zone]) zone = 1;
  if (g_adapt.zoneCounts[2] > g_adapt.zoneCounts[zone]) zone = 2;
  var zoneNames = ['BACK', 'MIDDLE', 'FRONT'];
  var predictedX = g_adapt.landingEMA === null ? null :
    depthToLanding(g_adapt.landingEMA, g_adapt.side === 'RIGHT');
  return {
    samples: n,
    confidence: Math.round(adaptiveConfidence() * 100),
    favoriteZone: n ? zoneNames[zone] : 'UNKNOWN',
    predictedLandingX: predictedX === null ? null : Math.round(predictedX),
    fastRate: n ? Math.round(g_adapt.fastCount * 100 / n) : 0,
    flatRate: n ? Math.round(g_adapt.flatCount * 100 / n) : 0,
    downRate: n ? Math.round(g_adapt.downCount * 100 / n) : 0
  };
}

/* 내 터치 기록(교착 감지용, 최근 8개) */
var g_touch_hist = [];

/* 교착: 마지막 터치가 p·2p 전(p=1..3)과 같은 자리·같은 반사 xV 면, 다음 터치에 해당하는 p 전 터치를 돌려준다(그 자리를 피한다) */
function staleTouch() {
  if ((DEF_CFG.STALE_N | 0) < 2) return null;
  var n = g_touch_hist.length, eq = function (a, b) { return Math.abs(a.px - b.px) <= 6 && Math.abs(a.vx - b.vx) <= 2; };
  for (var p = 1; p <= 3; p++) {
    if (n < 2 * p + 1) break;
    var last = g_touch_hist[n - 1];
    if (eq(last, g_touch_hist[n - 1 - p]) && eq(last, g_touch_hist[n - 1 - 2 * p])) return g_touch_hist[n - p];
  }
  return null;
}
/* 내 연속 터치 수(5터치 규칙 예산 = 4 − g_touches). 관측 사이 공 경로 × 내 몸 스윕 상자 교차로 감지, 공이 네트를 넘으면 0. md §2.8
 *   새 랠리: 첫 관측 rallyFrameCount 가 12~43 이라 rfc<4 에 닿지 않는다 → 점수가 바뀐 첫 호출에서 초기화(죽은 공 궤적의 가짜 터치도 차단) */
function updateTouches(s) {
  var scT = s.meta && s.meta.score, scoreKey = scT ? ((scT.self | 0) + ':' + (scT.opp | 0)) : null;
  var freshScore = scoreKey !== null && g_touch_score !== null && g_touch_score !== scoreKey;
  if (scoreKey !== null) g_touch_score = scoreKey;
  if (freshScore) { g_touches = 0; g_touch_hist.length = 0; g_tr_active = false; g_prev_ball_on_left = s.ball.x < NET_X; return; }
  var ballOnLeft = s.ball.x < NET_X;
  if (g_prev_ball_on_left !== null && ballOnLeft !== g_prev_ball_on_left) g_touches = 0;
  g_prev_ball_on_left = ballOnLeft;
  if (s.meta.rallyFrameCount < 4) { g_touches = 0; g_touch_hist.length = 0; return; }
  if (g_prev === null) return;
  var predicted = ballAfter(g_prev.ball, s.tick - g_prev_tick);
  var deviated = Math.abs(predicted.x - s.ball.x) > 2 ||
    Math.abs(predicted.yV - s.ball.yVelocity) > 2;
  if (deviated) {
    var myHalf = s.side === 'LEFT' ? s.ball.x < NET_X + 40 : s.ball.x > NET_X - 40;
    var dtT = s.tick - g_prev_tick;
    var bT = cloneBall(g_prev.ball), near = Math.abs(s.ball.x - s.self.x) <= PLAYER_HALF && Math.abs(s.ball.y - s.self.y) <= PLAYER_HALF;
    var xloT = Math.min(g_prev.selfX, s.self.x) - PLAYER_HALF, xhiT = Math.max(g_prev.selfX, s.self.x) + PLAYER_HALF;
    var yloT = Math.min(g_prev.selfY, s.self.y) - PLAYER_HALF - 4, yhiT = Math.max(g_prev.selfY, s.self.y) + PLAYER_HALF + 4;
    for (var fT = 1; fT <= dtT && !near; fT++) {
      if (stepBall(bT)) break;
      if (bT.x >= xloT && bT.x <= xhiT && bT.y >= yloT && bT.y <= yhiT) near = true;
    }
    if (near && myHalf) { g_touches += 1; g_touch_hist.push({ t: s.tick, bx: s.ball.x, by: s.ball.y, vx: s.ball.xVelocity, vy: s.ball.yVelocity, px: g_prev.selfX }); if (g_touch_hist.length > 8) g_touch_hist.shift(); }
  }
}

/* 목표까지 3프레임 걸음(18px) 단위로 가장 가까워지는 방향. |dx|<7 이면 정지 */
function walkTo(targetX, myPredX) {
  var dx = targetX - myPredX;
  if (dx > -7 && dx < 7) return 0;
  var step = WALK_SPEED * g_group;
  var best = 0, bestErr = Math.abs(dx);
  if (Math.abs(dx - step) < bestErr) { best = 1; bestErr = Math.abs(dx - step); }
  if (Math.abs(dx + step) < bestErr) best = -1;
  return best;
}

function fallbackAction(s) {
  var x = 0;
  var dx = s.ball.expectedLandingPointX - s.self.x;
  if (Math.abs(dx) > 8) x = dx > 0 ? 1 : -1;
  return { x: x, y: 0, hit: 0 };
}

/* 랠리 의사결정 본체. 순서: 상태 갱신 → 공중이면 킬 계획 유지·빠른공격 커밋·공중 재계획 → 지상: 드리프트 공격 → 수비(TH_RETREAT → 수비 자리)
 *   → 빠른공격 → 킬 점프 → 지상 리시브 계획(세트/넘기기/넘기기 점프) → 다이빙. md §2 */
function decideCore(s) {
  var cfg = s.config || {};
  var tf = cfg.tickFrameGroupSize || 0;
  g_group = tf > 0 ? tf : 3;
  var isRight = s.side === 'RIGHT';
  var minX = isRight ? NET_X + PLAYER_HALF : PLAYER_HALF;
  var maxX = isRight ? GROUND_WIDTH - PLAYER_HALF : NET_X - PLAYER_HALF;
  var towardNet = isRight ? -1 : 1;
  updateTouches(s);
  if (EXP_S2_TRACK) selfSync(s);
  observeOpponentPattern(s);
  ntObserve(s);
  var kgVx = kgOppVx(s); kgTrack(s); kg_lastVx = kgVx;
  g_oppm = EXP_REACH ? oppModelOf(s) : null;
  var me = s.self, ball = s.ball;
  if (me.state >= 3) return { x: 0, y: 0, hit: 0 };
  var myPredX = clamp(me.x + g_last_action.x * WALK_SPEED * LATENCY_FRAMES, minX, maxX);
  if (me.state === 1 || me.state === 2) {
    var vy = estimateMyVy(s);
    var me0 = {
      x: me.x, y: me.y, vy: vy, state: me.state,
      delay: (me.state === 2 && me.frameNumber === 0) ? (EXP_S2_TRACK && g_self.state === 2 ? g_self.delay : 3) : 0,
      frameNo: me.state === 2 ? me.frameNumber : 0,
      collFlag: (Math.abs(ball.x - me.x) <= PLAYER_HALF &&
                 Math.abs(ball.y - me.y) <= PLAYER_HALF)
    };
    var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };
    /* 체공 방향 전환 킬 계획: 남은 틱 동안 fly 입력을 내고, 재검증(여전히 확정)에 실패하면 버린다 */
    if (EXP_REACH && g_kill_plan !== null) {
      var kpT = Math.round((s.tick - g_kill_plan.tick0) / g_group);
      if (kpT >= 1 && kpT <= g_kill_plan.ticks) {
        var kpTraj = [];
        var kpR = microSimSeq(me0, s.ball, [
          { until: 1, act: first },
          { until: 1 + 3 * (g_kill_plan.ticks - kpT + 1), act: g_kill_plan.fly },
          { until: 999, act: g_kill_plan.smash }
        ], minX, maxX, 44, null, kpTraj);
        var kpOk = kpR.landed && kpR.powerTouches === 1 && (isRight ? kpR.landX < NET_X - 4 : kpR.landX > NET_X + 4) &&
          g_oppm !== null && oppTouch(kpTraj, g_oppm, kpR.lastHitFrame) < 0;
        if (kpOk) { g_air_policy = g_kill_plan.smash; return g_kill_plan.fly; }
        g_kill_plan = null;
      } else if (kpT > g_kill_plan.ticks) {
        g_air_policy = g_kill_plan.smash;
        g_fast_attack_policy = g_kill_plan.smash; g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS;
        g_kill_plan = null;
      }
    }
    /* 빠른공격·킬 커밋 유지(궤적이 예상과 달라 점수가 ABORT_SCORE 아래면 포기) */
    if (g_fast_attack_policy !== null && g_fast_attack_until >= s.tick) {
      var fastScore = scoreAirAction(s, me0, first, g_fast_attack_policy, minX, maxX);
      if (fastScore !== null && fastScore > FAST_ATTACK_CFG.ABORT_SCORE) {
        g_air_policy = g_fast_attack_policy;
        return g_fast_attack_policy;
      }
      g_fast_attack_until = -1;
      g_fast_attack_policy = null;
    }
    /* 공중 재계획: 현재 정책이 살아 있으면 15점 이상 나은 후보만 갈아탄다 */
    var curScore = null;
    if (g_air_policy !== null) curScore = scoreAirAction(s, me0, first, g_air_policy, minX, maxX);
    var pol = chooseAirPolicy(s, me0, minX, maxX);
    if (curScore !== null && curScore > -400) {
      if (pol === null || pol.score <= curScore + 15) return g_air_policy;
    }
    if (pol !== null && pol.score > -400) { g_air_policy = pol.action; return pol.action; }
    g_air_policy = null;
    var landingOurs = isRight ? ball.expectedLandingPointX >= NET_X
                              : ball.expectedLandingPointX <= NET_X;
    var moveTo = landingOurs ? clamp(ball.expectedLandingPointX, minX, maxX)
                             : standbyCenter(isRight, minX, maxX);
    return { x: walkTo(moveTo, myPredX), y: 0, hit: 0 };
  }
  g_air_policy = null;
  g_fast_attack_until = -1;
  g_fast_attack_policy = null;
  g_kill_plan = null;
  var landingX = ball.expectedLandingPointX;
  var ballOurs = isRight ? landingX >= NET_X : landingX <= NET_X;
  var landFrames = framesToLanding(ball);
  var ballOnOurHalf = isRight ? ball.x >= NET_X : ball.x <= NET_X;
  /* 공이 아직 상대 코트인데 낙하점만 내 코트(예: 상대 썬더 토스): 상대가 먼저 닿을 수 있으면 공격 분기 금지 → 수비 */
  var oppFirst = ballOurs && !ballOnOurHalf &&
    defOppContacts(s, isRight ? 0 : NET_X, isRight ? NET_X : GROUND_WIDTH).length > 0;
  var standbyC = standbyCenter(isRight, minX, maxX);
  /* 스스로 상대 코트로 넘어갈 공(공은 내 코트, 상대는 공중): 그냥 보내면 공짜 공 → 확정킬이 있으면 먼저 친다 */
  if (EXP_DRIFT_ATTACK && !ballOurs && ballOnOurHalf && s.opp.state !== 0) {
    var fa2 = findFastAttack(s, minX, maxX);
    if (fa2 !== null && EXP_DRIFT_ATTACK === 2 && !(fa2.confirmed || fa2.through)) fa2 = null;
    if (fa2 !== null) {
      g_fast_attack_policy = fa2.smash; g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS; g_air_policy = fa2.smash;
      g_pass_jump_until = s.tick + DEF_CFG.PASS_JUMP_COMMIT;
      return { x: fa2.jx, y: -1, hit: 1 };
    }
    var kj2 = findKillJump(s, minX, maxX);
    if (kj2 !== null && EXP_DRIFT_ATTACK === 2 && !(kj2.confirmed || kj2.through)) kj2 = null;
    if (kj2 !== null) {
      g_air_policy = kj2.smash; g_pass_jump_until = s.tick + DEF_CFG.PASS_JUMP_COMMIT;
      g_kill_plan = kj2.fly ? { fly: kj2.fly, ticks: kj2.flyTicks, smash: kj2.smash, tick0: s.tick } : null;
      if (!kj2.fly) { g_fast_attack_policy = kj2.smash; g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS; }
      return { x: kj2.jx, y: -1, hit: 0 };
    }
  }
  if (!ballOurs || oppFirst) {
    if (ballOnOurHalf || (s.meta && s.meta.rallyFrameCount < 4)) g_tr_active = false;   // 공이 넘어오면/랠리 시작이면 후퇴 해제
    /* TH_RETREAT(§2.7): 상대 서브 시퀀스에서 네트 위 점프 공격자의 첫 접촉이 K 스텝 안이고 내가 블록 자리면 네트 반대쪽으로 한 걸음.
     *   Lion 계열 썬더는 이 스냅샷에서 이탈(평타 388)을 결정하므로 그 뒤에 물러나야 평타를 다이빙으로 받는다. 한 번 시작하면 접촉까지 유지. */
    if (DEF_CFG.TH_RETREAT && me.state === 0 && (s.opp.state === 1 || s.opp.state === 2) && (!DEF_CFG.TH_RETREAT_SERVE_ONLY || g_nt.seq)) {
      var trOppNet = isRight ? NET_X - s.opp.x : s.opp.x - NET_X, trMyNet = isRight ? me.x - NET_X : NET_X - me.x;
      var trF = g_nt.flat[Math.min(4, Math.max(1, g_nt.oppT + 1))];
      var trOk = !DEF_CFG.TH_RETREAT_ADAPT || (DEF_CFG.TH_RETREAT_ADAPT === 2 ? (trF !== null && trF >= DEF_CFG.TH_RETREAT_TH) : (trF === null || trF >= DEF_CFG.TH_RETREAT_TH));
      if (trOk && trOppNet <= DEF_CFG.TH_RETREAT_OPP_NET && trMyNet <= DEF_CFG.TH_RETREAT_ZONE) {
        var trC = defOppContacts(s, isRight ? 0 : NET_X, isRight ? NET_X : GROUND_WIDTH);
        if (trC.length && trC[0].k <= DEF_CFG.TH_RETREAT_K) {
          var trNeed = true;
          if (DEF_CFG.TH_RETREAT_NEED && !g_tr_active) {
            var trKc = trC[0];
            for (var tri = 1; tri < trC.length; tri++) if (Math.abs(trC[tri].ball.y - DEF_CFG.TH_RETREAT_KILL_Y) < Math.abs(trKc.ball.y - DEF_CFG.TH_RETREAT_KILL_Y)) trKc = trC[tri];
            var trReact = ((3 - (trKc.k % 3)) % 3) + 1;
            var trTraj = kgTrajectory({ x: trKc.ball.x, y: trKc.ball.y, xV: isRight ? 20 : -20, yV: 0 }, 48);
            var trRs = defReachSplit(trTraj, myPredX, trReact, isRight);
            trNeed = trRs.walk < 0 && trRs.dive < DEF_CFG.TH_RETREAT_NEED_MARGIN;
          }
          if (trNeed) { g_tr_count++; g_tr_active = true; return { x: -towardNet, y: 0, hit: 0 }; }
        }
      }
    }
    var standbyT = adaptiveDefenseTarget(s, defenseTarget(s, minX, maxX, standbyC, myPredX), minX, maxX);
    return { x: walkTo(standbyT, myPredX), y: 0, hit: 0 };
  }
  /* 공격: 빠른공격 → 킬 점프(둘 다 확정킬 게이트) */
  var fastAttack = findFastAttack(s, minX, maxX);
  if (fastAttack !== null) {
    g_fast_attack_policy = fastAttack.smash;
    g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS;
    g_air_policy = fastAttack.smash;
    g_pass_jump_until = s.tick + DEF_CFG.PASS_JUMP_COMMIT;
    return { x: fastAttack.jx, y: -1, hit: 1 };
  }
  var kill = findKillJump(s, minX, maxX);
  if (kill !== null) {
    g_air_policy = kill.smash; g_pass_jump_until = s.tick + DEF_CFG.PASS_JUMP_COMMIT;
    g_kill_plan = kill.fly ? { fly: kill.fly, ticks: kill.flyTicks, smash: kill.smash, tick0: s.tick } : null;
    if (!kill.fly) { g_fast_attack_policy = kill.smash; g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS; }
    return { x: kill.jx, y: -1, hit: 0 };
  }
  var offset = null;
  /* 지상 리시브: co-sim 계획(세트/넘기기). 넘길 후보가 없으면 넘기기 점프 */
  var plan = groundPassPlan(s, isRight, minX, maxX, myPredX);
  var planX = null;
  if (plan !== null) {
    planX = plan.standX;
    if (!plan.anyCross) {
      var pj = findPassJump(s, minX, maxX);
      if (pj !== null) {
        g_air_policy = pj.smash; g_pass_jump_until = s.tick + DEF_CFG.PASS_JUMP_COMMIT;
        return { x: pj.jx, y: -1, hit: 0 };
      }
    }
  }
  /* 계획이 없을 때의 v5 오프셋 자리(착지점에서 towardNet 반대로 offset) */
  if (planX === null) {
    if (g_touches >= 3) offset = 18;
    else {
      var upV = Math.max(15, Math.abs(ballAfter(ball, landFrames - 1).yV));
      var flight = 2 * upV + 2;
      var hoverX = isRight ? NET_X + 12 : NET_X - 12;
      var needXv = (hoverX - landingX) / flight;
      offset = clamp(Math.round(3 * Math.abs(needXv)) + 1, 4, 26);
    }
  }
  var targetX = planX !== null ? planX : clamp(landingX - towardNet * offset, minX, maxX);
  var x = (plan !== null && plan.act) ? plan.act.x : walkTo(targetX, myPredX);
  /* 다이빙: 걸어서는 못 닿고 "지금 시작하는" 다이빙으로 닿을 때만(나중 다이빙으로 닿으면 계속 걷는다). 방향은 접촉점 쪽(뒤로도). md §2.6 */
  if (landFrames < 24) {
    var rs = defReachSplit(kgTrajectory(cloneBall(s.ball), 48), myPredX, DEF_CFG.DIVE_REACT, isRight);
    if (rs.walk < 0 && rs.diveNow >= 0) return { x: rs.diveDir || (landingX > myPredX ? 1 : -1), y: 0, hit: 1 };
  }
  return { x: x, y: 0, hit: 0 };
}

/* 다음 틱을 위한 직전 스냅샷 */
function savePrev(s) {
  g_prev = {
    ball: { x: s.ball.x, y: s.ball.y, xVelocity: s.ball.xVelocity, yVelocity: s.ball.yVelocity },
    selfY: s.self.y, selfX: s.self.x,
    oppY: s.opp.y, oppState: s.opp.state
  };
  g_prev_tick = s.tick;
}

var g_core_errors = 0, g_core_first_error = null;
/* ACCore 진입. decideCore 예외는 세고(errors) 낙하점 걷기 폴백 */
function decide(s) {
  var action;
  try { action = decideCore(s); }
  catch (e) {
    g_core_errors++;
    if (g_core_first_error === null) g_core_first_error = String((e && e.stack) || e).slice(0, 300);
    action = fallbackAction(s);
  }
  g_prev_action = g_last_action;
  g_last_action = action;
  savePrev(s);
  return action;
}
  return {
    decide: decide,
    sync: function (a, external) {
      g_last_action = { x: a.x, y: a.y, hit: a.hit };
      if (external) { g_air_policy = null; g_fast_attack_until = -1; g_fast_attack_policy = null; }
    },
    stats: getAdaptiveStats,
    last: function () { return g_last_action; },
    errors: function () { return { n: g_core_errors, first: g_core_first_error }; },
    rx: { oppTouch: oppTouch, oppModelOf: oppModelOf, RX_JUMP: RX_JUMP, RX_DIVE: RX_DIVE, rxTrajOf: rxTrajOf },
    kg: { kgOppCanReach: kgOppCanReach, kgTrajectory: kgTrajectory, kgIsGuaranteedKill: kgIsGuaranteedKill, gateOppReach: gateOppReach, standbyCenter: standbyCenter, diveBody: diveBody, KILL_GATE: KILL_GATE, DEF_CFG: DEF_CFG }
  };
})();

/* ══ §3 오케스트레이터 — 매 틱: (1) 지연 증거 (2) 데드볼 가드 (3) 랠리 감지 (4) 썬더 + 시작위치·지연 가드 (5) AC 그림자 호출(매 틱, 상태 유지)
 *   (6) 소유자 TH > AC > 폴백 → applySkill → sanitize → ACCore.sync → 반환. 예외는 삼키되 센다(M.errors) + 경기당 1회 F12 로그. md §3 ══ */
var M = {
  prevRally: -1, prevScore: -1, myServe: false, waitingForServe: false,
  lastOut: null, prev2Out: null, lastSelfX: null, lastSelfY: null, lastState: null,
  latWin: [], killedLat: 0, killedPos: 0, killedGroup: 0,
  errors: { thunder: 0, ac: 0, core: 0, skill: 0, orch: 0 },
  loggedFields: false, loggedError: false,
  rallyOwner: 'AC', rallies: []
};
function neutral() { return { x: 0, y: 0, hit: 0 }; }
function clampDir(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
function sanitize(a) { var o = a || {}; return { x: clampDir(o.x | 0), y: clampDir(o.y | 0), hit: o.hit ? 1 : 0 }; }
function fallbackAction(s) {
  var x = 0, dx = s.ball.expectedLandingPointX - s.self.x;
  if (Math.abs(dx) > 8) x = dx > 0 ? 1 : -1;
  return { x: x, y: 0, hit: 0 };
}
function logOnce(msg) { if (M.loggedError) return; M.loggedError = true; console.log('[OurBot v4] ' + msg); }
/* 새 스냅샷 필드 1회 로그(당일 스킬 필드 확인용) */
var KNOWN = { top: ['tick', 'side', 'self', 'opp', 'ball', 'meta', 'config'],
  self: ['x', 'y', 'state', 'frameNumber', 'divingDirection'],
  ball: ['x', 'y', 'xVelocity', 'yVelocity', 'isPowerHit', 'expectedLandingPointX'],
  meta: ['score', 'isPlayer2Serve', 'rallyFrameCount'], config: ['tickFrameGroupSize'] };
function logNewFields(s) {
  if (M.loggedFields) return; M.loggedFields = true;
  var extra = [], k, sec, secs = ['self', 'ball', 'meta', 'config'];
  for (k in s) if (Object.prototype.hasOwnProperty.call(s, k) && KNOWN.top.indexOf(k) < 0) extra.push(k + '=' + JSON.stringify(s[k]));
  for (var i = 0; i < secs.length; i++) { sec = secs[i]; if (s[sec]) for (k in s[sec]) if (Object.prototype.hasOwnProperty.call(s[sec], k) && KNOWN[sec].indexOf(k) < 0) extra.push(sec + '.' + k + '=' + JSON.stringify(s[sec][k])); }
  if (s.opp) for (k in s.opp) if (Object.prototype.hasOwnProperty.call(s.opp, k) && KNOWN.self.indexOf(k) < 0) extra.push('opp.' + k + '=' + JSON.stringify(s.opp[k]));
  console.log('[OurBot v4bc ' + s.side + '] 새 스냅샷 필드: ' + (extra.length ? extra.join(', ') : '없음'));
}
function latCounts() {
  var l1 = 0, l2 = 0;
  for (var i = 0; i < M.latWin.length; i++) { if (M.latWin[i] === 1) l1++; else if (M.latWin[i] === 2) l2++; }
  return { l1: l1, l2: l2 };
}
function core(s) {
  var isR = s.side === 'RIGHT';
  var selfX = isR ? 432 - s.self.x : s.self.x;
  if (DEBUG) logNewFields(s);
  if (LAT_GUARD && M.lastOut && M.prev2Out && M.lastState === 0 && s.self.state === 0 && M.lastSelfY === 244 && s.self.y === 244) {   // (1) 지연 증거: 직전 두 출력의 x 가 다르면 3프레임 변위가 지연1: 6(a2+2a1), 지연2: 6(2a2+a1)
    var a1 = isR ? -M.lastOut.x : M.lastOut.x, a2 = isR ? -M.prev2Out.x : M.prev2Out.x;
    if (a1 !== a2 && M.lastSelfX > 32 && M.lastSelfX < 184 && selfX > 32 && selfX < 184) {
      var obs = selfX - M.lastSelfX, e1 = 6 * (a2 + 2 * a1), e2 = 6 * (2 * a2 + a1);
      if (obs === e1 || obs === e2) { M.latWin.push(obs === e1 ? 1 : 2); if (M.latWin.length > LAT_WINDOW) M.latWin.shift(); }
    }
  }
  var sc = (s.meta && s.meta.score) ? s.meta.score : { self: 0, opp: 0 };
  var total = (sc.self | 0) + (sc.opp | 0);
  var rfc = s.meta ? (s.meta.rallyFrameCount | 0) : 0;
  /* (2) 데드볼 가드: 점수가 바뀐 뒤 서브 공(x 56/376, vx 0, y≤6)이 보일 때까지 중립(경기 종료 뒤 211프레임·다음 랠리에 입력 잔류 방지).
   *     서브 공을 못 봐도 rfc 45+ 면 해제(경기 종료 뒤·10점은 제외) */
  if (total !== M.prevScore && M.prevScore >= 0) M.waitingForServe = true;
  var serveBall = s.ball.xVelocity === 0 && (s.ball.x === 56 || s.ball.x === 376) && s.ball.y <= 6;
  if (M.waitingForServe && (serveBall || (rfc >= 45 && s.self.state < 5 && (sc.self | 0) < 10 && (sc.opp | 0) < 10))) M.waitingForServe = false;
  if (rfc < M.prevRally || total !== M.prevScore) {   // (3) 랠리 감지
    M.rallies.push({ owner: M.rallyOwner, myServe: M.myServe, th: Thunder.TH.state });
    if (M.rallies.length > 400) M.rallies.shift();
    M.rallyOwner = 'AC'; M.myServe = false;
  }
  M.prevRally = rfc; M.prevScore = total;
  var bx = isR ? 432 - s.ball.x : s.ball.x, bvx = isR ? -s.ball.xVelocity : s.ball.xVelocity;
  if (bvx === 0 && bx === 56 && s.ball.y <= 6) M.myServe = true;
  var out, owner;
  if (M.waitingForServe) { out = neutral(); owner = 'WAIT'; }
  else {
    var t = null;
    try { t = Thunder.step(s); } catch (e) { M.errors.thunder++; Thunder.kill('ERROR'); t = null; logOnce('썬더 예외: ' + (e && e.message)); }   // (4) 썬더
    var TH = Thunder.TH;
    if (t && TH.armed && !TH.dead && TH.fEst >= 0 && Thunder.tickIndexNow() <= 1) {
      if (!(s.self.state === 0 && s.self.y === 244 && selfX === 36)) {
        Thunder.kill('ABORT_POS'); t = null; M.killedPos++;
        if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 포기: 시작 위치 아님 x=' + selfX + ' y=' + s.self.y + ' state=' + s.self.state);
      } else if (LAT_GUARD) {
        var lc = latCounts();
        if (lc.l2 > lc.l1) {
          Thunder.kill('ABORT_LAT'); t = null; M.killedLat++;
          if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 포기: 지연 2프레임 증거 ' + lc.l2 + ' > ' + lc.l1);
        }
      }
    }
    if (TH.state === 'NO_GROUP' && !M.killedGroup) { M.killedGroup++; if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 비활성: tickFrameGroupSize=' + (s.config && s.config.tickFrameGroupSize)); }
    var aAC = null;
    try { aAC = ACCore.decide(s); } catch (e) { M.errors.ac++; aAC = null; logOnce('AC 예외: ' + (e && e.message)); }   // (5) AC 그림자 호출
    if (ACCore.errors) { var ce = ACCore.errors(); if (ce.n > M.errors.core) { M.errors.core = ce.n; logOnce('AC 코어 예외(폴백으로 처리됨) ' + ce.n + '회: ' + ce.first); } }
    if (t) { out = t; owner = 'TH'; M.rallyOwner = 'TH'; }   // (6) 소유자
    else if (aAC) { out = aAC; owner = 'AC'; }
    else { out = fallbackAction(s); owner = 'FALLBACK'; }
  }
  var pre = sanitize(out);
  /* 스킬 적용 뒤 sanitize; SK.key 는 sanitize 가 버리므로 따로 복사(엔진은 추가 키를 무시) */
  var fin = pre;
  try { var skA = applySkill(s, { x: pre.x, y: pre.y, hit: pre.hit }) || pre; fin = sanitize(skA); if (SK.on && skA[SK.key]) fin[SK.key] = skA[SK.key]; } catch (e) { M.errors.skill++; fin = pre; }
  var external = owner !== 'AC' || fin.x !== pre.x || fin.y !== pre.y || fin.hit !== pre.hit;
  try { ACCore.sync(fin, external); } catch (e) { M.errors.orch++; }
  M.prev2Out = M.lastOut; M.lastOut = fin; M.lastSelfX = selfX; M.lastSelfY = s.self.y; M.lastState = s.self.state;
  return fin;
}
function decide(snapshot) {
  try { return core(snapshot); }
  catch (e) { M.errors.orch++; logOnce('오케스트레이터 예외: ' + (e && e.message)); try { return sanitize(fallbackAction(snapshot)); } catch (e2) { return neutral(); } }
}
/* 검사 도구용 내부 노출 */
decide.__state = M;
decide.__thunder = Thunder.TH;
decide.__thunderTables = { expect: Thunder.EXPECT, spikeTick: Thunder.SPIKE_TICK, kill: Thunder.KILL };
decide.__bc = Thunder.BC;
decide.__ac = ACCore;
decide.__sk = SK;
