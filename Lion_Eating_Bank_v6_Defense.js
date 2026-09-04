'use strict';
/* Lion_Eating_Bank_v5_1.js — v5 와 같은 구조에 d=4 세트(d4G)를 실은 변형 = src/code-here/LionBC_D4_v2.js 와 이 헤더만 다른 동일본 (복사 2026-09-03T09:21:04.943Z, bot-dev/blockcounter/make_v5.mjs).
 *   sim 경기 384-16(리시브 결합으로 v5 보다 열세), 지터 2% AC 86.8%, Chrome 강제 60/60·자연 4/4. 기본 제출은 v5, 이 파일은 상대가 회색지대·평타 즉시점프를 쓰는 경우의 교체 후보. LionBC_v4 와 구조(밴딧·킬 틱 이탈·시작위치 가드·자기검증)는 동일하고 TH_SEQS 만 d=4 세트로 교체:
 *   phase 1 = P1C (s90 (208,167), 29틱), phase 2 = 2k1 (s86 (207,168), 28틱), phase 0 = 0d3 (s73 (208,171), 24틱); 기하 최선 세트 d4G. 세 위상 모두 d=4·reaction≤4.
 *   TH_SEQS[0]: kill s90 (208,167) v(20,30) → x=248 +3; flat → x=388 +14
 *   TH_SEQS[1]: kill s86 (207,168) v(20,30) → x=247 +3; flat → x=387 +14
 *   TH_SEQS[2]: kill s73 (208,171) v(20,38) → x=248 +3; flat → x=388 +14
 *   생성: V4_SEQS=blockcounter/seqs_d4G.json V4_EXPECT=blockcounter/out/thunder_expect_d4G.json node bot-dev/blockcounter/build_v4bc.mjs (2026-09-03T07:31:27.300Z), 이 스크립트가 배너만 추가.
 *   근거·벤치·Chrome 검증: bot-dev/thunder_phase12/README.md "d=4 탐색" 절. 제출본 아님. 손으로 고치지 말 것. */
/* Lion_Eating_Bank_v6_Defense.js — v5_1(썬더 서브) + GroundDefense 수비 코어.
 *   v6dev/build_v6.mjs 가 origin/main:Lion_Eating_Bank_v5_1.js + v6dev/gd_module.js 에서 생성.
 *   손으로 고치지 말 것. 고칠 곳은 gd_module.js / build_v6.mjs.
 *   설계: 낙하지점 추종을 버리고 (접촉 가능 프레임 × 접촉 위치 × 반사 방향) 을
 *        실제 물리로 전수 탐색하는 수비 상태기. 점프는 인증된 공격 셋업에서만. */
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
const MAX_BLEND = 0;

/* ══ §0-GD 수비형 노브 ══════════════════════════════════════════════════
 * GD_ON          1 = GroundDefense 상태기 사용(수비형 v6). 0 = v5_1 원본 판단.
 * GD_ATTACK      점프 공격 허용 여부. 0 이면 완전 무점프(썬더 서브 제외).
 * GD_ATTACK_MIN_K 지상 접촉까지 남은 프레임이 이보다 커야 점프를 검토한다.
 *                 (점프는 33프레임 = 11틱 구속이므로 시간 여유가 없으면 금지)
 * GD_ATTACK_SCORE findFastAttack / findKillJump 의 인증 점수 하한.
 * GD_ATTACK_COOL  공격 점프 후 재점프 금지 프레임. */
const GD_ON = 1;
const GD_ATTACK = 1;
const GD_ATTACK_MIN_K = 14;
const GD_ATTACK_SCORE = 700;
const GD_ATTACK_BOLD  = 350;
const GD_ATTACK_COOL = 24;
const GD_RD_BANDIT   = 1;
const GD_ATTACK_VMAX = 12;  /* 이보다 빠른 공에는 절대 점프하지 않는다 */
const GD_ATTACK_PH   = 1;     /* 1 = 상대 파워히트에서 온 공도 공격 대상으로 허용.
                                                     * v5 가 무너진 원인은 "빠른 강타에 점프"였고 그건
                                                     * GD_ATTACK_VMAX(|xV|≤12) 가 이미 막는다. isPowerHit 는
                                                     * 사실상 중복 조건이면서 기회의 절반 가까이를 잘라냈다
                                                     * (실측: 차단 8,487건 / 공격 62→97회, 종합 69.5→72.6%). */
const GD_LONG_RALLY  = 420;  /* 이 프레임을 넘긴 랠리는 인증 기준을 점진적으로 낮춘다 */
const GD_STICKY      = 900;      /* 대기 목표 히스테리시스(진동 억제) */
const GD_CLS_NEARNET = 70;  /* 코스 분포 학습에 쓸 상대 타격의 네트 근접 범위(px). 0=전부 */
const GD_SERVE_GUARD = 0;   /* 상대 서브 구간에는 표준 위협 기준 중립(가드) 위치를 유지 */

/* ══ [GD-BANDIT] 리시브 랠리 공격성 밴딧 ══════════════════════════════════
 * 팔 0 = SAFE (인증 점수 GD_ATTACK_SCORE. 지상 수비 우선, 랠리를 길게 끈다)
 * 팔 1 = BOLD (GD_ATTACK_BOLD. 인증이 조금 약해도 점프해 빨리 끝낸다)
 * 강한 상대에겐 SAFE, 약한 상대에겐 BOLD 가 이긴다. 어느 쪽인지 미리 알 수 없으므로
 * 리시브 랠리의 승패만으로 (승+1)/(시도+2) 를 비교해 온라인으로 고른다.
 * 관찰은 meta.score 뿐이고, 라플라스 사전분포가 자연스러운 탐색을 만든다. */
var RD = { arms: [{ n: 0, w: 0 }, { n: 0, w: 0 }], cur: 0, pend: -1, switches: 0 };
function rdScore(i) { return (RD.arms[i].w + 1) / (RD.arms[i].n + 2); }
function rdPick() { return (rdScore(1) > rdScore(0)) ? 1 : 0; }
function rdStart() { RD.cur = GD_RD_BANDIT ? rdPick() : 0; RD.pend = RD.cur; RD.arms[RD.cur].n++; }
function rdCredit(won) {
  if (RD.pend < 0) return;
  if (won) RD.arms[RD.pend].w += 1;
  RD.pend = -1;
}
function gdAttackBar(rfc) {
  var bar = RD.cur === 1 ? GD_ATTACK_BOLD : GD_ATTACK_SCORE;
  /* 아무도 못 끝내는 랠리는 그 자체로 지는 것과 같다. 길어질수록 기준을 낮춘다. */
  if (rfc > GD_LONG_RALLY) bar -= (rfc - GD_LONG_RALLY) * 1.5;
  return bar < 150 ? 150 : bar;
}       // AC 적응 수비 강도. 0=OFF(미지 상대 기본, 5상대 평균 +8pp). 코스가 반복되는 상대면 0.62

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
/* ══ §2.5 GroundDefense (GD) — 물리 기반 수비 코어 ══════════════════════════
 *
 * 설계 원칙 (전부 physics.js 실측에서 유도, 휴리스틱 상수 최소화)
 *
 * [P1] 충돌 판정 (FUN_00403070)
 *        |ball.x - player.x| ≤ 32  AND  |ball.y - player.y| ≤ 32
 *      지상 player.y = 244 → 지상 접촉 가능 ball.y ∈ [212, 276]
 *
 * [P2] 실효 접촉창
 *      processCollisionBetweenBallAndWorld 가 ball.y+yV > 252 이면 그 프레임에
 *      실점을 확정하고 리턴한다(충돌 판정보다 먼저). 따라서 실제로 받을 수 있는
 *      마지막 프레임은 "바닥에 닿기 직전 프레임"이며, 빠른 공에서는 단 1프레임뿐이다.
 *
 * [P3] 비파워 반사 (FUN_004030a0)
 *        xV = sign(bx-px) * floor(|bx-px| / 3)      (bx==px 면 rand ∈ {-1,0,1})
 *        yV = -max(15, |yV|)
 *      → 낙하지점 정중앙에 서면 xV ≈ 0 이라 공이 제자리에 뜬다.
 *        네트 쪽으로 보내려면 공보다 18~32px "뒤"에 서야 한다(xV = 6~10).
 *
 * [P4] 네트 기둥 반사대
 *        |bx - 216| < 25  AND  by > 192  →  우리쪽(bx<216)이면 xV = -|xV|
 *      즉 x ∈ (191,241) 에서 낮게 받으면 다음 프레임에 다시 우리 쪽으로 튕긴다.
 *      → 접촉 x 를 이 밴드 밖으로 만드는 것이 "네트 앞 썬더" 처리의 핵심.
 *
 * [P5] 제어 지연·격자
 *      스냅샷은 프레임 f0 상태, 이번 결정은 f0+1..f0+3, 다음 결정은 f0+4..f0+6.
 *      → 상대프레임 1 은 직전 액션이 지배하고, 새 액션은 상대프레임 2 부터 3프레임 단위.
 *      → 도달 가능 위치는 18px 격자. "낙하지점에 정확히 선다"는 애초에 불가능하므로
 *        목표를 x 하나가 아니라 "접촉 가능 구간"으로 잡아야 한다.
 *
 * [P6] 다이빙 비용 (state 3 → 4)
 *      x 는 13프레임 동안 6+8*12 = 102px 강제 이동, y 는 최소 229까지 올라가
 *      접촉창이 [197,261] 로 넓어진다. 대신 착지 후 lyingDown 까지 총 18프레임 무제어.
 *
 * 판단 구조
 *      공이 상대 코트  → planStandby : 상대의 가능한 타격 결과 전체를 전개하고
 *                                     지상 접촉 여유(margin)를 최대화하는 대기 x
 *      공이 우리 코트  → planReceive : 실제 컨트롤러를 그대로 돌린 co-simulation 으로
 *                                     (접촉 프레임 × 접촉 위치) 를 전수 탐색, 반사 결과까지 평가
 * ════════════════════════════════════════════════════════════════════════ */
var GD = (function () {
'use strict';

var GW = 432, NET = 216, PGY = 244, BGY = 252, MAXVY = 40;
var PH = 32, NHW = 25, NTY = 176, NTBY = 192, WALK = 6;
var CONTACT_LO = PGY - PH;        /* 212 */
/* 상대 타격 관측 → 우리 입력이 먹기까지의 프레임 수.
 * 타격이 프레임 c 에 일어나면 우리는 다음 틱(최대 3프레임 뒤)에 관측하고 +1 프레임 뒤 적용
 * → 최악 4, 기대 2.5. 대기 위치는 헤지이므로 최악값이 최선은 아니다(아래 스윕 참조). */
var REACT = 4;

/* ── 상대 타격 프레임 c 에 대한 정확한 반응 지연 ───────────────────────────
 * 우리 결정이 먹는 상대프레임은 2,5,8,… (f ≡ 2 mod 3) 로 위상이 확정돼 있다 [P5].
 * 따라서 상대가 프레임 c 에 치면, 그에 반응한 입력이 먹는 첫 프레임은
 * c+1 이상인 D={2,5,8,…} 의 최솟값이고 지연은 그 차이다 — 1,2,3 중 하나로 확정된다.
 * 상수 4(최악값)를 쓰면 우리 도달 범위를 매 위협마다 6~18px 과소평가하게 되고,
 * 실측상 썬더급 실점은 2~20px 차이로 갈렸다. 이건 사전확률 조정이 아니라
 * 버리고 있던 정보를 되찾는 것이므로 트레이드오프 없이 이득이다. */
function reactAt(c) {
  var f = c + 1;
  if (f < 2) f = 2;
  var r = (f - 2) % 3;
  if (r !== 0) f += 3 - r;
  return f - c;
}
var HORIZON = 110;                /* 궤적 전개 상한 */
var RET_HORIZON = 150;            /* 반사 후 궤적 전개 상한 */

/* [P6] 다이빙 운동학. 인덱스 0 = 다이빙 명령이 처음 먹는 프레임. */
var DIVE_Y  = [244, 239, 235, 232, 230, 229, 229, 230, 232, 235, 239, 244, 244];
var DIVE_DX = [6, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8];
var DIVE_LOCK = 18;               /* 다이빙 시작부터 다시 걸을 수 있을 때까지 */
var DIVE_SPAN = 102;              /* 다이빙 1회 총 수평 이동량 6 + 8*12 */

/* 위협 사전확률. 물리적으로 "내리꽂기(yd=+1)"만이 접촉창을 1~2프레임으로 좁히므로
 * 같은 커버리지 비용이면 내리꽂기를 먼저 막는 것이 기대실점을 최소화한다. */
var W = {
  DOWN: 1.50,      /* 파워 내리꽂기 사전확률 */
  FLAT: 1.00,      /* 파워 수평타 */
  LOB:  0.55,      /* 파워 아치(시간이 많아 거의 항상 받을 수 있다) */
  SOFT: 0.75,      /* 비파워 리시브/토스 */
  KEEP: 0.90,      /* 상대가 안 칠 경우 현재 궤적 */
  FAR:  1.15,      /* xd=±1 (수평속도 20) */
  CANON: 0.70,     /* 표준 최악 위협(네트 앞 내리꽂기) 앵커 */
  CANON_NEAR: 8,   /* 예측 접촉이 이보다 가까우면 앵커 0 (실측 궤적이 더 정확) */
  CANON_FAR: 20,   /* 이보다 멀면 앵커 최대 */
  EXACT_REACT: 0,  /* 실측: ANTICIPATE 지평에 적용하면 사실상 낙관적 REACT 가 되어 역효과(40.0%→13.3%) */
  EXACT_REACT_OFF: 0,  /* 1 = 상수 REACT 대신 위상에서 정확히 계산한 반응 지연 사용 */
  OPP_EXTRAP: 1,   /* 배치 평가에서 상대 위치를 낙하지점 추종으로 외삽 */
  /* ── 2수 게임 트리 ────────────────────────────────────────────────────
   * 1수(리턴 배치)만 보는 모델은 전부 실패했다. 상대는 우리 리턴을 보고 나서
   * 움직이므로, "상대가 어디서 만나는가"를 우리가 고정할 수 없기 때문이다.
   * 2수는 그 되먹임을 직접 푼다:
   *   우리 리턴 → (상대가 낙하지점으로 이동해 가장 위험한 지점에서 최선 응수)
   *            → 그때 우리가 방어 가능한 코스 비율
   * 이 값을 최대화하는 리턴을 고른다 = maximin. */
  DANGER_DEEP: 40, /* 네트에서 이 안쪽(상대 코트)에서의 타격만 위협으로 본다 */
  RET_DANGER: 0,   /* [구] 도달성 무시 순수 기하 위험도. 과보수적이라 OFF (§11.3) */
  /* ── 도달성 결합 위험도 ────────────────────────────────────────────────
   * 앞선 두 시도는 정확히 반대 방향으로 틀렸다.
   *   returnDanger  : 상대가 어디든 갈 수 있다고 가정 → 과보수적 (좋은 깊은 공까지 버림)
   *   배치 3항/2수  : 상대 위치를 행동 예측(낙하지점 추종 ±8px)으로 고정 → 과낙관적
   * 옳은 결합은 "예측"이 아니라 **도달 가능 집합**이다:
   *   프레임 k 에 상대가 x 에 있을 수 있다  <=>  |x - opp.x| <= 32 + 6*(k - 반응지연)
   *   그리고 그 높이까지 올라갈 수 있다      <=>  y >= oppLowY[k] - 32
   * 이건 상대가 무엇을 "할지"가 아니라 무엇을 "할 수 있는지"의 경계라
   * 최적반응 상대에게도 견고하면서, 물리적으로 불가능한 위협은 배제한다. */
  RET_DANGER2: 0,  /* 도달성 결합 위험도 1단계당 감점 (0=OFF) */
  DANGER_REACT: 2, /* 위협 판정에서 상대에게 주는 반응 지연(작을수록 상대에게 관대=보수적) */
  SPIKE_REACH: 0,  /* 2수의 상대 접촉 모델: 0=행동 예측(낙하지점 추종), 1=도달 가능 집합 */
  TWOPLY: 1000,    /* 2수 평가 가중. 400 이상에서 포화(사실상 동점 파훼자로 작동) */
  TWOPLY_K: 6,     /* 1수 점수 상위 K개 후보에만 2수를 돌린다(비용 제한) */
  TIER1: 0,        /* 1 = 접촉창 1프레임 위협 커버를 사전식 최우선. 실측상 역효과(40.0%→30.0%)라 OFF */
  LETHAL1: 2.60,   /* 접촉 가능 프레임 1개 = 치명 */
  LETHAL2: 2.00,
  LETHAL4: 1.35,
  DIVE_MG: 16,     /* 다이빙으로만 닿는 위협의 margin 감점 */
  BEHIND: 5,       /* [P3] 공보다 코트 안쪽에 설 때의 margin 가산 */
  STICKY: 120,     /* 대기 목표 히스테리시스(진동 억제) */
  ANTICIPATE: 12,  /* 대기 위치 평가의 최소 선행 지평(프레임) */
  CMAX: 8,         /* 상대 접촉 시점 가설 개수(minimax 표본) */
  HIT_SIGMA: 60,   /* 관측된 상대 타격 높이 주변의 가설 집중도(px).
                    * 좁히면(≤34) 오히려 나빠졌다 — 상대는 같은 지점에서 코스만 바꾸므로
                    * 타이밍 사전확률로는 내리꽂기/수평타를 구분할 수 없다. 완만하게 둔다. */
  HIT_FULL: 5,     /* 이 횟수만큼 관측하면 관측 분포를 최대로 신뢰 */
  /* 상대 코스 분포 학습(clsMul). 기본 OFF.
   * 실측: 켜면 오히려 나빠진다 (종합 69.9% → 65.9%(네트 40px 이내 타격만 학습)
   *       → 62.7%(70px) → 57.5%(전체 타격)). 이유는 게임이론적이다.
   *   내리꽂기와 수평 강타는 필요한 대기 위치가 배타적이라(truth.mjs) 관측 빈도를
   *   따라가는 것은 fictitious play 이고, 상대가 코스를 섞으면 "지금 안 막는 쪽"으로
   *   그대로 얻어맞는다. 치명도 가중 고정 사전확률(= minimax 헤지)이 더 강했다.
   * 코스가 확실히 한쪽으로 고정된 상대가 확인되면 CLS_MIN 을 3 정도로 낮춰 켠다. */
  CLS_MIN: 9999,   /* 이 횟수 이상 관측해야 상대 코스 분포를 반영 (9999 = OFF) */
  /* ── 조건부(스타켈베르크) 코스 예측 ──────────────────────────────────────
   * §3 의 전역 빈도 학습은 실패했다. 그런데 실측해 보니 원인이 따로 있었다:
   * 일부 상대는 코스를 "섞는" 게 아니라 **우리 위치에 최적반응**한다.
   *   v5 상대, 우리가 네트 24~47px 앞  → 수평 강타 56/56 (100%)
   *            우리가 네트 96~119px 뒤 → 내리꽂기  4/4  (100%)
   * (v5_1 은 위치와 무관하게 내리꽂기 91~97%, v4 는 100% — 최적반응 아님)
   * 상대가 최적반응자라면 어떤 고정 위치도 원리적으로 착취당한다. 대신 우리가
   * 선수(先手)이므로, "각 후보 위치가 유도하는 상대 응수"를 조건부로 예측해
   * 그 응수를 막을 수 있는 위치를 고르면 된다 = 스타켈베르크 균형.
   * 관측은 공개 정보(상대 타격 복원 + 그때 우리 x)뿐이다. */
  COND: 0,         /* 1 = 조건부 코스 예측으로 모든 위협 가중 재조정. 전체 역효과(75.8→65.6%)라 OFF */
  /* ── 조건부 신호의 좁은 사용: 가중치 재조정이 아니라 "위치 금지" ──────────
   * 최적반응형 상대(v5)는 우리가 네트 앞에 서면 깊은 수평 강타를 고른다.
   * 그런데 x≥164 에서는 그 코스에 **어떤 접촉도 물리적으로 불가**하다(dbg_flat.mjs).
   * 즉 그 자리는 "막기 어려운" 게 아니라 "그 상대에겐 자동 실점"인 자리다.
   * 관측이 그걸 뒷받침하면 해당 구간을 후보에서 빼기만 한다. 비최적반응형
   * 상대(v5_1·v4: 어디서든 내리꽂기 91~100%)에겐 조건이 성립하지 않아 무동작. */
  COND_BAN: 0,       /* 1 = 착취당하는 위치 금지 사용 */
  COND_BAN_TH: 0.65, /* 그 버킷에서 깊은 코스(수평/아치) 비율이 이 이상이면 금지 */
  COND_BAN_MIN: 10,  /* 금지 판정에 필요한 최소 관측 수 */
  COND_MIN: 6,     /* 버킷당 최소 관측 수 */
  COND_FULL: 20,   /* 이만큼 모이면 관측 분포를 최대로 신뢰 */
  COND_BW: 38,     /* 우리 위치 버킷 폭(px, 네트까지 거리 기준) */
  /* 중립 대기 위치를 네트에서 이만큼 더 뒤로 민다.
   * 근거: 앞(≤47px)에 서면 최적반응형 상대(v5)가 수평 강타 100% 를 고르는데,
   * x≥164 에서는 그 코스에 대해 "어떤 접촉도 물리적으로 불가"하다(dbg_flat.mjs).
   * x≤152 면 관측 후 슬라이딩으로 도달한다. */
  NEUTRAL_SHIFT: 0,
  CLS_FULL: 10,    /* 이 횟수면 관측 분포를 최대로 신뢰 */
  /* ── 리턴 배치(shot placement) ────────────────────────────────────────
   * 랠리 중 썬더는 "상대에게 네트 앞 공격권을 준 결과"다. 상대 접촉 지점을
   * 네트에서 멀리 밀어내면 같은 내리꽂기도 자기 코트에 꽂히므로 쓸 수 없게 된다.
   * 그래서 리턴 평가에서 착지점이 아니라 "상대가 실제로 만나는 지점"을 본다. */
  DEPTH_W: 1.50,   /* 착지 깊이 가중(구버전 값 1.5 = 배치항 OFF 시 원복) */
  /* 배치 3항은 실측 결과 전부 역효과였다(아래 표). 상대의 도달 가능 범위를
   * 우리 접촉 시점의 opp.x 로 판정하는데, 리턴이 날아가는 동안 상대가 이동하므로
   * 그 판정이 낙관적으로 어긋난다. 결과적으로 "상대가 못 온다"고 오판한 낮고 빠른
   * 드라이브를 고르고, 실제로는 상대가 네트 앞에서 그대로 받아친다.
   *   설정            리시브   네트앞 헌납률
   *   전부 OFF         40.0%      24.9%   ← 채택
   *   PUSH_DEEP 만     34.4%      41.8%
   *   GIVE_TH 만       38.3%      41.8%
   *   THREAT 만        19.4%      46.5%
   *   전부 ON          28.3%      41.2%
   * 코드는 남기되 기본 0. 상대 위치를 리턴 도착 시점으로 외삽하는 모델이 생기면 재검토. */
  PUSH_DEEP: 0,    /* 상대 접촉 지점을 네트에서 1px 밀어낼 때의 가치 */
  NEARNET: 56,     /* 이 안에서 상대가 잡으면 네트 앞 공격권을 준 것 */
  GIVE_TH: 0,      /* 네트 앞 공격권 헌납 감점 */
  THREAT: 0,       /* 상대가 우리에게 강요할 수 있는 최소 접촉창의 위험도 1단계당 감점 */
  NOREACH: 700,    /* 상대가 아예 못 닿는 리턴 */
  GUARD_PULL: 0.00,/* 동점 파훼: 네트 앞 가드 라인 선호 강도(아래 주석 참조) */
  GUARD_OFF: 36    /* 가드 라인 = 네트에서 이만큼 떨어진 곳 (LEFT 기준 x=180) */
};
/* 빌드 시 주입되는 오버라이드 (v6dev/build_v6.mjs --w '{"DOWN":1.5,...}') */
if (typeof GD_W_OVERRIDE !== 'undefined' && GD_W_OVERRIDE) {
  for (var _k in GD_W_OVERRIDE) if (W[_k] !== undefined) W[_k] = GD_W_OVERRIDE[_k];
  if (GD_W_OVERRIDE.REACT !== undefined) REACT = GD_W_OVERRIDE.REACT;
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function idiv(a, b) { return Math.floor(a / b); }

/* ── 공 1프레임. physics.js processCollisionBetweenBallAndWorldAndSetBallPosition
 *    와 순서까지 동일. true = 그 프레임에 바닥 접촉(실점), 이때 x/y 는 갱신하지 않는다. */
function stepBall(b) {
  if (b.yV > MAXVY) b.yV = MAXVY; else if (b.yV < -MAXVY) b.yV = -MAXVY;
  var fx = b.x + b.xV;
  if (fx < 0 || fx > GW) b.xV = -b.xV;
  if (b.y + b.yV < 0) b.yV = 1;
  if (Math.abs(b.x - NET) < NHW && b.y > NTY) {
    if (b.y <= NTBY) { if (b.yV > 0) b.yV = -b.yV; }
    else if (b.x < NET) b.xV = -Math.abs(b.xV);
    else b.xV = Math.abs(b.xV);
  }
  if (b.y + b.yV > BGY) { b.y = BGY; return true; }
  b.y += b.yV; b.x += b.xV; b.yV += 1;
  return false;
}

/* 궤적 전개. out[k-1] = 상대프레임 k 의 공 상태. dead=true 면 그 프레임에 실점. */
function rollout(x, y, xV, yV, n) {
  var b = { x: x, y: y, xV: xV, yV: yV }, out = [];
  for (var k = 1; k <= n; k++) {
    var dead = stepBall(b);
    out.push({ x: b.x, y: b.y, xV: b.xV, yV: b.yV, dead: dead });
    if (dead) break;
  }
  return out;
}
function rollBall(ball, n) { return rollout(ball.x, ball.y, ball.xVelocity, ball.yVelocity, n); }

/* 대기 계획은 각 위협의 "우리 코트 지상 접촉점"만 필요하다. 궤적 배열을 만들면
 * 위협 하나당 ~100개 객체 × 최대 ~80위협 = 결정마다 수천 객체를 버리게 된다.
 * 스트리밍으로 접촉점만 모으면 할당이 사라진다. */
function rolloutPts(x, y, xV, yV, n, isRight, minX, maxX) {
  var b = { x: x, y: y, xV: xV, yV: yV }, pts = [], lastX = x;
  for (var k = 1; k <= n; k++) {
    if (stepBall(b)) break;
    lastX = b.x;
    if (!oursSide(b.x, isRight)) continue;
    if (b.y < CONTACT_LO || b.y > BGY) continue;
    if (b.x < minX - PH - 60 || b.x > maxX + PH + 60) continue;
    pts.push({ k: k, x: b.x });
  }
  return { pts: pts, landX: lastX };
}

/* 좌우 정규화 없이 쓰기 위한 헬퍼 */
function oursSide(x, isRight) { return isRight ? x >= NET : x <= NET; }

/* ── 컨트롤러: 3프레임 묶음에서 |목표-현재| 오차를 최소화하는 방향.
 *    한 묶음 이동량이 18px 이므로 |d| > 9 일 때만 움직이는 것이 최적. */
function moveToward(cur, target) {
  var d = target - cur;
  return d > 9 ? 1 : (d < -9 ? -1 : 0);
}

/* ── 상대가 이 궤적에 처음 닿을 수 있는 지점. 못 닿으면 null.
 *    low[] = oppLowY 가 준 "프레임별 상대의 최고 도달 높이(y 최솟값)".
 *    off  = tr 의 프레임 0 이 스냅샷 기준 몇 번째 프레임인지. */
function oppContact(tr, oppX, low, isRight, off) {
  off = off || 0;
  for (var i = 0; i < tr.length; i++) {
    var t = tr[i], k = i + 1 + off;
    if (t.dead) break;
    if (oursSide(t.x, isRight)) continue;             /* 아직 우리 코트 */
    if (t.y > PGY + PH) continue;
    var lo = (low && low[k] !== undefined) ? low[k] : PGY;
    if (t.y < lo - PH) continue;                      /* 그 프레임엔 그 높이까지 못 올라감 */
    if (Math.abs(t.x - oppX) <= PH + WALK * (k - REACT > 0 ? k - REACT : 0)) {
      return { k: k, x: t.x, y: t.y, yV: t.yV };
    }
  }
  return null;
}
function oppCanCover(tr, oppX, low, isRight, off) {
  return oppContact(tr, oppX, low, isRight, off) !== null;
}

/* ── 상대 위치 외삽 ──────────────────────────────────────────────────────
 * 배치(placement) 평가의 핵심 결함은 "리턴이 날아가는 20~40프레임 동안 상대가
 * 가만히 있다"고 본 것이었다. 내장 AI 를 포함해 대부분의 봇은 예상 낙하지점으로
 * 걸어간다(physics.js letComputerDecideUserInput). 그 행동을 그대로 모사해
 * 프레임별 상대 x 를 외삽하면 배치 목적함수가 비로소 의미를 갖는다. */
function oppXAt(tr, oppX0, isRight, k) {
  var last = tr[tr.length - 1];
  var goal = last ? last.x : oppX0;
  var lo = isRight ? PH : NET + PH, hi = isRight ? NET - PH : GW - PH;
  if (goal < lo) goal = lo; else if (goal > hi) goal = hi;
  var d = goal - oppX0, mv = WALK * k;
  if (d > mv) d = mv; else if (d < -mv) d = -mv;
  return oppX0 + d;
}

/* ── 상대가 "고를 수 있는 가장 위험한" 접촉 지점 (= 네트에 가장 가까운 도달 가능 지점).
 *    상대는 아무 데서나 치는 게 아니라 자기에게 가장 유리한 지점을 고른다.
 *    첫 도달 가능 프레임으로 평가하면 배치 목적함수가 뒤집힌다(실측). */
function oppBestContact(tr, oppX, low, isRight, off) {
  off = off || 0;
  var best = null, bestD = 1e9;
  for (var i = 0; i < tr.length; i++) {
    var t = tr[i], k = i + 1 + off;
    if (t.dead) break;
    if (oursSide(t.x, isRight)) continue;
    if (t.y > PGY + PH) continue;
    var lo = (low && low[k] !== undefined) ? low[k] : PGY;
    if (t.y < lo - PH) continue;
    var oxk = W.OPP_EXTRAP ? oppXAt(tr, oppX, isRight, k) : oppX;
    if (Math.abs(t.x - oxk) > PH + (W.OPP_EXTRAP ? 8 : WALK * (k - REACT > 0 ? k - REACT : 0))) continue;
    var d = Math.abs(t.x - NET);
    if (d < bestD) { bestD = d; best = { k: k, x: t.x, y: t.y, yV: t.yV }; }
  }
  return best;
}

/* ── 상대를 그 지점에 세웠을 때, 상대가 우리에게 강요할 수 있는 최악의 좁은 접촉창.
 *    반환 0(안전) ~ 3(우리 코트 지상 접촉 불가 = 사실상 실점).
 *    이것이 "랠리 중 썬더를 헌납했는가"의 직접적인 물리 지표다. */
function worstSpikeThreat(q, isRight) {
  var base = Math.max(15, Math.abs(q.yV)), sgn = isRight ? 1 : -1, worst = 0;
  for (var xa = 0; xa <= 1; xa++) {
    for (var yd = 1; yd >= 0; yd--) {
      var tr2 = rollout(q.x, q.y, sgn * (xa + 1) * 10, base * yd * 2, 90);
      var lastT = tr2[tr2.length - 1];
      if (!oursSide(lastT.x, isRight)) continue;      /* 우리 코트에 안 옴 = 상대 자책 */
      var n = 0;
      for (var i = 0; i < tr2.length; i++) {
        var t = tr2[i];
        if (t.dead) break;
        if (!oursSide(t.x, isRight)) continue;
        if (t.y >= CONTACT_LO && t.y <= BGY) n++;
      }
      var th = n === 0 ? 3 : (n === 1 ? 2 : (n === 2 ? 1 : 0));
      if (th > worst) worst = th;
    }
  }
  return worst;
}

/* ── 우리 코트로 되돌아온 공을 다시 지상에서 받을 수 있는가(보수적 margin 판정) */
function secondChance(tr, p0, isRight, minX, maxX) {
  for (var i = 0; i < tr.length; i++) {
    var t = tr[i], k = i + 1;
    if (t.dead) break;
    if (!oursSide(t.x, isRight)) continue;
    if (t.y < CONTACT_LO || t.y > BGY) continue;
    if (t.x < minX - PH || t.x > maxX + PH) continue;
    if (Math.abs(t.x - p0) <= PH + WALK * (k - REACT > 0 ? k - REACT : 0)) return k;
  }
  return 0;
}

/* ── [P3][P4] 접촉 결과 평가: 반사속도 → 전체 궤적 → 점수 */
function scoreContact(bx, by, byV, px, s, isRight, minX, maxX, touches, low, off) {
  var nx;
  if (bx < px) nx = -idiv(Math.abs(bx - px), 3);
  else if (bx > px) nx = idiv(Math.abs(bx - px), 3);
  else nx = 0;                                        /* 엔진은 rand(-1..1). 0 으로 보수 평가 */
  var ay = Math.abs(byV);
  var tr = rollout(bx, by, nx, ay < 15 ? -15 : -ay, RET_HORIZON);
  var lastT = tr[tr.length - 1];
  var flight = tr.length;
  var toOpp = !oursSide(lastT.x, isRight);
  var sc = 0;
  if (toOpp) {
    sc += 1000;
    /* 착지 깊이는 보조 지표일 뿐이다. 상대는 공중에서 가로채므로
     * 실제로 중요한 것은 "상대가 어디서 이 공을 만나는가"다. */
    var landDepth = isRight ? (NET - lastT.x) : (lastT.x - NET);
    sc += clamp(landDepth - 24, 0, 180) * W.DEPTH_W;
    /* 배치항(PUSH_DEEP/GIVE_TH/THREAT)은 기본 0 이다. 0 일 때 상대 접촉 탐색과
     * worstSpikeThreat(4 롤아웃)을 그대로 돌면 후보당 수백 프레임을 헛돈다. */
    var placeOn = (W.PUSH_DEEP !== 0 || W.GIVE_TH !== 0 || W.THREAT !== 0);
    if (placeOn) {
      var q = oppBestContact(tr, s.opp.x, low, isRight, off);
      if (q === null) sc += W.NOREACH;
      else {
        var netDist = Math.abs(q.x - NET);
        sc += clamp(netDist, 0, 170) * W.PUSH_DEEP;
        if (netDist <= W.NEARNET) sc -= W.GIVE_TH;
        if (W.THREAT !== 0) sc -= worstSpikeThreat(q, isRight) * W.THREAT;
      }
    } else if (!oppCanCover(tr, s.opp.x, low, isRight, off)) {
      sc += W.NOREACH;                                /* 상대가 아예 못 닿는 리턴 */
    }
    if (flight < 26) sc += 120;                       /* 빨리 떨어지면 대응 시간이 없다 */
    /* [리턴 각도] 이 리턴이 상대에게 "막을 수 없는 스파이크 각도"를 내주는가.
     * 상대 위치를 쓰지 않는 순수 기하 지표라 최적반응 상대에게도 견고하다. */
    if (W.RET_DANGER !== 0) sc -= returnDanger(tr, isRight, off) * W.RET_DANGER;
    if (W.RET_DANGER2 !== 0) sc -= returnDangerReach(tr, s.opp.x, low, isRight, off) * W.RET_DANGER2;
  } else {
    /* 네트를 못 넘김. 접촉 횟수 예산과 두 번째 기회로 평가한다. */
    sc -= (touches >= 2) ? 800 : 220;
    var again = secondChance(tr, px, isRight, minX, maxX);
    if (again) sc += 260 + (flight < 70 ? flight : 70) * 2;
    else sc -= 900;
  }
  return { score: sc, tr: tr, toOpp: toOpp, landX: lastT.x, flight: flight, xV: nx };
}

/* ── 지상(걷기) 수신 co-simulation.
 *    px1 = 상대프레임 1 에서의 우리 x (직전 액션이 이미 반영된 값).
 *    새 액션은 상대프레임 2 부터 3프레임 단위로 갱신된다 [P5]. */
function simWalkContact(px1, targetP, traj, minX, maxX) {
  var p = px1, a = 0, latched = false;
  for (var k = 1; k <= traj.length; k++) {
    if (k >= 2) {
      if ((k - 2) % 3 === 0) a = moveToward(p, targetP);
      p = clamp(p + WALK * a, minX, maxX);
    }
    var t = traj[k - 1];
    if (t.dead) return null;
    var over = Math.abs(t.x - p) <= PH && Math.abs(t.y - PGY) <= PH;
    if (over) {
      if (!latched) return { k: k, p: p, t: t, first: moveToward(px1, targetP) };
      /* latched: 이미 붙어 있어 재판정 안 됨 */
    } else latched = false;
    if (k === 1 && over) latched = true;              /* 스냅샷 시점에 이미 겹쳐 있었다 */
  }
  return null;
}

/* ── 다이빙 수신 co-simulation.
 *    delay = 다이빙 명령을 내리기까지 걷는 프레임 수(3의 배수, 상대프레임 2 기준). */
function simDiveContact(px1, dir, delay, traj, minX, maxX) {
  var p = px1;
  for (var k = 1; k <= traj.length; k++) {
    var t = traj[k - 1];
    if (t.dead) return null;
    var py = PGY, moving = 0;
    if (k >= 2) {
      var off = (k - 2) - delay;                      /* 다이빙 명령이 먹은 뒤 경과 프레임 */
      if (off < 0) moving = dir * WALK;               /* 아직 걷는 중 */
      else if (off < DIVE_DX.length) { moving = dir * DIVE_DX[off]; py = DIVE_Y[off]; }
      else { moving = 0; py = PGY; }
      p = clamp(p + moving, minX, maxX);
      if (off >= 0 && off < DIVE_Y.length) py = DIVE_Y[off];
    }
    if (Math.abs(t.x - p) <= PH && Math.abs(t.y - py) <= PH) {
      return { k: k, p: p, t: t, dir: dir, delay: delay, py: py };
    }
    if (k >= 2 && (k - 2) - delay > DIVE_LOCK) return null;
  }
  return null;
}

/* ── 상대가 우리 리턴을 만나는 "가장 위험한" 지점 (위치 외삽 + 점프 준비시간 반영) */
function oppSpikeContact(tr, oppX0, isRight, off) {
  off = off || 0;
  var best = null, bestD = 1e9;
  for (var i = 0; i < tr.length; i++) {
    var t = tr[i], k = i + 1 + off;
    if (t.dead) break;
    if (oursSide(t.x, isRight)) continue;
    if (t.y > PGY + PH || t.y < 70) continue;
    /* 상대 접촉 가능 판정.
     *   0 = "낙하지점으로 걸어간다"는 행동 예측(±8px). 좁아서 과낙관적일 수 있다.
     *   1 = 도달 가능 집합 경계. 상대가 무엇을 할지가 아니라 할 수 있는지를 본다. */
    if (W.SPIKE_REACH) {
      if (Math.abs(t.x - oppX0) > PH + WALK * (k - W.DANGER_REACT > 0 ? k - W.DANGER_REACT : 0)) continue;
    } else {
      var oxk = oppXAt(tr, oppX0, isRight, k);
      if (Math.abs(t.x - oxk) > PH + 8) continue;     /* 그 프레임에 거기 못 있음 */
    }
    /* 지상보다 높은 곳에서 만나려면 점프 준비 프레임이 필요하다 */
    if (t.y < CONTACT_LO) {
      var m = 0;
      while (m < 16 && jumpY(m) > t.y) m++;
      if (k < m) continue;
    }
    var d = Math.abs(t.x - NET);
    if (d < bestD) { bestD = d; best = { k: k, x: t.x, y: t.y, yV: t.yV }; }
  }
  return best;
}

/* ── 리턴 위험도 (상대 위치와 무관한 순수 기하 지표) ──────────────────────
 * [검증: truth_vertical.mjs]
 *   상대의 최대 급경사 스파이크(yV=40, 엔진 상한)는 우리 코트 접촉창이 **1프레임**이고
 *   반응이 물리적으로 불가능하다. 오직 미리 그 자리에 있어야만 막힌다.
 *   그런데 상대 타격 x 가 깊어지면(우리가 LEFT 일 때 x >= ~232) 그 스파이크는
 *   네트 기둥 밴드(|x-216|<25, y>192)에서 **자기 코트 쪽으로 되튕겨** 자책이 된다.
 *   즉 위험 구간은 네트 바로 건너편 x ≈ 190~232 로 좁다.
 * 따라서 리턴의 좋고 나쁨은 "상대가 어디 있는가"가 아니라
 * "이 궤적이 위험 구간을 지나며 상대가 때릴 수 있는 높이에 있는가"로 판정할 수 있다.
 * 상대 위치를 예측할 필요가 없어(= 최적반응 상대에게도 견고) 앞선 배치 시도들과 다르다.
 * 반환 0(안전) ~ 3(우리 코트 지상 접촉창 0 = 사실상 실점). */
function returnDanger(tr, isRight, off) {
  var sgn = isRight ? 1 : -1, worst = 0;
  for (var i = 0; i < tr.length; i++) {
    var t = tr[i];
    if (t.dead) break;
    if (oursSide(t.x, isRight)) continue;             /* 아직 우리 코트 */
    if (t.y < 76 || t.y > PGY + PH) continue;         /* 점프로도 못 닿거나 이미 바닥 */
    var dNet = isRight ? (NET - t.x) : (t.x - NET);   /* 상대 코트 깊이 */
    if (dNet < 0 || dNet > W.DANGER_DEEP) continue;   /* 깊은 곳에서의 스파이크는 자책 */
    var base = Math.max(15, Math.abs(t.yV));
    for (var xa = 0; xa <= 1; xa++) {
      var s2 = rollout(t.x, t.y, sgn * (xa + 1) * 10, base * 2, 40);
      var lastT = s2[s2.length - 1];
      if (!oursSide(lastT.x, isRight)) continue;      /* 우리 코트에 안 옴 = 자책 */
      var n = 0;
      for (var j = 0; j < s2.length; j++) {
        var u = s2[j];
        if (u.dead) break;
        if (!oursSide(u.x, isRight)) continue;
        if (u.y >= CONTACT_LO && u.y <= BGY) n++;
      }
      var th = n === 0 ? 3 : (n === 1 ? 2 : (n === 2 ? 1 : 0));
      if (th > worst) { worst = th; if (worst >= 3) return 3; }
    }
  }
  return worst;
}

/* ── 도달성 결합 리턴 위험도.
 *    returnDanger 와 같은 스파이크 기하 평가에, 상대의 도달 가능 집합 게이트를 더한다. */
function returnDangerReach(tr, oppX, low, isRight, off) {
  off = off || 0;
  var sgn = isRight ? 1 : -1, worst = 0, rd = W.DANGER_REACT;
  for (var i = 0; i < tr.length; i++) {
    var t = tr[i], k = i + 1 + off;
    if (t.dead) break;
    if (oursSide(t.x, isRight)) continue;
    if (t.y < 76 || t.y > PGY + PH) continue;
    var dNet = isRight ? (NET - t.x) : (t.x - NET);
    if (dNet < 0 || dNet > W.DANGER_DEEP) continue;   /* 깊은 곳 스파이크는 자책 */
    /* [도달성] 가로: 걸어서 닿을 수 있는가 */
    if (Math.abs(t.x - oppX) > PH + WALK * (k - rd > 0 ? k - rd : 0)) continue;
    /* [도달성] 세로: 그 프레임에 그 높이까지 올라갈 수 있는가 */
    var lo = (low && low[k] !== undefined) ? low[k] : PGY;
    if (t.y < lo - PH) continue;
    var base = Math.max(15, Math.abs(t.yV));
    for (var xa = 0; xa <= 1; xa++) {
      var s2 = rollout(t.x, t.y, sgn * (xa + 1) * 10, base * 2, 40);
      var lastT = s2[s2.length - 1];
      if (!oursSide(lastT.x, isRight)) continue;
      var n = 0;
      for (var j = 0; j < s2.length; j++) {
        var u = s2[j];
        if (u.dead) break;
        if (!oursSide(u.x, isRight)) continue;
        if (u.y >= CONTACT_LO && u.y <= BGY) n++;
      }
      var th = n === 0 ? 3 : (n === 1 ? 2 : (n === 2 ? 1 : 0));
      if (th > worst) { worst = th; if (worst >= 3) return 3; }
    }
  }
  return worst;
}

/* ── 2수 평가: 우리가 px 에서 이 공을 받았을 때, 상대 최선 응수에 대한 우리 방어 커버리지(0~1) */
function twoPlyCoverage(px, tr1, s, isRight, minX, maxX, off) {
  var q = oppSpikeContact(tr1, s.opp.x, isRight, off);
  if (q === null) return 1;                            /* 상대가 아예 못 만짐 */
  var base = Math.max(15, Math.abs(q.yV));
  var sgn = isRight ? 1 : -1;
  var resp = [], totW = 0;
  for (var xa = 0; xa <= 1; xa++) {
    for (var yd = 1; yd >= -1; yd--) {
      var tr2 = rollout(q.x, q.y, sgn * (xa + 1) * 10, base * yd * 2, 100);
      var lastT = tr2[tr2.length - 1];
      if (!oursSide(lastT.x, isRight)) continue;       /* 상대 자책 = 위협 아님 */
      var pts = [];
      for (var i = 0; i < tr2.length; i++) {
        var t = tr2[i];
        if (t.dead) break;
        if (!oursSide(t.x, isRight)) continue;
        if (t.y < CONTACT_LO || t.y > BGY) continue;
        pts.push({ abs: q.k + i + 1, x: t.x });
      }
      var w = (yd === 1 ? W.DOWN : (yd === 0 ? W.FLAT : W.LOB)) * (xa === 1 ? W.FAR : 1);
      if (!pts.length) { totW += w; continue; }        /* 우리 코트에 오는데 접촉창이 없음 = 못 막음 */
      w *= (pts.length <= 1 ? W.LETHAL1 : (pts.length === 2 ? W.LETHAL2 : (pts.length <= 4 ? W.LETHAL4 : 1)));
      resp.push({ pts: pts, w: w });
      totW += w;
    }
  }
  if (totW <= 0) return 1;
  /* 우리 리턴 접촉(프레임 off, 위치 px) 이후 상대 타격까지 걸어서 잡을 수 있는 사전 위치들 */
  var freeF = q.k - off; if (freeF < 0) freeF = 0;
  var lo = clamp(px - WALK * freeF, minX, maxX), hi = clamp(px + WALK * freeF, minX, maxX);
  /* 이진 커버리지(막는다/못막는다)는 비행시간이 길면 전부 1 로 포화해 변별력이 없다.
   * 그래서 "가장 좋은 사전 위치에서의 가중 여유(margin)"를 연속값으로 쓴다.
   * 못 막는 응수는 음수 여유로 그대로 반영되고, 아슬아슬하게 막는 것과
   * 넉넉히 막는 것이 구분된다. */
  var bestV = -1e9;
  for (var P = lo; P <= hi; P += 6) {
    var v = 0;
    for (var r = 0; r < resp.length; r++) {
      var L = resp[r], m = -1e9;
      for (var j = 0; j < L.pts.length; j++) {
        var pt = L.pts[j];
        var free = pt.abs - (q.k + REACT); if (free < 0) free = 0;
        var rw = WALK * free, rd = free > 1 ? 6 + 8 * (free - 1) : rw;
        if (rd > DIVE_SPAN) rd = DIVE_SPAN;
        var mg = PH + (rd > rw ? rd : rw) - Math.abs(pt.x - P);
        if (mg > m) m = mg;
      }
      if (m > 40) m = 40; else if (m < -60) m = -60;
      v += L.w * m;
    }
    if (v > bestV) bestV = v;
  }
  /* 응수가 하나도 우리 코트에 안 오면(전부 상대 자책) 만점 */
  if (!resp.length) return 1;
  return (bestV / totW + 60) / 100;                    /* 0(최악) ~ 1(최선) */
}

/* ══ 수신 계획 ═══════════════════════════════════════════════════════════ */
function planReceive(s, minX, maxX, isRight, px1, touches, prevOppY, dTick) {
  var traj = rollBall(s.ball, HORIZON);
  var low = oppLowY(s, prevOppY === undefined ? null : prevOppY, dTick || 3, HORIZON + RET_HORIZON + 2);
  if (!traj.length) return null;

  /* 지상 접촉이 가능한 프레임이 하나라도 있는가 [P1][P2] */
  var hasGround = false;
  for (var i = 0; i < traj.length; i++) {
    var t = traj[i];
    if (t.dead) break;
    if (t.y >= CONTACT_LO && t.y <= BGY && oursSide(t.x, isRight) &&
        t.x >= minX - PH && t.x <= maxX + PH) { hasGround = true; break; }
  }

  var best = null, cands = [];
  /* 1) 걷기 수신: 목표 x 를 전 구간에서 훑되, 도달 위치가 18px 격자라 [P5]
   *    실제로는 소수의 (접촉 프레임, 접촉 위치) 로 수렴한다. 같은 쌍은 점수가
   *    완전히 동일하므로 한 번만 채점한다(후보 77 → 보통 2~6개). */
  var seen = {};
  for (var tp = minX; tp <= maxX; tp += 2) {
    var c = simWalkContact(px1, tp, traj, minX, maxX);
    if (c === null) continue;
    var key = c.k + ':' + c.p;
    if (seen[key] !== undefined) continue;
    seen[key] = 1;
    var ev = scoreContact(c.t.x, c.t.y, c.t.yV, c.p, s, isRight, minX, maxX, touches, low, c.k);
    var sc = ev.score + 500;                          /* 걷기 수신은 다이빙보다 항상 우대 */
    sc += (c.k > 40 ? 40 : c.k);                      /* 늦게 만날수록 재계획 여지가 크다 */
    var cand = { sc: sc, act: { x: c.first, y: 0, hit: 0 }, k: c.k, p: c.p,
                 ev: ev, dive: false, target: tp };
    if (W.TWOPLY > 0 && ev.toOpp) cands.push(cand);
    if (best === null || sc > best.sc) best = cand;
  }

  /* 1b) 2수 재순위.
   * 주의: 목표 x 를 2px 씩 훑으므로 후보 대부분이 "같은 접촉 위치 p"로 수렴한다
   * (도달 위치가 18px 격자이기 때문 [P5]). 점수 상위 K개를 뽑으면 전부 이웃이라
   * 반사속도가 사실상 같아 2수 값이 동일해지고 순위가 절대 안 바뀐다.
   * 그래서 실제로 서로 다른 선택지인 "접촉 위치 p"별로 최선 후보만 남겨 비교한다. */
  if (W.TWOPLY > 0 && cands.length > 1) {
    /* cands 는 이미 (접촉프레임, 접촉위치) 로 유일하다 = 서로 다른 실제 선택지 */
    var uniq = cands.slice();
    uniq.sort(function (a, b) { return b.sc - a.sc; });
    var K = uniq.length < W.TWOPLY_K ? uniq.length : W.TWOPLY_K;
    var best2 = null;
    for (var ci = 0; ci < K; ci++) {
      var cd = uniq[ci];
      cd.cov = twoPlyCoverage(cd.p, cd.ev.tr, s, isRight, minX, maxX, cd.k);
      cd.sc2 = cd.sc + W.TWOPLY * cd.cov;
      if (best2 === null || cd.sc2 > best2.sc2) best2 = cd;
    }
    if (best2 !== null) { best2.sc = best2.sc2; if (best === null || best2.sc2 > best.sc) best = best2; }
  }

  /* 2) 다이빙 수신: 걷기로 도달할 수 없을 때만. 착지 후 18프레임 무제어를 비용으로 반영. */
  var needDive = (best === null) || (!best.ev.toOpp && best.ev.score < 0);
  if (needDive) {
    for (var d = -1; d <= 1; d += 2) {
      for (var dl = 0; dl <= 9; dl += 3) {
        var dc = simDiveContact(px1, d, dl, traj, minX, maxX);
        if (dc === null) continue;
        var dev = scoreContact(dc.t.x, dc.t.y, dc.t.yV, dc.p, s, isRight, minX, maxX, touches, low, dc.k);
        var dsc = dev.score - 260;                    /* [P6] 무제어 18프레임 비용 */
        if (!dev.toOpp) dsc -= 300;                   /* 다이빙해서 못 넘기면 사실상 실점 */
        if (dl > 0) dsc -= 40;                        /* 지금 결정은 걷기, 다이빙은 다음 틱 */
        if (best === null || dsc > best.sc) {
          best = { sc: dsc, k: dc.k, p: dc.p, ev: dev, dive: true, target: dc.p,
                   act: dl === 0 ? { x: d, y: 0, hit: 1 } : { x: d, y: 0, hit: 0 } };
        }
      }
    }
  }
  if (best === null) return null;
  best.hasGround = hasGround;
  return best;
}

/* ══ 대기 계획 ═══════════════════════════════════════════════════════════
 * 상대가 아직 치지 않았다. 상대 접촉 프레임 c 를 추정하고, 그 시점의 공 상태에서
 * 나올 수 있는 모든 타격 결과를 전개한 뒤,
 *   margin(p, j) = max_k [ 32 + 6*max(0, k - c - REACT) - |bx_k - p| ]
 * 가 모든 위협 j 에 대해 음수가 되지 않는 p 를 고른다(가중 minimax).      */
/* 점프 궤적 y(m) = 244 - 16m + m(m-1)/2  (physics.js: yVelocity=-16, 매 프레임 +1) */
function jumpY(m) {
  if (m <= 0) return PGY;
  var y = PGY - 16 * m + idiv(m * (m - 1), 2);
  return y > PGY ? PGY : y;
}

/* 상대가 프레임 k 에 도달할 수 있는 가장 높은 위치(=y 최솟값).
 * 공중이면 탄도가 확정이므로 그대로 두고, 착지 이후부터 점프를 허용한다. */
function oppLowY(s, prevOppY, dTick, kmax) {
  var low = new Array(kmax + 1), oy = s.opp.y, st = s.opp.state;
  var landK = 0;
  if (oy < PGY && st <= 2) {
    var d = dTick > 0 ? dTick : 3;
    var vy = prevOppY === null ? -16 : (oy - prevOppY - idiv(d * (d - 1), 2)) / d;
    var y = oy, v = vy;
    for (var k = 1; k <= kmax; k++) {
      y = y + v; v += 1;
      if (y >= PGY) { y = PGY; landK = k; break; }
      low[k] = y;
    }
    if (!landK) landK = kmax;
  }
  for (var k2 = 1; k2 <= kmax; k2++) {
    if (k2 < landK) { if (low[k2] === undefined) low[k2] = oy; continue; }
    var m = k2 - landK;
    low[k2] = jumpY(m > 16 ? 16 : m);
  }
  low[0] = oy;
  return low;
}

/* ── 상대 타격 시점 복원 (공개 관찰만 사용) ──────────────────────────────
 * 스냅샷은 3프레임 간격이라 "상대가 어느 프레임에, 공이 어느 높이에 있을 때
 * 쳤는지"가 직접 보이지 않는다. 그러나 직전 스냅샷의 공 상태와 현재 상태가
 * 있으면 접촉 프레임 m 은 유일하게 역산된다:
 *   접촉 위치 P = prev 를 m 번 전진시킨 것,
 *   접촉 직후 속도 = (cur.xV, cur.yV - (3-m)),
 *   그 속도로 (3-m) 번 더 전진시킨 결과가 cur 와 일치해야 한다.
 * m 을 1..3 으로 전수 검사하면 정확히 복원된다. 이 값이 "상대가 실제로 어느
 * 높이에서 치는가"라는 잠재변수의 유일한 관측치이고, 이걸 알면 접촉 시점 가설의
 * 확률질량을 실제 타이밍에 몰아줄 수 있다. */
var HIT = { n: 0, yMean: 171, xMean: 0, cls: [0, 0, 0], power: 0, soft: 0,
            cond: [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]] };   /* [우리위치버킷][코스] */
function condBucket(netDist) {
  var b = Math.floor(netDist / W.COND_BW);
  return b < 0 ? 0 : (b > 4 ? 4 : b);
}
/* 버킷 b 에 섰을 때 상대가 코스 i 를 고를 상대확률(균등 대비 배율). 관측 부족이면 1. */
/* 버킷 b 에 서면 상대가 "깊은 코스"로 응징하는가? (금지 판정) */
function condBanned(b) {
  if (!W.COND_BAN) return false;
  var v = HIT.cond[b], n = v[0] + v[1] + v[2];
  if (n < W.COND_BAN_MIN) return false;
  return (v[1] + v[2]) / n >= W.COND_BAN_TH;
}
function condMul(b, i) {
  if (!W.COND) return 1;
  var v = HIT.cond[b], n = v[0] + v[1] + v[2];
  if (n < W.COND_MIN) return 1;
  var conf = (n - W.COND_MIN + 1) / (W.COND_FULL - W.COND_MIN + 1);
  if (conf > 1) conf = 1;
  return (1 - conf) + conf * ((v[i] + 1) / (n + 3)) * 3;
}
function reconstructHit(prev, cur, g) {
  if (!prev) return null;
  for (var m = 1; m <= g; m++) {
    var b = { x: prev.x, y: prev.y, xV: prev.xV, yV: prev.yV }, ok = true;
    for (var i = 0; i < m; i++) if (stepBall(b)) { ok = false; break; }
    if (!ok) continue;
    var t = { x: b.x, y: b.y, xV: cur.xV, yV: cur.yV - (g - m) };
    for (var j = 0; j < g - m; j++) if (stepBall(t)) { ok = false; break; }
    if (!ok) continue;
    if (Math.abs(t.x - cur.x) <= 1 && Math.abs(t.y - cur.y) <= 1 &&
        Math.abs(t.xV - cur.xV) <= 1 && Math.abs(t.yV - cur.yV) <= 1) {
      return { x: b.x, y: b.y, m: m, xV0: cur.xV, yV0: cur.yV - (g - m) };
    }
  }
  return null;
}
function noteOppHit(y, x, xV0, yV0, learnCls, myNetDist) {
  HIT.n += 1;
  var r = HIT.n === 1 ? 1 : 0.4;
  HIT.yMean += (y - HIT.yMean) * r;
  HIT.xMean += (x - HIT.xMean) * r;
  /* 파워히트는 |xV| 가 정확히 10 또는 20 (엔진: (|xd|+1)*10). 그 외는 비파워. */
  var ax = Math.abs(xV0);
  if (ax === 10 || ax === 20) {
    HIT.power += 1;
    var kind = yV0 > 8 ? 0 : (yV0 < -8 ? 2 : 1);        /* 0=내리꽂기 1=수평 2=아치 */
    if (learnCls !== false) HIT.cls[kind] += 1;
    /* 네트 앞 공격만, 그때 우리가 어디 있었는지와 함께 기록 */
    if (learnCls !== false && myNetDist !== undefined && myNetDist !== null) {
      HIT.cond[condBucket(myNetDist)][kind] += 1;
    }
  } else HIT.soft += 1;
}

/* ── 상대 코스 분포 학습 ─────────────────────────────────────────────────
 * 내리꽂기(네트 앞 1프레임)와 수평 강타(깊은 뒤쪽)는 필요한 대기 위치가 서로
 * 배타적이다(v6dev/truth.mjs: 어떤 p 도 둘 다 막지 못한다). 따라서 고정 사전확률로는
 * 한쪽에게 반드시 진다. 상대의 실제 타격은 매번 정확히 복원되므로(reconstructHit),
 * 관측된 코스 빈도를 라플라스 평활 후 고정 사전확률과 신뢰도 혼합해 쓴다.
 * 관측 0회면 정확히 기존 고정값과 같다. */
function clsMul(i) {
  var n = HIT.cls[0] + HIT.cls[1] + HIT.cls[2];
  if (n < W.CLS_MIN) return 1;
  var conf = (n - W.CLS_MIN + 1) / (W.CLS_FULL - W.CLS_MIN + 1);
  if (conf > 1) conf = 1;
  var freq = (HIT.cls[i] + 1) / (n + 3);
  return (1 - conf) + conf * freq * 3;                /* 균등(1/3) 대비 상대빈도 */
}
/* 관측이 쌓일수록 실제 타격 높이 근처 가설에 가중을 몰아준다(0관측이면 균등). */
function hitPrior(y) {
  if (HIT.n < 2) return 1;
  var conf = HIT.n >= W.HIT_FULL ? 1 : (HIT.n - 1) / (W.HIT_FULL - 1);
  var d = (y - HIT.yMean) / W.HIT_SIGMA;
  var g = Math.exp(-d * d);
  return 1 - conf + conf * (0.15 + 0.85 * g);
}

/* ── 표준(최악) 위협 집합 ────────────────────────────────────────────────
 * 상대가 우리에게 가장 아픈 곳 = 네트 바로 앞, 점프 정점 높이(y≈171)에서
 * 최고 속도로 치는 경우. 여기서 나오는 내리꽂기·수평타·아치를 한 벌로 묶는다.
 * 두 곳에서 쓴다.
 *   (1) 예측 접촉이 멀 때의 앵커(실측이 부정확한 구간의 보험)
 *   (2) 당장은 아무 위협도 없을 때(우리가 막 넘긴 직후 등)의 중립 위치 산출.
 *       이 구간은 "아무것도 안 하는 시간"이 아니라 다음 공격을 대비해 미리
 *       자리를 잡을 수 있는 유일한 여유 시간이다. */
function canonShots(isRight, cc, w, minX, maxX) {
  var out = [], sgn = isRight ? 1 : -1;
  var cx = isRight ? NET - 8 : NET + 8;
  for (var b = 0; b < 2; b++) {
    out.push({ c: cc, r: rolloutPts(cx, 171, sgn * 20, (b ? 30 : 19) * 2, HORIZON, isRight, minX, maxX),
               w: w * W.DOWN * clsMul(0), cls: 'C1' });
  }
  out.push({ c: cc, r: rolloutPts(cx, 171, sgn * 20, 0, HORIZON, isRight, minX, maxX), w: w * W.FLAT * clsMul(1), cls: 'C0' });
  out.push({ c: cc, r: rolloutPts(cx, 171, sgn * 20, -38, HORIZON, isRight, minX, maxX), w: w * W.LOB * clsMul(2), cls: 'CL' });
  return out;
}

/* ── 상대 타격 모델 (minimax) ────────────────────────────────────────────
 * 상대는 "언제 칠지"도 고른다. 접촉 시점을 하나로 예측하면 그 추정이 한 틱마다
 * 크게 흔들려(높고 먼 곳에서 치는 가정 ↔ 네트 앞에서 치는 가정) 대기 목표가
 * 진동하고, 결국 어디에도 도달하지 못한다.
 * 그래서 물리적으로 가능한 접촉 프레임 전체에서 최대 CMAX 개를 균등 추출하고,
 * 각각에서 나올 수 있는 타격 결과를 모두 전개한다. 같은 종류(내리꽂기/수평/아치/
 * 리시브)의 변형끼리는 클래스 사전확률을 나눠 가지므로, 열거를 늘려도 확률
 * 질량이 부풀지 않는다. 결과적으로 "상대가 어느 타이밍에 쳐도 막을 수 있는 자리"
 * 가 선택된다. */
function opponentShots(s, isRight, prevOppY, dTick, minX, maxX) {
  var traj = rollBall(s.ball, 70);
  var ox = s.opp.x;
  var low = oppLowY(s, prevOppY, dTick, traj.length + 2);
  var feas = [];
  for (var i = 0; i < traj.length; i++) {
    var t = traj[i], k = i + 1;
    if (t.dead) break;
    if (oursSide(t.x, isRight)) break;                 /* 우리 코트로 넘어옴 */
    if (Math.abs(t.x - ox) > PH + WALK * k) continue;
    var lo = low[k] === undefined ? PGY : low[k];
    if (t.y < lo - PH || t.y > PGY + PH) continue;
    feas.push({ k: k, t: t });
  }
  var shots = [];
  if (!feas.length) {
    /* 지금 당장 상대가 건드릴 수 있는 공이 없다 → 표준 위협 기준 중립 위치로 미리 이동 */
    shots.push({ c: 0, r: rolloutPts(s.ball.x, s.ball.y, s.ball.xVelocity, s.ball.yVelocity, 70, isRight, minX, maxX), w: W.KEEP, cls: 'K' });
    var cn0 = canonShots(isRight, 12, 1, minX, maxX);
    for (var q0 = 0; q0 < cn0.length; q0++) shots.push(cn0[q0]);
    return shots;
  }
  /* 균등 추출: 가장 이른 접촉 / 가장 늦은 접촉 / 그 사이 */
  var CMAX = W.CMAX | 0; if (CMAX < 1) CMAX = 1;
  var picks = [];
  if (feas.length <= CMAX) picks = feas;
  else for (var q = 0; q < CMAX; q++) picks.push(feas[Math.round(q * (feas.length - 1) / (CMAX - 1))]);

  var sgn = isRight ? 1 : -1;                          /* 우리 쪽으로 오는 x 방향 */
  for (var pi = 0; pi < picks.length; pi++) {
    var c = picks[pi].k, cb = picks[pi].t;
    var base = Math.max(15, Math.abs(cb.yV));
    var hp = hitPrior(cb.y);                          /* 관측된 타격 높이 사전확률 */
    for (var xa = 0; xa <= 1; xa++) {
      for (var yd = 1; yd >= -1; yd--) {
        shots.push({ c: c, r: rolloutPts(cb.x, cb.y, sgn * (xa + 1) * 10, base * yd * 2, HORIZON, isRight, minX, maxX),
                     w: (yd === 1 ? W.DOWN : (yd === 0 ? W.FLAT : W.LOB)) *
                        clsMul(yd === 1 ? 0 : (yd === 0 ? 1 : 2)) *
                        (xa === 1 ? W.FAR : 1) * hp,
                     cls: 'P' + yd });
      }
    }
    /* 비파워(리시브/토스): 상대의 정확한 x 를 모르므로 대표 속도 3개 */
    if (cb.y >= CONTACT_LO - 40) {
      for (var m = 0; m < 3; m++) {
        shots.push({ c: c, r: rolloutPts(cb.x, cb.y, sgn * (3 + m * 5), -base, HORIZON, isRight, minX, maxX),
                     w: W.SOFT * hp, cls: 'S' });
      }
    }
  }
  /* 상대가 안 칠 경우: 현재 궤적 그대로 */
  shots.push({ c: 0, r: rolloutPts(s.ball.x, s.ball.y, s.ball.xVelocity, s.ball.yVelocity, 70, isRight, minX, maxX), w: W.KEEP, cls: 'K' });

  /* ── 표준 최악 위협(네트 앞 내리꽂기) 앵커 ────────────────────────────
   * 앵커를 켜는 기준은 "상대가 언제 치는가"가 아니라 "위협이 우리 코트 지상에
   * 도달하기까지 몇 프레임 남았는가"여야 한다. 상대 서브 토스처럼 눈앞의 위협이
   * 다 느린 공일 때가 바로 앞으로 나가 둘 여유가 있는 순간이고, 그때 뒤에 서
   * 있으면 마지막 네트 앞 스파이크에 절대 못 닿는다(실측: 서브 리시브 실패의
   * 지배적 원인). 반대로 위협이 임박했으면 실측 궤적이 훨씬 정확하므로 앵커는 끈다. */
  var cRef = picks[0].k;
  var fade = (cRef - W.CANON_NEAR) / (W.CANON_FAR - W.CANON_NEAR);
  fade = fade < 0 ? 0 : (fade > 1 ? 1 : fade);
  if (fade > 0) {
    var cc = cRef > 22 ? 22 : (cRef < 6 ? 6 : cRef);
    var cn = canonShots(isRight, cc, W.CANON * fade, minX, maxX);
    for (var q1 = 0; q1 < cn.length; q1++) shots.push(cn[q1]);
  }
  return shots;
}

/* 표준 위협만으로 결정되는 중립 대기 x. 좌우/코트 폭에만 의존하므로 1회 계산 후 캐시. */
var _neutral = {};
function neutralX(minX, maxX, isRight, px1) {
  var key = (isRight ? 'R' : 'L') + minX + '_' + maxX + '_' + W.NEUTRAL_SHIFT + '_' +
            clsMul(0).toFixed(2) + '_' + clsMul(1).toFixed(2) + '_' + clsMul(2).toFixed(2);
  if (_neutral[key] !== undefined) return _neutral[key];
  var cn = canonShots(isRight, 12, 1, minX, maxX), best = px1, bestK = -Infinity;
  for (var p = minX; p <= maxX; p += 2) {
    var cov = 0, sl = 0;
    for (var j = 0; j < cn.length; j++) {
      var sh = cn[j], m = -1e9, pts0 = sh.r.pts;
      for (var i = 0; i < pts0.length; i++) {
        var free = pts0[i].k - REACT; if (free < 0) free = 0;
        var rw = WALK * free, rd = free > 1 ? 6 + 8 * (free - 1) : rw;
        if (rd > DIVE_SPAN) rd = DIVE_SPAN;
        var mg = PH + (rd > rw ? rd : rw) - Math.abs(pts0[i].x - p);
        if (mg > m) m = mg;
      }
      if (m <= -1e8) continue;
      if (m >= 0) { cov += sh.w; sl += sh.w * (m > 30 ? 30 : m); }
      else sl += sh.w * m * 0.7;
    }
    var kk = cov * 1000 + sl;
    if (kk > bestK) { bestK = kk; best = p; }
  }
  best = clamp(isRight ? best + W.NEUTRAL_SHIFT : best - W.NEUTRAL_SHIFT, minX, maxX);
  _neutral[key] = best;
  return best;
}

function planStandby(s, minX, maxX, isRight, px1, prevTarget, prevOppY, dTick, dbg) {
  var shots = opponentShots(s, isRight, prevOppY, dTick, minX, maxX);
  var lists = [], maxC = 0;
  for (var j = 0; j < shots.length; j++) {
    var sh = shots[j], pts = sh.r.pts;
    if (!pts.length) continue;                        /* 우리 코트에 안 옴 = 위협 아님 */
    /* 치명도: 접촉 가능 프레임이 좁을수록, 도착이 이를수록 위험하다. */
    var win = pts.length;
    var lethal = win <= 1 ? W.LETHAL1 : (win === 2 ? W.LETHAL2 : (win <= 4 ? W.LETHAL4 : 1.0));
    var firstAbs = sh.c + pts[0].k;
    var haste = firstAbs <= 16 ? 1.25 : 1.0;
    var cs0 = sh.cls || 'X';
    var kind = (cs0 === 'P1' || cs0 === 'C1') ? 0 : ((cs0 === 'P0' || cs0 === 'C0') ? 1 :
               ((cs0 === 'P-1' || cs0 === 'CL') ? 2 : -1));
    lists.push({ pts: pts, w: sh.w * lethal * haste, c: sh.c, cls: cs0, kind: kind, lethal1: win <= 1 });
    if (sh.c > maxC) maxC = sh.c;
  }
  /* ── 클래스별 확률 정규화 ────────────────────────────────────────────────
   * 실제로 일어나는 타격은 하나뿐이다. 그런데 "느린 공"은 열거 변형이 많아서
   * (수평 2 + 아치 2 + 리시브 3) 커버리지 합계만 보면 확률이 부풀려지고,
   * 변형이 1~2개뿐인 내리꽂기가 항상 밀린다. 실제로 우리가 지는 공은 100%
   * 내리꽂기였다(v6dev/diag_notouch.mjs). 따라서 같은 클래스의 변형끼리
   * 가중치를 나눠 클래스 사전확률이 보존되도록 정규화한다. */
  var cnt = {};
  for (var z = 0; z < lists.length; z++) cnt[lists[z].cls] = (cnt[lists[z].cls] || 0) + 1;
  for (var z2 = 0; z2 < lists.length; z2++) lists[z2].w /= cnt[lists[z2].cls];
  if (dbg) { dbg.lists = lists; dbg.keys = []; }
  if (!lists.length) {
    /* 어떤 위협도 우리 코트 지상에 닿지 않는다 → 표준 위협으로 중립 위치를 정한다.
     * 여기서 직전 목표를 그대로 유지하면(구버전) 다음 공격 대비 시간을 통째로 버린다. */
    return neutralX(minX, maxX, isRight, px1);
  }

  /* ── 최소 선행 지평 [핵심] ─────────────────────────────────────────────
   * 상대의 타격이 코앞(c=1)이면 "지금 위치에서 막을 수 있는가"는 이미 결정돼
   * 있어서 모든 후보 p 의 커버리지가 같아진다. 그러면 목표가 부차항(slack)만
   * 보고 매 틱 흔들리고, 결국 어디에도 못 간다(실측: 무접촉 실점 41/41).
   * 그래서 위협이 최소 ANTICIPATE 프레임 뒤에 온다고 보고 평가한다.
   * = "지금 이 자리를 지키고 있었다면 막을 수 있었는가" 를 목표로 삼는 것이고,
   *   이것이 미리 안전한 위치에 서 있게 만드는 유일한 기울기다.
   * 임박한 공의 실제 처리는 planReceive 가 정확한 물리로 따로 담당한다. */
  var horiz = maxC > W.ANTICIPATE ? maxC : W.ANTICIPATE;
  var freeAt = horiz + (W.EXACT_REACT ? reactAt(horiz) : REACT);
  if (freeAt > 46) freeAt = 46;
  var guardX = clamp(isRight ? NET + W.GUARD_OFF : NET - W.GUARD_OFF, minX, maxX);
  var bestP = px1, bestKey = -Infinity;
  var posAt = [];
  for (var p = minX; p <= maxX; p += 2) {
    /* 후보 목표 p 로 걸어갈 때 우리의 실제 위치 궤적 [P5] */
    var cur = px1, a = 0;
    posAt.length = 0; posAt.push(cur);                /* posAt[k-1] = 상대프레임 k 의 우리 x */
    for (var k = 2; k <= freeAt; k++) {
      if ((k - 2) % 3 === 0) a = moveToward(cur, p);
      cur = clamp(cur + WALK * a, minX, maxX);
      posAt.push(cur);
    }
    var pBucket = condBucket(isRight ? (p - NET) : (NET - p));
    if (condBanned(pBucket)) continue;                /* 이 자리는 그 상대에게 자동 실점 */
    var covered = 0, slack = 0, worst = 1e9, tier1 = 0;
    for (var q = 0; q < lists.length; q++) {
      var L = lists[q], m = -1e9;
      var cEff = L.c > W.ANTICIPATE ? L.c : W.ANTICIPATE;   /* 최소 선행 지평 적용 */
      /* 반응 지연은 "실제 타격 프레임"의 위상으로 결정된다. 선행 지평으로 밀어놓은
       * cEff 에 적용하면 위상이 뒤섞여 그냥 낙관적 상수가 되어버린다(실측 역효과). */
      var rct = W.EXACT_REACT ? reactAt(L.c) : REACT;
      var lock = cEff + rct; if (lock > freeAt) lock = freeAt; if (lock < 1) lock = 1;
      var basePos = posAt[lock - 1];
      for (var r = 0; r < L.pts.length; r++) {
        var pt = L.pts[r];
        /* pt.k 는 상대 타격 시점 기준이므로 스냅샷 기준 절대 프레임으로 환산한다. */
        var abs = cEff + pt.k;
        var kk = abs < lock ? abs : lock;
        if (kk < 1) kk = 1; if (kk > posAt.length) kk = posAt.length;
        var here = posAt[kk - 1];
        var free = abs - lock; if (free < 0) free = 0;
        var rw = WALK * free;                          /* 걸어서 */
        var rd = free > 1 ? 6 + 8 * (free - 1) : rw;   /* [P6] 슬라이딩으로 */
        if (rd > DIVE_SPAN) rd = DIVE_SPAN;
        var reach = rd > rw ? rd : rw;
        var need = Math.abs(pt.x - here);
        var mg = PH + reach - need;
        if (need > PH + rw) mg -= W.DIVE_MG;           /* 다이빙으로만 닿음 = 무제어 18프레임 */
        /* [P3] 네트 방향 반사를 만들려면 공보다 코트 안쪽에 있어야 유리 */
        if (isRight ? (basePos > pt.x + 12) : (basePos < pt.x - 12)) mg += W.BEHIND;
        if (mg > m) m = mg;
      }
      /* [조건부] 이 후보 위치 p 에 섰을 때 상대가 이 코스를 고를 상대확률 */
      var wEff = L.kind >= 0 ? L.w * condMul(pBucket, L.kind) : L.w;
      if (m >= 0) {
        covered += wEff; slack += wEff * (m > 30 ? 30 : m);
        if (L.lethal1) tier1 += wEff;                 /* 접촉창 1프레임 = 놓치면 무조건 실점 */
      } else slack += wEff * m * 0.7;
      if (m < worst) worst = m;
    }
    /* ── 사전식 우선순위 ────────────────────────────────────────────────────
     * 접촉 가능 프레임이 1개뿐인 위협(= 네트 앞 썬더급 내리꽂기)은 놓치면
     * 두 번째 기회가 물리적으로 존재하지 않는다. 실측상 랠리 중 썬더 실점은
     * 전부 "지상에 있었는데 2~20px 모자란" 경우였다. 따라서 이 부류의 커버는
     * 가중합에 섞지 말고 별도 상위 항으로 둔다 — 막을 수 있으면 반드시 막는다. */
    var key = (W.TIER1 ? tier1 * 100000 : 0) + covered * 1000 + slack + (worst >= 0 ? 500 : 0);
    /* ── 동점 파훼 [중요] ───────────────────────────────────────────────────
     * 위협이 다 느려서 어디에 서 있어도 커버리지·여유가 같아지는 구간이 자주 있다.
     * 그때 단순 최대값 탐색은 루프가 먼저 도는 p=minX(뒷벽)를 고르고, 다음 틱에
     * 다시 뒤집혀 목표가 32 ↔ 168 사이를 진동한다(실측). 그러면 정작 마지막
     * 네트 앞 스파이크 때 아무 데도 가 있지 못한다.
     * 물리적으로 이 게임에서 "되받을 수 없는 유일한 코스"는 네트 앞 내리꽂기다
     * (v6dev/truth.mjs: 가드 라인 이상에서만 6코스 중 5코스 방어, 그 아래는 스파이크
     *  0코스). 그러므로 다른 조건이 같다면 항상 가드 라인 쪽을 택한다. */
    key -= Math.abs(p - guardX) * W.GUARD_PULL;
    if (dbg) dbg.keys.push({ p: p, key: key, covered: covered, slack: slack, worst: worst });
    /* 히스테리시스: 목표가 매 틱 흔들리면 18px 격자 때문에 제자리 진동만 하고
     * 실제로는 어디에도 도달하지 못한다. 직전 목표 근처를 명시적으로 우대한다. */
    if (prevTarget !== null) {
      var dpt = Math.abs(p - prevTarget);
      if (dpt <= 2) key += W.STICKY;
      else if (dpt <= 12) key += W.STICKY * (1 - dpt / 24);
    }
    if (key > bestKey) { bestKey = key; bestP = p; }
  }
  return bestP;
}

/* ── 우리 코트로 오는 중인가: 예측이 아니라 정확한 궤적 전개로 판정 */
function incomingLanding(s, isRight) {
  var traj = rollBall(s.ball, HORIZON);
  if (!traj.length) return { ours: false, frames: 0, x: s.ball.x };
  var last = traj[traj.length - 1];
  return { ours: oursSide(last.x, isRight), frames: traj.length, x: last.x, traj: traj };
}

return {
  W: W,
  stepBall: stepBall, rollout: rollout, rollBall: rollBall,
  moveToward: moveToward, planReceive: planReceive, planStandby: planStandby, reactAt: reactAt,
  twoPlyCoverage: twoPlyCoverage, oppSpikeContact: oppSpikeContact, returnDanger: returnDanger,
  returnDangerReach: returnDangerReach,
  opponentShots: opponentShots, oppLowY: oppLowY, jumpY: jumpY, neutralX: neutralX,
  reconstructHit: reconstructHit, noteOppHit: noteOppHit, HIT: HIT, clsMul: clsMul,
  condMul: condMul, condBucket: condBucket, condBanned: condBanned,
  incomingLanding: incomingLanding, oppCanCover: oppCanCover,
  scoreContact: scoreContact, oursSide: oursSide, oppContact: oppContact, oppBestContact: oppBestContact,
  worstSpikeThreat: worstSpikeThreat,
  C: { GW: GW, NET: NET, PGY: PGY, BGY: BGY, PH: PH, WALK: WALK, REACT: REACT,
       CONTACT_LO: CONTACT_LO, DIVE_LOCK: DIVE_LOCK }
};
})();

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
  MAX_CONTACT: 18,      // 너무 늦게 만나는 공은 '반박자 빠른 공격'에서 제외
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
var g_gd_target = null;        /* [GD] 직전 대기/수신 목표 x (진동 억제용) */
var g_gd_last_jump = -9999;    /* [GD] 마지막 공격 점프 tick */
var g_gd_stats = { standby: 0, receive: 0, dive: 0, attack: 0, noPlan: 0,
  gPH: 0, gVX: 0, gDive: 0, gK: 0, gToOpp: 0, gTouch: 0, gOpp: 0, gCool: 0, gScore: 0, gOK: 0, killOK: 0 };
var g_gd_prev_opp_y = null;   /* [GD] 직전 틱 상대 y (상대 탄도 추정용) */
var g_gd_ball_was_ours = false;  /* [GD] 이번 랠리에 공이 우리 코트에 온 적이 있는가 */
var g_gd_rally_mark = -1;

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
        if (drop > 26 && !unreachable && !throughBall) continue;
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

  if (!GD_ON) return legacyGroundDecision(s, minX, maxX, isRight, towardNet, myPredX);

  /* ══ [GD] 수비 상태기 ═══════════════════════════════════════════════════
   * px1 = 상대프레임 1 에서의 우리 x. 이번 결정은 상대프레임 2 부터 먹으므로
   *       직전 액션 1프레임분을 먼저 반영해야 한다 [P5]. */
  /* [GD-OBS] 상대 타격 시점을 정확히 복원해 기록한다(공개 관찰만 사용). */
  if (g_prev !== null && g_prev_tick !== null) {
    var dF = s.tick - g_prev_tick;
    if (dF >= 1 && dF <= 4) {
      var hit = GD.reconstructHit(
        { x: g_prev.ball.x, y: g_prev.ball.y, xV: g_prev.ball.xVelocity, yV: g_prev.ball.yVelocity },
        { x: ball.x, y: ball.y, xV: ball.xVelocity, yV: ball.yVelocity }, dF);
      if (hit !== null) {
        var hitTheirs = isRight ? hit.x < NET_X + PLAYER_HALF : hit.x > NET_X - PLAYER_HALF;
        /* 코스 분포는 "네트 앞에서 나온 마무리 타격"만 학습한다. 랠리 중간의
         * 토스·리시브까지 세면 분포가 느린 공 쪽으로 쏠려 대기 위치가 뒤로 밀린다. */
        var nearNet = GD_CLS_NEARNET === 0 ||
          Math.abs(hit.x - NET_X) <= GD_CLS_NEARNET;
        /* 조건부 학습용: 상대가 칠 때 "우리가 네트에서 얼마나 떨어져 있었는가" */
        var myNetD = isRight ? (me.x - NET_X) : (NET_X - me.x);
        if (hitTheirs) GD.noteOppHit(hit.y, hit.x, hit.xV0, hit.yV0, nearNet, myNetD);
      }
    }
  }

  /* [GD] 랠리 경계 감지 + 공이 우리 코트에 온 적 있는지 추적 */
  var rfcNow = s.meta ? (s.meta.rallyFrameCount | 0) : 0;
  if (rfcNow < g_gd_rally_mark) g_gd_ball_was_ours = false;
  g_gd_rally_mark = rfcNow;
  if (isRight ? ball.x > NET_X : ball.x < NET_X) g_gd_ball_was_ours = true;

  var px1 = clamp(me.x + g_last_action.x * WALK_SPEED, minX, maxX);
  var ballOnOurHalf = isRight ? ball.x > NET_X : ball.x < NET_X;
  var land = GD.incomingLanding(s, isRight);
  var gdDT = g_prev_tick === null ? 3 : (s.tick - g_prev_tick);
  var gdLow = GD.oppLowY(s, g_gd_prev_opp_y, gdDT, 130);
  var oppLive = !ballOnOurHalf && GD.oppCanCover(land.traj, s.opp.x, gdLow, isRight, 0);

  /* (A) 우리 코트로 떨어지고 상대가 더 못 건드린다 → 정밀 수신 계획 */
  if (land.ours && !oppLive) {
    var plan = GD.planReceive(s, minX, maxX, isRight, px1, g_touches, g_gd_prev_opp_y, gdDT);
    if (plan !== null) {
      /* (A-1) 공격 셋업(요구 3): 지상 수비가 확실히 확보된 상태에서,
       *       시뮬레이션이 "상대가 못 받는다"고 인증한 킬만 점프를 허용한다. */
      /* ── 공격 셋업 허가 조건 (요구 1·3) ─────────────────────────────────
       * 점프는 33프레임(=11틱) 구속이다. 그 사이 어떤 재계획도 못 하므로,
       * "상대의 강타가 날아오는 중"에는 절대 점프하지 않는다. 이것이 v5 가
       * 리시브에서 무너진 직접 원인이었다(강타 진입 중 점프 → 깊은 공 방치).
       * 점프는 (a) 느린 공을 (b) 여유 있게 받으며 (c) 시뮬레이션이 상대의
       * 대응 불가를 인증했을 때만 쓴다. */
      var atkSafe = (GD_ATTACK_PH || !ball.isPowerHit) && Math.abs(ball.xVelocity) <= GD_ATTACK_VMAX;
      if (GD_ATTACK) {
        if (!GD_ATTACK_PH && ball.isPowerHit) g_gd_stats.gPH++;
        else if (Math.abs(ball.xVelocity) > GD_ATTACK_VMAX) g_gd_stats.gVX++;
        else if (plan.dive) g_gd_stats.gDive++;
        else if (plan.k < GD_ATTACK_MIN_K) g_gd_stats.gK++;
        else if (!plan.ev.toOpp) g_gd_stats.gToOpp++;
        else if (g_touches >= 3) g_gd_stats.gTouch++;
        else if (s.opp.state >= 3) g_gd_stats.gOpp++;
        else if (s.tick - g_gd_last_jump <= GD_ATTACK_COOL) g_gd_stats.gCool++;
        else g_gd_stats.gOK++;
      }
      if (GD_ATTACK && atkSafe && !plan.dive && plan.k >= GD_ATTACK_MIN_K && plan.ev.toOpp &&
          g_touches < 3 && s.opp.state < 3 && s.tick - g_gd_last_jump > GD_ATTACK_COOL) {
        var fastAttack = findFastAttack(s, minX, maxX);
        var atkBar = gdAttackBar(s.meta ? (s.meta.rallyFrameCount | 0) : 0);
        if (fastAttack !== null && fastAttack.score >= atkBar) {
          g_fast_attack_policy = fastAttack.smash;
          g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS;
          g_air_policy = fastAttack.smash;
          g_gd_last_jump = s.tick; g_gd_stats.attack++;
          return { x: fastAttack.jx, y: -1, hit: 1 };
        }
        var kill = findKillJump(s, minX, maxX);
        if ((fastAttack !== null && fastAttack.score < atkBar) || (kill !== null && kill.score < atkBar)) g_gd_stats.gScore++;
        if (kill !== null && kill.score >= atkBar) {
          g_air_policy = kill.smash;
          g_gd_last_jump = s.tick; g_gd_stats.attack++;
          return { x: kill.jx, y: -1, hit: 0 };
        }
      }
      g_gd_target = plan.target;
      if (plan.dive) g_gd_stats.dive++; else g_gd_stats.receive++;
      return plan.act;
    }
    /* 어떤 지상·다이빙 접촉도 불가 → 최소한 낙하지점에 붙어 둔다 */
    g_gd_stats.noPlan++;
    g_gd_target = clamp(land.x, minX, maxX);
    return { x: GD.moveToward(px1, g_gd_target), y: 0, hit: 0 };
  }

  /* (B) 그 밖의 모든 상황 → 안전 대기 위치가 1순위 (요구 4) */
  /* ── 상대 서브 구간: 눈앞의 공이 아니라 "마지막 네트 앞 스파이크"가 진짜 위협 ──
   * 서브 시퀀스 동안 공은 상대 코트에서만 오가고, 그때 열거되는 위협은 전부
   * 지금 이 공에 대한 것이라 대기 위치가 뒤쪽(x≈126)으로 잡힌다. 그런데 이 국면의
   * 실제 실점은 전부 시퀀스 끝의 네트 앞 스파이크였고, 그때 필요한 위치는 x≥152 다.
   * 공이 아직 우리 코트에 한 번도 안 온 동안에는 표준 위협 기준 가드 위치를 지킨다. */
  var st;
  if (GD_SERVE_GUARD && !g_gd_ball_was_ours && g_touches === 0) {
    st = GD.neutralX(minX, maxX, isRight, px1);
  } else {
    st = GD.planStandby(s, minX, maxX, isRight, px1, g_gd_target, g_gd_prev_opp_y, gdDT);
  }
  g_gd_target = st; g_gd_stats.standby++;
  return { x: GD.moveToward(px1, st), y: 0, hit: 0 };
}

/* v5_1 원본 지상 판단(GD_ON=0 일 때만). 비교·롤백용으로 그대로 보존한다. */
function legacyGroundDecision(s, minX, maxX, isRight, towardNet, myPredX) {
  var me = s.self, ball = s.ball;
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
  g_gd_prev_opp_y = s.opp.y;
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
    gdStats: function () { return g_gd_stats; },
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
  rallyOwner: 'AC', rallies: [], prevSelfScore: null
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
    /* [GD-BANDIT] 직전 랠리가 리시브였으면 승패로 팔을 갱신하고, 새 랠리의 팔을 뽑는다. */
    if (!M.myServe) rdCredit(M.prevSelfScore !== null && (sc.self | 0) > M.prevSelfScore);
    else RD.pend = -1;
    M.prevSelfScore = sc.self | 0;
    rdStart();
    M.rallies.push({ owner: M.rallyOwner, myServe: M.myServe, th: Thunder.TH.state, rd: RD.cur });
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
decide.__rd = RD;
decide.__ac = ACCore;
decide.__sk = SK;

decide.__gd = GD;
decide.__gdStats = function () { return ACCore.gdStats(); };
