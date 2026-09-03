'use strict';
/* Lion_Eating_Bank_v5_1.js — v5 와 같은 구조에 d=4 세트(d4G)를 실은 변형 = src/code-here/LionBC_D4_v2.js 와 이 헤더만 다른 동일본 (복사 2026-09-03T09:21:04.943Z, bot-dev/blockcounter/make_v5.mjs).
 *   sim 경기 384-16(리시브 결합으로 v5 보다 열세), 지터 2% AC 86.8%, Chrome 강제 60/60·자연 4/4. 기본 제출은 v5, 이 파일은 상대가 회색지대·평타 즉시점프를 쓰는 경우의 교체 후보. LionBC_v4 와 구조(밴딧·킬 틱 이탈·시작위치 가드·자기검증)는 동일하고 TH_SEQS 만 d=4 세트로 교체:
 *   phase 1 = P1C (s90 (208,167), 29틱), phase 2 = 2k1 (s86 (207,168), 28틱), phase 0 = 0d3 (s73 (208,171), 24틱); 기하 최선 세트 d4G. 세 위상 모두 d=4·reaction≤4.
 *   TH_SEQS[0]: kill s90 (208,167) v(20,30) → x=248 +3; flat → x=388 +14
 *   TH_SEQS[1]: kill s86 (207,168) v(20,30) → x=247 +3; flat → x=387 +14
 *   TH_SEQS[2]: kill s73 (208,171) v(20,38) → x=248 +3; flat → x=388 +14
 *   생성: V4_SEQS=blockcounter/seqs_d4G.json V4_EXPECT=blockcounter/out/thunder_expect_d4G.json node bot-dev/blockcounter/build_v4bc.mjs (2026-09-03T07:31:27.300Z), 이 스크립트가 배너만 추가.
 *   근거·벤치·Chrome 검증: bot-dev/thunder_phase12/README.md "d=4 탐색" 절. 제출본 아님. 손으로 고치지 말 것. */
/* ==========================================================================
 *  원본 헤더: LionBC_v4.js — 실험용: Lion_Eating_Bank_v4 + 블록 대처. bot-dev/blockcounter/build_v4bc.mjs 가 생성 (2026-09-03T07:28:27.551Z). 손으로 고치지 말 것.
 *  = §1 Thunder(3위상 + [BC] 훅) + §2 AdaptiveCounter_v5_2 코어 + §3 오케스트레이터(v2 모양, Saja 없음)
 *  근거·검증 절차: bot-dev/LION_MERGE_PLAN.md, 블록 대처: bot-dev/blockcounter/README.md. 제출본 v4 와의 차이 = §0 [BC] 노브 3개 + §1 [BC] 블록·훅 3곳.
 * ========================================================================== */

/* ══ §0 당일 노브 ══ */
const DEBUG = true;        // F12 로그(썬더 발동/포기, 새 필드, 예외 1회). 제출 전 false 권장(1랠리 1줄이라 true여도 무방)
const LAT_GUARD = 1;       // 최근 LAT_WINDOW 관측에서 지연2 증거 > 지연1 증거면 썬더 포기(지연2에서 썬더는 0%). 지연1에서는 결과 영향 없음
const LAT_WINDOW = 30;
const SELF_CHECK = 1;      // 썬더 자기검증: 틱마다 기대 공 위치(TH_EXPECT)와 비교, 어긋나면 즉시 AC로. 지연1·정상 서브에서는 절대 발동하지 않음(결정론)
const SELF_CHECK_TOL = 2;  // 허용 오차(px)
const CAMP_ABORT_X = 0;    // 네트 캠퍼 대응(당일 노브). 0=끔(기본). 상대가 우리 서브마다 네트 앞(x≈248)에 서서 썬더 공을 몸으로 받아내면 262로.
                           //   근거: 캠핑 AC 상대 내서브 13%→48%. 단 AC도 ph1 스파이크 틱에 x=252에 서 있다가(점프해서 공을 못 건드림)
                           //   켜두면 오탐으로 vs AC 40-0→17-23. 그래서 기본은 끔. 판단 지점은 스파이크 누름 틱(TH_SPIKE_TICK).
const SERVE_BANDIT = 1;    // [BC] 위상별 서브 모드 밴딧(thunder / ac / flat). 내 서브 랠리 승패로 (승+1)/(시도+2)가 큰 모드를 고른다. 0=항상 썬더.
                           //   근거(bot-dev/blockcounter/README.md §5·§6): 네트 캠퍼 상대 내서브 23%→89%, 기존 봇 5종 상대 수치 불변. 신호는 블록 횟수가 아니라 승패여야 함.
const BANDIT_BLOCKWIN = 0.5; // [BC] 블록당하고도 이긴 썬더 랠리의 승 가중치(1=온전한 승).
const BANDIT_MODES = 'thunder,ac,flat'; // [BC] 밴딧 팔과 우선순위. steep=이탈 끈 썬더(예측이 틀리는 상대용 보험): thunder,steep,ac,flat
const CAMP_ESCAPE = 1;     // [BC] 킬 틱 이탈(phase 1·2). 1=예측 즉시, 2=블록 1회 관측 후, 3=블록 2회 관측 후: 상대가 킬 샷에 닿을 수 있으면(속도 외삽 x가 닿는 지점 x+32+6 이내, 지상이거나 점프 궤적이 상자 안) 평타(vy=0)로 전환. 0=끔.
const MAX_BLEND = 0;       // AC 적응 수비 강도. 0=OFF(미지 상대 기본, 5상대 평균 +8pp). 코스가 반복되는 상대면 0.62

// ── 스킬 블록(당일용, Sajamokneun_v3_2 원본). SK.on=false면 아무 것도 안 함. 최종 출력 직전에 한 번 적용되고 그 결과가 sync된다.
var SK = {
  on:    false,             // 스킬 확인 전에는 false. 확인 후 true 로.
  gauge: 'self.gauge',      // 내 게이지 경로.  새 필드 로그에서 그대로 복사
  ogauge:'opp.gauge',       // 상대 게이지 경로
  full:  100,               // 만충 값
  key:   'skill',           // 발동할 때 반환 객체에 넣을 키 이름
  fire:  0,                 // 0 = 발동 안 함(수비만)   1 = 발동함
  guard: 1                  // 1 = 상대 만충이면 위험한 강스매시를 아치로 낮춤
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
  } catch (e) { /* 스킬 로직이 죽어도 기본 액션은 그대로 */ }
  return a;
}

/* ══ §1 Thunder — 3위상 오픈루프 서브(TH_SEQS[0]=phase1, [1]=phase2, [2]=phase0, LEFT 기준; RIGHT는 x 부호 반전).
 *   시퀀스 출처: Lion_Eating_Bank_v3.js (실제 Chrome 강제 위상 40/40 × 3, 자연 위상 25/25). 지연 1프레임·틱그룹 3 전제.
 *   상태(TH.state): IDLE / ACTIVE / NO_PLAN / NO_GROUP / ABORT_POS / ABORT_LAT / DONE / ERROR ══ */
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
/* 위상별 기대 공 위치(planTick 순, LEFT 기준 [x,y]; null=검사 안 함). 캡처 2026-09-03T07:28:27.475Z */
var TH_EXPECT = [[[56,3],[56,15],[56,36],[56,66],[56,105],[56,153],[56,210],[60,188],[66,131],[72,83],[78,44],[84,14],[90,9],[96,21],[102,42],[108,72],[114,111],[120,159],[144,196],[204,202],[144,217],[108,217],[120,178],[132,148],[144,127],[156,115],[168,112],[180,118],[192,133]],[[56,1],[56,10],[56,28],[56,55],[56,91],[56,136],[56,190],[52,209],[40,149],[28,98],[16,56],[4,23],[8,7],[20,16],[32,34],[44,61],[56,97],[68,142],[80,196],[123,182],[132,143],[141,113],[150,92],[159,80],[168,77],[177,83],[186,98],[195,122]],[null,[56,6],[56,21],[56,45],[56,78],[56,120],[56,171],[56,231],[35,168],[14,114],[7,69],[28,33],[49,6],[70,12],[91,27],[112,51],[133,84],[142,42],[151,9],[160,3],[169,15],[178,36],[187,66],[196,105]]];
/* 위상별 스파이크(마지막 파워히트 누름) 틱. 네트 캠퍼 검사 시점 */
var TH_SPIKE_TICK = [27,27,23];
/* 킬 틱·닿는 지점·평타 이탈 (build_v4bc.mjs 가 실제 물리로 계산)
 *   TH_SEQS[0]: kill s90 (208,167) v(20,30) → x=248 +3; flat → x=388 +14
 *   TH_SEQS[1]: kill s86 (207,168) v(20,30) → x=247 +3; flat → x=387 +14
 *   TH_SEQS[2]: kill s73 (208,171) v(20,38) → x=248 +3; flat → x=388 +14 */
var TH_KILL = [{"killTick":28,"touchPts":[[228,197,5],[248,228,6]],"escape":[1,0,0]},{"killTick":27,"touchPts":[[227,198,5],[247,229,6]],"escape":[1,0,1]},{"killTick":23,"touchPts":[[228,209,5],[248,248,6]],"escape":[1,0,1]}];
/* ── [BC] 블록 대처(bot-dev/blockcounter/README.md §7): planIndex별 서브 모드 밴딧 + 킬 틱 평타 이탈 ──
 *   모드 thunder(시퀀스) / ac(썬더 생략, AC 서브) / flat(킬 틱에서 무조건 평타). 점수 (승+1)/(시도+2), 동점이면 앞선 모드.
 *   랠리 결과는 점수 +1 로만 판정(경기 리셋은 무시). 블록 = 킬 뒤 공이 isPowerHit 를 잃음(상대 범프). */
var BC = {
  modes: BANDIT_MODES.split(','),          // thunder=이탈 켠 썬더, steep=이탈 끈 썬더(예측이 틀리는 상대용 보험), ac=일반 서브, flat=무조건 평타
  mode: ['thunder', 'thunder', 'thunder'],
  stats: [{}, {}, {}],
  cur: null, lastSelf: 0, lastOpp: 0,
  prevOppX: -1, curOppX: -1, prevOppY: 244, curOppY: 244, margin: 6,
  switches: 0, escapes: 0, log: []
};
var BC_JUMP_Y = (function () { var a = [], y = 244, vy = -16; for (var m = 0; m < 40; m++) { y += vy; a.push(y); if (y < 244) vy += 1; else break; } return a; })();
function bcScore(pi, mode) { var st = BC.stats[pi][mode] || { n: 0, won: 0 }; return (st.won + 1) / (st.n + 2); }
function bcModeFor(pi) {
  if (!SERVE_BANDIT) return 'thunder';
  var best = 'thunder', bestV = -1;
  for (var i = 0; i < BC.modes.length; i++) {
    var m = BC.modes[i];
    if (m === 'flat' && !TH_KILL[pi].escape) continue;
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
function bcOnScoreChange(score, side) {
  var self = score.self | 0, opp = score.opp | 0;
  if (BC.cur) {
    var won = self === BC.lastSelf + 1 && opp === BC.lastOpp, lost = opp === BC.lastOpp + 1 && self === BC.lastSelf;
    if (won || lost) {
      var st = BC.stats[BC.cur.pi][BC.cur.mode];
      if (st) { if (won) st.won += (BC.cur.blocked ? BANDIT_BLOCKWIN : 1); if (BC.cur.blocked) st.blocked++; }
      var before = BC.mode[BC.cur.pi];
      BC.mode[BC.cur.pi] = bcModeFor(BC.cur.pi);
      if (BC.log.length < 120) BC.log.push({ pi: BC.cur.pi, mode: BC.cur.mode, won: won, blocked: BC.cur.blocked, escaped: BC.cur.escaped, next: BC.mode[BC.cur.pi] });
      if (before !== BC.mode[BC.cur.pi]) {
        BC.switches++;
        if (DEBUG) console.log('[OurBot v4bc ' + side + '] 서브 모드 전환 phase=' + ((BC.cur.pi + 1) % 3) + ' ' + before + ' → ' + BC.mode[BC.cur.pi] + ' (' + BC.cur.mode + (won ? ' 승' : ' 패') + (BC.cur.blocked ? ', 블록당함' : '') + (BC.cur.escaped ? ', 이탈' : '') + ')');
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
/* 이 스냅샷의 상대가 planIndex pi 의 킬 궤적에 닿을 수 있는가. x: 직전 틱 대비 속도(±6/step 클램프)로 닿는 step 까지 외삽.
 * y: 지상이면 언제든 점프 가능 → 위험. 공중이면 점프 궤적(−16 부터 +1)이 결정론이라 그 step 의 y 를 계산해 |dy|≤32 일 때만 위험. */
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
/* CAMP_ESCAPE 1 = 예측 즉시 이탈, 2 = 이 위상에서 블록을 1회 이상 본 뒤에만, 3 = 2회 이상 본 뒤에만 (사용자 제안 "먼저 해보고 계속 막히면") */
function bcEscapeAllowed(pi) {
  if (CAMP_ESCAPE < 2) return true;
  var st = BC.stats[pi].thunder;
  return !!st && (st.blocked | 0) >= CAMP_ESCAPE - 1;
}
function bcObserve(s) {
  if (!BC.cur || !BC.cur.killSeen) return;
  var bvx = s.side === 'RIGHT' ? -s.ball.xVelocity : s.ball.xVelocity;
  if (s.ball.isPowerHit && bvx > 0) BC.cur.phSeen = true;
  else if (BC.cur.phSeen && !s.ball.isPowerHit) BC.cur.blocked = true;
}
function reset() { TH.armed = false; TH.dead = false; TH.fEst = -1; TH.state = 'IDLE'; TH.logged = false; }
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
  if (group && group !== 3) { TH.state = 'NO_GROUP'; TH.dead = true; return null; }   // 시퀀스는 3프레임 격자 전제
  var bx = isRight ? 432 - s.ball.x : s.ball.x;
  var bvx = isRight ? -s.ball.xVelocity : s.ball.xVelocity;
  var myServeDrop = bvx === 0 && bx === 56;
  if (myServeDrop) {
    var fresh = s.ball.y === 0 ||
      (TH_YTABLE[s.ball.y] !== undefined && TH.fEst >= 0 && TH_YTABLE[s.ball.y] < TH.fEst);
    if (fresh) reset();
  }
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
  /* [BC] 서브 모드 밴딧: 위상이 확정되는 첫 틱에 이 랠리의 모드를 고른다. ac 면 썬더를 생략해 AC 가 서브한다. */
  if (!BC.cur) {
    var bcMode = bcModeFor(planIndex);
    bcServeStart(planIndex, bcMode);
    if (bcMode === 'ac') {
      if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 생략 phase=' + phase + ': 서브 모드 ac (밴딧 ' + JSON.stringify(BC.stats[planIndex]) + ')');
      kill('MODE_AC');
      return null;
    }
  }
  /* 자기검증(R1): 이 틱에 기대되는 공 위치와 다르면(지연 지터·블록·오발동) 즉시 포기 → 같은 틱부터 AC가 랠리를 맡는다. */
  if (SELF_CHECK) {
    var ex = TH_EXPECT[planIndex] && TH_EXPECT[planIndex][planTick];
    if (ex && (Math.abs(bx - ex[0]) > SELF_CHECK_TOL || Math.abs(s.ball.y - ex[1]) > SELF_CHECK_TOL)) {
      TH.devCount++;
      if (DEBUG) console.log('[OurBot v4bc ' + s.side + '] 썬더 포기: 궤적 이탈 planTick=' + planTick + ' 기대(' + ex[0] + ',' + ex[1] + ') 관측(' + bx + ',' + s.ball.y + ')');
      kill('ABORT_DEVIATION');
      return null;
    }
  }
  /* 네트 캠퍼 회피(R2): 스파이크를 누르는 틱에 상대가 네트 앞(정규화 x ≤ CAMP_ABORT_X)에 있으면 썬더 공은 상대 몸에 맞고
   * 되돌아와 랠리를 진다(실측 캠핑 AC 상대 1승 39패). 스파이크를 누르지 않고 AC에 넘겨 상대 위치를 보고 치게 한다. */
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
  /* [BC] 킬 틱 이탈: 이 틱의 입력 방향이 킬 접촉 속도를 정한다. 상대가 닿을 수 있으면(또는 모드 flat) y방향 0 → 평타(vy=0, 착지 x≈370). */
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

/* ══ §2 ACCore — AdaptiveCounter_v5_2 전문(무수정, MAX_BLEND만 노브). sha256 fab4afb14fbc ══ */
var ACCore = (function () {
'use strict';
/* AdaptiveCounter_v5_2
 * v5_1의 적응형 수비를 그대로 유지한다. 공격 시뮬레이션이 성공을 보장하는
 * 상황에서만 반박자 빠른 타격을 쓰고, 안전한 최대 하향 스파이크를 우선한다. */

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
var DIVE_SPEED = 8;
var LATENCY_FRAMES = 1;

var CFG = { AIR_MIN: 3, AIR_MAX: 16, Y_LO: 120, Y_HI: 218, TOL: 26, BAND: 0 };

/* === [ADAPT-1] 적응 강도: 초반에는 v5 그대로, 표본이 쌓일수록 서서히 반영 === */
var ADAPT_CFG = {
  MIN_SAMPLES: 3,       // 이 횟수 전에는 학습값을 수비에 사용하지 않음
  FULL_SAMPLES: 12,     // 이 정도 관측하면 표본 신뢰도를 최대로 봄
  EMA_RATE: 0.34,       // 최근 공격 코스에 반응하는 속도
  MAX_BLEND: MAX_BLEND,   // v4 노브(§0)로 치환됨. 원본 0.62      // 기존 v5 수비 판단을 최소 38% 보존
  MAX_SHIFT: 72,        // 학습 때문에 한 번에 치우칠 수 있는 최대 거리
  RECENT_SIZE: 8,
  HIT_X_RANGE: 105,
  HIT_Y_RANGE: 125
};

/* === [FAST-1] 빠른 공격은 엄격한 성공 조건을 통과할 때만 사용 === */
var FAST_ATTACK_CFG = {
  ARM_UNTILS: [2, 3],   // v5_1의 4프레임 대기보다 1~2프레임 먼저 타격 준비
  MAX_CONTACT: 13,      // 너무 늦게 만나는 공은 '반박자 빠른 공격'에서 제외
  MAX_DROP: 15,
  DOWN_MAX_DROP: 11,    // 하향 공격은 접촉 뒤 11프레임 안에 떨어져야 함
  COURT_MARGIN: 10,
  OPP_WINDOW: 2,        // 상대가 대응 가능한 프레임 창
  COMMIT_TICKS: 15,
  ABORT_SCORE: -280,
  DOWN_BONUS: 145,
  EARLY_WEIGHT: 11
};

var g_prev = null;
var g_touches = 0;
var g_prev_ball_on_left = null;
var g_prev_tick = null;
var g_last_action = { x: 0, y: 0, hit: 0 };
var g_air_policy = null;
var g_group = 3;
var g_fast_attack_until = -1;
var g_fast_attack_policy = null;

/* === [ADAPT-2] 랠리가 바뀌어도 유지되는 상대 패턴 능력치 === */
var g_adapt = {
  side: null,
  attackCount: 0,
  landingMean: 0,
  landingM2: 0,
  landingEMA: null,
  recentDepths: [],
  zoneCounts: [0, 0, 0],       // 0=뒤, 1=중앙, 2=네트 앞
  shotCounts: [0, 0, 0, 0, 0, 0], // 느림/빠름 × 아치/수평/내리꽂기
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
function ballAfter(ball, n) {
  var b = cloneBall(ball);
  for (var i = 0; i < n; i++) if (stepBall(b)) break;
  return b;
}
function framesToLanding(ball) {
  var b = cloneBall(ball);
  for (var i = 1; i <= 200; i++) if (stepBall(b)) return i;
  return 200;
}
function powerHitLanding(b0, xAbs, yd) {
  var b = {
    x: b0.x, y: b0.y,
    xV: (b0.x < NET_X ? 1 : -1) * (xAbs + 1) * 10,
    yV: Math.max(15, Math.abs(b0.yV)) * yd * 2
  };
  for (var i = 1; i <= 200; i++) if (stepBall(b)) return { x: b.x, frames: i };
  return { x: b.x, frames: 200 };
}

function oppCanReach(b, oppX, oppMinX, oppMaxX, fSinceHit) {
  if (b.x < oppMinX - PLAYER_HALF || b.x > oppMaxX + PLAYER_HALF) return false;
  if (b.y < 76) return false;
  if (b.y < 212 && fSinceHit < 5) return false;
  return Math.abs(b.x - oppX) <= WALK_SPEED * fSinceHit + 40;
}

function microSim(me0, ball0, firstAction, action, minX, maxX, maxFrames, oppInfo) {
  var mx = me0.x, my = me0.y, vy = me0.vy, state = me0.state;
  var delay = me0.delay, frameNo = me0.frameNo;
  var b = { x: ball0.x, y: ball0.y, xV: ball0.xVelocity, yV: ball0.yVelocity };
  var collFlag = me0.collFlag === true;
  var touches = 0, powerTouches = 0, oppWindow = 0, fSinceHit = -1;

  for (var f = 1; f <= maxFrames; f++) {
    var a = (f === 1) ? firstAction : action;
    if (stepBall(b)) {
      return { landed: true, landX: b.x, frames: f, touches: touches,
        powerTouches: powerTouches, oppWindow: oppWindow };
    }
    if (fSinceHit >= 0) {
      fSinceHit += 1;
      if (oppInfo && oppCanReach(b, oppInfo.x, oppInfo.minX, oppInfo.maxX, fSinceHit)) oppWindow += 1;
    }
    if (state < 3) mx = clamp(mx + a.x * WALK_SPEED, minX, maxX);
    var futureY = my + vy;
    my = futureY;
    if (futureY < PLAYER_GROUND_Y) vy += 1;
    else { my = PLAYER_GROUND_Y; vy = 0; state = 0; }
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
        }
        touches += 1; collFlag = true;
      }
    } else collFlag = false;
  }
  return { landed: false, landX: b.x, frames: maxFrames, touches: touches,
    powerTouches: powerTouches, oppWindow: oppWindow };
}

function microSimSeq(me0, ball0, stages, minX, maxX, maxFrames, oppInfo) {
  var mx = me0.x, my = me0.y, vy = me0.vy, state = me0.state;
  var delay = me0.delay, frameNo = me0.frameNo;
  var b = { x: ball0.x, y: ball0.y, xV: ball0.xVelocity, yV: ball0.yVelocity };
  var collFlag = me0.collFlag === true;
  var touches = 0, powerTouches = 0, oppWindow = 0, fSinceHit = -1, lastHitFrame = 0, si = 0;

  for (var f = 1; f <= maxFrames; f++) {
    while (si < stages.length - 1 && f > stages[si].until) si += 1;
    var a = stages[si].act;
    if (stepBall(b)) {
      return { landed: true, landX: b.x, frames: f, touches: touches,
        powerTouches: powerTouches, lastHitFrame: lastHitFrame, oppWindow: oppWindow };
    }
    if (fSinceHit >= 0) {
      fSinceHit += 1;
      if (oppInfo && oppCanReach(b, oppInfo.x, oppInfo.minX, oppInfo.maxX, fSinceHit)) oppWindow += 1;
    }
    if (state < 3) mx = clamp(mx + a.x * WALK_SPEED, minX, maxX);
    if (state < 3 && a.y === -1 && my === PLAYER_GROUND_Y) { vy = -16; state = 1; }
    var futureY = my + vy;
    my = futureY;
    if (futureY < PLAYER_GROUND_Y) vy += 1;
    else { my = PLAYER_GROUND_Y; vy = 0; if (state === 1 || state === 2) state = 0; }
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
        }
        touches += 1; collFlag = true;
      }
    } else collFlag = false;
  }
  return { landed: false, landX: b.x, frames: maxFrames, touches: touches,
    powerTouches: powerTouches, lastHitFrame: lastHitFrame, oppWindow: oppWindow };
}

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
  for (var i = 0; i < 3; i++) {
    var jumpAct = { x: jxs[i], y: -1, hit: 0 };
    for (var j = 0; j < 3; j++) {
      for (var k = 0; k < 3; k++) {
        var smash = { x: cxs[j], y: yds[k], hit: 1 };
        var r = microSimSeq(me0, s.ball, [
          { until: 1, act: first },
          { until: 4, act: jumpAct },
          { until: 999, act: smash }
        ], minX, maxX, 44, oppInfo);
        if (!r.landed || r.powerTouches < 1) continue;
        if (r.touches > budget) continue;
        if (r.landX <= oppMinX + 4 || r.landX >= oppMaxX - 4) continue;
        var drop = r.frames - r.lastHitFrame;
        var distFromOpp = Math.abs(r.landX - s.opp.x);
        var unreachable = distFromOpp > WALK_SPEED * drop + 44;
        var throughBall = r.oppWindow === 0;
        if (drop > 14 && !unreachable && !throughBall) continue;
        var score = 300 - drop * 6 + distFromOpp;
        if (throughBall) score += 250;
        else if (unreachable) score += 120;
        /* [DOWN-1] 이미 안전 판정을 통과한 후보끼리는 최대 하향(y=1)을 우선. */
        if (smash.y === 1 && drop <= FAST_ATTACK_CFG.DOWN_MAX_DROP &&
            (throughBall || unreachable)) {
          score += Math.round(FAST_ATTACK_CFG.DOWN_BONUS * 0.65);
        }
        if (!best || score > best.score) best = { jx: jxs[i], smash: smash, score: score };
      }
    }
  }
  return best;
}

/*
 * === [FAST-2] 반박자 빠른 공격 ===
 * v5_1의 일반 공격보다 hit 준비를 1~2프레임 앞당긴다. 다만 아래 조건을
 * 모두 통과한 경우에만 반환하고, 하나라도 실패하면 기존 v5_1로 돌아간다.
 */
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
  var yds = [1, 0]; // 최대 하향을 먼저 검사하고, 안전한 수평타만 보조 후보로 둔다.

  for (var au = 0; au < FAST_ATTACK_CFG.ARM_UNTILS.length; au++) {
    var armUntil = FAST_ATTACK_CFG.ARM_UNTILS[au];
    for (var i = 0; i < jxs.length; i++) {
      // 점프와 동시에 hit를 눌러 공격 상태를 반박자 먼저 준비한다.
      var jumpAct = { x: jxs[i], y: -1, hit: 1 };
      for (var j = 0; j < cxs.length; j++) {
        for (var k = 0; k < yds.length; k++) {
          var smash = { x: cxs[j], y: yds[k], hit: 1 };
          var r = microSimSeq(me0, s.ball, [
            { until: 1, act: first },
            { until: armUntil, act: jumpAct },
            { until: 999, act: smash }
          ], minX, maxX, 38, oppInfo);

          if (!r.landed || r.powerTouches !== 1 || r.touches > budget) continue;
          // 실제 접촉은 y=1/0 타격 명령으로 전환된 뒤에만 허용한다.
          if (r.lastHitFrame <= Math.max(armUntil, g_group) ||
              r.lastHitFrame > FAST_ATTACK_CFG.MAX_CONTACT) continue;
          if (r.landX <= oppMinX + FAST_ATTACK_CFG.COURT_MARGIN ||
              r.landX >= oppMaxX - FAST_ATTACK_CFG.COURT_MARGIN) continue;

          var drop = r.frames - r.lastHitFrame;
          if (drop < 1 || drop > FAST_ATTACK_CFG.MAX_DROP) continue;
          if (smash.y === 1 && drop > FAST_ATTACK_CFG.DOWN_MAX_DROP) continue;

          var distFromOpp = Math.abs(r.landX - s.opp.x);
          var unreachable = distFromOpp > WALK_SPEED * drop + 44;
          var throughBall = r.oppWindow === 0;
          if (r.oppWindow > FAST_ATTACK_CFG.OPP_WINDOW) continue;
          if (!throughBall && !unreachable) continue;

          var score = 720 - r.lastHitFrame * FAST_ATTACK_CFG.EARLY_WEIGHT -
            drop * 12 + distFromOpp;
          if (throughBall) score += 180;
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
              dropFrames: drop, landX: r.landX
            };
          }
        }
      }
    }
  }
  return best;
}

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
  var r = microSim(me0, s.ball, first, act, minX, maxX, 34, oppInfo);
  if (!r.landed) return null;
  if (r.touches > touchBudget) return null;
  var onOpp = r.landX > oppMinX + 4 && r.landX < oppMaxX - 4;
  if (onOpp && r.touches > 0) {
    var distFromOpp = Math.abs(r.landX - s.opp.x);
    var score = distFromOpp - r.frames * 2;
    if (r.powerTouches > 0 && r.oppWindow === 0) score += 250;
    else if (r.powerTouches > 0 && r.oppWindow <= 2) score += 120;
    else if (distFromOpp > WALK_SPEED * r.frames + 44) score += 120;
    /* [DOWN-2] 상대 코트 착지와 낮은 대응 창이 확인된 최대 하향타만 가산. */
    if (act.hit === 1 && act.y === 1 && r.powerTouches > 0 &&
        (r.oppWindow <= FAST_ATTACK_CFG.OPP_WINDOW ||
         distFromOpp > WALK_SPEED * r.frames + 44)) {
      score += FAST_ATTACK_CFG.DOWN_BONUS;
    }
    if (r.powerTouches >= 2) score += 60;
    if (act.hit === 1) score += 10;
    if (r.frames > 36 && distFromOpp < 110 &&
        !(r.powerTouches > 0 && r.oppWindow <= 2)) score -= 120;
    return score;
  }
  if (!onOpp && r.touches === 0) return null;
  var budget = 4 - g_touches;
  if (act.hit === 0 && r.touches > 0 && budget - r.touches >= 1) return -80;
  return -500 + (act.hit === 0 ? 50 : 0);
}

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

function defenseTarget(s, minX, maxX, fallback) {
  var isRight = s.side === 'RIGHT';
  var contactBall = ballAfter(s.ball, 2);
  var lands = [];
  for (var xa = 0; xa <= 1; xa++) {
    var yds = [1, 0, -1];
    for (var i = 0; i < 3; i++) {
      var land = powerHitLanding(contactBall, xa, yds[i]);
      var ours = isRight ? land.x >= NET_X : land.x <= NET_X;
      if (ours) lands.push(land);
    }
  }
  var plainFrames = framesToLanding(s.ball);
  var plainX = s.ball.expectedLandingPointX;
  var plainOurs = isRight ? plainX >= NET_X : plainX <= NET_X;
  if (plainOurs) lands.push({ x: plainX, frames: plainFrames });
  if (!lands.length) return fallback;

  var bestX = fallback, bestWorst = Infinity;
  for (var x = minX; x <= maxX; x += 4) {
    var worst = -Infinity;
    for (var k = 0; k < lands.length; k++) {
      var fr = lands[k].frames;
      var deficit = Math.abs(x - lands[k].x) - (WALK_SPEED * fr + 38);
      if (deficit > 0 && fr <= 10) deficit *= 1.6;
      else if (deficit > 0 && fr <= 16) deficit *= 1.2;
      if (deficit > worst) worst = deficit;
    }
    if (worst < bestWorst) { bestWorst = worst; bestX = x; }
  }
  return bestX;
}

function jumpYAt(k) {
  if (k <= 0) return PLAYER_GROUND_Y;
  var y = PLAYER_GROUND_Y - 16 * k + idiv(k * (k - 1), 2);
  return y > PLAYER_GROUND_Y ? PLAYER_GROUND_Y : y;
}

function estimateMyVy(s) {
  if (g_prev === null || s.self.state > 2) return -16;
  var d = Math.max(1, s.tick - g_prev_tick);
  var dy = s.self.y - g_prev.selfY;
  return dy / d + (d + 1) / 2;
}

function findIntercept(s, myPredX, minX, maxX) {
  var b = cloneBall(s.ball);
  for (var k = 1; k <= 44; k++) {
    if (stepBall(b)) break;
    if (b.yV < 0) continue;
    if (b.y < CFG.Y_LO || b.y > CFG.Y_HI) continue;
    if (b.x < minX - 20 || b.x > maxX + 20) continue;
    if (Math.abs(b.xV) > 14) continue;
    var airAge = k - LATENCY_FRAMES;
    var walkable = WALK_SPEED * (k - 1) + 8;
    if (Math.abs(b.x - myPredX) > walkable) continue;
    if (airAge >= CFG.AIR_MIN && airAge <= CFG.AIR_MAX &&
        Math.abs(jumpYAt(airAge) - b.y) <= CFG.TOL) {
      return { jump: true, targetX: b.x };
    }
    if (airAge > CFG.AIR_MAX) return { jump: false, targetX: b.x };
  }
  return null;
}

/* === [ADAPT-3] 상대가 실제로 때린 공만 감지하고 코스/속도/각도를 기록 === */
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
  g_adapt.attackActive = false;
  g_adapt.lastAttackTick = -9999;
  g_adapt.lastRallyFrame = null;
  g_adapt.lastScoreSelf = null;
  g_adapt.lastScoreOpp = null;
}

function landingToDepth(landingX, isRight) {
  // 양쪽 진영을 같은 좌표로 정규화: 0=뒷벽, 216=네트.
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
    // 새 랠리에서는 순간 감지 상태만 해제하고, 누적 패턴은 보존한다.
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

/* === [ADAPT-4] 표본 수 + 코스 반복도 + 분산으로 패턴 신뢰도 계산 === */
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

/* === [ADAPT-5] 신뢰도가 높을 때만 v5의 방어 위치를 학습 코스 쪽으로 보정 === */
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
  // 빠른 공격 비율이 높을수록 예측 위치에 조금 더 일찍 붙는다.
  var speedCommit = 0.90 + fastRate * 0.10;
  var blend = Math.min(ADAPT_CFG.MAX_BLEND,
    ADAPT_CFG.MAX_BLEND * confidence * speedCommit);
  var shift = clamp((learnedX - baseTarget) * blend,
                    -ADAPT_CFG.MAX_SHIFT, ADAPT_CFG.MAX_SHIFT);
  return clamp(baseTarget + shift, minX, maxX);
}

/* 디버그/브리핑용: 게임 중 현재 학습된 능력치를 읽을 수 있다. */
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

function updateTouches(s) {
  var ballOnLeft = s.ball.x < NET_X;
  if (g_prev_ball_on_left !== null && ballOnLeft !== g_prev_ball_on_left) g_touches = 0;
  g_prev_ball_on_left = ballOnLeft;
  if (s.meta.rallyFrameCount < 4) { g_touches = 0; return; }
  if (g_prev === null) return;
  var predicted = ballAfter(g_prev.ball, s.tick - g_prev_tick);
  var deviated = Math.abs(predicted.x - s.ball.x) > 2 ||
    Math.abs(predicted.yV - s.ball.yVelocity) > 2;
  if (deviated) {
    var nearMe = Math.abs(s.ball.x - s.self.x) < 90 && Math.abs(s.ball.y - s.self.y) < 110;
    var myHalf = s.side === 'LEFT' ? s.ball.x < NET_X + 40 : s.ball.x > NET_X - 40;
    if (nearMe && myHalf) g_touches += 1;
  }
}

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

function decideCore(s) {
  var cfg = s.config || {};
  var tf = cfg.tickFrameGroupSize || 0;
  g_group = tf > 0 ? tf : 3;

  var isRight = s.side === 'RIGHT';
  var minX = isRight ? NET_X + PLAYER_HALF : PLAYER_HALF;
  var maxX = isRight ? GROUND_WIDTH - PLAYER_HALF : NET_X - PLAYER_HALF;
  var towardNet = isRight ? -1 : 1;

  updateTouches(s);
  observeOpponentPattern(s); // [ADAPT-6] 매 판단마다 새 상대 타격만 한 번 기록
  var me = s.self, ball = s.ball;
  if (me.state >= 3) return { x: 0, y: 0, hit: 0 };

  var myPredX = clamp(me.x + g_last_action.x * WALK_SPEED * LATENCY_FRAMES, minX, maxX);

  if (me.state === 1 || me.state === 2) {
    var vy = estimateMyVy(s);
    var me0 = {
      x: me.x, y: me.y, vy: vy, state: me.state,
      delay: (me.state === 2 && me.frameNumber === 0) ? 3 : 0,
      frameNo: me.state === 2 ? me.frameNumber : 0,
      collFlag: (Math.abs(ball.x - me.x) <= PLAYER_HALF &&
                 Math.abs(ball.y - me.y) <= PLAYER_HALF)
    };
    var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };

    /* [FAST-3] 직전 시뮬레이션과 현재 궤적이 모두 안전할 때만 빠른 공격 유지. */
    if (g_fast_attack_policy !== null && g_fast_attack_until >= s.tick) {
      var fastScore = scoreAirAction(s, me0, first, g_fast_attack_policy, minX, maxX);
      if (fastScore !== null && fastScore > FAST_ATTACK_CFG.ABORT_SCORE) {
        g_air_policy = g_fast_attack_policy;
        return g_fast_attack_policy;
      }
      // 공 궤적이 예상과 달라지면 즉시 포기하고 기존 v5_1 공중 판단으로 복귀.
      g_fast_attack_until = -1;
      g_fast_attack_policy = null;
    }

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
                             : (isRight ? NET_X + 108 : NET_X - 108);
    return { x: walkTo(moveTo, myPredX), y: 0, hit: 0 };
  }

  g_air_policy = null;
  g_fast_attack_until = -1;
  g_fast_attack_policy = null;
  var landingX = ball.expectedLandingPointX;
  var ballOurs = isRight ? landingX >= NET_X : landingX <= NET_X;
  var landFrames = framesToLanding(ball);
  var ballOnOurHalf = isRight ? ball.x >= NET_X : ball.x <= NET_X;
  var oppMayHit = CFG.BAND === 1 && !ballOnOurHalf && Math.abs(ball.x - s.opp.x) < 130;
  var standbyC = isRight ? NET_X + 108 : NET_X - 108;

  if (!ballOurs || oppMayHit) {
    var oppImminent = s.opp.state === 1 || s.opp.state === 2 ||
      (Math.abs(ball.x - s.opp.x) < 90 && Math.abs(ball.y - s.opp.y) < 130);
    var standbyT;
    if (oppImminent) {
      var originalDefense = defenseTarget(s, minX, maxX, standbyC);
      standbyT = adaptiveDefenseTarget(s, originalDefense, minX, maxX);
    }
    else if (!ballOurs) standbyT = adaptiveDefenseTarget(s, standbyC, minX, maxX);
    else standbyT = clamp(landingX, standbyC - 45, standbyC + 45);
    return { x: walkTo(standbyT, myPredX), y: 0, hit: 0 };
  }

  /* [FAST-4] 수비 분기가 끝난 뒤에만 빠른 공격을 검사한다. */
  var fastAttack = findFastAttack(s, minX, maxX);
  if (fastAttack !== null) {
    g_fast_attack_policy = fastAttack.smash;
    g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS;
    g_air_policy = fastAttack.smash;
    return { x: fastAttack.jx, y: -1, hit: 1 };
  }

  var kill = findKillJump(s, minX, maxX);
  if (kill !== null) { g_air_policy = kill.smash; return { x: kill.jx, y: -1, hit: 0 }; }

  var icept = findIntercept(s, myPredX, minX, maxX);
  if (icept !== null) {
    var jx = walkTo(icept.targetX, myPredX);
    return { x: jx, y: icept.jump ? -1 : 0, hit: 0 };
  }

  var offset;
  if (g_touches >= 3) offset = 18;
  else {
    var upV = Math.max(15, Math.abs(ballAfter(ball, landFrames - 1).yV));
    var flight = 2 * upV + 2;
    var hoverX = isRight ? NET_X + 12 : NET_X - 12;
    var needXv = (hoverX - landingX) / flight;
    offset = clamp(Math.round(3 * Math.abs(needXv)) + 1, 4, 26);
  }
  var targetX = clamp(landingX - towardNet * offset, minX, maxX);
  var dx = targetX - myPredX;
  var x = walkTo(targetX, myPredX);

  var dist = Math.abs(dx);
  if (landFrames < 24 && dist > WALK_SPEED * landFrames + 6 &&
      dist <= DIVE_SPEED * landFrames + 44 && (ball.y > 140 || landFrames <= 10)) {
    return { x: dx > 0 ? 1 : -1, y: 0, hit: 1 };
  }
  return { x: x, y: 0, hit: 0 };
}

function savePrev(s) {
  g_prev = {
    ball: { x: s.ball.x, y: s.ball.y, xVelocity: s.ball.xVelocity, yVelocity: s.ball.yVelocity },
    selfY: s.self.y
  };
  g_prev_tick = s.tick;
}

function decide(s) {
  var action;
  try { action = decideCore(s); } catch (e) { action = fallbackAction(s); }
  g_last_action = action;
  savePrev(s);
  return action;
}
  return {
    decide: decide,
    /* 실제 적용된 입력을 되먹인다. external=true(썬더/스킬이 바꾼 입력)면 AC가 스스로 세운
     * 공중 정책·빠른공격 커밋도 지운다(v1 adaptiveCommitExternalAction 의미). AC 자신의 출력이면 유지. */
    sync: function (a, external) {
      g_last_action = { x: a.x, y: a.y, hit: a.hit };
      if (external) { g_air_policy = null; g_fast_attack_until = -1; g_fast_attack_policy = null; }
    },
    stats: getAdaptiveStats,
    last: function () { return g_last_action; }   // 검사용
  };
})();

/* ══ §3 오케스트레이터 ══
 *  매 틱 순서: (1) 지연 증거 (2) 데드볼 가드 (3) 랠리 감지 (4) 썬더 + 가드 (5) AC 그림자 호출
 *            (6) 소유자 선택 → applySkill → sanitize → ACCore.sync → 반환
 *  예외는 삼키되 센다(M.errors) + 경기당 1회 F12 로그. AC가 죽으면 낙하점 걷기 폴백(v1 fallbackAction). */
var M = {
  prevRally: -1, prevScore: -1, myServe: false, waitingForServe: false,
  lastOut: null, prev2Out: null, lastSelfX: null, lastSelfY: null, lastState: null,
  latWin: [], killedLat: 0, killedPos: 0, killedGroup: 0,
  errors: { thunder: 0, ac: 0, skill: 0, orch: 0 }, loggedFields: false, loggedError: false,
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
  /* (1) 지연 증거: 지상에서 직전 두 출력의 x가 다르면 3프레임 변위가 LAT1: 6(a2+2a1), LAT2: 6(2a2+a1). 최근 LAT_WINDOW개만 본다. */
  if (LAT_GUARD && M.lastOut && M.prev2Out && M.lastState === 0 && s.self.state === 0 && M.lastSelfY === 244 && s.self.y === 244) {
    var a1 = isR ? -M.lastOut.x : M.lastOut.x, a2 = isR ? -M.prev2Out.x : M.prev2Out.x;
    if (a1 !== a2 && M.lastSelfX > 32 && M.lastSelfX < 184 && selfX > 32 && selfX < 184) {
      var obs = selfX - M.lastSelfX, e1 = 6 * (a2 + 2 * a1), e2 = 6 * (2 * a2 + a1);
      if (obs === e1 || obs === e2) { M.latWin.push(obs === e1 ? 1 : 2); if (M.latWin.length > LAT_WINDOW) M.latWin.shift(); }
    }
  }
  var sc = (s.meta && s.meta.score) ? s.meta.score : { self: 0, opp: 0 };
  var total = (sc.self | 0) + (sc.opp | 0);
  var rfc = s.meta ? (s.meta.rallyFrameCount | 0) : 0;
  /* (2) 데드볼 가드(점수 무관): 점수가 바뀐 뒤 다음 서브공(x 56/376, vx 0, 낙하 초기)이 보일 때까지 중립.
   *     경기 종료 후 211프레임·다음 경기 첫 랠리에 다이빙/점프 입력이 잔류해 썬더 시작 위치가 깨지는 것을 막는다. */
  if (total !== M.prevScore && M.prevScore >= 0) M.waitingForServe = true;
  var serveBall = s.ball.xVelocity === 0 && (s.ball.x === 56 || s.ball.x === 376) && s.ball.y <= 6;
  if (M.waitingForServe && serveBall) M.waitingForServe = false;
  /* (3) 랠리 감지 */
  if (rfc < M.prevRally || total !== M.prevScore) {
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
    /* (4) 썬더 + 가드 */
    var t = null;
    try { t = Thunder.step(s); } catch (e) { M.errors.thunder++; Thunder.kill('ERROR'); t = null; logOnce('썬더 예외: ' + (e && e.message)); }
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
    /* (5) AC 그림자 호출 — 매 틱. 접촉 수·상대 학습 상태 유지 */
    var aAC = null;
    try { aAC = ACCore.decide(s); } catch (e) { M.errors.ac++; aAC = null; logOnce('AC 예외: ' + (e && e.message)); }
    /* (6) 소유자 */
    if (t) { out = t; owner = 'TH'; M.rallyOwner = 'TH'; }
    else if (aAC) { out = aAC; owner = 'AC'; }
    else { out = fallbackAction(s); owner = 'FALLBACK'; }
  }
  var pre = sanitize(out);
  var fin = pre;
  try { fin = sanitize(applySkill(s, { x: pre.x, y: pre.y, hit: pre.hit }) || pre); } catch (e) { M.errors.skill++; fin = pre; }
  var external = owner !== 'AC' || fin.x !== pre.x || fin.y !== pre.y || fin.hit !== pre.hit;
  try { ACCore.sync(fin, external); } catch (e) { M.errors.orch++; }
  M.prev2Out = M.lastOut; M.lastOut = fin; M.lastSelfX = selfX; M.lastSelfY = s.self.y; M.lastState = s.self.state;
  return fin;
}
function decide(snapshot) {
  try { return core(snapshot); }
  catch (e) { M.errors.orch++; logOnce('오케스트레이터 예외: ' + (e && e.message)); try { return sanitize(fallbackAction(snapshot)); } catch (e2) { return neutral(); } }
}
decide.__state = M;
decide.__thunder = Thunder.TH;
decide.__thunderTables = { expect: Thunder.EXPECT, spikeTick: Thunder.SPIKE_TICK, kill: Thunder.KILL };
decide.__bc = Thunder.BC;
decide.__ac = ACCore;
decide.__sk = SK;
