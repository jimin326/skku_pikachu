/* ==========================================================================
 *  Lion_Eating_Bank_v2.js — leonyi(피카츄) 배구 봇 [JavaScript]  (조립기 출력명; 옛 이름 OurBot_v12)
 *  = OurBot_v11 썬더 서브 + Sajamokneun_v3_2 서브 랠리 + AdaptiveCounter_v5_2 리시브/랠리 코어
 *
 *  역할 분담 (bot-dev/sim_real.mjs 실게임 재현 벤치, 랜덤 서브·10점·LAT=1·시드 고정, 2026-09-02 실측):
 *   - 내 서브, 썬더 가능 위상(3개 중 2개): §1 Thunder 오픈루프 시퀀스. 734/734 즉시 득점.
 *   - 내 서브, 썬더 불가 위상(ph0):        §3 SajaCore가 그 랠리를 끝까지 (vs AC 82% / vs Saja 91% / vs v11 79%.
 *                                          AC 코어가 서브하면 35% / 66% / 89%). 네트 통과 후 AC로 넘기면 붕괴(91%→9%).
 *   - 상대 서브 + 그 외 전부:              §2 ACCore (리시브 랠리 승률 vs AC 68% — v11의 v9코어는 6%, Saja는 9~15%).
 *  10시드 성적: vs AdaptiveCounter_v5_2 78.9%(경기 79-1), vs Sajamokneun_v3_2 76.1%(78-2), vs OurBot_v11 71.0%(76-4).
 *  (썬더+AC코어만이면 68.6 / 67.6 / 68.6. v11 단독은 AC에 36.2%.)
 *
 *  합성 규칙 (§4):
 *   - 세 코어를 매 틱 전부 호출해 내부 상태를 유지하고(그림자 호출), 출력 하나만 고른다. 실측 decide 평균 0.5ms, max 7ms.
 *   - 고른 입력을 sync()로 두 코어의 '직전 적용 입력'에 되먹인다(지연 보정용).
 *   - 게임 종료(WIN_SCORE 도달) 후에는 중립 출력: 다음 경기 첫 랠리에 다이빙/점프 입력이 잔류해 썬더 전제가 깨지는 것을 막는다.
 *   - 썬더 첫 틱에 시작 위치(x=36, 지상)가 아니면 그 랠리 썬더 포기 → 서브 코어가 정상 서브.
 *   - 수동 지연 추정기(LAT_GUARD): 이동 없이 '직전 두 출력의 x가 다를 때 3프레임 변위'로 LAT1/LAT2 증거를 세고
 *     LAT2 증거가 많으면 썬더를 포기한다(LAT=2면 썬더는 0/151 자멸). LAT=1에서는 결과에 전혀 영향 없음(수치 동일 확인).
 *   - 썬더 랠리 길이는 78/92프레임 고정 + 라운드 간 41프레임 → 썬더 다음 내 서브는 항상 ph0(무썬더 위상).
 *     그래서 내 서브의 절반이 ph0이고 ph0 서브 품질(=SajaCore)이 중요하다.
 *
 *  당일 노브: SERVE_CORE('SAJA'|'AC'), WIN_SCORE, LAT_GUARD, SK(스킬 블록). 벤치: bot-dev/_v12_bench.mjs, 재조립: bot-dev/_build_v12.mjs
 * ========================================================================== */
'use strict';

/* ══ §0 노브 ═══════════════════════════════════════════════════════════════ */
const DEBUG = true;            // F12 로그: [Thunder] 발동, [v12] 모드 전환/썬더 포기/새 스냅샷 필드
const SERVE_CORE = 'SAJA';     // 무썬더 위상의 내 서브 랠리를 맡을 코어: 'SAJA'(실측 우세) | 'AC'
const LAT_GUARD = 1;           // 1=수동 지연 추정기로 LAT2 증거 > LAT1 증거면 썬더 포기. 0=끔
const WIN_SCORE = 10;          // 경기 승리 점수. 당일 규칙이 다르면(15점제 등) 반드시 맞출 것 — 도달 시 중립 출력

// ── Saja v3_2 스킬 블록(당일용). SK.on=false면 아무 것도 안 함. 최종 출력에 applySkill을 한 번 씌운다.
// ── §1  설정 — 이 일곱 줄만 고칩니다 ────────────────────────────────────────
var SK = {
  on:    false,             // 스킬 확인 전에는 false. 확인 후 true 로.
  gauge: 'self.gauge',      // 내 게이지 경로.  Probe 출력에서 그대로 복사
  ogauge:'opp.gauge',       // 상대 게이지 경로
  full:  100,               // 만충 값.  Probe 의 "값 범위" 줄에서 확인
  key:   'skill',           // 발동할 때 반환 객체에 넣을 키 이름
  fire:  0,                 // 0 = 발동 안 함(수비만)   1 = 발동함
  guard: 1                  // 1 = 상대 만충이면 위험한 강스매시를 아치로 낮춤
};
// 기본값이 fire:0, guard:1 인 이유:
//   수비 반응은 자책 위험이 0이고 몇 줄이면 되지만,
//   발동은 물리를 바꿔서 우리 예측을 어긋나게 만들 수 있습니다.
//   측정으로 이득이 확인되기 전까지 fire 는 0 으로 둡니다.

// ── §2  로직 — 여기는 고치지 않습니다 ───────────────────────────────────────
function skPick(o, path) {                       // 'a.b.c' 를 따라감. 없으면 undefined
  var p = path.split('.'), v = o;
  for (var i = 0; i < p.length; i++) { if (v == null) return undefined; v = v[p[i]]; }
  return v;
}
function skFull(v) { return typeof v === 'number' && v >= SK.full; }

function applySkill(s, a) {
  if (!SK.on || !a) return a;
  try {
    // 수비: 상대가 만충이면 강스매시(y=+1)를 아치(y=-1)로 낮춥니다.
    // 강스매시는 실패하면 자기 코트에 꽂히고, 상대 반격 각도도 넓게 열어줍니다.
    if (SK.guard && skFull(skPick(s, SK.ogauge)) && a.hit === 1 && a.y === 1) a.y = -1;

    // 공격: 내가 만충이고 "이미 파워히트를 치려는 순간"에만 발동합니다.
    // 아무 때나 쓰면 게이지만 버리고, 물리가 바뀌어 예측이 어긋납니다.
    if (SK.fire && skFull(skPick(s, SK.gauge)) && a.hit === 1 && s.self.state === 1) a[SK.key] = 1;
  } catch (e) { /* 스킬 로직이 죽어도 기본 액션은 그대로 나갑니다 */ }
  return a;
}

/* ══════════════════════════════════════════════════════════════════════════
 * §1 Thunder — OurBot_v11의 썬더 서브(오픈루프 시퀀스, phase 0/2에서 발동, 지연 1프레임 기준).
 *   v11에서 바꾼 것: dfnObserve 제거, v9 폴백 자리에 `return null`, TH.noPlan 플래그, kill().
 *   원본 주석 발췌:
 *  원본: 2006년 세오의 피카츄배구 블로그 "무적기술 쓰는법"
 *        https://blog.naver.com/neoseo4535/50002988054
 *  원리(엔진 소스에서 확인):
 *   1) 패스  — 서브 낙하 공을 살짝 이동해 받아 네트 바로 앞으로 보낸다.
 *   2) 토스  — 네트에 붙어 공이 네트 상단(y=176~192)보다 낮아진 뒤 ↗파워히트.
 *              공이 네트 측면에 맞고(vx 반전) 우리 쪽 위로 튕겨 벽에 맞고 돌아온다.
 *   3) 스파이크 — 점프 후 ↓ 유지 + 히트 1회. 공이 네트 상단에 맞고(vy 반전)
 *              튕겨올라 아직 파워히트 상태(state 2, 약 10프레임)인 피카츄에게
 *              재충돌 → yVelocity = |vy|*2 로 다시 배가되어 vy≈65~67 로
 *              네트 바로 뒤에 내리꽂힌다. (일반 최강 스파이크 vy=30의 2배 이상)
 *
 *  구현:
 *   - 자기 서브 랠리에서만 발동. 서브 낙하 궤적이 결정적이므로
 *     공 y좌표로 물리 프레임을 역산해 tick 스케줄을 정확히 실행한다.
 *   - 봇 제약(3프레임 tick 그룹 + 1틱 지연)과 랠리-tick 위상(phase 0/1/2)별로
 *     bot-dev/thunder_tick_probe*.mjs 브루트포스로 찾은 검증된 스케줄 사용.
 *     phase 1: 낙하 x=222 vy=65 / phase 2: 낙하 x=223 vy=67 (LEFT 기준, RIGHT는 미러)
 *     phase 0: 상대 개입 불가능한 해가 존재하지 않아(탐색 0건) 일반 로직으로 서브.
 *   - RIGHT 사이드는 좌우 미러(엔진이 ADR-0031로 벽 대칭이라 정확히 대응).
 *   - 서브가 아니거나 시퀀스 종료 후에는 OurBot_v9 로직(v9Decide)으로 플레이.
 *   - 접촉 수: 패스1 + 토스1 + 스파이크2 = 4회 → 5회 접촉 룰 안전.
 * ════════════════════════════════════════════════════════════════════════ */
var Thunder = (function () {
/* ---------- 썬더 상태 ---------- */
var TH = {
  seenScore: -1, // 점수합 (랠리 전환 감지)
  armed: false,  // 이번 랠리에서 썬더 진행 중
  dead: false,   // 이번 랠리에서 썬더 포기 (일반 로직으로)
  fEst: -1,      // 추정 물리 프레임 (랠리 시작 기준)
  noPlan: false  // v12: 이번 랠리는 썬더 해가 없는 위상(무썬더 위상) — 오케스트레이터가 서브 코어를 고르는 근거
};

/* 서브 낙하 y좌표 -> 결정 시점의 물리 프레임.
 * 서브 공은 (x=56, y=0, vy=1)에서 자유낙하: step k 후 y=(k+1)(k+2)/2.
 * 결정은 프레임 f의 물리 실행 "전" 상태를 보므로 y(step k) 관측 = 프레임 k+1. */
var TH_YTABLE = (function () {
  var t = {}, y = 0, vy = 1;
  for (var k = 0; k < 20; k++) { y += vy; vy += 1; t[y] = k + 1; }
  return t;
})();

/* 오픈루프 tick 시퀀스 (좌표는 LEFT 기준 정규화, [x, y, hit], 인덱스 = v1의 tick t).
 * v1의 플랜은 walk가 현재 위치 피드백(thWalk)이었는데, 지연 1프레임 재매핑을 하면
 * 같은 tick의 결정을 2프레임 늦은 상태에서 내리게 되어 걸음 진동이 달라지고
 * 접촉을 놓친다(plan2에서 실측). 썬더 랠리는 상대 개입이 불가능해 완전 결정적이므로,
 * 검증된 v1@lat3 실행의 tick별 실제 출력을 bot-dev/thunder_capture_seq.mjs 로 녹화해
 * 오픈루프로 박제했다. → 위상 이동에 면역.
 *  SEQ1(v1 phase1): 낙하 x=222 vy=65 / SEQ2(v1 phase2): x=223 vy=67. 4접촉, 개입 불가. */
var TH_SEQS = [
  // v1 phase 0 — "상대 개입이 불가능한" 썬더 해 없음 (probe5/probe6 각 0건) -> 일반 로직
  null,
  // v1 phase 1 — 점프 리시브(t6) + 걷기 + 토스 점프(t14)/파워히트(t17) + ↓스파이크(t22) + ↓유지
  [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[1,-1,0],[0,0,0],[1,0,0],[1,0,0],
   [1,0,0],[1,0,0],[1,0,0],[1,0,0],[0,-1,0],[0,0,0],[0,0,0],[1,-1,1],[0,0,0],[0,0,0],
   [0,0,0],[0,0,0],[0,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0]],
  // v1 phase 2 — 걷기 패스 + 토스 점프(t21)/파워히트(t22) + 스파이크(t28) + ↓유지
  [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],
   [1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],[-1,0,0],[-1,0,0],[0,0,0],[1,0,0],[1,0,0],
   [0,0,0],[0,-1,0],[1,-1,1],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[1,1,1],[0,1,0],
   [0,1,0],[0,1,0]]
];

/* ---------- 엔트리 포인트 ---------- */
function step(snapshot) {
  try {
    var s = snapshot;
    var isRight = (s.side === 'RIGHT');
    var scoreTotal = s.meta.score.self + s.meta.score.opp;
    if (scoreTotal !== TH.seenScore) {
      TH.seenScore = scoreTotal; TH.armed = false; TH.dead = false; TH.fEst = -1; TH.noPlan = false;
    }
    // LEFT 기준으로 정규화 (RIGHT면 미러)
    var bx = isRight ? 432 - s.ball.x : s.ball.x;
    var bvx = isRight ? -s.ball.xVelocity : s.ball.xVelocity;
    var selfX = isRight ? 432 - s.self.x : s.self.x;

    var myServeDrop = (bvx === 0 && bx === 56);
    // 새 랠리 감지 보강: 점수 변화 없이도(연습 모드/헤드리스 하니스 등)
    // 내 서브 공이 초기 상태로 돌아오면 랠리별 상태를 리셋한다.
    if (myServeDrop) {
      var fresh = (s.ball.y === 0) ||
        (TH_YTABLE[s.ball.y] !== undefined && TH.fEst >= 0 && TH_YTABLE[s.ball.y] < TH.fEst);
      if (fresh) { TH.armed = false; TH.dead = false; TH.fEst = -1; TH.noPlan = false; }
    }
    if (!TH.dead) {
      if (myServeDrop && s.ball.y === 0) {
        // 라운드 시작 전(레디) — phase 판별 불가, 중립으로 대기
        TH.armed = true; TH.fEst = -1;
        return { x: 0, y: 0, hit: 0 };
      }
      if (myServeDrop && TH_YTABLE[s.ball.y] !== undefined) {
        TH.fEst = TH_YTABLE[s.ball.y]; // 공 y좌표로 프레임 역산(재동기화)
        TH.armed = true;
      } else if (TH.armed) {
        if (TH.fEst < 0) { TH.armed = false; } // 낙하를 못 본 채 랠리 진행 — 포기
        else { TH.fEst += 3; }                 // 결정은 3프레임 주기
      }
      if (TH.armed && TH.fEst >= 0) {
        var phase = (3 - (TH.fEst % 3)) % 3;
        var t = ((TH.fEst - (TH.fEst % 3)) / 3) + 1;
        /* 지연 1프레임 보정: lat3에서 phase p' 플랜의 적용 구간은 [f+3, f+5],
         * lat1에서는 [f+1, f+3]이므로 실제 phase p = (p'+1)%3 격자에서
         * 같은 시퀀스를 tick 1 늦춰 내면 적용 타임라인이 정확히 일치한다. */
        var planIdx = (phase + 2) % 3;
        var tPlan = t - 1;
        var seq = TH_SEQS[planIdx];
        if (seq === null || tPlan >= seq.length) {
          if (seq === null && DEBUG) console.log('[Thunder ' + s.side + '] phase=' + phase + ' 썬더 해 없음 -> 서브 코어(SERVE_CORE) 폴백');
          if (seq === null) TH.noPlan = true;
          TH.dead = true; TH.armed = false; // 해 없는 위상이거나 시퀀스 종료
        } else {
          if (DEBUG && tPlan === 1) console.log('[Thunder ' + s.side + '] 썬더 발동 phase=' + phase + ' (seq ' + planIdx + ')');
          var e = seq[tPlan];
          return isRight ? { x: -e[0], y: e[1], hit: e[2] } : { x: e[0], y: e[1], hit: e[2] };
        }
      }
    }
  } catch (e) { /* 이상 시 코어 로직으로 */ }
  return null;   // v12: 썬더가 낼 입력이 없으면 null -> 오케스트레이터가 코어를 고른다
}
  function kill() { TH.dead = true; TH.armed = false; }
  return { step: step, kill: kill, TH: TH };
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §2 ACCore — AdaptiveCounter_v5_2 전문(무수정). 리시브/랠리/수비 코어. 매 틱 호출해 내부 상태(g_prev, g_touches,
 *   g_adapt 학습)를 유지하고, 썬더/Saja가 낼 때는 출력만 버린다. sync(a)로 실제 적용된 입력을 g_last_action에 맞춘다.
 * ════════════════════════════════════════════════════════════════════════ */
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
  MAX_BLEND: 0.62,      // 기존 v5 수비 판단을 최소 38% 보존
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
  return { decide: decide, sync: function (a) { g_last_action = { x: a.x, y: a.y, hit: a.hit }; } };
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §3 SajaCore — Sajamokneun_v3_2의 물리 완전 이식 빔서치(스킬 블록은 §0으로 이동, decide 반환 2곳만 v3 원형으로).
 *   무썬더 위상의 내 서브 랠리를 끝까지 전담(SERVE_CORE='SAJA'). 그 외에는 상태 유지용으로만 호출.
 *   sync(a,left)로 실제 적용 입력을 G.prevAct(RIGHT 정규화 좌표)에 맞춘다.
 * ════════════════════════════════════════════════════════════════════════ */
var SajaCore = (function () {
'use strict';
// ============================================================================
// Model-based search bot. Single file, no imports. Ports physics.js exactly.
// ============================================================================
var GW=432, HW=216, PHL=32, PGY=244, BGY=252, NPHW=25, NTT=176, NTB=192;
var SELF_REACH_LAG=12; // @param:SELF_REACH_LAG — bot/params.json의 제출용 인라인 사본
var OPP_REACH_LAG=0;  // @param:OPP_REACH_LAG — bot/params.json의 제출용 인라인 사본
var STATE_AWARE_REACH=0; // @param:STATE_AWARE_REACH
var DIVE_COST=400,JUMP_COST=200;
var DEPTH=4, BEAM=48; // @param:DEPTH_BEAM
var ROLLOUT_TOUCH_TRACKING=1; // @param:ROLLOUT_TOUCH_TRACKING
var ROOT_DIVERSITY=0; // @param:ROOT_DIVERSITY
var SEARCH_DIAGNOSTICS=0; // @param:SEARCH_DIAGNOSTICS
var OPP_STATE_REACH=0; // @param:OPP_STATE_REACH
var SHOT_SELECT=0; // @param:SHOT_SELECT
var BLOCK_ASSIST=1; // @param:BLOCK_ASSIST
var ROOT_QUOTA=1; // @param:ROOT_QUOTA
var SHOT_TOUCH_CROSS_BONUS=5000;
var BLOCK_NET_DISTANCE=64, BLOCK_POST_OFFSET=40;

// ---- flat state: Int32Array(22) --------------------------------------------
// 0 bx 1 by 2 bvx 3 bvy | player block base 4 (LEFT=p1) and 13 (RIGHT=p2)
// +0 x +1 y +2 vy +3 st +4 fn +5 dly +6 lie +7 dd +8 coll
var SZ=22, PL=4, PR=13;

function stepLean(s, ax,ay,ah, bx_,by_,bh,touch,ME,probe){
  var bx=s[0],by=s[1],bvx=s[2],bvy=s[3], ground=0;
  var ballWasLeft=bx<HW;
  var fx=bx+bvx; if(fx<0||fx>GW) bvx=-bvx;
  if(by+bvy<0) bvy=1;
  var d=bx-HW;
  if(d<NPHW&&d>-NPHW&&by>NTT){
    if(by<=NTB){ if(bvy>0) bvy=-bvy; }
    else { var a=bvx<0?-bvx:bvx; bvx = d<0 ? -a : a; }
  }
  var fy=by+bvy;
  if(fy>BGY){ ground=1; bvy=-bvy; by=BGY; }
  else { by=fy; bx=bx+bvx; bvy+=1; }
  s[0]=bx;s[1]=by;s[2]=bvx;s[3]=bvy;
  if(ROLLOUT_TOUCH_TRACKING&&touch&&ballWasLeft!==(bx<HW)){ touch.mt=0;touch.ot=0; }
  for(var p=0;p<2;p++){
    var o=p===0?PL:PR, ix=p===0?ax:bx_, iy=p===0?ay:by_, ih=p===0?ah:bh;
    var st=s[o+3];
    if(st===4){ s[o+6]-=1; if(s[o+6]<-1) s[o+3]=0; continue; }
    var vx=0; if(st<5) vx = st<3 ? ix*6 : s[o+7]*8;
    var px=s[o]+vx;
    if(p===0){ if(px<32)px=32; else if(px>184)px=184; } else { if(px<248)px=248; else if(px>400)px=400; }
    s[o]=px;
    if(st<3 && iy===-1 && s[o+1]===PGY){ s[o+2]=-16; st=1; s[o+3]=1; s[o+4]=0;if(touch&&o===ME)touch.dc=(touch.dc|0)+JUMP_COST; }
    var pfy=s[o+1]+s[o+2]; s[o+1]=pfy;
    if(pfy<PGY) s[o+2]+=1;
    else if(pfy>PGY){ s[o+2]=0; s[o+1]=PGY; s[o+4]=0;
      if(st===3){ st=4;s[o+3]=4;s[o+4]=0;s[o+6]=3; } else { st=0;s[o+3]=0; } }
    if(ih===1){
      if(st===1){ s[o+5]=5;s[o+4]=0;st=2;s[o+3]=2; }
      else if(st===0&&ix!==0){ st=3;s[o+3]=3;s[o+4]=0;s[o+7]=ix;s[o+2]=-5;if(touch&&o===ME)touch.dc=(touch.dc|0)+DIVE_COST; }
    }
    if(st===1) s[o+4]=(s[o+4]+1)%3;
    else if(st===2){ if(s[o+5]<1){ s[o+4]+=1; if(s[o+4]>4){ s[o+4]=0; s[o+3]=1; } } else s[o+5]-=1; }
  }
  for(var q=0;q<2;q++){
    var oo=q===0?PL:PR, jx=q===0?ax:bx_, jy=q===0?ay:by_;
    var ddx=s[0]-s[oo], ddy=s[1]-s[oo+1];
    if(ddx<=PHL&&ddx>=-PHL&&ddy<=PHL&&ddy>=-PHL){
      if(s[oo+8]===0){
        if(probe&&oo===ME){probe.hit=1;probe.bx=s[0];probe.bvy=s[3];probe.power=s[oo+3]===2;}
        if(ROLLOUT_TOUCH_TRACKING&&touch){ if(oo===ME)touch.mt++;else touch.ot++; }
        var pxx=s[oo];
        if(s[0]<pxx) s[2]=-(((pxx-s[0])/3)|0);
        else if(s[0]>pxx) s[2]=(((s[0]-pxx)/3)|0);
        var av=s[3]<0?-s[3]:s[3]; s[3]=-av; if(av<15) s[3]=-15;
        if(s[oo+3]===2){
          var m=(jx<0?-jx:jx)+1;
          s[2] = s[0]<HW ? m*10 : -m*10;
          var b2=s[3]<0?-s[3]:s[3]; s[3]=b2*jy*2;
        }
        s[oo+8]=1;
      }
    } else s[oo+8]=0;
  }
  return ground;
}

// ---- exact free-flight landing prediction ---------------------------------
// LAND: x, frames, whether the path hit the risky net-top band.
var LAND=new Int32Array(3);
function landing(bx,by,bvx,bvy){
  var n=0;LAND[2]=0;
  while(n<300){
    var fx=bx+bvx; if(fx<0||fx>GW) bvx=-bvx;
    if(by+bvy<0) bvy=1;
    var d=bx-HW;
    if(d<NPHW&&d>-NPHW&&by>NTT){ if(by<=NTB){ LAND[2]=1;if(bvy>0) bvy=-bvy; } else { var a=bvx<0?-bvx:bvx; bvx=d<0?-a:a; } }
    var fy=by+bvy;
    if(fy>BGY){ LAND[0]=bx; LAND[1]=n+1; return; }
    by=fy; bx=bx+bvx; bvy+=1; n++;
  }
  LAND[0]=bx; LAND[1]=300;
}

// ---- jump arc table --------------------------------------------------------
var JY=[],JV=[]; (function(){ var y=PGY,v=-16; for(var k=0;k<40;k++){ JY.push(y);JV.push(v); var ny=y+v; if(ny<PGY){y=ny;v++;} else if(ny>PGY) break; else {y=ny;} } })();
var DY=[],DV=[]; (function(){ var y=PGY,v=-5; for(var k=0;k<40;k++){ DY.push(y);DV.push(v); var ny=y+v; if(ny<PGY){y=ny;v++;} else if(ny>PGY) break; else {y=ny;} } })();

function inferVy(st,y,prevY,frameGroup){
  if(st!==1&&st!==2&&st!==3) return 0;
  var A=(st===3)?DY:JY, V=(st===3)?DV:JV, n=0, one=0, m=0;
  for(var k=0;k<A.length;k++) if(A[k]===y){ var vv=V[k]; if(n===0){one=vv;m=vv;} else if(vv>m)m=vv; n++; }
  if(n===0) return 0;
  if(n===1) return one;
  if(prevY!==null&&prevY!==undefined){
    for(var i=0;i<A.length;i++) if(A[i]===y){
      var vp=V[i]-frameGroup;
      if(y-(frameGroup*vp+((frameGroup*(frameGroup-1))/2|0))===prevY) return V[i];
    }
  }
  return m;
}

// ---- persistent memory ------------------------------------------------------
var G = {
  prev:null, prevAct:{x:0,y:0,hit:0},
  myTouch:0, oppTouch:0, prevBallLeft:null, prevCollSelf:false, prevCollOpp:false,
  budgetMs:32, worstMs:0, panic:0
};

var ACT=[[0,0,0],[1,0,0],[-1,0,0],[0,-1,0],[1,-1,0],[-1,-1,0],
         [0,-1,1],[1,-1,1],[-1,-1,1],[0,0,1],[1,0,1],[-1,0,1],[0,1,1],[1,1,1],[-1,1,1]];

// Two fixed arenas alternate by depth. All allocations happen once at load.
function makeArena(){
  var nodes=new Array(BEAM), order=new Int32Array(BEAM), rc=new Int32Array(ACT.length);
  for(var i=0;i<BEAM;i++) nodes[i]={s:new Int32Array(SZ),fx:0,fy:0,fh:0,has:0,sc:0,dead:0,ri:-1,mt:0,ot:0,dc:0};
  return {nodes:nodes,order:order,rc:rc};
}
var ARENA_A=makeArena(), ARENA_B=makeArena();
var WORK_STATE=new Int32Array(SZ), OPP_ACT=new Int32Array(3);
var WORK_META={mt:0,ot:0,dc:0};
var ROOT_METRICS={ticks:new Int32Array(DEPTH),sum:new Int32Array(DEPTH),one:new Int32Array(DEPTH)};
var SEARCH_METRICS={decisions:0,searches:0,panics:0,depth:new Int32Array(DEPTH+1),shotTriggers:0,shotKinds:new Int32Array(3)};
var SHOT_STATE=new Int32Array(SZ), SHOT_META={mt:0,ot:0,dc:0}, SHOT_PROBE={hit:0,power:0,bx:0,bvy:0}, SHOT_PICK=new Int32Array(3);
var OPP_REACH=new Int32Array(3);

// Stable constrained top-BEAM. Strict '>' keeps earlier candidates ahead on ties.
function offer(arena,count,state,sc,dead,fx,fy,fh,has,ri,mt,ot,dc){
  var nodes=arena.nodes, order=arena.order, pos,slot,j;
  if(count===BEAM){
    if(ROOT_DIVERSITY){
      var forced=arena.rc[ri]<ROOT_QUOTA, victimRoot;
      pos=-1;
      for(j=BEAM-1;j>=0;j--){
        victimRoot=nodes[order[j]].ri;
        if(forced ? arena.rc[victimRoot]>ROOT_QUOTA
                  : (victimRoot===ri||arena.rc[victimRoot]>ROOT_QUOTA)){ pos=j;break; }
      }
      if(pos<0||(!forced&&!(sc>nodes[order[pos]].sc))) return count;
      slot=order[pos]; arena.rc[nodes[slot].ri]--;
      for(j=pos;j<BEAM-1;j++) order[j]=order[j+1];
      pos=BEAM-1;
    } else {
      if(!(sc>nodes[order[BEAM-1]].sc)) return count;
      slot=order[BEAM-1]; pos=BEAM-1;
    }
  } else { slot=count; pos=count; count++; }
  while(pos>0 && sc>nodes[order[pos-1]].sc){ order[pos]=order[pos-1]; pos--; }
  order[pos]=slot;
  var n=nodes[slot]; n.s.set(state); n.sc=sc; n.dead=dead;
  n.fx=fx; n.fy=fy; n.fh=fh; n.has=has; n.ri=ri;n.mt=mt;n.ot=ot;n.dc=dc;
  if(ROOT_DIVERSITY) arena.rc[ri]++;
  return count;
}
function nodeAction(n){ return n&&n.has ? {x:n.fx,y:n.fy,hit:n.fh} : {x:0,y:0,hit:0}; }

function recordRootDiversity(depth,arena,count){
  var mask=0,roots=0;
  for(var i=0;i<count;i++){
    var ri=arena.nodes[arena.order[i]].ri, bit=1<<ri;
    if((mask&bit)===0){mask|=bit;roots++;}
  }
  ROOT_METRICS.ticks[depth]++;ROOT_METRICS.sum[depth]+=roots;
  if(roots===1)ROOT_METRICS.one[depth]++;
}

function panicHit(){
  G.panic++;
  if(SEARCH_DIAGNOSTICS)SEARCH_METRICS.panics++;
}
function recordDepth(depth){
  if(SEARCH_DIAGNOSTICS){SEARCH_METRICS.searches++;SEARCH_METRICS.depth[depth]++;}
}

function timeoutAction(snap,t0){
  panicHit();recordDepth(0); G.prev=snap;
  var el=Date.now()-t0; if(el>G.worstMs) G.worstMs=el;
  return G.prevAct;
}

function decideCore(snap,t0){
  if(SEARCH_DIAGNOSTICS)SEARCH_METRICS.decisions++;
  var isR = snap.side==='RIGHT';
  var ME = isR?PR:PL, OP = isR?PL:PR;
  var myNear = isR?HW:0, myFar = isR?GW:HW;
  var frameGroup=(snap.config&&snap.config.tickFrameGroupSize)|0;
  if(frameGroup<1)frameGroup=3;

  // ---------- rebuild ----------
  var root=ARENA_A.nodes[0], s0=root.s;
  s0[0]=snap.ball.x; s0[1]=snap.ball.y; s0[2]=snap.ball.xVelocity; s0[3]=snap.ball.yVelocity;
  var prevSelfY = G.prev? G.prev.self.y : null, prevOppY = G.prev? G.prev.opp.y : null;
  for(var i=0;i<2;i++){
    var o=i===0?ME:OP, v=i===0?snap.self:snap.opp, py = i===0?prevSelfY:prevOppY;
    s0[o]=v.x; s0[o+1]=v.y; s0[o+2]=inferVy(v.state,v.y,py,frameGroup);
    s0[o+3]=v.state; s0[o+4]=v.frameNumber; s0[o+7]=v.divingDirection;
    s0[o+5]=(v.state===2&&v.frameNumber===0)?4:0;
    s0[o+6]=(v.state===4)?3:-1;
    var dx=snap.ball.x-v.x, dy=snap.ball.y-v.y;
    s0[o+8]=(dx<=PHL&&dx>=-PHL&&dy<=PHL&&dy>=-PHL)?1:0;
  }

  // ---------- touch bookkeeping ----------
  var ballLeft = snap.ball.x < HW;
  if(G.prevBallLeft!==null && ballLeft!==G.prevBallLeft){ G.myTouch=0; G.oppTouch=0; }
  G.prevBallLeft = ballLeft;
  var cs = s0[ME+8]===1, co = s0[OP+8]===1;
  if(cs&&!G.prevCollSelf) G.myTouch++;
  if(co&&!G.prevCollOpp) G.oppTouch++;
  G.prevCollSelf=cs; G.prevCollOpp=co;
  root.mt=G.myTouch;root.ot=G.oppTouch;

  if(Date.now()-t0>=G.budgetMs) return timeoutAction(snap,t0);

  // ---------- lag compensation: this snapshot's frame runs my PREVIOUS action ----------
  var pa=G.prevAct;
  oppPolicy(s0,OP,isR,OPP_ACT);
  stepLean(s0, isR?OPP_ACT[0]:pa.x, isR?OPP_ACT[1]:pa.y, isR?OPP_ACT[2]:pa.hit,
                isR?pa.x:OPP_ACT[0], isR?pa.y:OPP_ACT[1], isR?pa.hit:OPP_ACT[2],root,ME,null);
  if(Date.now()-t0>=G.budgetMs) return timeoutAction(snap,t0);

  // ---------- search ----------
  var best;
  if(SHOT_SELECT&&chooseShot(s0,ME,OP,isR,frameGroup,t0)) best={x:SHOT_PICK[0],y:SHOT_PICK[1],hit:1};
  else best = search(s0, ME, OP, isR, myNear, myFar, frameGroup, t0);
  G.prev = snap; G.prevAct = best;
  var el = Date.now()-t0; if(el>G.worstMs) G.worstMs=el;
  return best;
}

// opponent policy used inside rollouts: a competent receiver
function oppPolicy(s,O,selfIsRight,out){
  // O is the opponent's block; opponent side is opposite of self
  var oppIsRight = !selfIsRight;
  var near = oppIsRight?HW:0, far = oppIsRight?GW:HW;
  landing(s[0],s[1],s[2],s[3]);
  var lpx=LAND[0], onOwn = lpx>near && lpx<far;
  var toNet = oppIsRight?-1:1;
  var tgt = onOwn ? (lpx - toNet*10) : (near+far)/2;
  var dx = tgt - s[O];
  var x = (dx>6)?1:((dx<-6)?-1:0);
  var y=0,h=0;
  var st=s[O+3];
  var bdx=s[0]-s[O], bdy=s[1]-s[O+1];
  if(bdx<0)bdx=-bdx; if(bdy<0)bdy=-bdy;
  if(st===0 && bdx<40 && s[1]>40 && s[1]<150 && s[3]>0) y=-1;
  if(st===1||st===2){h=1;y=1;if(bdx<50&&bdy<50)x=0;}
  out[0]=x; out[1]=y; out[2]=h;
}

function intervalSlack(x,lo,hi){
  if(x<lo)return lo-x;
  if(x>hi)return x-hi;
  var a=x-lo,b=hi-x;return -(a<b?a:b);
}

// Deterministic power-shot selector outside the beam. No angle heuristic:
// every candidate is ranked only by exact landing, reach interval and net risk.
function chooseShot(s0,ME,OP,isR,frameGroup,t0){
  var st=s0[ME+3];if(st!==1&&st!==2)return 0;
  var found=0,best=-2147483647,bestX=0,bestY=0;
  for(var yi=0;yi<3;yi++){
    var sy=yi-1;
    for(var xi=0;xi<3;xi++){
      if(Date.now()-t0>=G.budgetMs)return 0;
      var sx=xi===0?0:(xi===1?1:-1);
      SHOT_STATE.set(s0);SHOT_META.mt=ARENA_A.nodes[0].mt;SHOT_META.ot=ARENA_A.nodes[0].ot;SHOT_META.dc=0;
      oppPolicy(SHOT_STATE,OP,isR,OPP_ACT);
      var contact=0;
      for(var f=0;f<frameGroup;f++){
        SHOT_PROBE.hit=0;SHOT_PROBE.power=0;
        var ground=stepLean(SHOT_STATE,
          isR?OPP_ACT[0]:sx,isR?OPP_ACT[1]:sy,isR?OPP_ACT[2]:1,
          isR?sx:OPP_ACT[0],isR?sy:OPP_ACT[1],isR?1:OPP_ACT[2],SHOT_META,ME,SHOT_PROBE);
        if(SHOT_PROBE.hit){
          if(SHOT_PROBE.power){
            var speed=(sx<0?-sx:sx)+1;
            var av=SHOT_PROBE.bvy<0?-SHOT_PROBE.bvy:SHOT_PROBE.bvy;if(av<15)av=15;
            SHOT_STATE[2]=SHOT_PROBE.bx<HW?speed*10:-speed*10;
            SHOT_STATE[3]=av*sy*2;contact=1;
          }
          break;
        }
        if(ground)break;
      }
      if(!contact)continue;
      if(ROLLOUT_TOUCH_TRACKING&&(SHOT_META.mt>=5||SHOT_META.ot>=5))continue;
      landing(SHOT_STATE[0],SHOT_STATE[1],SHOT_STATE[2],SHOT_STATE[3]);
      var lpx=LAND[0],lpf=LAND[1],netRisk=LAND[2];
      oppReachInterval(SHOT_STATE,OP,isR,lpf);
      var slack=intervalSlack(lpx,OPP_REACH[0],OPP_REACH[1]);
      var ySlack=BGY-OPP_REACH[2];if(ySlack<0)ySlack=-ySlack;ySlack-=PHL;
      if(ySlack>slack)slack=ySlack;
      var landsOpp=isR?lpx<HW:lpx>=HW;
      if(!landsOpp||netRisk)continue;
      var score=slack;
      if(SHOT_META.mt>=3&&landsOpp)score+=SHOT_TOUCH_CROSS_BONUS;
      if(!found||score>best){found=1;best=score;bestX=sx;bestY=sy;}
    }
  }
  if(!found)return 0;
  SHOT_PICK[0]=bestX;SHOT_PICK[1]=bestY;
  if(SEARCH_DIAGNOSTICS){SEARCH_METRICS.shotTriggers++;SEARCH_METRICS.shotKinds[bestY+1]++;}
  return 1;
}

function search(s0, ME, OP, isR, myNear, myFar, frameGroup, t0){
  var root=ARENA_A.nodes[0]; root.has=0; root.sc=0; root.dead=0;root.ri=-1;root.dc=0; ARENA_A.order[0]=0;
  if(ROLLOUT_TOUCH_TRACKING&&(root.mt>=5||root.ot>=5)){recordDepth(0);return G.prevAct;}
  var blockMode=BLOCK_ASSIST&&blockThreat(s0,OP,isR);
  var src=ARENA_A, dst=ARENA_B, srcCount=1, dstCount=0, work=WORK_STATE;
  for(var d=0; d<DEPTH; d++){
    dstCount=0; var timedOut=0;if(ROOT_DIVERSITY)dst.rc.fill(0);
    expand:
    for(var bi=0; bi<srcCount; bi++){
      if(Date.now()-t0>=G.budgetMs){ timedOut=1; break expand; }
      var nd=src.nodes[src.order[bi]];
      if(nd.dead){
        dstCount=offer(dst,dstCount,nd.s,nd.sc,nd.dead,nd.fx,nd.fy,nd.fh,nd.has,nd.ri,nd.mt,nd.ot,nd.dc);
        continue;
      }
      for(var ai=0; ai<ACT.length; ai++){
        if(Date.now()-t0>=G.budgetMs){ timedOut=1; break expand; }
        var a=ACT[ai];
        work.set(nd.s);
        WORK_META.mt=nd.mt;WORK_META.ot=nd.ot;WORK_META.dc=nd.dc;
        var g=0;
        oppPolicy(work,OP,isR,OPP_ACT);
        var touchDead=0;
        for(var f=0; f<frameGroup; f++){
          g = stepLean(work, isR?OPP_ACT[0]:a[0], isR?OPP_ACT[1]:a[1], isR?OPP_ACT[2]:a[2],
                             isR?a[0]:OPP_ACT[0], isR?a[1]:OPP_ACT[1], isR?a[2]:OPP_ACT[2],WORK_META,ME,null);
          touchDead=ROLLOUT_TOUCH_TRACKING&&(WORK_META.mt>=5||WORK_META.ot>=5);
          if(g||touchDead) break;
        }
        var fx=nd.has?nd.fx:a[0], fy=nd.has?nd.fy:a[1], fh=nd.has?nd.fh:a[2];
        var ri=nd.has?nd.ri:ai;
        var sc=evaluate(work, ME, OP, isR, myNear, myFar, g, d,WORK_META.mt,WORK_META.ot,blockMode)-WORK_META.dc;
        dstCount=offer(dst,dstCount,work,sc,g||touchDead,fx,fy,fh,1,ri,WORK_META.mt,WORK_META.ot,WORK_META.dc);
      }
    }
    if(timedOut){
      panicHit();recordDepth(d);
      if(d===0) return dstCount>0 ? nodeAction(dst.nodes[dst.order[0]]) : G.prevAct;
      return nodeAction(src.nodes[src.order[0]]);
    }
    var tmp=src; src=dst; dst=tmp; srcCount=dstCount;
    if(SEARCH_DIAGNOSTICS)recordRootDiversity(d,src,srcCount);
    if(Date.now()-t0>=G.budgetMs){ panicHit();recordDepth(d+1);return nodeAction(src.nodes[src.order[0]]); }
  }
  recordDepth(DEPTH);
  return nodeAction(src.nodes[src.order[0]]);
}

// Reachable interval after forced dive motion and lying recovery.
// REACH[0] is its centre, REACH[1] is radius including the 32px body half-width.
var REACH=new Int32Array(3);
function selfReachInterval(s,ME,isR,lpf){
  var st=s[ME+3], frames=lpf, x=s[ME], y=s[ME+1], vy=s[ME+2], lie=s[ME+6],canWalk=1;
  var lo=isR?248:32, hi=isR?400:184;
  if(st===3){
    var dd=s[ME+7];
    while(frames>0 && st===3){
      x+=dd*8; if(x<lo)x=lo; else if(x>hi)x=hi;
      frames--;
      var fy=y+vy;
      if(fy>PGY){ y=PGY;vy=0;st=4; lie=3; }
      else { y=fy; if(fy<PGY) vy+=1; }
    }
  }
  if(st===4 && frames>0){
    var locked=lie+2; if(locked<0)locked=0; if(locked>frames)locked=frames;
    frames-=locked; if(frames>0)st=0;
  }
  if(st>=3)canWalk=0;
  if(st!==3&&st!==4&&y<PGY&&frames>0){while(frames>0&&y<PGY){frames--;var ay=y+vy;if(ay>PGY){y=PGY;vy=0;break;}y=ay;if(ay<PGY)vy++;}if(y<PGY)canWalk=0;}
  if(canWalk){frames-=SELF_REACH_LAG;if(frames<0)frames=0;}else frames=0;
  REACH[0]=x; REACH[1]=32+frames*6;REACH[2]=y;
}

// Opponent reachable interval. Unlike the old symmetric radius, diving keeps
// its forced direction and airborne/lying frames consume movement time.
function oppReachInterval(s,O,isR,lpf){
  var st=s[O+3],frames=lpf,x=s[O],y=s[O+1],vy=s[O+2],lie=s[O+6],canWalk=1;
  var oppIsRight=!isR,centreLo=oppIsRight?248:32,centreHi=oppIsRight?400:184;
  if(st===3){
    var dd=s[O+7];
    while(frames>0&&st===3){
      x+=dd*8;if(x<centreLo)x=centreLo;else if(x>centreHi)x=centreHi;
      frames--;
      var fy=y+vy;
      if(fy>PGY){y=PGY;vy=0;st=4;lie=3;}
      else {y=fy;if(fy<PGY)vy++;}
    }
    if(st===3)canWalk=0;
  }
  if(st===4&&frames>0){
    var locked=lie+2;if(locked<0)locked=0;if(locked>frames)locked=frames;
    frames-=locked;if(frames>0)st=0;else if(locked>0)canWalk=0;
  }
  if(st!==3&&st!==4&&y<PGY&&frames>0){
    while(frames>0&&y<PGY){
      frames--;var ay=y+vy;
      if(ay>PGY){y=PGY;vy=0;break;}
      y=ay;if(ay<PGY)vy++;
    }
    if(y<PGY)canWalk=0;
  }
  if(canWalk){frames-=OPP_REACH_LAG;if(frames<0)frames=0;}else frames=0;
  var radius=PHL+frames*6,lo=x-radius,hi=x+radius;
  var courtLo=oppIsRight?HW:0,courtHi=oppIsRight?GW:HW;
  if(lo<courtLo)lo=courtLo;if(hi>courtHi)hi=courtHi;
  OPP_REACH[0]=lo;OPP_REACH[1]=hi;OPP_REACH[2]=y;
}

function blockThreat(s,O,isR){
  var ballOpp=isR?s[0]<HW:s[0]>=HW;if(!ballOpp)return 0;
  if(s[3]<=0)return 0;
  var nd=s[O]-HW;if(nd<0)nd=-nd;if(nd>BLOCK_NET_DISTANCE)return 0;
  return 1;
}

function evaluate(s, ME, OP, isR, myNear, myFar, ground, depth,mt,ot,blockMode){
  var sc=0;
  if(ground){
    var lx=s[0];
    var mine = isR ? (lx>=HW) : (lx<HW);
    return mine ? -10000 : 10000;
  }
  if(ROLLOUT_TOUCH_TRACKING){if(mt>=5)return -10000;if(ot>=5)return 10000;}
  landing(s[0],s[1],s[2],s[3]);
  var lpx=LAND[0], lpf=LAND[1];
  var landsMine = isR ? (lpx>=HW) : (lpx<HW);
  if(landsMine){
    // can I get there?
    var anchor=s[ME], selfReach,reachY=s[ME+1];
    if(STATE_AWARE_REACH){ selfReachInterval(s,ME,isR,lpf); anchor=REACH[0]; selfReach=REACH[1];reachY=REACH[2]; }
    else {var walk=lpf-SELF_REACH_LAG;if(walk<0)walk=0;selfReach=PHL+6*walk;}
    var need = lpx - anchor; if(need<0) need=-need;
    var yNeed=BGY-reachY;if(yNeed<0)yNeed=-yNeed;
    var canReach = need <= selfReach&&yNeed<=PHL;
    sc -= 900;
    sc -= canReach?0:2500;
    sc -= need*1.5;
  } else {
    sc += 900;
    var slack;
    if(OPP_STATE_REACH){oppReachInterval(s,OP,isR,lpf);slack=intervalSlack(lpx,OPP_REACH[0],OPP_REACH[1]);}
    else {var oneed=lpx-s[OP];if(oneed<0)oneed=-oneed;var oppReach=6*(lpf-OPP_REACH_LAG)+32;slack=oneed-oppReach;}
    sc += slack>0 ? (1800 + slack*12) : slack*9;
    // prefer deep/steep balls
    sc += (s[3]>0? s[3]*3 : 0);
  }
  // positioning: be near own court centre-ish / under future ball
  var post = landsMine ? lpx : (myNear+myFar)/2;
  var ballOpp=isR?s[0]<HW:s[0]>=HW;
  if(BLOCK_ASSIST&&blockMode&&ballOpp&&!landsMine)post=isR?HW+BLOCK_POST_OFFSET:HW-BLOCK_POST_OFFSET;
  var pd = s[ME]-post; if(pd<0) pd=-pd;
  sc -= pd*0.6;
  // touch limit pressure
  var myTouch=ROLLOUT_TOUCH_TRACKING?mt:G.myTouch;
  if(myTouch>=3) sc -= 400*(myTouch-2);
  return sc;
}


// ---------------------------------------------------------------------------
// Side normalisation. All strategy code above runs in "I am RIGHT" coordinates.
// Playing LEFT simply mirrors the world (x -> 432-x). This removes every
// side-conditional code path AND makes evaluation tie-breaks side-independent
// (the action table lists +x before -x, and a stable sort turns that into a
// hidden directional preference that is good for one side and bad for the other).
// ---------------------------------------------------------------------------
// 정규화 래퍼. LEFT 를 미러링해서 decideCore 는 항상 RIGHT 기준 단일 경로로 돕니다.
// 모르는 필드(당일 추가될 게이지 등)는 그대로 통과시킵니다 — 얕은 복사 후 좌표만 덮어씀.
// 이렇게 하지 않으면 새 필드가 LEFT 경로에서만 사라져 좌우 비대칭이 생깁니다.
function mirrorPlayer(p){
  var o={}; for(var k in p) if(Object.prototype.hasOwnProperty.call(p,k)) o[k]=p[k];
  o.x=GW-p.x; o.divingDirection=-p.divingDirection; return o;
}
function decide(snap){
  var t0=Date.now();
  if(snap.side === 'RIGHT') return decideCore(snap,t0);
  var t={}; for(var k in snap) if(Object.prototype.hasOwnProperty.call(snap,k)) t[k]=snap[k];
  t.side='RIGHT';
  t.self=mirrorPlayer(snap.self);
  t.opp =mirrorPlayer(snap.opp);
  var b={}; for(var k2 in snap.ball) if(Object.prototype.hasOwnProperty.call(snap.ball,k2)) b[k2]=snap.ball[k2];
  b.x=GW-snap.ball.x; b.xVelocity=-snap.ball.xVelocity;
  b.expectedLandingPointX=GW-snap.ball.expectedLandingPointX;
  t.ball=b;
  var a=decideCore(t,t0);
  return {x:-a.x, y:a.y, hit:a.hit};
}
decide.__rootMetrics=ROOT_METRICS;
decide.__searchMetrics=SEARCH_METRICS;
  return { decide: decide, sync: function (a, left) { G.prevAct = { x: left ? -a.x : a.x, y: a.y, hit: a.hit }; } };
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §4 오케스트레이터
 * ════════════════════════════════════════════════════════════════════════ */
var M = {
  prevRally: -1, prevScore: -1, mode: 'AC', myServe: false,
  rallyThunder: 0, rallySaja: 0, rallies: [],   // 벤치용: 새 랠리 감지 시 직전 랠리의 {th, saja, mode}를 push (최대 400)
  lastOut: null, prev2Out: null, lastSelfX: null, lastSelfY: null, lastState: null,
  lat1: 0, lat2: 0, killedLat: 0, killedPos: 0, loggedFields: false
};
function v12Neutral() { return { x: 0, y: 0, hit: 0 }; }
function v12Clamp(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
function v12Call(core, s) {
  try {
    var a = core.decide(s);
    if (!a || typeof a !== 'object') return v12Neutral();
    return { x: v12Clamp(a.x | 0), y: v12Clamp(a.y | 0), hit: a.hit ? 1 : 0 };
  } catch (e) { return v12Neutral(); }
}
// 당일 스킬 대비: 스냅샷에 새 필드가 생기면 첫 tick에 F12 콘솔로 보여준다 (v11에서 이식).
var v12KNOWN = { top: ['tick', 'side', 'self', 'opp', 'ball', 'meta', 'config'],
  self: ['x', 'y', 'state', 'frameNumber', 'divingDirection'],
  ball: ['x', 'y', 'xVelocity', 'yVelocity', 'isPowerHit', 'expectedLandingPointX'],
  meta: ['score', 'isPlayer2Serve', 'rallyFrameCount'], config: ['tickFrameGroupSize'] };
function v12LogNewFields(s) {
  if (M.loggedFields) return; M.loggedFields = true;
  var extra = [], k, sec;
  for (k in s) if (Object.prototype.hasOwnProperty.call(s, k) && v12KNOWN.top.indexOf(k) < 0) extra.push(k + '=' + JSON.stringify(s[k]));
  var secs = ['self', 'ball', 'meta', 'config'];
  for (var i = 0; i < secs.length; i++) { sec = secs[i]; if (s[sec]) for (k in s[sec]) if (Object.prototype.hasOwnProperty.call(s[sec], k) && v12KNOWN[sec].indexOf(k) < 0) extra.push(sec + '.' + k + '=' + JSON.stringify(s[sec][k])); }
  if (s.opp) for (k in s.opp) if (Object.prototype.hasOwnProperty.call(s.opp, k) && v12KNOWN.self.indexOf(k) < 0) extra.push('opp.' + k + '=' + JSON.stringify(s.opp[k]));
  console.log('[v12 ' + s.side + '] 새 스냅샷 필드: ' + (extra.length ? extra.join(', ') : '없음'));
}
function v12NewRally() {
  M.rallies.push({ th: M.rallyThunder, saja: M.rallySaja, mode: M.mode });
  if (M.rallies.length > 400) M.rallies.shift();
  M.rallyThunder = 0; M.rallySaja = 0; M.mode = 'AC'; M.myServe = false;
}
function v12Core(s) {
  var isR = s.side === 'RIGHT', left = !isR;
  var selfX = isR ? 432 - s.self.x : s.self.x;   // LEFT 기준 정규화
  if (DEBUG) v12LogNewFields(s);
  /* (1) 수동 지연 추정 — 직전 두 출력의 x가 다르고 두 스냅샷 모두 지상·벽 밖이면, 3프레임 변위는
   *     LAT1: 6*(a2+2*a1), LAT2: 6*(2*a2+a1). (a1=직전 출력, a2=그 전 출력, LEFT 정규화) */
  if (LAT_GUARD && M.lastOut && M.prev2Out && M.lastState === 0 && s.self.state === 0 && M.lastSelfY === 244 && s.self.y === 244) {
    var a1 = isR ? -M.lastOut.x : M.lastOut.x, a2 = isR ? -M.prev2Out.x : M.prev2Out.x;
    if (a1 !== a2 && M.lastSelfX > 32 && M.lastSelfX < 184 && selfX > 32 && selfX < 184) {
      var obs = selfX - M.lastSelfX, e1 = 6 * (a2 + 2 * a1), e2 = 6 * (2 * a2 + a1);
      if (obs === e1) M.lat1++; else if (obs === e2) M.lat2++;
    }
  }
  var fin = function (a) {
    try { ACCore.sync(a); } catch (e) { /* 무시 */ }
    try { SajaCore.sync(a, left); } catch (e) { /* 무시 */ }
    M.prev2Out = M.lastOut; M.lastOut = a; M.lastSelfX = selfX; M.lastSelfY = s.self.y; M.lastState = s.self.state;
    return a;
  };
  var sc = (s.meta && s.meta.score) ? s.meta.score : { self: 0, opp: 0 };
  /* (2) 게임 종료 가드 */
  if (sc.self >= WIN_SCORE || sc.opp >= WIN_SCORE) return fin(v12Neutral());
  /* (3) 새 랠리 감지 + 내 서브 감지 */
  var rfc = s.meta ? (s.meta.rallyFrameCount | 0) : 0, total = (sc.self | 0) + (sc.opp | 0);
  if (rfc < M.prevRally || total !== M.prevScore) v12NewRally();
  M.prevRally = rfc; M.prevScore = total;
  var bx = isR ? 432 - s.ball.x : s.ball.x, bvx = isR ? -s.ball.xVelocity : s.ball.xVelocity;
  if (bvx === 0 && bx === 56 && s.ball.y <= 6) M.myServe = true;
  /* (4) 썬더 */
  var t = null; try { t = Thunder.step(s); } catch (e) { t = null; }
  var TH = Thunder.TH;
  if (t && TH.armed && !TH.dead && TH.fEst >= 0 && Math.floor(TH.fEst / 3) <= 1) {
    if (!(s.self.state === 0 && s.self.y === 244 && selfX === 36)) {
      Thunder.kill(); t = null; M.killedPos++;
      if (DEBUG) console.log('[v12 ' + s.side + '] 썬더 포기: 시작 위치 아님 x=' + selfX + ' y=' + s.self.y + ' state=' + s.self.state);
    } else if (LAT_GUARD && M.lat2 > M.lat1) {
      Thunder.kill(); t = null; M.killedLat++;
      if (DEBUG) console.log('[v12 ' + s.side + '] 썬더 포기: 지연 2프레임 증거 ' + M.lat2 + ' > ' + M.lat1);
    }
  }
  /* (5) 그림자 호출 — 둘 다 매 틱 돌려 상태 유지 */
  var aAC = v12Call(ACCore, s), aSJ = v12Call(SajaCore, s);
  if (t) { M.rallyThunder++; return fin(t); }
  /* (6) 모드: 내 서브 랠리인데 썬더가 안 내면(무썬더 위상/포기) 서브 코어가 그 랠리를 끝까지 */
  if (M.myServe && M.mode === 'AC' && rfc < 70) {
    M.mode = SERVE_CORE;
    if (DEBUG && SERVE_CORE !== 'AC') console.log('[v12 ' + s.side + '] 내 서브 랠리(무썬더 위상) -> ' + SERVE_CORE + ' 코어');
  }
  if (M.mode === 'SAJA') { M.rallySaja++; return fin(aSJ); }
  return fin(aAC);
}
function decide(snapshot) {
  var a;
  try { a = v12Core(snapshot); } catch (e) { a = v12Neutral(); }
  try { a = applySkill(snapshot, a) || a; } catch (e) { /* 스킬 블록이 죽어도 기본 액션 유지 */ }
  return a;
}
decide.__state = M;   // 벤치/디버그용 (bot-dev/_v12_bench.mjs)
