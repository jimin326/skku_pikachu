/* ==========================================================================
 *  OurBot_v11.js — leonyi(피카츄) 배구 봇  [JavaScript]  = v9 + 썬더 서브 + 수비 개선
 *
 *  === v10 성적 (bot-dev, 지연 1프레임 = 실제 브라우저 조건) ===
 *    vs Jayce_v1.py : 게임 35~48%, 랠리 48~50% (40~60게임)  ← v9는 게임 0%, 랠리 9.6%
 *    vs 내장AI      : 12/12   vs Keun_v1 : 9~10/12 (v9는 7/12)   vs kyu_v14 : 12/12
 *    (12랠리 격자는 표본이 좁아 ±1 흔들림. 최종 판단은 matchup.mjs 다판으로 할 것)
 *    썬더 자체      : phase 0/2 에서 12/12 즉시득점(모든 상대), phase 1은 폴백
 *
 *  === v9 -> v10 일반 플레이 변경 (Jayce전 실측으로 찾은 버그 2개) ===
 *   (a) 상대 코트에 공이 있을 때 '제자리 진동' 버그
 *       walkTo의 데드밴드 WALK_DB=6인데 1결정=3프레임=18px 이동이라, 목표를
 *       계속 지나쳐 x:+1/-1/0을 반복하며 60프레임을 허비했다(실측 트레이스).
 *       그 상태로 상대 스매시가 오면 40~76px 떨어져 있어 못 닿고 실점.
 *       -> 수비 이동에 별도 데드밴드 DEF_DB=10 적용. 9~11이 안정 구간이고
 *          8 이하(진동)나 12 이상(굼뜸)은 즉시 성능이 떨어진다.
 *   (b) 수비 위치를 fl.x(자유낙하 예측)로 잡던 문제
 *       상대는 반드시 공을 치므로 그 예측은 무의미한데, 그걸 좇아 코트 구석에
 *       서 있었다. -> defendX(): 공이 상대 코트면 예측을 버리고 수비 정위치로.
 *       (DEF_FRAC=0.52가 최적. 네트로 더 당기면 스매시는 막지만 로브에 진다.)
 *   주의: DEF_ANTICIP=2 / DEPTH_W 는 실험했으나 이득이 없어 기본 꺼둠(노브로 남김).
 *
 *  v1(Thunder_v1) 대비 썬더 부분 변경:
 *   - v1은 sim.mjs 기본 모델(결정 → 3프레임 뒤 적용)로 스케줄을 맞췄지만,
 *     실제 브라우저(botInput.js)는 워커 응답이 다음 프레임 전에 도착해
 *     결정이 f+1부터 적용된다(지연 1프레임). 적용 시점이 2프레임 당겨지는
 *     것은 tick 격자의 위상 이동과 같으므로, 실제 phase p에서
 *     TH_SEQS[(p+2)%3] 시퀀스를 tick 1 늦춰 실행하면 v1과 프레임 단위로
 *     동일한 적용 타임라인이 재현된다 (유도·검증: bot-dev/thunder_v2_test.mjs).
 *     → 지연 1 기준으로 phase 0·2에서 썬더, phase 1은 일반 로직 폴백.
 *   - 플랜을 피드백 walk(thWalk)에서 오픈루프 시퀀스로 교체 (TH_SEQS 주석 참고).
 *   - 폴백을 kyu_v14 → OurBot_v9로 교체: lat1에서 kyu는 자기 서브를 자멸하는 반면
 *     (12/24), v9는 애초에 실제 입력 흐름(지연 1) 대상으로 튠된 봇(18/24).
 *
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
 * ========================================================================== */

/* ---------- 썬더 상태 ---------- */
var TH = {
  seenScore: -1, // 점수합 (랠리 전환 감지)
  armed: false,  // 이번 랠리에서 썬더 진행 중
  dead: false,   // 이번 랠리에서 썬더 포기 (일반 로직으로)
  fEst: -1       // 추정 물리 프레임 (랠리 시작 기준)
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

/* v11-4: 적응형 수비 학습 — decide() 최상단에서 매 틱 호출한다.
 * 주의: v9Core 안에 두면 썬더 랠리에서는 v9Core가 아예 호출되지 않아(썬더가 먼저 return)
 * 학습이 끊긴다. 실점 감지는 '다음 랠리 첫 틱'에 오는데 그 랠리가 썬더면 통째로 놓친다.
 * 그래서 썬더/일반 분기보다 앞에서 무조건 돌려야 한다. */
function dfnObserve(s) {
  if (!DFN_LEARN) return;
  const isLeft = s.side === 'LEFT';
  const ball = s.ball, opp = s.opp;
  const oppScore = s.meta && s.meta.score ? s.meta.score.opp : 0;
  const nbx = isLeft ? ball.x : GW - ball.x;
  const oppAir = (opp.state === 1 || opp.state === 2);
  const ballOpp = isLeft ? ball.x >= NET_X : ball.x < NET_X;
  if (s.meta.rallyFrameCount < dfnPrevRally) {   // 새 랠리: 직전 랠리 기록을 넘김
    dfnPrevHist = dfnHist; dfnHist = []; dfnLatch = null; dfnLatchLeft = 0; dfnPrevUsedKey = dfnUsedKey; dfnUsedKey = null;
  } else {
    dfnLastBall = nbx;                            // 랠리 중 마지막 관측 공 위치
  }
  dfnPrevRally = s.meta.rallyFrameCount;
  dfnHist.push(oppAir && ballOpp ? dfnKey(nbx, ball.y) : null);
  if (dfnHist.length > 60) dfnHist.shift();
  if (dfnPrevOppScore >= 0 && oppScore > dfnPrevOppScore) {
    const landN = dfnLastBall;                    // 직전 랠리의 마지막 공 위치 = 착지 근처
    if (landN !== null && landN < NET_X) {
      /* 상황키 선택: '상대가 공중이었던 마지막 구간'이 강타 준비 구간이다.
       * 그 구간의 시작 쪽(= DFN_LEAD 틱 앞)을 키로 쓴다. 배열 뒤에서부터
       * 유효 키가 이어지는 덩어리를 찾아 그 앞쪽을 고른다. */
      let last = -1;
      for (let i = dfnPrevHist.length - 1; i >= 0; i--) if (dfnPrevHist[i]) { last = i; break; }
      let k = null;
      if (last >= 0) {
        let start = last;
        while (start > 0 && dfnPrevHist[start - 1]) start--;   // 연속 구간의 시작
        k = dfnPrevHist[Math.max(start, last - DFN_LEAD)];
      }
      if (k) {
        const e = dfnTable[k];
        if (e) { e.land = (e.land * e.n + landN) / (e.n + 1); e.n++; }
        else dfnTable[k] = { land: landN, n: 1, back: DFN_BACK };
        if (DEBUG) console.log('[OurBot] 적응수비 학습 ' + k + ' -> ' + Math.round(landN));
      }
    }
    /* 오프셋 적응: 직전 랠리에서 래치가 걸렸는데 실점했으면, 공이 우리 뒤로 갔는지 앞에 꽂혔는지로
     * 그 키의 오프셋을 한 칸 조정한다(뒤로 뚫림 -> 더 뒤에 서기, 앞에 꽂힘 -> 더 앞에 서기). */
    if (DFN_ADAPT_BACK && dfnPrevUsedKey && dfnTable[dfnPrevUsedKey] && landN !== null) {
      const e = dfnTable[dfnPrevUsedKey];
      if (e.back === undefined) e.back = DFN_BACK;
      const stood = e.land - e.back;
      if (landN < stood - 32) e.back = Math.min(96, e.back + DFN_ADAPT_STEP);
      else if (landN > stood + 32 && landN < NET_X) e.back = Math.max(0, e.back - DFN_ADAPT_STEP);
    }
  }
  dfnPrevOppScore = oppScore;
}

/* ---------- 엔트리 포인트 ---------- */
function decide(snapshot) {
  try { dfnObserve(snapshot); } catch (e) { /* 학습 실패는 플레이에 영향 없게 */ }
  try {
    var s = snapshot;
    var isRight = (s.side === 'RIGHT');
    var scoreTotal = s.meta.score.self + s.meta.score.opp;
    if (scoreTotal !== TH.seenScore) {
      TH.seenScore = scoreTotal; TH.armed = false; TH.dead = false; TH.fEst = -1;
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
      if (fresh) { TH.armed = false; TH.dead = false; TH.fEst = -1; }
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
          if (seq === null && DEBUG) console.log('[Thunder ' + s.side + '] phase=' + phase + ' 썬더 해 없음 -> v9 폴백');
          TH.dead = true; TH.armed = false; // 해 없는 위상이거나 시퀀스 종료
        } else {
          if (DEBUG && tPlan === 1) console.log('[Thunder ' + s.side + '] 썬더 발동 phase=' + phase + ' (seq ' + planIdx + ')');
          var e = seq[tPlan];
          return isRight ? { x: -e[0], y: e[1], hit: e[2] } : { x: e[0], y: e[1], hit: e[2] };
        }
      }
    }
  } catch (e) { /* 이상 시 일반 로직으로 */ }
  return v9Decide(snapshot);
}

/* ==========================================================================
 *  이하: 일반 플레이 로직 — OurBot_v9 (decide -> v9Decide 로만 개명)
 * ========================================================================== */
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
/* v11-5: 점프 정렬 허용치. 32 -> 40.
 * "쓸모없는 점프를 해서 뒤를 못 막는다"는 가설로 점프를 줄여봤으나 반대였다 —
 * 넓힐수록 좋아진다. 좁으면 칠 수 있는 공을 그냥 흘려보내고 상대에게 공격권을 준다.
 * 실측(5시드 300랠리): 32->240, 38->240, 40->259, 42->239, 48->244.
 * 40에서 뾰족해 과적합을 의심했으나 **완전히 다른 시드 5개로 재검증**해도
 * 40 -> 254 (기준선 240)로 재현됐고, Jayce전이 두 세트 모두 25->31/32로 일관 개선.
 * 42 이상은 급락하므로 40을 넘기지 말 것(v9전 변동이 특히 크다). */
const JUMP_ALIGN = 40;      // 점프 허용 |ball.x-me.x|
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
const BLOCK_PEN = 0;        // 네트 앞 블로커에 걸리는 궤적 감점(0=끔, 실험용 노브)
const NET_GUARD = 100;      // 네트 ±이 거리를 '블록 구역'으로 본다
const ADAPT_W = 60;          // 경기 중 구역 학습 가중치(0=끔). 낙하 구역별 득점률로 조준 보정
/* v11-4: 적응형 수비 (상대 강타 착지 학습). **v11-5(JUMP_ALIGN=40) 이후 이득으로 반전 → 채택.**
 * [경위] 처음엔 손해였다(OFF 2215 vs ON 2151). 당시 실패 원인은 "네트로 나가면 뒤가 빈다"였는데,
 *   v11-5로 뒷벽 실점이 15건->0건이 되면서 그 비용이 사라졌다.
 * [재측정] 40랠리 경기 벤치(bot-dev/_match.mjs), HOLD=12:
 *   학습시드 2828 -> 2900 / **검증시드(전혀 다른 값) 2817 -> 2910 (+2.5%)**. 일관됨.
 * [한계] 이득은 전부 v9전에서 나온다(429->500). **Jayce/kyu15는 483/720으로 미동.**
 *   그쪽은 강타 실점 자체는 13->4로 줄지만(효과 있음) 그만큼 뒤쪽 실점이 늘어 상쇄된다
 *   — 네트와 뒤를 동시에 못 지키는 구조적 트레이드오프.
 * [부수 발견] 학습이 걸리는 조건(상대 공중 + 공이 상대 코트)은 랠리당 1~2틱뿐이라
 *   그냥 두면 1틱 지시 = 3프레임 = 18px만 움직이고 원위치로 돌아가 아무 효과가 없다.
 *   DFN_HOLD로 목표를 붙잡아야 실제로 이동한다. (효과가 없어 보이던 초기 측정의 원인)
 * 코드는 노브로 남긴다 — 상대가 바뀌면(로브를 안 쓰는 상대) 유효할 수 있다.
 *
 * [원래 근거 — 예측 가능성 자체는 확인됨]
 * 근거(bot-dev/_adapt_check.mjs): 상대가 룰베이스라 강타 착지점이 결정적이다.
 * kyu_v15에게 진 강타 20건이 단 4개 상황으로 수렴하고, 각 상황의 착지점 분산이 0.
 * 강타 4틱(12프레임) 전 상태를 키로 잡으면 그때 필요한 이동은 46~100px이고
 * 12프레임이면 72px 걷기 + 몸 32 = 104px까지 닿으므로 전부 커버 가능.
 * → 실점한 강타의 (상황키 → 착지점)을 기억해뒀다가, 같은 상황이 오면 미리 그 자리로 간다.
 * 정적으로 네트에 붙는 것(DEF_FRAC↑)은 뒤쪽 실점이 폭증해서 실패했지만(12→55),
 * 이건 '그 상황에서만' 움직이므로 평상시 수비를 해치지 않는다. */
const DFN_LEARN = 1;        // 1=적응형 수비 켬 (v11-5 이후 조건이 바뀌어 이득으로 반전)
const DFN_LEAD = 4;         // 강타 몇 틱 전 상태를 키로 쓸지
const DFN_BX = 24;          // 상황키 x 구간 폭
const DFN_BY = 30;          // 상황키 y 구간 폭
const DFN_MIN = 1;          // 이 횟수 이상 실점한 상황부터 반응
const DFN_HOLD = 12;        // 학습 목표를 붙잡는 틱 수(1틱 지시는 18px만 움직여 무효)
/* v11-6: DFN_BACK — 학습된 강타 착지점보다 이만큼 '뒤'(내 벽 쪽)에 선다. **핵심 개선.**
 * [결과] 40랠리 경기 벤치: 0 -> 2900/3600, 48 -> 3286, 56 -> 3300 / 검증시드 48 -> 3272, 52 -> 3278.
 *   Jayce/kyu15 483/720 -> 684/720 (67% -> 95%). 15랠리 경기도 183 -> 234, 10랠리 123 -> 144.
 * [형태] 32·40 -> 2804(무효), 48~56 평지, 64·80 -> 2865(무효). 절벽이므로 값을 함부로 바꾸지 말 것.
 * [왜 되나 — 측정된 메커니즘] 위치가 좋아서 '받는' 게 아니다. 상대(Jayce 계열)는 opp_can_reach로
 *   우리 x를 보고 킬각을 계산한다. 184에 서면 뒤가 '도달 불가'라 평타 드라이브(vx-20,vy≈0, 13프레임에
 *   x≈26 착지)를 꽂고, 착지점-48~56(x≈130~150)에 서면 앞뒤 어느 쪽도 킬이 안 나와 공격을 포기한다.
 *   실측: 상대의 네트앞 샷 10회(평타 7) -> 3회(평타 0). **상대가 킬을 포기하게 만드는 위치**다.
 * [주의] 정적으로 그 자리에 서는 것(DEF_FRAC 0.62)은 1809/3600(Jayce 18/720)로 붕괴한다.
 *   '상대가 강타를 결정하는 그 순간'에만 가야 하므로 학습(DFN_LEARN) 없이는 성립하지 않는다.
 * [기하] 강타(착지 176~208, 3~5프레임)는 ±50 안 = x>=126 필요, 평타드라이브(x≈26, 13프레임)는
 *   72px 이내 = x<=130 필요 -> 교집합 x≈126~130. 52는 그 평지의 중앙값. */
const DFN_BACK = 52;
/* 실험(기본 OFF): 학습 목표가 멀면 걷지 않고 다이빙으로 '슬라이딩'.
 * 결과: 3303 -> 2818 (Jayce/kyu15 684 -> 483). 두 가지 이유.
 *  (1) 다이빙은 12프레임 체공 x 8px = 최대 96px(걷기 72)로 겨우 +24px인데, 착지 후 5프레임 누움(불능).
 *  (2) 더 근본적으로 상대(Jayce/kyu_v15)는 공중에서도 **매 틱 우리 x를 보고 조준을 다시 고른다**
 *      (Jayce_v1.py:786 score_air_action/choose_air_policy, kyu_v15.js:397-398). 네트로 달려들면
 *      뒤로 평타 드라이브를 꽂는다. "특정 상태 -> 무조건 스파이크"가 아니라 "우리 위치의 함수".
 *      그래서 예측해서 받으러 가는 전략은 성립하지 않고, 킬이 안 나오는 위치(DFN_BACK)가 답이다. */
const DFN_DIVE = 0;         // 학습 목표가 멀면 다이빙(1=켬) — 실측 손해, 끔
/* v11-7: 오프셋 온라인 적응 — "DFN_BACK=52는 Jayce 맞춤 아닌가"에 대한 답. (bot-dev/_robust.mjs)
 * 검사: Jayce의 도달 판정 상수를 흔든 변종(reach±40, WALK_SPEED 5/8)에 고정 52를 넣어보니
 *   walk8(우리를 빠르다고 보는 상대)에서 330/720로 BACK=0(421)보다 나쁘고, reach-40에서는 483(무효).
 *   → 52는 Jayce 계열 문턱값에 맞춰진 값이 맞다. 착지점 '학습'은 상대 무관하지만 오프셋은 아니었다.
 * 해법: 키별 오프셋 back을 실점 방향으로 STEP씩 조정(공이 우리 뒤로 갔으면 더 뒤에, 앞에 꽂혔으면 더 앞에).
 *   결과(변종): base 684 유지, walk8 330->481(검증시드 359->458). 실제 상대 5종 검증시드 3278->3309.
 *   15랠리 짧은 경기에서는 중립(1177 vs 1175). 시작값 52는 알려진 상대(Jayce/kyu15)용 사전값이고,
 *   모르는 상대에선 스스로 교정된다. 한계: reach-40(더 공격적 킬 판정)에선 어떤 오프셋도 483 —
 *   '킬이 안 나오는 위치'가 우리 리치 안에 없는 상대에겐 이 접근 자체가 무력하다. */
const DFN_ADAPT_BACK = 1;   // 키별 오프셋을 실점 방향으로 조정(1=켬)
const DFN_ADAPT_STEP = 24;
const DFN_DIVE_MIN = 40;    // 이 거리 이상일 때만 다이빙
const FREEZE_USE = 0;       // 상대 다이빙/누움 경직을 조준에 반영(0=끔, 1=반영)
const SERVE_LOB_AFTER = 2;  // 상대의 네트 앞 블록 시도를 이만큼 목격하면 이후 서브는 로브(0=끔)
// v10: 공이 상대 코트에 있는 동안의 수비 자세 (Jayce처럼 강하게 때리는 상대 대응)
const DEF_FRAC = 0.52;      // 수비 대기 위치 비율(내 코트 안, 0=벽 1=네트). 상대 공격 대기용
const DEF_DB = 10;          // 수비 이동 데드밴드(px). 1결정=18px 이동이라 작으면 제자리 진동,
                            // 너무 크면 굼떠서 스매시를 못 쫓아간다. 9~11이 안정 구간(Jayce 실측).
const DEF_ANTICIP = 1;      // 0=고정 대기, 1=상대 위치로 약간 보정, 2=상대 타점→스매시 착지 예측
const DEF_SMASH_VX = 20;    // 상대 스매시의 가로 속도 가정(px/f)
const DEF_SMASH_T = 3;      // 스매시 타점→착지까지 가정 프레임
const DEF_MIX = 0.5;        // 예측 착지점 반영 비율(0=기본위치만, 1=예측만)
const DEPTH_W = 0;          // 상대 코트 구석(네트앞/뒷벽) 선호 가중치(0=끔)
/* v11-1: 통과탄(through-ball) 가점.
 * v10의 margin은 '착지점'까지의 거리만 본다 → 착지점이 멀어도 날아가는 도중에
 * 상대 히트박스를 지나가면 그냥 받아친다. 실측(bot-dev/_aim_gap.mjs): vs Jayce
 * 상대서브 4패 중 3패가 '우리 스매시가 되받혀서 실점'.
 * → Jayce_v1의 opp_can_reach 방식으로 비행 경로 '매 프레임' 상대 도달 가능성을 세고,
 *   한 번도 안 걸리면(요격 창 0) 확정 킬로 보고 크게 가점한다. */
/* 실측 결과: 5시드 300랠리 벤치(bot-dev/_sweep.mjs)에서 어떤 가중치도 끄는 것보다
 * 나쁘다 (off 231/300, PEN=3 228, PEN=6 222, PEN=15 214, W=900 상당히 악화).
 * Jayce전은 30/60으로 어느 설정에서도 미동 없음 → Jayce전 패인은 조준이 아니다.
 * 기능은 노브로 남기되 기본 off. */
const PASS_W = 0;           // 요격 창 0(통과탄) 가점  (0=끔)
const PASS_PEN = 0;         // 요격 창 1프레임당 감점  (0=끔)
const MIRROR_NORM = 1;      // v11-2: 좌우 미러 정규화(1=켬)
/* v11-3 시도: 네트앞 강타(수직 내려꽂기) 방어 — 실패, 미채택.
 * 조사 결과(bot-dev/_spike_*.mjs):
 *  - Jayce/kyu_v15 상대 35패 중 20패가 강타(vy>=25)로 인한 실점.
 *  - 그러나 강타 접촉 → 착지 예산이 3~5프레임뿐(결정 기회 0~1회, 이동 12~24px).
 *    필요 이동은 중앙 76px → 맞고 나서 반응하는 것은 물리적으로 불가능.
 *  - 정위치를 네트로 당기는 것은 로브에 져서 더 나쁘다
 *    (DEF_FRAC 0.52→240/300, 0.58→210, 0.64→207, 0.70→198).
 *  - 강타 자세 사전 감지(상대 state2 + 공중 하강, 선행 12~15프레임)도 시도했으나
 *    **강타 시점의 우리 위치가 가드 on/off에서 동일(중앙 x=180)**이라 효과가 없었다.
 *    즉 봇은 이미 네트 근처에 가 있고, 지는 케이스는 그 전에 다른 곳으로 끌려간
 *    소수 상황이라 이 시점의 개입으로는 못 고친다. (실측 218/300 vs 미적용 240/300)
 *  → 남은 방향은 '강타 시점 대응'이 아니라 '그 전에 끌려가지 않게 하는 것',
 *    또는 우리 리턴이 애초에 강타당하기 좋은 공을 안 주는 것. */
//@PARAMS_END

let prevMeY = PLAYER_GY, loggedThisJump = false, loggedFields = false;
// 터치 리밋(한쪽 연속 5회 접촉 = 실점) 대비: 내 연속 접촉 수 추정. ELP는 선수 접촉 때만 바뀐다.
let prevELP = null, prevOnMySide = null, myTouches = 0, prevRally = -1;
// 상대가 '네트 블로커'인지 경기 중에 학습: 우리 공이 네트를 넘을 때 상대가 네트 앞에서 공중에 있었는가
let oppBlockCount = 0, oppWasAirNet = false, lastNetIntercept = -999, prevOppScore = -1;
// 경기 중 상대 학습: 상대 코트를 구역으로 나눠 "어디로 보냈을 때 득점했는지" 성공률 누적
const ZONES = 6;
let zoneWin = new Array(ZONES).fill(1), zoneTry = new Array(ZONES).fill(2);  // 낙관적 초기화(사전확률 50%)
let lastAimZone = -1, prevSelfScore = -1;
/* v11-4: 상황키 → 실점 착지점 학습표. 키는 LEFT 정규화 좌표 기준. */
let dfnTable = Object.create(null);      // key -> {land, n}
let dfnHist = [];                        // 이번 랠리의 틱별 상황키
let dfnPrevHist = [];                    // 직전 랠리의 것(실점은 다음 랠리 첫 틱에 감지됨)
let dfnLastBall = null;                  // 직전 랠리에서 마지막으로 본 공 x(정규화)
let dfnPrevRally = -1;                   // prevRally는 위에서 이미 갱신되므로 별도 추적
/* 학습 목표는 '한 틱'만 참인 조건에서 나온다(상대가 공중인 순간은 1~2틱뿐).
 * 그런데 1틱 지시는 3프레임=18px만 움직이고 원위치로 돌아가 효과가 없다(실측).
 * → 한 번 걸리면 DFN_HOLD 틱 동안 목표를 물고 있는다. */
let dfnLatch = null, dfnLatchLeft = 0;
let dfnLatchBack = 0, dfnUsedKey = null, dfnPrevUsedKey = null;   // 오프셋 적응용
let dfnPrevOppScore = -1;
function dfnKey(bx, by) {
  return 'b' + (Math.floor(bx / DFN_BX) * DFN_BX) + '_' + (Math.floor(by / DFN_BY) * DFN_BY);
}
function zoneOf(landX, isP2) {                    // 상대 코트를 6등분 (0=네트쪽 … 5=구석)
  const rel = isP2 ? (NET_X - landX) / NET_X : (landX - NET_X) / NET_X;
  const z = Math.floor(rel * ZONES);
  return z < 0 ? 0 : z >= ZONES ? ZONES - 1 : z;
}
function zoneScore(z) { return zoneWin[z] / zoneTry[z]; }   // 0~1

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
// k프레임 안에 상대가 도달할 수 있는 최소 y(점프 타이밍을 자유롭게 고른다고 가정)
const MIN_JUMP_Y = (() => { const a = []; let m = PLAYER_GY; for (let k = 0; k < 40; k++) { m = Math.min(m, JUMP_Y[Math.min(k, JUMP_Y.length - 1)]); a.push(m); } return a; })();
// 네트 앞 블로커 대응: 이 궤적이 상대 몸(가로 32+걸음, 세로 점프 사정권)에 걸리는가
function blockRisk(bx, by, vx, vy, oppX) {
  let x = bx, y = by, ux = vx, uy = vy, worst = -999;
  for (let k = 1; k <= 40; k++) {
    if (x + ux < 0 || x + ux > GW) ux = -ux;
    if (y + uy < 0) uy = 1;
    if (Math.abs(x - NET_X) < NET_HALF && y > NTT) { if (y < NTB) { if (uy > 0) uy = -uy; } else return 1; }
    if (y + uy > BALL_GY) break;
    y += uy; x += ux; uy += 1;
    // 네트 구역에서 가로채이는 경우만 '블록'으로 본다(깊은 곳 리시브는 margin이 이미 반영)
    if (Math.abs(x - NET_X) < NET_GUARD && Math.abs(x - oppX) <= HALF + 6 * k) {
      const over = y - (MIN_JUMP_Y[Math.min(k, 39)] - HALF);   // >0 이면 상대 사정권 안으로 지나감
      if (over > worst) worst = over;
    }
  }
  return worst <= 0 ? 0 : Math.min(1, worst / 120);   // 0(완전히 넘김) ~ 1(정면으로 들어감)
}
/* v11-1: 요격 창(oppWindow) — 이 궤적을 상대가 '몇 프레임이나' 건드릴 수 있는가.
 * Jayce_v1.py의 opp_can_reach 이식:
 *   - 상대 코트 밖이면 불가
 *   - y < 76 (점프 최고 도달보다 높음) 이면 불가
 *   - y < 212 (점프로만 닿는 높이)인데 히트 후 5프레임 미만이면 준비 시간 부족으로 불가
 *   - 걷기 도달 거리(6px/f + 몸 여유) 안이어야 가능
 * 반환 0 = 어떤 무빙·점프로도 못 받는 통과탄. 프레임당 65px+로 날아가는 공이
 * 히트박스를 '프레임 사이로' 지나가는 경우도 이 방식이면 잡힌다. */
function oppWindow(bx, by, vx, vy, oppX, isP2) {
  let x = bx, y = by, ux = vx, uy = vy, win = 0;
  const oppMin = isP2 ? HALF : NET_X + HALF;          // 상대가 설 수 있는 x 범위
  const oppMax = isP2 ? NET_X - HALF : GW - HALF;
  for (let k = 1; k <= 60; k++) {
    if (x + ux < 0 || x + ux > GW) ux = -ux;
    if (y + uy < 0) uy = 1;
    if (Math.abs(x - NET_X) < NET_HALF && y > NTT) {
      if (y < NTB) { if (uy > 0) uy = -uy; }
      else return 99;                                  // 네트 몸통에 막힘 = 최악
    }
    if (y + uy > BALL_GY) break;                       // 착지
    y += uy; x += ux; uy += 1;
    if (x < oppMin - HALF || x > oppMax + HALF) continue;
    if (y < 76) continue;                              // 점프로도 못 닿는 높이
    if (y < 212 && k < 5) continue;                    // 점프 준비 시간 부족
    if (Math.abs(x - oppX) <= 6 * k + 40) win++;       // 걸어서 도달 가능
  }
  return win;
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
function choosePowerHit(ball, oppX, isP2, oppFrozen) {
  const frozen = oppFrozen || 0;   // 상대가 못 움직이는 프레임 수(다이빙 state3 / 누움 state4)
  let best = null;
  for (const xDir of [1, 0]) for (const yDir of [-1, 0, 1]) {
    const f = powerHitLanding(xDir, yDir, ball.x, ball.y, ball.yVelocity);
    const oppSide = isP2 ? f.x < NET_X : f.x > NET_X;
    if (!oppSide) continue;
    // 상대가 비행시간 동안 6px/f로 이동 + 몸 32 + 다이빙 여유 → 그래도 남는 거리
    // 상대가 다이빙·누움 중이면 그 프레임만큼은 못 움직인다 → 그만큼 더 멀리 보낼 수 있다
    const margin = Math.abs(f.x - oppX) - Math.min(6 * Math.max(0, f.frames - frozen), 200) - HALF;
    // 상대가 네트 앞에 붙어 있으면(블로커) 몸에 걸리는 궤적을 감점 — 그 위로 넘기는 로브가 정답
    let pen = 0;
    if (BLOCK_PEN > 0) {
      const vx0 = ball.x < NET_X ? (Math.abs(xDir) + 1) * 10 : -(Math.abs(xDir) + 1) * 10;
      const vy0 = Math.max(Math.abs(ball.yVelocity), 15) * yDir * 2;
      pen = BLOCK_PEN * blockRisk(ball.x, ball.y, vx0, vy0, oppX);
    }
    // 경기 중 학습한 구역 성공률을 가중 — 상대가 실제로 못 받는 곳으로 수렴
    const zb = ADAPT_W > 0 ? ADAPT_W * (zoneScore(zoneOf(f.x, isP2)) - 0.5) * 2 : 0;
    /* v10: 상대 코트 '깊이' 보상.
     * Jayce 같은 강한 상대는 자기 코트 한가운데 떨어지는 공을 편하게 밟고 서서
     * 강스매시로 되돌려준다(실측: 우리 로브가 x=300에 떨어지자 vy=33으로 반격).
     * 네트 바로 뒤(짧게)나 뒷벽(깊게) 구석으로 보낼수록 상대가 때리기 어렵다.
     * → 상대 코트 중앙에서 멀수록 가점. */
    const oppMid = isP2 ? NET_X / 2 : NET_X + NET_X / 2;   // 상대 코트 중앙
    const depth = DEPTH_W > 0 ? DEPTH_W * (Math.abs(f.x - oppMid) / (NET_X / 2)) : 0;
    /* v11-1: 요격 창 반영. 창이 0이면 통과탄(확정 킬) → 큰 가점,
     * 창이 넓을수록 되받힐 확률이 높으므로 프레임당 감점. */
    let passB = 0;
    if (PASS_W > 0 || PASS_PEN > 0) {
      const vx0 = ball.x < NET_X ? (Math.abs(xDir) + 1) * 10 : -(Math.abs(xDir) + 1) * 10;
      const vy0 = Math.max(Math.abs(ball.yVelocity), 15) * yDir * 2;
      const win = oppWindow(ball.x, ball.y, vx0, vy0, oppX, isP2);
      passB = win === 0 ? PASS_W : -PASS_PEN * Math.min(win, 30);
    }
    const score = margin + (yDir === 1 ? 15 : 0) - f.frames * 0.5 - pen + zb + depth + passB;
    if (!best || score > best.score) best = { xDir, yDir, score, land: f.x, frames: f.frames, margin, pen, zone: zoneOf(f.x, isP2), passB };
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
/* ── v11-2: 좌우 미러 정규화 (Keun_v1의 설계를 이식) ──────────────────────
 * 전략 코드를 항상 "나는 LEFT" 좌표계에서만 돌린다. RIGHT면 세계를 미러(x -> 432-x)해서
 * 넣고 결과의 x만 뒤집는다.
 * 이유(Keun 주석): 사이드 분기를 없앨 뿐 아니라, 동점 처리(tie-break)가 사이드에
 * 휘둘리지 않게 한다. 후보를 훑는 루프가 +x를 -x보다 먼저 보면 한쪽 사이드에만
 * 유리한 숨은 방향 편향이 생기는데, 미러링이 이를 제거한다.
 * 주의: 모르는 필드(당일 추가될 게이지 등)는 얕은 복사로 그대로 통과시킨다.
 *       이렇게 하지 않으면 새 필드가 RIGHT 경로에서만 사라져 좌우 비대칭이 생긴다. */
function mirrorPlayer(p) {
  if (!p) return p;
  const q = Object.assign({}, p);
  q.x = GW - p.x;
  if (typeof p.divingDirection === 'number') q.divingDirection = -p.divingDirection;
  return q;
}
function mirrorSnapshot(s) {
  const m = Object.assign({}, s);
  m.side = 'LEFT';
  m.self = mirrorPlayer(s.self);
  m.opp = mirrorPlayer(s.opp);
  const b = Object.assign({}, s.ball);
  b.x = GW - s.ball.x;
  b.xVelocity = -s.ball.xVelocity;
  if (typeof s.ball.expectedLandingPointX === 'number')
    b.expectedLandingPointX = GW - s.ball.expectedLandingPointX;
  m.ball = b;
  const meta = Object.assign({}, s.meta);
  // isPlayer2Serve 는 "P2(=RIGHT)가 서브인가". 미러 세계에서 나는 LEFT이므로
  // '상대가 서브인가'가 유지되도록 뒤집는다.
  meta.isPlayer2Serve = !s.meta.isPlayer2Serve;
  if (s.meta.score) meta.score = { self: s.meta.score.self, opp: s.meta.score.opp };
  m.meta = meta;
  return m;
}
/* 미러 래퍼: RIGHT면 미러해서 LEFT 경로로 돌리고 x만 되돌린다. */
function v9Decide(s) {
  if (MIRROR_NORM && s.side === 'RIGHT') {
    const a = v9Core(mirrorSnapshot(s));
    return { x: -a.x, y: a.y, hit: a.hit };
  }
  return v9Core(s);
}
function v9Core(s) {
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
  // 내 서브 진행 중인가(랠리 초반 + 공이 아직 네트를 안 넘음 + 옆속도 거의 0)
  const iServe = isLeft ? !s.meta.isPlayer2Serve : s.meta.isPlayer2Serve;
  const isServeNow = iServe && s.meta.rallyFrameCount < 40 && onMySide && Math.abs(ball.xVelocity) < 3;
  // 블로커 감지(엣지): 공이 네트 근처에 있는 동안 상대가 네트 앞에서 점프 중이면 1회 카운트
  const oppAirNet = (opp.state === 1 || opp.state === 2) && Math.abs(opp.x - NET_X) < 75 && Math.abs(ball.x - NET_X) < 110;
  if (oppAirNet && !oppWasAirNet) lastNetIntercept = s.tick;
  oppWasAirNet = oppAirNet;
  // "네트 앞 가로채기 직후 실점"만 블록으로 집계 — 평범한 네트 앞 공격과 구분
  const oppScore = s.meta && s.meta.score ? s.meta.score.opp : 0;
  const selfScore = s.meta && s.meta.score ? s.meta.score.self : 0;
  if (prevOppScore >= 0 && oppScore > prevOppScore && s.tick - lastNetIntercept < 12) oppBlockCount++;
  if (selfScore === 0 && oppScore === 0 && (prevSelfScore > 0 || prevOppScore > 0)) {   // 새 경기 → 학습 초기화
    zoneWin = new Array(ZONES).fill(1); zoneTry = new Array(ZONES).fill(2); oppBlockCount = 0;
    dfnTable = Object.create(null); dfnHist = [];
  }
  if (prevSelfScore >= 0 && lastAimZone >= 0) {          // 직전 포인트 결과를 조준 구역에 반영
    if (selfScore > prevSelfScore) { zoneWin[lastAimZone] += 1; zoneTry[lastAimZone] += 1; lastAimZone = -1; }
    else if (oppScore > prevOppScore) { zoneTry[lastAimZone] += 1; lastAimZone = -1; }
  }
  prevOppScore = oppScore; prevSelfScore = selfScore;
  const oppIsBlocker = oppBlockCount >= SERVE_LOB_AFTER;
  // 상대 경직 프레임: state 4(누움)=약 5, state 3(다이빙 중)=약 4 — 이 동안 상대는 이동 불가
  const oppFrozenFrames = FREEZE_USE > 0 ? (opp.state === 4 ? 5 : opp.state === 3 ? 4 : 0) * FREEZE_USE : 0;
  let x = 0, y = 0, hit = 0;

  const walkTo = (tx, db) => { tx = tx < moveMin ? moveMin : tx > moveMax ? moveMax : tx;
    const d = tx - me.x; const band = db === undefined ? WALK_DB : db;
    return Math.abs(d) > band ? (d > 0 ? 1 : -1) : 0; };
  /* 공이 상대 코트에 있을 때의 수비 위치.
   * fl.x(자유낙하 예측)는 상대가 반드시 공을 치므로 무의미하다 — 그걸 좇으면
   * 코트 구석에 서서 진동하다가 상대 스매시에 못 닿는다(Jayce전 실측).
   * 대신 상대의 '타점'을 예측하고, 거기서 나올 스매시가 떨어질 곳을 막는다.
   *   - 강한 상대(Jayce)의 결정타는 네트 바로 뒤(내 코트 네트쪽 40~60px)에 꽂힌다.
   *   - 스매시는 xVelocity 약 ±20이고 타점 높이에서 바닥까지 ~6~8프레임이므로
   *     낙하점 ≈ 타점x + 20*프레임 → 네트 근처. 그래서 기본 수비는 네트 쪽으로 당긴다.
   *   - 다만 로브/구석 공도 있으므로 완전히 네트에 붙지는 않고 DEF_FRAC로 조절. */
  const defendX = () => {
    /* v11-4: 이 상황에서 전에 강타로 실점한 적이 있으면 그 착지점으로 미리 간다. */
    if (DFN_LEARN) {
      const oppAir = (opp.state === 1 || opp.state === 2);
      const ballOpp = isLeft ? ball.x >= NET_X : ball.x < NET_X;
      if (oppAir && ballOpp) {
        const nbx = isLeft ? ball.x : GW - ball.x;
        const e = dfnTable[dfnKey(nbx, ball.y)];
        if (e && e.n >= DFN_MIN) { dfnLatch = e.land; dfnLatchBack = (DFN_ADAPT_BACK && e.back !== undefined) ? e.back : DFN_BACK; dfnLatchLeft = DFN_HOLD; dfnUsedKey = dfnKey(nbx, ball.y); }
      }
      if (dfnLatchLeft > 0 && dfnLatch !== null) {
        dfnLatchLeft--;
        const tgt = dfnLatch - dfnLatchBack;
        return isLeft ? tgt : GW - tgt;
      }
    }
    if (!DEF_ANTICIP) return standbyX;
    const base = isLeft ? NET_X * DEF_FRAC : GW - NET_X * DEF_FRAC;
    if (DEF_ANTICIP < 2) {
      const oppOff = (opp.x - NET_X) / NET_X;
      return base - towardNet * oppOff * 18;
    }
    /* DEF_ANTICIP=2: 상대 타점 기반 예측.
     * 공이 상대 코트에서 하강 중이면 상대는 그 근처에서 때린다고 보고,
     * 그 타점에서 네트를 향한 스매시(vx≈±20, 낙하까지 tf프레임)의 착지점을 계산. */
    const contactX = fl.x;                    // 상대가 치기 전 자유낙하 예측 = 대략적 타점
    const tf = DEF_SMASH_T;                   // 스매시 후 바닥까지 대략 프레임
    let land = contactX + towardNet * DEF_SMASH_VX * tf;   // 내 코트 쪽으로 날아오는 착지점
    // 내 코트 범위로 클램프
    const lo = isLeft ? 0 : NET_X, hi = isLeft ? NET_X : GW;
    if (land < lo) land = lo; if (land > hi) land = hi;
    // 예측 착지점과 기본 수비 위치를 섞는다(예측이 틀려도 크게 안 벗어나게)
    return base + (land - base) * DEF_MIX;
  };
  // 다이빙/누움 중: 입력 무의미
  if (me.state === 3 || me.state === 4) return skillPolicy(s, { x: 0, y: 0, hit: 0 });

  if (me.state === 0) {
    loggedThisJump = false;
    if (!ballMine) {
      const dx0 = defendX();
      if (DFN_DIVE && dfnLatchLeft > 0 && dfnLatch !== null && Math.abs(dx0 - me.x) >= DFN_DIVE_MIN)
        return skillPolicy(s, { x: dx0 > me.x ? 1 : -1, y: 0, hit: 1 });   // 지상 + 방향 + hit = 다이빙
      return skillPolicy(s, { x: walkTo(dx0, DEF_DB), y: 0, hit: 0 });
    }

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
  if (!ballMine) {                       // 내 스매시 직후 등: 공중에서도 수비 위치로 복귀
    return skillPolicy(s, { x: walkTo(defendX(), DEF_DB), y: 0, hit: 0 });
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
      // 서브 상황에서 상대가 네트로 달려오면 로브(y=-1)로 넘긴다.
      // 서브 로브는 네트 통과 높이 y≈3~28로, 상대 점프 최고 도달(y76)보다 위 → 물리적으로 블록 불가.
      if (SERVE_LOB_AFTER > 0 && isServeNow && oppIsBlocker) y = -1;
      // 접촉 순간 |x|가 공 속도를 정함(1→20, 0→10). 방향은 추적 방향 유지.
      if (shot.xDir === 0) x = 0; else if (x === 0) x = tdx >= 0 ? 1 : -1;
      hit = 1;
      if (shot.zone !== undefined) lastAimZone = shot.zone;
      if (DEBUG && !loggedThisJump) { console.log(`[OurBot ${s.side}] SMASH t${s.tick} ball(${ball.x | 0},${ball.y | 0}) self(${me.x | 0},${me.y | 0}) -> x${x} y${y} contact+${c.k}f(${c.x | 0},${c.y | 0}) land~${shot.land | 0} margin${shot.margin | 0}`); loggedThisJump = true; }
    }
  }
  return skillPolicy(s, { x, y, hit });
}