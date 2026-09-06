'use strict';
/* Lion_Eating_Bank_v8.js — v7 + v5_2 + v6_Defense 이식 (bot-dev/v8/build_v8.mjs 가 v7 에서 생성, STEP=5, PRED=kg, REACT=3). 손으로 고치지 말 것.
 *   근거·분류·검증: 문서 "Lion 4파일 병합 설계"(2026-09-04). 단계별 내용은 build_v8.mjs 머리말.
 *   STEP1 [EXP] v5_2 의 EXP_S2_TRACK(state2 delay 정확 추적)·oppModelOf/oppTouch(전지 수비수 L2 도달 모델)·체공 fly 킬 계획·EXP_DRIFT_ATTACK 을 v7 위에 병합.
 *   STEP2 [GATE] 확정킬 술어 노브(KILL_GATE.PREDICATE), kgOppMotion 누운 상대 재점프 누락 수정, 다이빙 운동학 13프레임 102px.
 *   STEP3 [RECV] 지상 리시브 자리를 실제 컨트롤러(3프레임 묶음·18px 격자) co-sim 으로 고른다(v6_Defense simWalkContact). 채점은 v7 우선순위 + 반사 궤적 전개.
 *   STEP4 [NEUTRAL] 위협이 없을 때의 대기 위치를 표준 네트앞 위협 집합 × v7 여유 모델로 유도(STANDBY_MODE). */
/* Lion_Eating_Bank_v7.js — 실험용(제출본 아님). = v6(v5_1 + 지상 스파이크 KILL-GATE) + [DEF] 수비 4변경. 손으로 고친 파일(생성기 없음), 2026-09-04.
 *   변경(DEF_CFG 노브로 각각 끌 수 있음, 0 = v6 동작):
 *     ① AIR_GATE        공중(state 1) 스매시에도 KILL-GATE. 거부되면 hit=0 몸터치 후보만 남음.
 *     ② NO_JUMP_RECEIVE findIntercept 의 리시브 점프 끔(리시브는 지상에서만).
 *     ③ NEW_DEF         defenseTarget 을 "상대 접촉 시점×샷 궤적 × 내 반응지연(REACT 3)·걷기·다이빙·상자 32" 최악 여유 최대화 모델로 교체(defenseTargetNew). 0 이면 v6 의 착지점 기반(defenseTargetV6).
 *     ④ ALWAYS_DEF      공이 상대 코트면 항상 defenseTarget(v6 는 상대 임박 시에만). STANDBY_OFF 92 = rally_escape/universal_x.mjs 안전 구간(x 112~136, 네트 기준 80~104) 중심.
 *     ⑤ OPP_FIRST       (추가 수정) 공이 상대 코트에 있고 상대가 넘어오기 전에 닿을 수 있으면(defOppContacts>0) 공격 분기(findFastAttack/findKillJump) 금지 → 수비 분기.
 *                       원인: 상대 썬더 토스(vx −3)의 예상 착지점이 우리 코트라 ballOurs=true 가 되고, CFG.BAND=0 이라 oppMayHit 가드도 꺼져 있어 findKillJump 가 "상대가 안 건드린다" 가정의 microSim 으로 킬을 찾아
 *                       상대 스파이크 2틱 전에 점프시켰음(v5_1·v6·v7 공통, rally_escape/serve_jump_trace.mjs 로 확인). 리시브 점프(findIntercept)가 아니라 공격 점프였다.
 *   벤치(bot-dev/sim_real, 지연1, 10점, 좌우 각 1경기): bot-dev/rally_escape/bench.mjs · ablate.mjs(노브 절제) · loss_diag_variant.mjs(패배 유형) · pos_diag.mjs(상대 마지막 타구 때 내 위치).
 *   ─ 미러/썬더 매치는 수비로 못 움직임: vs LionBC_v4 16-16, vs v5_1 21-11, vs v6 16-16 은 전부 서브권 결정(vs LionBC_v4 262랠리 = 내 서브 131승/상대 서브 131패, vs v5_1 525랠리 = 285/240; 노브와 무관하게 v5_1 과 랠리 기록이 완전히 같음). 썬더 서브는 어느 쪽도 못 받는다.
 *   ─ 16시드×2(bench.mjs 시드): 전체 켬 v7 = AC_v5_2 29-3 69% / NetCamper_v2 12-20 44% / RedTeam_RL_v1 31-1 74%  (v6 = 32-0 78% / 27-5 71% / 32-0 72%).
 *       절제(하나씩 끔, NetCamper/AC): -NEW_DEF 32-0 71% / 29-3 70%,  -AIR_GATE 21-11 54% / 32-0 87%,  -ALWAYS_DEF 21-11 58% / 32-0 86%,  -NO_JUMP 7-25 40% / 30-2 67%,  STANDBY 108 11-21 43% / 29-3 68%,  전체 끔 27-5 71% / 32-0 78% (= v6, 노브 복원 확인).
 *   ─ 48시드×2(생성 시드; 시드 세트에 따라 결과가 크게 흔들림 — 같은 v7 이 AC 69%→83%): 
 *       v6 85-11 72% / 93-3 75% / 92-4 74% / OurBot_v12 92-4 73%;  v7 전체 켬 40-56 46% / 95-1 83% / 90-6 75% / 94-2 79%;
 *       AIR_GATE 만 끔+ALWAYS_DEF 끔 89-7 65% / 96-0 84% / 96-0 90% / 96-0 95%;  NEW_DEF·AIR_GATE·ALWAYS_DEF 끔(= NO_JUMP+92) 95-1 76% / 87-9 73% / 96-0 87% / 96-0 91%;  92 만(=v6+STANDBY 92) 96-0 84% / 95-1 83% / 90-6 70% / 96-0 86%.
 *   ─ 진단: ① AIR_GATE 는 모든 상대에서 손해(거부 후 hit=0 몸터치가 쌓여 touchLimit 패, vs NetCamper 26회/8시드; AC 상대 긴 랠리 패 31→53). ③ NEW_DEF 는 NetCamper 에 특히 손해: 진 랠리에서 상대 마지막 파워히트 순간 |내 x − 착지 x| 중앙값 78·p75 86(v6 모델 67) — 6종 파워히트+3종 몸리시브의 최악값이 먼 샷에 끌려 실제 날아오는 급강하에서 멀어짐. ② NO_JUMP 와 ④ 는 상대별 득실이 갈림.
 *   ─ 96시드×2 = 192경기/칸 (ablate.mjs ... 96 ..., 상대 순서 NetCamper_v2 / AC_v5_2 / RedTeam_RL_v1 / OurBot_v12):
 *       v6(STANDBY 108)                    174-18 72% / 186-6 76% / 181-11 72% / 186-6 74%
 *       v6 + STANDBY 80                    192-0 81% / 172-20 70% / 161-31 68% / 191-1 89%
 *       v6 + STANDBY 84                    191-1 86% / 171-21 73% / 181-11 71% / 192-0 93%
 *       v6 + STANDBY 88·92·96(경기 동일)   192-0 85% / 191-1 84% / 179-13 70% / 192-0 86%   (96 은 랠리 80/81/70/86)
 *       v6 + STANDBY 100                   174-18 70% / 187-5 75% / 181-11 72% / 187-5 74%   (= v6)
 *       NO_JUMP + 92                       191-1 76% / 175-17 73% / 192-0 86% / 192-0 91%
 *       NO_JUMP + NEW_DEF + 92             170-22 64% / 192-0 86% / 192-0 89% / 192-0 95%
 *       v7 전체 켬                         74-118 45% / 191-1 85% / 178-14 74% / 189-3 79%
 *   판정: 계획대로 전부 켠 v7 은 v6 대비 회귀(NetCamper 74-118). 4변경 중 살아남은 것은 "대기 위치 92"뿐: v6 + STANDBY_OFF 92(= 이 파일에서 AIR_GATE·NO_JUMP_RECEIVE·NEW_DEF·ALWAYS_DEF 모두 0)가 v6 를 3상대에서 지배하고 RedTeam 은 오차 안(179-13 vs 181-11). 88~96 은 고원, 100 부터 v6 로 되돌아감.
 *   ─ OPP_FIRST 수정 후 (96시드×2, 상대 순서 NetCamper / AC / RedTeam / OurBot_v12 / v5_1 / LionBC_v4):
 *       v6                                 174-18 72% / 186-6 76% / 181-11 72% / 186-6 74% / 99-93 / 96-96
 *       v6 + 92, OPP_FIRST 0               192-0 85% / 191-1 84% / 179-13 70% / 192-0 86% / 99-93 / 96-96
 *       v6 + 92, OPP_FIRST 1  ← 권장       191-1 84% / 191-1 80% / 180-12 73% / 192-0 91% / 96-96 / 182-10 72%
 *       v7 전체 켬, OPP_FIRST 0            74-118 45% / 191-1 85% / 178-14 74% / 189-3 79% / 92-100 / 96-96
 *       v7 전체 켬, OPP_FIRST 1            65-127 44% / 150-42 59% / 179-13 76% / 174-18 63% / 109-83 / 188-4 74%
 *     OPP_FIRST 는 권장 구성에서 LionBC_v4(구 시퀀스 썬더)를 96-96 → 182-10 으로 바꿈: 상대 서브 랠리 214개 중 104개를 긴 랠리로 이김(전에는 0). v5_1(d=4 썬더)은 여전히 100% 서브권 결정(96-96), 미러(v7 vs v7)도 서버 100%.
 *     전체 켬 구성에서는 OPP_FIRST 가 AC·OurBot 을 크게 깎음(NEW_DEF 수비 위치로 강제되기 때문) — 전체 켬은 어차피 기각.
 *   ─ 좌우 비대칭(미해결 단서): 권장 구성 vs AC 내가 LEFT 47-1 랠리 71% / RIGHT 48-0 89%, vs LionBC_v4 LEFT 25-23 50% / RIGHT 45-3 66%. AC_v5_2 자기 미러도 LEFT 23-1, NetCamper_v2 미러는 RIGHT 21-3(OurBot_v12 미러는 12-12).
 *     AC 코어(우리가 쓰는 §2)에 좌우 의존이 있다는 뜻. 원인 미조사. bot-dev/rally_escape/side_split.mjs · mirror_any.mjs.
 *   (위 표들은 2026-09-04 낮의 절제 기록. 그 뒤 사용자 지시로 "봇 풀 벤치로 원칙 기능을 끄지 말고 구현의 빈틈을 고친다"로 방향을 바꿨다. 아래가 최종.)
 *
 *   ═══ 2026-09-04 최종: 원칙 구현 (DEF_CFG 전부 켬) ═══
 *   원칙: ① 수비는 최소 움직임으로 상대의 모든 경우를 막는 자리에 선다 ② 점프는 확정킬(카운터 포함)·안전한 넘기기(지상으로 못 넘길 때만)·썬더 서브에만 ③ 다이빙은 꼭 필요할 때만.
 *   구현(모두 DEF_CFG 노브, 0 이면 v6 동작):
 *     NEW_DEF+ALWAYS_DEF  상대 접촉 시점×샷 9종 궤적에 대한 내 최악 여유 최대화(반응 3·걷기 6·다이빙 8·상자 32). 공이 상대 코트에 있는 내내.
 *     MIN_MOVE            지금 자리가 모든 경우를 막으면 개선이 SAFE_HYST(24) 이상일 때만, 못 막으면 MOVE_HYST(4) 이상일 때만 이동. 서브 시작 구석(x36)에 머물지 않게 두 문턱.
 *     FAST_FIRST          모든 경우를 못 막을 때는 착지까지 FAST_STEPS(14) 이하인 빠른 샷의 여유부터 최대화(느린 샷은 반응 여지가 있다).
 *     NO_JUMP_RECEIVE     리시브 점프(findIntercept) 없음. 점프 출처는 findKillJump·findFastAttack(둘 다 KILL-GATE)·findPassJump·썬더뿐.
 *     OPP_FIRST           공이 상대 코트에 있고 상대가 먼저 닿을 수 있으면 공격 분기 금지(썬더 토스에 킬 점프 나가던 버그).
 *     GROUND_PASS         지상 몸리시브 자리(standX)를 microSimSeq 로 실제 접촉·튕김을 시뮬레이션해 고른다(착지점 가정은 수평 속도 큰 공에서 반대편에 맞아 뒤로 튐).
 *                         우선순위: 상대가 못 닿는 넘기기(점프 없는 득점) > 첫 터치 세트(hover, 킬 시도; SET_MAX_TOUCH) > 넘어가는 것 중 상대에서 먼 것. 걸어서 제때 갈 수 있는 자리만.
 *     PASS_JUMP           지상으로 넘길 후보가 없을 때만(벽 구석: 플레이어 최소 x 32 라 공 뒤로 못 들어가 수직으로만 튀어 터치초과) 점프+파워히트(방향이 항상 상대 쪽). 게이트 없음. y=1 제외.
 *     PASS_JUMP_COMMIT    의도한 점프(킬·빠른공격·넘기기) 뒤 20틱은 공중 정책의 AIR_GATE 면제 → 계획 실행. 누운 상대(state 4)를 근거로 승인한 킬이 1틱 뒤 재거부돼 허공에 뜨던 문제.
 *     KILL-GATE 보수화    스냅샷에 lyingDownDurationLeft 가 없으므로 누운 상대는 "다음 스텝에 일어난다"로 본다(전에는 3프레임 고정 → 과대평가).
 *     DIVE_MODEL          다이빙은 defReachSplit(수비 도달 모델과 같은 기하)로 "걸어서 못 닿고 다이빙으로 닿을 때"만. v5_1 식은 반폭을 안 빼 18px 옆 공에도 다이빙(RedTeam 170회 중 터치 67회).
 *     SAFE_PASS           공중 정책에서 상대 코트에 떨어지는 후보는 우리 코트에 남는 후보보다 항상 위(발동 사례는 관측 안 됨).
 *   도구: rally_escape/jump_stats.mjs(점프 출처·다이빙·터치초과) rally_trace.mjs(랠리 틱 추적) touchlimit_diag.mjs dive_diag.mjs serve_jump_trace.mjs mirror.mjs
 *   ─ 실제 Chrome (2026-09-04, bot-dev/harness/run.mjs, headless fast 30fps, winningScore 10, traceTouches; 빌드 scratch dist_v7):
 *       v7L-vs-AI 10:0, AI-vs-v7R 10:0 — 썬더 12회 전부 직접 득점(위상 0×8·1×1·2×3, 포기·예외 0), 착지 x 248(LEFT)/184(RIGHT) @f82~99 = 시뮬 기대와 일치.
 *       v7L-vs-NetCamper_v2 10:3, NetCamper_v2-vs-v7R 10:1 — 썬더 13회 중 직접 득점 2, 나머지는 캠퍼가 건드려도 이탈 평타가 x 387/45 깊은 곳에 착지해 득점(실패 1).
 *       결론: 브라우저 Worker 지연(1프레임)에서 썬더 위상·틱 정렬 정상. 수비 변경이 서브 시작 위치 가드를 깨지 않음.
 *       최종 파일(KILL_MAX_CONTACT 16) 재실측 dist_v7f: v7L-vs-NC 10:3·10:2, NC-vs-v7R 10:0·10:1, v7L-vs-AC 10:2, AC-vs-v7R 10:2 — 6/6 승, 예외 0, 썬더 vs AC 8/8 직접 득점.
 *   ─ "일반 공을 놓친다"(vs NetCamper_v2) 원인 분석 (rally_escape/miss_diag.mjs · killjump_repro.mjs · rally_trace.mjs):
 *       내 코트 착지 패배를 상대 마지막 타구 순간의 내 위치에서 도달 모델로 분류하면 대부분 "걷기·다이빙 어느 쪽으로도 못 닿음"(12시드 294랠리 중 50) = 위치 선정 이후의 킬샷.
 *       그중 "보통 공"처럼 보이는 두 사례의 진짜 원인:
 *       A. 상대 서브 로브(376,105 v−10,−30)가 천장을 맞고 39프레임 뒤 착지하는데, 접촉 17프레임 뒤를 가정한 킬 점프가 승인돼 t+2틱에 점프 →
 *          공중 재계획이 몸터치 후보로 바꿔 x 이동을 멈추고(132 에서 정지) 공은 발밑으로 → 착지. 수정: KILL_MAX_CONTACT 16(먼 접촉은 확정이 아님).
 *          KILL_COMMIT(빠른공격식 커밋)은 결과가 동일해 효과 없음 — 다른 사례에서는 커밋대로 스매시했지만 게이트가 못 닿는다고 본 평타를 네트 캠퍼가 받아냄(도달 모델의 외삽 한계).
 *       B. 벽 구석 공(x18): 계획은 standX 48 인데 walkTo 가 36→54 로 18px 걸음이라 과녁을 지나쳐 |18−54|=36>32 로 놓침. STAND_GRID(18px 격자 후보)와
 *          PASS_ROBUST(±6px 강건 후보만)는 둘 다 후보가 성겨져 넘기기 점프 폭증·승률 하락으로 기각. 남은 과제(발생 빈도 낮음).
 *       다이빙 오라클(rally_escape/dive_oracle.mjs: 진 랠리를 시드 재현으로 되감아 착지 전 1~8틱부터 강제 다이빙/걷기로 덮어쓰고 실제 엔진으로 확인):
 *         4상대 107개 내 코트 착지 패배 중 강제 다이빙으로 공을 건드릴 수 있던 것 23개, 그중 랠리를 이긴 것 0개. 건드릴 수 있던 경우는 전부 걷기로도 건드림(다이빙 이득 0).
 *         엔진 실측(dive_physics_probe.mjs): 다이빙 = 첫 프레임 +6, 이후 +8/프레임 × 10 = 11프레임 86px(걷기 66px), 몸 y 229~244, 착지 후 5프레임 누움. 즉 걷기 대비 +20px 뿐.
 *         → "다이빙으로 받을 수 있어 보이는데 안 한다"는 판단 오류가 아니라 실제로 못 닿는 공(3~6프레임 스파이크). 남는 문제는 상대 타구 순간의 위치(모든 경우 방어 자리의 타협).
 *       다이빙 모델 통일(diveBody, 엔진 실측): m=1 +6/y244, m=2..11 +8/프레임·y 239→229→239, m=12 y244, m=13..17 누움(이동 0)인데 누워서도 공에 닿는다(lying_touch_probe.mjs).
 *         KILL-GATE(상대)·defReachSlack(수비 위치)·defReachSplit(내 다이빙) 모두 같은 함수를 쓴다. 좌우 대칭이라 뒤로 다이빙 포함.
 *         "최대한 걷다가 마지막에 다이빙" = 도달식 6·(j−react) + diveBody(m).dx 의 j 최대화가 그것. 실행은 defReachSplit 의 diveNow(이번 틱 안에 시작해야 닿음)일 때만 다이빙,
 *         dive≥0 이지만 diveNow<0 이면(나중에 시작해야 닿음) 계속 걷는다 — 전에는 dive≥0 이면 즉시 다이빙해 너무 일찍 눕는 경로가 있었다(실전 발생 0회).
 *       [버그 수정] 위 다이빙 판정이 kgTrajectory(s.ball) 로 스냅샷(xVelocity/yVelocity)을 xV/yV 로 읽어 궤적이 NaN → 걷기·다이빙 여유가 항상 −∞였다(다이빙 0회의 진짜 이유).
 *         cloneBall(s.ball) 로 수정. 수정 뒤에도 실전 다이빙은 0회 = "걷기로 못 닿고 다이빙으로 닿는" 틱이 실제로 없음(reach_tally.mjs: 3926틱 중 0).
 *       [DIVE_HAILMARY] 모델상 못 닿는 공에 마지막 시도 다이빙: 48시드에서 랠리당 0.06~0.09회 발동, 득 0(RedTeam 87→86, OurBot 95→94) → 기본 0. 되감기 오라클과 같은 결론.
 *       [TOUCH_MARGIN] 진 랠리를 반응 3스텝 모델로 재분류하니 NetCamper 12시드 54패 중 37이 "걸어서 닿는데 놓침"이었다. 원인: 지상 리시브 계획이 넘기기 품질을 위해
 *         접촉 범위(±32) 가장자리 자리를 고르고 실제 이동은 18px 걸음이라 2~4px 차로 놓침(예: 스파이크 착지 264 에 296 을 골라 298 에서 34px, 벽 구석 공 x18 에 48 을 골라 54).
 *         후보를 빼지 않고 접촉 여유(32−|접촉x−자리|)가 9 미만이면 −500 −(9−여유)·50 감점하고 "상대가 못 닿는 넘기기" 보너스도 주지 않음. 재분류 결과 37 → 0(남은 23 은 못 닿는 킬샷).
 *         STAND_GRID·PASS_ROBUST 가 실패한 이유도 같은 문제를 "후보 삭제"로 풀어 후보가 성겨졌기 때문. 감점 방식이 답.
 *   ─ 최종 측정 (2026-09-04 밤, 48시드×2; jump_stats 는 경기마다 새 인스턴스, ablate 는 인스턴스 유지):
 *     랠리당 점프(썬더서브 / 킬점프 / 넘기기점프) · 다이빙 · 터치초과 패 · 랠리 승률
 *       AC_v5_2    0.89 / 0.51 / 0.18 · 0 · 0 · 95%      NetCamper_v2 0.60 / 0.55 / 0.38 · 0 · 0 · 78%      RedTeam_RL_v1 0.96 / 0.14 / 0.00 · 0 · 0 · 87%
 *       OurBot_v12 0.99 / 0.59 / 0.48 · 0 · 0 · 95%      LionBC_v4    0.85 / 0.10 / 0.19 · 0 · 0 · 81%      리시브 점프 0, 서브 때 리시버 점프 0(serve_jump_trace).
 *     회귀 벤치(96경기/칸, 상대 순서 NetCamper / AC / RedTeam / OurBot / v5_1 / LionBC_v4):
 *       v6(전부 끔)  85-11 72% / 93-3 75% / 92-4 73% / 92-4 73% / 48-48 / 48-48
 *       v7 최종      94-2 76% / 96-0 95% / 96-0 87% / 96-0 95% / 48-48 / 96-0 91%
 *     v6 대비 전 상대에서 경기 수·랠리율 모두 위. v5_1(d=4 썬더)·미러는 여전히 100% 서브권.
 *     시작 상태(계획 4변경 전부 켬, 빈틈 미수정)는 NetCamper 74-118 이었다 → 원칙이 아니라 구현 빈틈(터치초과·접촉점·허공 점프·다이빙 판정·킬 지평)이 원인이었음이 확인됨.
 *     기각된 시도(48시드): KILL_OUR_HALF(킬 점프 소멸), STAND_GRID(후보 성김→넘기기 점프 폭증), PASS_ROBUST(같음), KILL_COMMIT(효과 없음, 켜둠). 12시드 결과는 노이즈가 커서 판단에 쓰지 말 것.
 */
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
const THUNDER_SERVE = 1;  // [v8 당일 노브] 1=썬더 서브(3위상 시퀀스 + 밴딧 + 이탈). 0=썬더 없이 평소 랠리 로직으로 서브(확정킬이면 킬, 아니면 안전하게 넘기기). 0이면 아래 [BC] 노브 전부 무효
const SERVE_BANDIT = 1;    // [BC] 위상별 서브 모드 밴딧(thunder / ac / flat). 내 서브 랠리 승패로 (승+1)/(시도+2)가 큰 모드를 고른다. 0=항상 썬더.
                           //   근거(bot-dev/blockcounter/README.md §5·§6): 네트 캠퍼 상대 내서브 23%→89%, 기존 봇 5종 상대 수치 불변. 신호는 블록 횟수가 아니라 승패여야 함.
const BANDIT_BLOCKWIN = 0.5; // [BC] 블록당하고도 이긴 썬더 랠리의 승 가중치(1=온전한 승).
const BANDIT_MODES = 'thunder,ac,flat'; // [BC] 밴딧 팔과 우선순위. steep=이탈 끈 썬더(예측이 틀리는 상대용 보험): thunder,steep,ac,flat
const CAMP_ESCAPE = 1;     // [BC] 킬 틱 이탈(phase 1·2). 1=예측 즉시, 2=블록 1회 관측 후, 3=블록 2회 관측 후: 상대가 킬 샷에 닿을 수 있으면(속도 외삽 x가 닿는 지점 x+32+6 이내, 지상이거나 점프 궤적이 상자 안) 평타(vy=0)로 전환. 0=끔.
const AC_LOSS_COMEBACK = 1; // [BC] 1=ac 서브 랠리를 지면 그 위상의 서브 모드 기록을 비우고 썬더로 복귀(썬더가 한 번 막혔다고 그 경기 내내 ac 에 갇히지 않게; 진짜 막히면 다음 서브에서 다시 ac). 0=밴딧 점수대로(ac 가 1승 3패까지 버팀)
const NEW_GAME_RESET = 0;   // [BC] 1=점수가 0:0 으로 돌아오면(새 게임) 서브 모드 기록·모드 초기화, 0=이전 게임 기록 유지(기본). 같은 블로커와 연속 경기 시 1은 매 게임 위상당 1점씩 다시 잃음(README §12); 한 페이지에서 상대가 바뀌면 1 권장
const EXP_DRIFT_ATTACK = 1; // [EXP] 1=낙하점이 상대 코트여도 공이 내 코트에 있고 상대가 지상이 아니면 킬 탐색 먼저(possession_audit: DEFEND 게이트가 확정 킬 기회를 막음). 2=확정/관통 킬일 때만
const EXP_S2_TRACK = 1;      // [EXP] 1=내 출력으로 state2 delay/frameNumber 를 정확히 추적(고정 3 추정이 접촉을 state1 틈에 떨어뜨리는 몸빵 방지)
const EXP_REACH = 1;         // [EXP] 1=상태 인지형 상대 도달 모델(oppTouch, 전지 수비수 L2) + 체공 방향 전환 킬 계획
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
  switches: 0, escapes: 0, comebacks: 0, resets: 0, log: []
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
  if (NEW_GAME_RESET && self === 0 && opp === 0 && BC.lastSelf + BC.lastOpp > 0) {
    /* [BC] 새 게임: 이전 게임의 서브 모드 기록을 버리고 세 위상 모두 썬더부터 */
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
        /* [BC] ac 서브로 졌으면 그 위상 기록을 비우고 썬더로 복귀. 썬더가 진짜 막히면 다음 서브에서 다시 ac 로 간다(비용 1점) */
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
  if (!THUNDER_SERVE) { TH.state = 'OFF'; TH.dead = true; TH.armed = false; return null; }   // [v8] 썬더 꺼짐: 서브는 AC 코어의 랠리 로직이 맡는다
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
var g_pass_jump_until = -1;   // [PASS-JUMP] 이 틱까지는 공중 파워히트에 AIR_GATE 면제
var g_group = 3;
var g_fast_attack_until = -1;
var g_fast_attack_policy = null;
var g_prev_action = { x: 0, y: 0, hit: 0 };   // [EXP] 직전 틱 출력(a_{s-6})
var g_self = { y: 244, vy: 0, state: 0, delay: 0, fn: 0, tick: null }; // [EXP] 자기 상태 모델
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
/* 스냅샷 s 까지 처리된 프레임 = s-3(a_{s-6}), s-2, s-1(a_{s-3}). 관측과 어긋나면 관측으로 재동기화. */
function selfSync(s) {
  var m = g_self;
  if (m.tick !== null && s.tick - m.tick === g_group) { selfStep(m, g_prev_action); for (var i = 1; i < g_group; i++) selfStep(m, g_last_action); }
  else { m.y = s.self.y; m.vy = 0; m.state = s.self.state; m.delay = s.self.state === 2 && s.self.frameNumber === 0 ? 3 : 0; m.fn = s.self.frameNumber; }
  m.tick = s.tick;
  if (m.state !== s.self.state || m.y !== s.self.y) { m.y = s.self.y; m.state = s.self.state; m.fn = s.self.frameNumber; if (s.self.state === 2) m.delay = s.self.frameNumber === 0 ? 3 : 0; if (s.self.state < 3 && s.self.y === PLAYER_GROUND_Y) m.vy = 0; }
  else if (s.self.state === 2 && s.self.frameNumber > 0) { m.delay = 0; m.fn = s.self.frameNumber; }
}

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


/* ============================================================================
 * [KILL-GATE] 확정킬 판정 — 점프 스파이크는 "상대가 절대 받을 수 없는" 경우에만.
 *
 * 배경(bot-dev/rally_escape 실측): 내 파워히트가 상대에게 받히면 그 랠리를
 * 59~72% 진다. 즉 확정킬이 아닌 스파이크는 기댓값이 음수다. 상대 봇도 같은
 * 전략(허점 보일 때만 스파이크)을 쓴다.
 *
 * v5_1 의 oppCanReach 는 (a) 상대 state 를 무시하고 (b) 다이빙 도달을 빼먹어서
 * 상대를 과소평가한다. 여기서는 blockcounter/geom.mjs 에서 엔진과 39/39 일치를
 * 확인한 모델(걷기 6 / 점프 궤적 / 다이빙 8px×10)을 그대로 쓴다.
 * ========================================================================== */

var KILL_GATE = {
  ON: 1,          // 0 = v5_1 그대로(비교용)
  PREDICATE: 'kg',   // [v8] 'kg' = v7 기하 모델(REACT·MARGIN, 위치 외삽) / 'oppTouch' = 전지 수비수 L2(접촉 전 자유 이동) / 'oppTouch0' = 접촉 뒤 전지(d=1)+위치 외삽
  REACT: 3,       // 상대 반응 지연(물리 스텝). 봇은 틱 위상에 따라 2~4(model.mjs reactionDelay). 2 = 최소값(가장 보수적), 3 = v7 값.
  MARGIN: 6       // 도달 판정 여유 px. 크면 더 보수적(스파이크를 덜 함).
};

/* [DEF] 수비 설정. 점프는 확정킬 스파이크만, 리시브는 지상에서만. */
var DEF_CFG = {
  NO_JUMP_RECEIVE: 1,   // 1 = findIntercept 의 리시브 점프를 끈다(공은 결국 내려오므로 점프 없이 받을 수 있다)
  REACT: 3,             // 내 반응 지연(물리 스텝). 결정주기 3 + 입력지연 1 → 보수적으로 3
  STANDBY_OFF: 92,      // 기본 대기 위치 = 네트에서 이 거리(px). rally_escape/universal_x.mjs 안전 구간 116~136 의 중심
  PASS_REACH: 'gate',   // [RECV v8] 넘기기의 "상대가 못 닿음" 판정: 'gate' = 킬 게이트 술어 / 'L2' = 전지 수비수(접촉 전 자유 이동 포함; 느린 공엔 이쪽이 맞다)
  PASS_WINDOW: 0,       // [RECV v8] 0 = co-sim 후보 전 구간 / N = 접촉 자리가 착지점 ±N 안인 후보만(v7 의 ±48 창)
  STANDBY_MODE: 'canon',  // [v8] 'fixed' = NET±STANDBY_OFF(v7) / 'canon' = 표준 네트앞 위협 집합(내리꽂기·수평·아치, y≈171) × 여유 모델(defReachSlack)로 유도한 x. 좌우별 1회 계산
  CANON_CX: 8,          // [v8] 표준 위협의 접촉 x = 네트에서 상대 쪽으로 이만큼(px). +16 지점도 함께 본다
  PRIORITY: 'fast',     // [v8] 모든 경우를 못 막을 때 먼저 막을 샷: 'fast' = 착지까지 FAST_STEPS 이하(v7) / 'lethal' = 내 코트 지상 접촉창이 LETHAL_WINDOW 프레임 이하(관측 후 반응 불가)
  LETHAL_WINDOW: 2,
  TOUCH_DETECT: 'path',   // [v8] 내 터치 감지: 'path' = 관측 사이 공 경로 × 내 몸 경로 교차(mixed_v2 selfSetup) / 'box' = v7 의 90×110 근접 상자
  MAX_CONTACT: 30,      // 상대 접촉 후보를 몇 스텝 앞까지 볼지
  MAX_SAMPLES: 8,       // 접촉 후보 최대 표본 수(계산량 상한)
  X_STEP: 8,            // 내 위치 후보 격자
  AIR_GATE: 1,          // 1 = 공중(state 1)에서 새로 휘두르는 스매시에도 KILL-GATE 적용. 0 = v6 그대로(절제 비교용)
  NEW_DEF: 1,           // 1 = 접촉시점×샷 궤적 기반 defenseTarget. 0 = v6 의 착지점 기반(절제 비교용)
  ALWAYS_DEF: 1,        // 1 = 공이 상대 쪽이면 항상 defenseTarget. 0 = v6(상대 임박 시에만, 아니면 adaptiveDefenseTarget)(절제 비교용)
  OPP_FIRST: 1,         // [OPP-FIRST] 1 = 공이 상대 코트에 있고 상대가 넘어오기 전에 닿을 수 있으면(defOppContacts) 공격 분기(findFastAttack/findKillJump) 금지, 수비 분기로. 0 = v6(예상 착지점만 보고 공격)
  /* ── 2026-09-04 원칙 반영(점프는 확정킬·안전한 넘기기·서브만, 수비는 최소 움직임) ── */
  MIN_MOVE: 1,          // [MIN-MOVE] 지금 자리가 모든 경우를 막으면 안 움직임. 이동은 최악 여유 개선이 MOVE_HYST 이상일 때만
  MOVE_HYST: 4,         //   못 막는 상태에서 이동을 정당화하는 최소 개선(px)
  SAFE_HYST: 24,        //   이미 안전한 상태에서 이동을 정당화하는 최소 개선(px). 구석에 머무는 것을 막는다
  SAFE_SLACK: 0,        // 현재 자리를 "안전"으로 보는 최악 여유(px)
  FAST_FIRST: 1,        // [FAST-FIRST] 모든 경우를 못 막을 때는 착지까지 FAST_STEPS 이하인 빠른 샷의 여유를 먼저 최대화
  FAST_STEPS: 14,
  SAFE_PASS: 1,         // [SAFE-PASS] 공중 정책: 상대 코트에 떨어지는 후보는 우리 코트에 남는 후보(-80)보다 항상 우선(바닥 -70)
  GROUND_PASS: 1,       // [PASS] 지상 몸리시브 오프셋 선택: ① 상대가 못 닿는 넘기기(점프 없는 득점) ② 첫 터치면 세트(킬 시도) ③ 넘어가는 것 중 상대에서 먼 것
  SET_MAX_TOUCH: 1,     // [PASS] 세트(hover)를 허용하는 최대 터치 수. 1 = 첫 터치만 세트, 그 다음은 넘김
  KILL_MAX_CONTACT: 16, // [KILL-H] 킬 점프는 접촉이 이 프레임 안에 오는 공에만. 먼 접촉은 상대 위치 외삽·공중 재계획이 어긋나 확정이 아니다(천장 맞고 39프레임 뒤 오는 공에 점프하던 사례, killjump_repro.mjs).
                        //   48시드 랠리 승률 NetCamper/AC/RedTeam/OurBot: 13 → 74/92/87/77, 16 → 78/95/87/95, 20 → 66/70/87/95, 99(무제한) → 74/70/89/95
  KILL_OUR_HALF: 0,     // [KILL-H] 1 = 킬 점프는 공이 이미 우리 코트 반쪽에 있을 때만. 기각: 카운터 킬은 공이 넘어오기 전에 결정되므로 킬 점프가 거의 사라짐(12시드 NetCamper 75→64%). 지평은 KILL_MAX_CONTACT 로만
  STAND_GRID: 0,        // [PASS] (v8: co-sim 이식으로 미사용) 1 = 지상 리시브 자리 후보를 틱당 이동량(18px) 격자로. 기각: 48시드 NetCamper 74→64%, AC 92→85%(후보가 성겨 넘기기 점프 폭증). 과녁 지나침 사례는 남은 과제
  TOUCH_MARGIN: 9,      // [PASS] 지상 리시브 자리 후보 중 접촉 여유(32 − |접촉x − 자리|)가 이 값 미만이면 크게 감점(후보에서 빼지는 않음). 18px 걸음의 반. 자리가 접촉 범위 가장자리라 2~4px 차로 놓치던 사례(miss_diag)
  PASS_ROBUST: 0,       // [PASS] (v8: co-sim 이식으로 미사용) N>0 = 지상 리시브 자리는 ±N px 틀려도 같은 결과가 나오는 후보만 채택. 기각(6 에서 48시드 NetCamper 74→61%, OurBot 77→57%: 강건한 후보가 드물어 넘기기 점프 폭증). 과녁 지나침(x36→54, 공 x18) 사례는 남은 과제
  KILL_COMMIT: 1,       // [KILL-C] 킬 점프 뒤 공중에서 계획한 스매시를 커밋([FAST-3] 과 같은 메커니즘, ABORT_SCORE 아래로 떨어질 때만 포기). 0 = 매 틱 재계획(몸터치 후보가 이기면 스매시를 버려 허공 점프가 됨)
  DIVE_HAILMARY: 0,     // [DIVE-HM] 모델상 걷기·다이빙 어느 쪽으로도 못 닿는 공(=점수를 잃는 공)이 16프레임 안에 우리 코트에 떨어지면 접촉점 쪽으로 다이빙을 시도한다(모델 오차·운 대비, 잃을 것 없음). 0 = 끔
  DIVE_MODEL: 1,        // [DIVE] 1 = 다이빙 판정을 수비 도달 모델(걷기 6·다이빙 8px×궤적·상자 32)로: 걸어서 못 닿고 다이빙으로는 닿을 때만. 0 = v5_1 거리식
  PASS_JUMP: 1,         // [PASS-JUMP] 지상 몸리시브로는 상대 코트로 못 넘기는 공(벽 구석 등)만 점프+파워히트로 넘긴다. 확정킬 게이트 없음(안 넘기면 터치초과로 지는 상황)
  PASS_JUMP_COMMIT: 20  //   의도한 점프(킬·빠른공격·넘기기) 뒤 공중 정책에서 AIR_GATE 를 면제하는 틱 수. 리시브 점프가 없으므로 AIR_GATE 는 사실상 이 면제 밖에서만 산다
};

/* 점프 궤적: 점프 후 m 스텝의 몸 y (엔진: vy=-16 에서 +1/스텝) */
var KG_JUMP_Y = (function () {
  var a = [], y = 244, vy = -16;
  for (var m = 0; m < 40; m++) { y += vy; a.push(y); if (y < 244) vy += 1; else break; }
  return a;
})();
/* 다이빙 궤적: 다이빙 후 m 스텝의 몸 y (엔진: vy=-5 에서 +1/스텝) */
var KG_DIVE_Y = (function () {
  var a = [], y = 244, vy = -5;
  for (var m = 0; m < 20; m++) { y += vy; if (y >= 244) break; a.push(y); vy += 1; }
  return a;
})();

/* 다이빙 시작 후 m 프레임째의 몸(엔진 실측 rally_escape/dive_physics_probe.mjs · lying_touch_probe.mjs):
 *   m=1 x+6 y244(입력 프레임), m=2..11 x+8/프레임 y=KG_DIVE_Y(239→229→239), m=12 y244 다이빙 마지막, m=13..17 누움(state 4, 이동 0, y244) — 누워서도 공에 닿는다.
 *   방향은 좌우 대칭(뒤로 다이빙 포함). 그 뒤(m≥18)는 다시 지상 걷기. */
/* [FIX v8] 엔진(physics.js processPlayerMovement): 입력 프레임은 아직 state 0 이라 +6, 그 뒤 state 3 인 12프레임(y 239→229→239→244→244) 동안 +8, 13프레임째 착지(state 4, 5프레임 누움).
 *   = 13프레임 102px. 이전 표(11프레임 86px)는 m=12,13 의 +8 을 빠뜨렸다(v6_Defense DIVE_DX/DIVE_Y 와 일치). */
var DIVE_Y_TABLE = [239, 235, 232, 230, 229, 229, 230, 232, 235, 239, 244, 244];   // m=2..13
var DIVE_TOUCH_FRAMES = 18;   // m=14..18 누움(state 4, 이동 0) — 누워서도 공에 닿는다
function diveBody(m) {
  if (m < 1 || m > DIVE_TOUCH_FRAMES) return null;
  if (m === 1) return { dx: WALK_SPEED, y: PLAYER_GROUND_Y };
  if (m <= 13) return { dx: WALK_SPEED + 8 * (m - 1), y: DIVE_Y_TABLE[m - 2] };
  return { dx: WALK_SPEED + 8 * 12, y: PLAYER_GROUND_Y };
}

/* 상대가 지금 어떤 상태인지에 따라, k 스텝 뒤 도달 가능한 몸 y 집합과 x 이동량을 만든다.
 * state 0=지상, 1=점프중, 2=점프+파워히트, 3=다이빙중, 4=누움(못 움직임). */
function kgOppMotion(opp, k, react) {
  var st = opp.state | 0;
  /* 누워 있으면 lyingDownDurationLeft 동안 완전 정지. 스냅샷에 없으면 3프레임으로 본다. */
  if (st === 4) {
    /* 스냅샷에는 lyingDownDurationLeft 가 없다(botContract). 모르면 0 = 다음 스텝에 일어난다고 보수적으로 본다(확정킬 원칙). */
    var lie = (opp.lyingDownDurationLeft === undefined) ? 0 : (opp.lyingDownDurationLeft | 0);
    if (k <= lie + 1) return { ys: [], walk: 0 };   // 못 움직이고 못 닿음
    /* [FIX v8] 일어난 뒤에는 지상과 같다(걷기·점프·다이빙). grounded 가 없으면 kgOppCanReach 가 y=244 접촉만 보고 재점프를 놓쳤다(gate_verify 위험 불일치 전부 이 경우). */
    return { ys: [244], walk: (k - lie - 1) * WALK_SPEED, grounded: true };
  }
  /* 공중(점프/스매시 중)이면 착지할 때까지 y 는 궤적에 묶여 있다. 착지 후 지상. */
  if (st === 1 || st === 2) {
    var y = opp.y, vy = (opp.yVelocity === undefined) ? 0 : (opp.yVelocity | 0);
    var ys = [];
    for (var i = 0; i < k; i++) { y += vy; if (y < 244) vy += 1; else { y = 244; vy = 0; } }
    ys.push(y);
    /* 공중에서도 좌우 이동은 되지만(엔진: state<3 이면 xDirection*6) 새로 점프는 못 한다. */
    var walkAir = Math.max(0, k - react + 1) * WALK_SPEED;
    if (y >= 244) {
      /* 이미 착지했으면 그 뒤로는 새 점프도 가능 */
      return { ys: ys, walk: walkAir, grounded: true };
    }
    return { ys: ys, walk: walkAir, grounded: false };
  }
  /* 지상: 서기 + (반응 뒤) 점프 + 다이빙 전부 가능 */
  return { ys: null, walk: Math.max(0, k - react + 1) * WALK_SPEED, grounded: true };
}

/* 상대가 이 궤적에 닿을 수 있는가. traj = [{n, x, y}] (n = 접촉 후 스텝, 착지 전까지).
 * 닿을 수 있으면 true. 확정킬이려면 false 여야 한다. */
function kgOppCanReach(traj, opp, oppMinX, oppMaxX, react, margin) {
  var clampX = function (x) { return x < oppMinX ? oppMinX : (x > oppMaxX ? oppMaxX : x); };
  for (var t = 0; t < traj.length; t++) {
    var p = traj[t];
    if (p.n <= 0) continue;
    var m = kgOppMotion(opp, p.n, react);
    var need = Math.abs(p.x - opp.x) - PLAYER_HALF - margin;
    if (need < 0) need = 0;
    var lo = clampX(opp.x - m.walk), hi = clampX(opp.x + m.walk);
    var xok = (p.x + PLAYER_HALF + margin >= lo) && (p.x - PLAYER_HALF - margin <= hi);
    if (!xok) continue;

    /* 공중에 묶인 상대: y 가 궤적으로 정해져 있다 */
    if (m.ys !== null && m.ys.length === 0) continue;          // 누워서 못 움직임
    if (m.ys !== null && !m.grounded) {
      if (Math.abs(p.y - m.ys[0]) <= PLAYER_HALF) return true;
      continue;
    }
    /* 지상(또는 착지 완료): 서기 */
    if (Math.abs(p.y - PLAYER_GROUND_Y) <= PLAYER_HALF) return true;
    /* 점프: 반응 뒤 아무 스텝에나 시작 가능 */
    for (var j = react; j <= p.n; j++) {
      var mm = p.n - j;
      if (mm < KG_JUMP_Y.length && Math.abs(p.y - KG_JUMP_Y[mm]) <= PLAYER_HALF) return true;
    }
    /* 다이빙: 시작 전까지 걷고, 시작 후 8px/스텝 */
    for (var j2 = react; j2 <= p.n; j2++) {
      var db2 = diveBody(p.n - j2);
      if (db2 === null) continue;
      var reach = WALK_SPEED * Math.max(0, j2 - react) + db2.dx;
      var dlo = clampX(opp.x - reach), dhi = clampX(opp.x + reach);
      if (p.x + PLAYER_HALF + margin >= dlo && p.x - PLAYER_HALF - margin <= dhi &&
          Math.abs(p.y - db2.y) <= PLAYER_HALF) return true;
    }
  }
  return false;
}

/* 접촉 직후 공 상태에서 착지까지의 궤적을 뽑는다 (n = 접촉 후 스텝). */
function kgTrajectory(b0, maxN) {
  var b = { x: b0.x, y: b0.y, xV: b0.xV, yV: b0.yV };
  var out = [];
  for (var n = 1; n <= maxN; n++) {
    if (stepBall(b)) { out.push({ n: n, x: b.x, y: b.y, landed: true }); break; }
    out.push({ n: n, x: b.x, y: b.y, landed: false });
  }
  return out;
}

/* microSimSeq 결과가 "확정킬"인지 최종 판정.
 * r 은 landed/landX/frames/lastHitFrame/contactBall 을 가진 결과. */
function kgIsGuaranteedKill(s, r, oppMinX, oppMaxX) {
  if (!KILL_GATE.ON) return true;
  if (!r || !r.landed || !r.contactBall) return false;
  /* 상대 코트에 떨어져야 한다 */
  if (r.landX <= oppMinX + 4 || r.landX >= oppMaxX - 4) return false;
  var traj = kgTrajectory(r.contactBall, 60);
  var opp = {
    x: s.opp.x, y: s.opp.y, state: s.opp.state,
    yVelocity: s.opp.yVelocity,
    lyingDownDurationLeft: s.opp.lyingDownDurationLeft
  };
  /* [GATE v8] 술어는 gateOppReach(KILL_GATE.PREDICATE) 로 통일. 'kg' 면 v7 과 같이 관측 속도로 접촉 시점 x 를 외삽한 기하 모델. */
  return !gateOppReach(r.contactBall, r.lastHitFrame || 0, s, oppMinX, oppMaxX);
}

/* 상대 x 속도 추정(직전 스냅샷 대비). 없으면 0. */
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

/* [EXP-REACH] 상태 인지형 상대 도달 모델(v5_2 oppTouch).
 *  상대가 현재 상태(지상 / 점프 궤적 m프레임째 / 다이빙 m프레임째 / 누움)에서 매 프레임 자유 입력(걷기 6, 점프, 다이빙 6+8/f)으로
 *  파워히트 뒤 공 궤적 traj[n-1]=(프레임 n 의 공 위치) 에 닿을 수 있는 첫 프레임을 돌려준다(없으면 -1). 반응 지연은 최악(1프레임).
 *  pre = traj[0] 이전에 상대가 자유롭게 움직일 수 있는 프레임 수(내 접촉까지의 프레임) — 전지 수비수(L2) 기준.
 *  noPre = true 면 접촉 전에는 걷기·다이빙을 시작하지 않는다(위치는 호출자가 관측 속도로 외삽) — 접촉 뒤 반응만 전지(exact d=1).
 *  검증: possession_audit/gate_verify.mjs — 정확 모델(model.mjs canTouch) 대비 12,215건 중 위험 불일치 0. */
var RX_JUMP = (function () { var a = [PLAYER_GROUND_Y]; for (var m = 1; m <= 33; m++) a.push(PLAYER_GROUND_Y - 16 * m + idiv(m * (m - 1), 2)); return a; })();
var RX_DIVE = (function () { var a = [PLAYER_GROUND_Y]; for (var m = 1; m <= 11; m++) a.push(PLAYER_GROUND_Y - 5 * m + idiv(m * (m - 1), 2)); return a; })();
function rxJumpIndex(y, asc) { for (var m = 1; m <= 33; m++) if (RX_JUMP[m] === y && ((asc && m <= 16) || (!asc && m >= 16))) return m; return asc ? 1 : 33; }
function rxDiveIndex(y, asc) { for (var m = 1; m <= 11; m++) if (RX_DIVE[m] === y && ((asc && m <= 5) || (!asc && m >= 6))) return m; return asc ? 1 : 11; }
var g_oppm = null;
var g_kill_plan = null;
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
  var freeMove = noPre ? Math.max(freeAt, pre + 1) : freeAt;   // 걷기·다이빙 시작이 허용되는 첫 프레임
  for (var i = 1; i < L; i++) {
    var n = pre + i;   // 수비수 시간(접촉 전 프레임 포함)
    var bx = traj[i - 1].x, by = traj[i - 1].y;
    var base = clamp(o.dive ? x0 + o.dir * 8 * Math.min(n, landAt) : x0, lo0, hi0);   // 다이빙 변위는 프레임마다 벽에 클램프됨
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
        if (noPre && j <= pre) continue;   // 접촉 전에 시작한 다이빙은 없다고 본다
        var baseJ = clamp(o.dive ? x0 + o.dir * 8 * Math.min(j - 1, landAt) : x0, lo0, hi0);
        var reach = 6 * Math.max(0, j - 1 - freeMove + 1) + 6 + 8 * Math.min(m2, 11);
        if (bx >= clamp(baseJ - reach, lo0, hi0) - PLAYER_HALF && bx <= clamp(baseJ + reach, lo0, hi0) + PLAYER_HALF) return n;
      }
    }
  }
  return -1;
}
/* 접촉 직후 공 상태 → oppTouch 용 궤적([{x,y}], 마지막 원소 = 착지 프레임) */
function rxTrajOf(contactBall, maxN) {
  var b = { x: contactBall.x, y: contactBall.y, xV: contactBall.xV, yV: contactBall.yV }, out = [];
  for (var n = 1; n <= maxN; n++) { var landed = stepBall(b); out.push({ x: b.x, y: b.y }); if (landed) break; }
  return out;
}
/* [GATE] 술어 통일: "내가 pre 프레임 뒤에 contactBall 로 공을 보내면 상대가 닿을 수 있는가".
 *   KILL_GATE.PREDICATE: 'kg' = v7 기하 모델(REACT·MARGIN, 위치는 관측 속도로 외삽)
 *                        'oppTouch' = 전지 수비수 L2(접촉 전에도 자유 이동)  'oppTouch0' = 접촉 뒤 전지(d=1), 접촉 전 위치는 관측 속도 외삽 */
/* [FIX v8] 스냅샷에는 상대 yVelocity 가 없다(botContract: x,y,state,frameNumber,divingDirection). v7 kg 모델은 undefined 를 0 으로 봐서
 *   공중 상대가 "그 높이에 멈춰 있다가 천천히 떨어진다"고 계산했고, 그래서 네트 앞에서 이미 뛰어오른 블로커에게 킬 점프를 확정으로 내줬다
 *   (RedTeam 리시브 패의 94~100% 가 블록당한 킬 점프, recv_kinds.mjs). 점프 인덱스(oppModelOf: y 와 직전 y 로 상승/하강 판정)에서 vy = −16+m 을 복원한다. */
function oppVyEst(s) {
  if (s.opp.yVelocity !== undefined) return s.opp.yVelocity;
  if (g_oppm !== null) { if (g_oppm.air) return -16 + g_oppm.air; if (g_oppm.dive) return -5 + g_oppm.dive; }
  return 0;
}
function gateOppReach(contactBall, pre, s, oppMinX, oppMaxX) {
  var pred = KILL_GATE.PREDICATE || 'kg';
  if (pred !== 'kg' && g_oppm !== null) {
    var tr = rxTrajOf(contactBall, 90);
    if (pred === 'oppTouch') return oppTouch(tr, g_oppm, pre) >= 0;
    var om = { x: clamp(g_oppm.x + kg_lastVx * pre, g_oppm.lo, g_oppm.hi), state: g_oppm.state, dir: g_oppm.dir,
               air: g_oppm.air, dive: g_oppm.dive, lo: g_oppm.lo, hi: g_oppm.hi };
    return oppTouch(tr, om, pre, true) >= 0;
  }
  var opp = { x: clamp(s.opp.x + kg_lastVx * pre, oppMinX, oppMaxX), y: s.opp.y, state: s.opp.state,
              yVelocity: oppVyEst(s), lyingDownDurationLeft: s.opp.lyingDownDurationLeft };
  return kgOppCanReach(kgTrajectory(contactBall, 60), opp, oppMinX, oppMaxX, KILL_GATE.REACT, KILL_GATE.MARGIN);
}

function oppCanReach(b, oppX, oppMinX, oppMaxX, fSinceHit) {
  if (b.x < oppMinX - PLAYER_HALF || b.x > oppMaxX + PLAYER_HALF) return false;
  if (b.y < 76) return false;
  if (b.y < 212 && fSinceHit < 5) return false;
  return Math.abs(b.x - oppX) <= WALK_SPEED * fSinceHit + 40;
}

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
          lastHitFrame = f; contactBall = { x: b.x, y: b.y, xV: b.xV, yV: b.yV };
        }
        touches += 1; collFlag = true;
      }
    } else collFlag = false;
  }
  return { landed: false, landX: b.x, frames: maxFrames, touches: touches,
    powerTouches: powerTouches, oppWindow: oppWindow, lastHitFrame: lastHitFrame, contactBall: contactBall };
}

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

function findKillJump(s, minX, maxX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X;
  var oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var budget = 4 - g_touches;
  if (budget < 1) return null;
  /* [KILL-H] 공이 아직 상대 반쪽이면 킬 점프 없음 */
  if (DEF_CFG.KILL_OUR_HALF && (isRight ? s.ball.x < NET_X : s.ball.x > NET_X)) return null;
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
  var flyTicks = EXP_REACH ? [0, 1, 2] : [0];   // [EXP-REACH] 체공 중 x 를 바꾼 뒤 스매시하는 계획(확정일 때만 채택)
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
            /* [KILL-H] 먼 미래(틱 양자화·공중 재계획으로 어긋남)의 접촉은 확정이 아니다 */
            if (r.lastHitFrame > DEF_CFG.KILL_MAX_CONTACT) continue;
            var drop = r.frames - r.lastHitFrame;
            var distFromOpp = Math.abs(r.landX - s.opp.x);
            var unreachable = distFromOpp > WALK_SPEED * drop + 44;
            var throughBall = r.oppWindow === 0;
            /* [KILL-GATE] 확정킬이 아니면 점프 스파이크 자체를 포기한다. */
            if (!kgIsGuaranteedKill(s, r, oppMinX, oppMaxX)) continue;
            /* [EXP-REACH] 확정 = 상태 인지형 도달 모델로 상대가 어떤 입력을 해도 못 닿음 */
            var confirmed = EXP_REACH && g_oppm !== null && r.powerTouches === 1 && oppTouch(traj, g_oppm, r.lastHitFrame) < 0;
            if (h > 0 && !confirmed) continue;
            if (drop > 14 && !unreachable && !throughBall && !confirmed) continue;
            var score = 300 - drop * 6 + distFromOpp;
            if (confirmed) score += 400 - r.lastHitFrame * 4;
            else if (throughBall) score += 250;
            else if (unreachable) score += 120;
            /* [DOWN-1] 이미 안전 판정을 통과한 후보끼리는 최대 하향(y=1)을 우선. */
            if (smash.y === 1 && drop <= FAST_ATTACK_CFG.DOWN_MAX_DROP &&
                (throughBall || unreachable || confirmed)) {
              score += Math.round(FAST_ATTACK_CFG.DOWN_BONUS * 0.65);
            }
            if (!best || score > best.score) best = { jx: jxs[i], smash: smash, score: score, fly: h > 0 ? flyAct : null, flyTicks: h, confirmed: confirmed, through: throughBall };
          }
        }
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
  var traj = [];   // [EXP-REACH]

  for (var au = 0; au < FAST_ATTACK_CFG.ARM_UNTILS.length; au++) {
    var armUntil = FAST_ATTACK_CFG.ARM_UNTILS[au];
    for (var i = 0; i < jxs.length; i++) {
      // 점프와 동시에 hit를 눌러 공격 상태를 반박자 먼저 준비한다.
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
          var confirmed = EXP_REACH && g_oppm !== null && oppTouch(traj, g_oppm, r.lastHitFrame) < 0;   // [EXP-REACH]
          if (r.oppWindow > FAST_ATTACK_CFG.OPP_WINDOW && !confirmed) continue;
          if (!throughBall && !unreachable && !confirmed) continue;
          /* [KILL-GATE] 확정킬이 아니면 반박자 빠른 공격도 하지 않는다. */
          if (!kgIsGuaranteedKill(s, r, oppMinX, oppMaxX)) continue;

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
  /* [KILL-GATE] 공중에서 새로 휘두르는 스매시(state 1)도 확정킬이어야 한다.
   * 이미 휘두른 뒤(state 2)는 되돌릴 수 없으므로 통과. 거부되면 hit=0 몸터치 후보만 남는다. */
  if (DEF_CFG.AIR_GATE && act.hit === 1 && me0.state === 1 && r.powerTouches > 0 &&
      !(g_pass_jump_until >= s.tick) &&                    // [PASS-JUMP] 넘기기 점프 중에는 면제
      !kgIsGuaranteedKill(s, r, oppMinX, oppMaxX)) return null;
  var onOpp = r.landX > oppMinX + 4 && r.landX < oppMaxX - 4;
  if (onOpp && r.touches > 0) {
    var distFromOpp = Math.abs(r.landX - s.opp.x);
    var score = distFromOpp - r.frames * 2;
    var confirmed = EXP_REACH && g_oppm !== null && r.powerTouches > 0 && oppTouch(traj, g_oppm, r.frames - traj.length) < 0;   // [EXP-REACH]
    if (confirmed) score += 350;
    else if (r.powerTouches > 0 && r.oppWindow === 0) score += 250;
    else if (r.powerTouches > 0 && r.oppWindow <= 2) score += 120;
    else if (distFromOpp > WALK_SPEED * r.frames + 44) score += 120;
    /* [DOWN-2] 상대 코트 착지와 낮은 대응 창이 확인된 최대 하향타만 가산. */
    if (act.hit === 1 && act.y === 1 && r.powerTouches > 0 &&
        (confirmed || r.oppWindow <= FAST_ATTACK_CFG.OPP_WINDOW ||
         distFromOpp > WALK_SPEED * r.frames + 44)) {
      score += FAST_ATTACK_CFG.DOWN_BONUS;
    }
    if (r.powerTouches >= 2) score += 60;
    if (act.hit === 1) score += 10;
    if (r.frames > 36 && distFromOpp < 110 &&
        !(r.powerTouches > 0 && r.oppWindow <= 2)) score -= 120;
    /* [SAFE-PASS] 상대 코트에 떨어지는 후보는 우리 코트에 남는 후보(-80)보다 항상 위 */
    if (DEF_CFG.SAFE_PASS && score < -70) score = -70;
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

/* 궤적 생성: 접촉 직후 속도로 착지까지 (n = 접촉 후 스텝) */
function defTraj(x, y, xV, yV) {
  var b = { x: x, y: y, xV: xV, yV: yV }, out = [];
  for (var n = 1; n <= 90; n++) {
    var landed = stepBall(b);
    out.push({ n: n, x: b.x, y: b.y, landed: landed });
    if (landed) break;
  }
  return out;
}

/* 상대가 공에 닿을 수 있는 접촉 시점들. 각 항목 = { k, ball, air(점프 상태로 닿음→파워히트 가능), ground(지상 몸터치 가능) }.
 * 상대는 "계획"하는 쪽이므로 반응 지연 없이 다음 스텝부터 움직인다고 본다. 상태(공중/누움)는 KILL-GATE 의 kgOppMotion 재사용. */
function defOppContacts(s, oppMinX, oppMaxX) {
  var isRight = s.side === 'RIGHT';
  var opp = { x: s.opp.x, y: s.opp.y, state: s.opp.state | 0, yVelocity: oppVyEst(s),   // [FIX v8] 스냅샷에 yVelocity 없음 → 점프 인덱스에서 복원
              lyingDownDurationLeft: s.opp.lyingDownDurationLeft };
  var oLo = oppMinX + PLAYER_HALF, oHi = oppMaxX - PLAYER_HALF;
  var b = cloneBall(s.ball);
  var out = [];
  /* [FIX v8] 엔진 충돌 래치(isCollisionWithBallHappened): 스냅샷에서 공이 이미 상대 몸과 겹쳐 있으면(방금 친 공) 떨어질 때까지 다시 닿을 수 없다.
   *   이걸 모르면 상대 스파이크 직후 k=1 에 가짜 "재접촉"이 잡혀 OPP_FIRST 가 수비 분기로 보내고, 가짜 위협 쪽으로 자리를 옮겨 실제 공을 놓친다(trace_loss vs AC). */
  var latch = Math.abs(s.ball.x - s.opp.x) <= PLAYER_HALF && Math.abs(s.ball.y - s.opp.y) <= PLAYER_HALF;
  for (var k = 1; k <= DEF_CFG.MAX_CONTACT; k++) {
    if (stepBall(b)) break;
    if (latch) { if (Math.abs(b.x - s.opp.x) <= PLAYER_HALF && Math.abs(b.y - s.opp.y) <= PLAYER_HALF) continue; latch = false; }
    var onOpp = isRight ? b.x < NET_X : b.x > NET_X;
    if (!onOpp) continue;
    var m = kgOppMotion(opp, k, 1);
    if (m.ys !== null && m.ys.length === 0) continue;             // 누워서 못 움직임
    var lo = clamp(opp.x - m.walk, oLo, oHi), hi = clamp(opp.x + m.walk, oLo, oHi);
    if (b.x + PLAYER_HALF < lo || b.x - PLAYER_HALF > hi) continue;
    var air = false, ground = false;
    if (m.ys !== null && !m.grounded) {                            // 공중에 묶임: 그 궤적 y 로만 닿음
      if (Math.abs(b.y - m.ys[0]) <= PLAYER_HALF) air = true;
    } else {
      if (Math.abs(b.y - PLAYER_GROUND_Y) <= PLAYER_HALF) ground = true;
      for (var j = 1; j <= k; j++) {
        var mm = k - j;
        if (mm < KG_JUMP_Y.length && Math.abs(b.y - KG_JUMP_Y[mm]) <= PLAYER_HALF) { air = true; break; }
      }
    }
    if (!air && !ground) continue;
    out.push({ k: k, ball: { x: b.x, y: b.y, xV: b.xV, yV: b.yV }, air: air, ground: ground });
  }
  if (out.length > DEF_CFG.MAX_SAMPLES) {                          // 균등 표본(첫 접촉은 항상 포함)
    var picked = [], step = (out.length - 1) / (DEF_CFG.MAX_SAMPLES - 1);
    for (var i = 0; i < DEF_CFG.MAX_SAMPLES; i++) picked.push(out[Math.round(i * step)]);
    out = picked;
  }
  return out;
}

/* 한 접촉 시점에서 상대가 만들 수 있는 샷 궤적들. 파워히트 6종(공중일 때) + 몸리시브 3종(지상일 때). 내 코트 착지만. */
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

/* 내가 x0(지상)에서 react 스텝 뒤부터 걷기(6)/다이빙(6 후 8)으로 궤적에 닿는 최대 여유 px. 음수면 그만큼 부족. */
function defReachSlack(traj, x0, react, isRight) {
  var best = -Infinity;
  for (var t = 0; t < traj.length; t++) {
    var p = traj[t];
    if (p.landed) break;
    if (p.y < PLAYER_GROUND_Y - 48) continue;                     // 다이빙 정점(229)-32 보다 높으면 어떤 자세로도 못 닿음
    if (isRight ? p.x < NET_X : p.x > NET_X) continue;            // 내 코트에 들어온 뒤부터
    var need = Math.abs(p.x - x0) - PLAYER_HALF; if (need < 0) need = 0;
    var n = p.n - react + 1; if (n < 0) n = 0;
    if (Math.abs(p.y - PLAYER_GROUND_Y) <= PLAYER_HALF) {
      var sl = WALK_SPEED * n - need;
      if (sl > best) best = sl;
    }
    for (var m = 1; m <= DIVE_TOUCH_FRAMES; m++) {
      var db = diveBody(m);
      if (Math.abs(p.y - db.y) > PLAYER_HALF) continue;
      var j = p.n - m; if (j < react) continue;                    // 다이빙 시작 스텝은 반응 이후
      var sl2 = WALK_SPEED * (j - react) + db.dx - need;           // 걷다가(j−react) 다이빙(db.dx): 최대 도달 = 접촉 시점에 다이빙 프레임을 최대로
      if (sl2 > best) best = sl2;
    }
  }
  return best;
}

/* [DIVE] 내가 x0(지상)에서 react 스텝 뒤부터 이 궤적에 닿는 최대 여유를 걷기/다이빙으로 나눠 돌려준다(defReachSlack 과 같은 기하). */
function defReachSplit(traj, x0, react, isRight) {
  var walk = -Infinity, dive = -Infinity, diveNow = -Infinity, diveDir = 0;
  var nowWindow = react + (g_group - 1);                            // 이번 틱 안에 시작하는 다이빙
  for (var t = 0; t < traj.length; t++) {
    var p = traj[t];
    if (p.landed) break;
    if (isRight ? p.x < NET_X : p.x > NET_X) continue;
    var need = Math.abs(p.x - x0) - PLAYER_HALF; if (need < 0) need = 0;
    var n = p.n - react + 1; if (n < 0) n = 0;
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
  /* diveNow ≥ 0 이면 지금 다이빙해야 닿는다. dive ≥ 0 인데 diveNow < 0 이면 더 걷다가 다음 틱 이후에 다이빙하는 편이 닿는다(지금 다이빙하면 너무 일러 누운 채 공을 맞이한다). */
  return { walk: walk, dive: dive, diveNow: diveNow, diveDir: diveDir };
}

/* [NEUTRAL v8] 위협이 아직 없을 때의 대기 x. v7 은 고정 92(universal_x 전샷 교집합 중심, x=124)였고 v6_Defense 는 표준 내리꽂기 앵커로 182 를 유도했다.
 *   여기서는 v6_Defense 의 "표준 위협 집합"(상대 코트 네트 바로 앞 y≈171 접촉에서 파워히트 6종, 두 가지 입사 속도)을 v7 의 여유 모델(걷기 6·다이빙·반응 REACT)로 풀어
 *   최악 여유가 최대인 x 를 고른다. 동률이면 네트 쪽(접촉창 1프레임 내리꽂기는 관측 후 반응이 불가하므로). 물리 예측은 x≈152~156(네트 −60~64). */
var g_neutral_cache = { L: null, R: null };
function standbyCenter(isRight, minX, maxX) {
  if (DEF_CFG.STANDBY_MODE !== 'canon') return isRight ? NET_X + DEF_CFG.STANDBY_OFF : NET_X - DEF_CFG.STANDBY_OFF;
  var key = isRight ? 'R' : 'L';
  if (g_neutral_cache[key] !== null) return g_neutral_cache[key];
  var trs = [], offs = [DEF_CFG.CANON_CX, DEF_CFG.CANON_CX + 16], yvs = [19, 30];
  for (var ci = 0; ci < offs.length; ci++) {
    var cx = isRight ? NET_X - offs[ci] : NET_X + offs[ci];
    for (var vi = 0; vi < yvs.length; vi++) {
      var ts = defShotTrajs({ ball: { x: cx, y: 171, xV: 0, yV: yvs[vi] }, air: true, ground: false }, isRight);
      for (var q = 0; q < ts.length; q++) trs.push(ts[q]);
    }
  }
  var bestX = isRight ? NET_X + DEF_CFG.STANDBY_OFF : NET_X - DEF_CFG.STANDBY_OFF, best = -Infinity;
  for (var x = minX; x <= maxX; x += 4) {
    var worst = Infinity;
    for (var k = 0; k < trs.length; k++) { var sl = defReachSlack(trs[k], x, DEF_CFG.REACT, isRight); if (sl < worst) worst = sl; }
    if (worst > best || (worst === best && Math.abs(x - NET_X) < Math.abs(bestX - NET_X))) { best = worst; bestX = x; }
  }
  g_neutral_cache[key] = bestX;
  return bestX;
}
/* 이 궤적이 내 코트에서 지상 접촉 가능한 프레임 수(작을수록 관측 후 반응이 불가한 치명 샷) */
function defWindow(traj, isRight) {
  var n = 0;
  for (var t = 0; t < traj.length; t++) {
    var p = traj[t];
    if (p.landed) break;
    if (isRight ? p.x < NET_X : p.x > NET_X) continue;
    if (Math.abs(p.y - PLAYER_GROUND_Y) <= PLAYER_HALF) n++;
  }
  return n;
}

/* [DEF] 수비 위치: 상대가 닿을 수 있는 모든 접촉 시점 × 가능한 샷의 궤적에 대해 내 최악 여유를 최대화하는 x.
 * 동률이면 fallback(기본 대기 위치)에 가까운 x. 상대가 어떤 샷도 못 만들면 fallback. */
function defenseTargetNew(s, minX, maxX, fallback, curX) {
  var isRight = s.side === 'RIGHT';
  var oppMinX = isRight ? 0 : NET_X, oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var contacts = defOppContacts(s, oppMinX, oppMaxX);
  var trs = [], fast = [];
  /* [FIX v8] 상대가 아직 닿을 수 있어도 안 칠 수 있다. 예상 착지점이 내 코트면 지금 궤적 자체를 위협에 넣는다(v6_Defense 의 KEEP). */
  if (isRight ? s.ball.expectedLandingPointX >= NET_X : s.ball.expectedLandingPointX <= NET_X) {
    var keepT = defTraj(s.ball.x, s.ball.y, s.ball.xVelocity, s.ball.yVelocity);
    var keepL = keepT[keepT.length - 1];
    if (keepL.landed) { trs.push(keepT); fast.push(keepL.n <= DEF_CFG.FAST_STEPS); }
  }
  for (var i = 0; i < contacts.length; i++) {
    var ts = defShotTrajs(contacts[i], isRight);
    for (var q = 0; q < ts.length; q++) {
      var L = ts[q][ts[q].length - 1];
      trs.push(ts[q]);
      fast.push(DEF_CFG.PRIORITY === 'lethal' ? defWindow(ts[q], isRight) <= DEF_CFG.LETHAL_WINDOW
                                              : contacts[i].k + L.n <= DEF_CFG.FAST_STEPS);   // [v8] 우선 샷: 치명(접촉창) 또는 빠른(착지 스텝)
    }
  }
  if (!trs.length) return fallback;
  /* x 의 평가 = { f: 빠른 샷 최악 여유, a: 전체 최악 여유 } */
  var evalX = function (x) {
    var wf = Infinity, wa = Infinity;
    for (var k = 0; k < trs.length; k++) {
      var sl = defReachSlack(trs[k], x, DEF_CFG.REACT, isRight);
      if (sl < wa) wa = sl;
      if (fast[k] && sl < wf) wf = sl;
    }
    return { f: wf, a: wa };
  };
  var better = function (p, q) {
    if (DEF_CFG.FAST_FIRST && p.f !== q.f) return p.f > q.f;
    return p.a > q.a;
  };
  var cur = (DEF_CFG.MIN_MOVE && curX !== undefined) ? evalX(curX) : null;
  var bestX = fallback, best = null;
  for (var x = minX; x <= maxX; x += DEF_CFG.X_STEP) {
    var e = evalX(x);
    if (best === null || better(e, best) ||
        (e.f === best.f && e.a === best.a && Math.abs(x - fallback) < Math.abs(bestX - fallback))) { best = e; bestX = x; }
  }
  if (cur !== null) {
    /* [MIN-MOVE] 지금 자리가 모든 경우를 막으면(a ≥ SAFE_SLACK) 큰 개선(SAFE_HYST)일 때만, 못 막으면 작은 개선(MOVE_HYST)에도 이동.
     * 안전한데도 큰 개선이면 옮기는 이유: 서브 시작 위치(x 36) 같은 구석은 지금은 안전해도 다음 상황에서 긴 이동을 강요한다. */
    var gain = (DEF_CFG.FAST_FIRST && best.f !== cur.f) ? best.f - cur.f : best.a - cur.a;
    var hyst = cur.a >= DEF_CFG.SAFE_SLACK ? DEF_CFG.SAFE_HYST : DEF_CFG.MOVE_HYST;
    if (gain < hyst) return curX;
  }
  return bestX;
}

/* v6 의 defenseTarget (착지점 기반, 상대 상태·다이빙 무시). DEF_CFG.NEW_DEF=0 절제 비교용. */
function defenseTargetV6(s, minX, maxX, fallback) {
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

function defenseTarget(s, minX, maxX, fallback, curX) {
  return DEF_CFG.NEW_DEF ? defenseTargetNew(s, minX, maxX, fallback, curX)
                         : defenseTargetV6(s, minX, maxX, fallback);
}

/* [PASS] 지상 몸리시브의 접촉 오프셋 선택. 몸리시브 물리(엔진): xV = ±idiv(|공x−내x|,3), yV = −max(15,|yV|).
 * ① 상대가 착지 전에 못 닿는 넘기기가 있으면 그것(점프 없는 확정 득점) ② 첫 터치(SET_MAX_TOUCH 미만)면 null → 기존 세트로 킬 시도
 * ③ 넘어가는 것 중 상대(외삽 위치)에서 가장 먼 것. 넘어가는 후보가 없으면 null(기존 로직). */
/* [RECV v8] 지상 몸리시브 자리 — v6_Defense planReceive 의 컨트롤러 co-simulation 이식.
 *   v7 은 착지점 ±48 을 4px 격자로 놓고 "그 자리에 서 있다"고 가정해 접촉을 시뮬했다. 그런데 실제 이동은 3프레임 묶음 × 6px = 18px 격자이고
 *   walkTo 는 |dx|<7 이면 멈추므로 계획 자리(368)와 실제 자리(366)가 어긋나 1px 차로 놓치는 자책이 남았다(trace_selflast: AC 38·NetCamper 21·RedTeam 21 / 96경기).
 *   여기서는 목표 x 마다 실제 컨트롤러(gpMoveToward, 상대프레임 2 부터 g_group 프레임마다 갱신, 지연 1)를 그대로 돌려 "첫 접촉 프레임 k × 접촉 위치 p" 를 찾고,
 *   같은 (k,p) 는 한 번만 채점한다(도달 위치가 격자라 77개 목표가 보통 2~6개로 수렴). 채점은 v7 우선순위 그대로:
 *   ① 상대가 못 닿는 넘기기(gateOppReach, 점프 없는 득점) ② 첫 터치면 네트앞 세트(킬 시도) ③ 넘어가는 것 중 상대에서 먼 것. 반사 궤적은 끝까지 전개한다(네트 되돌림·재접촉 자동 반영).
 *   반환 act = 이번 틱에 낼 걸음(co-sim 의 첫 입력). 매 틱 재계획하되 직전 접촉 자리 근처에 작은 가산(진동 억제). */
function gpMoveToward(cur, target) { var d = target - cur; return d > 9 ? 1 : (d < -9 ? -1 : 0); }
var g_recv_p = null;
/* 스냅샷 공의 프레임별 상태(속도 포함; kgTrajectory 는 위치만 담아 반사 계산에 못 쓴다) */
function gpTraj(b0, maxN) {
  var b = { x: b0.x, y: b0.y, xV: b0.xV, yV: b0.yV }, out = [];
  for (var n = 1; n <= maxN; n++) {
    var landed = stepBall(b);
    out.push({ n: n, x: b.x, y: b.y, xV: b.xV, yV: b.yV, landed: landed });
    if (landed) break;
  }
  return out;
}
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
function groundPassPlan(s, landingX, landFrames, upV, isRight, minX, maxX, myPredX) {
  var oppMinX = isRight ? 0 : NET_X, oppMaxX = isRight ? NET_X : GROUND_WIDTH;
  var hoverX = isRight ? NET_X + 12 : NET_X - 12;
  var traj = gpTraj(cloneBall(s.ball), 90);
  var coll0 = Math.abs(s.ball.x - s.self.x) <= PLAYER_HALF && Math.abs(s.ball.y - s.self.y) <= PLAYER_HALF;
  var seen = {}, bestPass = null, bestSet = null, anyCross = false;
  for (var tp = minX; tp <= maxX; tp += 2) {
    var c = gpWalkContact(myPredX, tp, traj, minX, maxX, coll0);
    if (c === null) continue;
    var key = c.k + ':' + c.p;
    if (seen[key] !== undefined) continue;
    seen[key] = 1;
    /* [PASS_WINDOW] v7 처럼 착지점 근처 자리만(이른 가로채기 제외). 0 = 전 구간 */
    if (DEF_CFG.PASS_WINDOW > 0 && Math.abs(c.p - landingX) > DEF_CFG.PASS_WINDOW) continue;
    /* 몸리시브 반사(엔진): xV = sign(공x−내x)·idiv(|공x−내x|,3), yV = −max(15,|yV|). 같은 자리면 엔진은 rand(−1..1) → 0 으로 보수 평가 */
    var dxc = c.t.x - c.p;
    var nx = dxc < 0 ? -idiv(-dxc, 3) : (dxc > 0 ? idiv(dxc, 3) : 0);
    var ny = -Math.max(15, Math.abs(c.t.yV));
    var cb = { x: c.t.x, y: c.t.y, xV: nx, yV: ny };
    var tr2 = rxTrajOf(cb, 150);
    var landX = tr2[tr2.length - 1].x, flight = tr2.length;
    /* 튕긴 공이 (서 있는) 내 몸에 다시 닿는 자리는 제외(v7: touches !== 1) — 세트는 몸을 비켜 네트 앞에 떨어지는 것만 */
    var reTouch = false;
    for (var q = 1; q < tr2.length - 1; q++) {
      var u = tr2[q];
      if (Math.abs(u.x - c.p) <= PLAYER_HALF && Math.abs(u.y - PLAYER_GROUND_Y) <= PLAYER_HALF) { reTouch = true; break; }
    }
    var crosses = landX > oppMinX + 8 && landX < oppMaxX - 8;
    var tmargin = PLAYER_HALF - Math.abs(dxc);
    var edgePenalty = (DEF_CFG.TOUCH_MARGIN > 0 && tmargin < DEF_CFG.TOUCH_MARGIN) ? 1 : 0;
    var sticky = (g_recv_p !== null && Math.abs(c.p - g_recv_p) <= 9) ? 40 : 0;
    if (crosses) {
      anyCross = true;
      var ox = clamp(s.opp.x + kg_lastVx * c.k, oppMinX + PLAYER_HALF, oppMaxX - PLAYER_HALF);
      /* [PASS_REACH] 느린 넘기기는 상대가 미리 움직일 시간이 많다. 'L2' = 전지 수비수(접촉 전 자유 이동 포함) / 'gate' = 킬 게이트와 같은 술어 */
      var reach = (DEF_CFG.PASS_REACH === 'L2' && g_oppm !== null) ? (oppTouch(tr2, g_oppm, c.k) >= 0) : gateOppReach(cb, c.k, s, oppMinX, oppMaxX);
      var sc = Math.abs(landX - ox) - flight * 2 + ((reach || edgePenalty) ? 0 : 1000)
             - edgePenalty * (500 + (DEF_CFG.TOUCH_MARGIN - tmargin) * 50) + sticky;
      if (bestPass === null || sc > bestPass.sc) bestPass = { p: c.p, first: c.first, tp: tp, sc: sc, unreachable: !reach && !edgePenalty };
    } else if (!reTouch) {
      var d = Math.abs(landX - hoverX) + edgePenalty * 100 - sticky;
      if (d <= 30 && (bestSet === null || d < bestSet.d)) bestSet = { p: c.p, first: c.first, tp: tp, d: d };
    }
  }
  var pick = null, kind = null;
  if (bestPass !== null && bestPass.unreachable) { pick = bestPass; kind = 'point'; }
  else if (g_touches < DEF_CFG.SET_MAX_TOUCH && bestSet !== null) { pick = bestSet; kind = 'set'; }
  else if (bestPass !== null) { pick = bestPass; kind = 'pass'; }
  if (pick === null) { g_recv_p = null; return { standX: null, anyCross: anyCross, kind: null, act: null }; }
  g_recv_p = pick.p;
  return { standX: pick.p, anyCross: anyCross, kind: kind, act: { x: pick.first, y: 0, hit: 0 } };
}

/* [PASS-JUMP] 지상으로는 못 넘기는 공을 점프+파워히트로 상대 코트에 보낸다. 파워히트는 방향이 항상 상대 쪽(엔진)이라 벽 구석에서도 넘어간다.
 * 확정킬 게이트는 걸지 않는다(안 넘기면 터치초과로 지는 상황). 후보 중 상대(외삽)에서 멀고 체공이 긴 것(내가 착지해 자리 잡을 시간)을 고른다. y=1(급강하)은 제외. */
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
      var ox = clamp(s.opp.x + kg_lastVx * r.lastHitFrame, oppMinX + PLAYER_HALF, oppMaxX - PLAYER_HALF);
      var score = Math.abs(r.landX - ox) + (r.frames - r.lastHitFrame);
      if (!best || score > best.score) best = { jx: jxs[i], smash: smash, score: score };
    }
  }
  return best;
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
  if (DEF_CFG.NO_JUMP_RECEIVE) return null;   // [DEF] 리시브는 지상 블록(낙하점+오프셋)에서만
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
    var myHalf = s.side === 'LEFT' ? s.ball.x < NET_X + 40 : s.ball.x > NET_X - 40;
    if (DEF_CFG.TOUCH_DETECT === 'path' && g_prev.selfX !== undefined) {
      /* [TOUCH v8] mixed_v2 selfSetup 이식: 직전 스냅샷의 공을 프레임별로 굴리며 내 몸(직전→현재 위치 선형 보간, 상자 32)과 겹친 프레임이 있었는지 본다.
       *   접촉은 첫 겹침 프레임에 일어나므로 그때까지의 자유비행 경로는 정확하다. 예전 90×110 근접 상자는 네트 앞 상대 블록을 내 터치로 세거나(과다) 관측 사이 접촉을 놓쳤다(touch_audit.mjs). */
      var dtT = s.tick - g_prev_tick;
      var bT = cloneBall(g_prev.ball), near = Math.abs(s.ball.x - s.self.x) <= PLAYER_HALF && Math.abs(s.ball.y - s.self.y) <= PLAYER_HALF;
      /* 내 몸의 경로는 선형 보간이 아니라 두 스냅샷 위치가 만드는 스윕 상자로 본다: 걷기는 6px 단위로 한 프레임에 몰릴 수 있어(170→176 이 첫 프레임에) 선형 보간은 접촉 프레임 위치를 4px 놓친다. */
      var xloT = Math.min(g_prev.selfX, s.self.x) - PLAYER_HALF, xhiT = Math.max(g_prev.selfX, s.self.x) + PLAYER_HALF;
      var yloT = Math.min(g_prev.selfY, s.self.y) - PLAYER_HALF - 4, yhiT = Math.max(g_prev.selfY, s.self.y) + PLAYER_HALF + 4;
      for (var fT = 1; fT <= dtT && !near; fT++) {
        if (stepBall(bT)) break;
        if (bT.x >= xloT && bT.x <= xhiT && bT.y >= yloT && bT.y <= yhiT) near = true;
      }
      if (near && myHalf) g_touches += 1;
    } else {
      var nearMe = Math.abs(s.ball.x - s.self.x) < 90 && Math.abs(s.ball.y - s.self.y) < 110;
      if (nearMe && myHalf) g_touches += 1;
    }
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
  if (EXP_S2_TRACK) selfSync(s);   // [EXP]
  observeOpponentPattern(s); // [ADAPT-6] 매 판단마다 새 상대 타격만 한 번 기록
  var kgVx = kgOppVx(s); kgTrack(s); kg_lastVx = kgVx;  // [KILL-GATE] 상대 x 속도 외삽용
  g_oppm = EXP_REACH ? oppModelOf(s) : null;   // [EXP-REACH]
  var me = s.self, ball = s.ball;
  if (me.state >= 3) return { x: 0, y: 0, hit: 0 };

  var myPredX = clamp(me.x + g_last_action.x * WALK_SPEED * LATENCY_FRAMES, minX, maxX);

  if (me.state === 1 || me.state === 2) {
    var vy = estimateMyVy(s);
    var me0 = {
      x: me.x, y: me.y, vy: vy, state: me.state,
      delay: (me.state === 2 && me.frameNumber === 0) ? (EXP_S2_TRACK && g_self.state === 2 ? g_self.delay : 3) : 0,   // [EXP]
      frameNo: me.state === 2 ? me.frameNumber : 0,
      collFlag: (Math.abs(ball.x - me.x) <= PLAYER_HALF &&
                 Math.abs(ball.y - me.y) <= PLAYER_HALF)
    };
    var first = { x: g_last_action.x, y: g_last_action.y, hit: g_last_action.hit };

    /* [EXP-REACH] 체공 방향 전환 킬 계획: 남은 체공 틱 동안 fly 를 내고, 재검증(여전히 확정 킬)에 실패하면 버린다 */
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
        if (DEF_CFG.KILL_COMMIT) { g_fast_attack_policy = g_kill_plan.smash; g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS; }   // [KILL-C] 체공 뒤 커밋
        g_kill_plan = null;
      }
    }
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
                             : standbyCenter(isRight, minX, maxX);   // [NEUTRAL v8]
    return { x: walkTo(moveTo, myPredX), y: 0, hit: 0 };
  }

  g_air_policy = null;
  g_fast_attack_until = -1;
  g_fast_attack_policy = null;
  g_kill_plan = null;   // [EXP-REACH]
  var landingX = ball.expectedLandingPointX;
  var ballOurs = isRight ? landingX >= NET_X : landingX <= NET_X;
  var landFrames = framesToLanding(ball);
  var ballOnOurHalf = isRight ? ball.x >= NET_X : ball.x <= NET_X;
  var oppMayHit = CFG.BAND === 1 && !ballOnOurHalf && Math.abs(ball.x - s.opp.x) < 130;
  /* [OPP-FIRST] 공이 아직 상대 코트에 있는데 예상 착지점만 우리 코트인 경우(예: 상대 썬더 토스, vx=-3 로 넘어오는 궤적),
   * 상대가 넘어오기 전에 닿을 수 있으면 상대가 먼저 친다고 보고 공격 분기를 막는다. 안 막으면 findKillJump 가
   * "상대가 안 건드린다" 가정의 microSim 으로 킬을 찾아 상대 스파이크 2틱 전에 점프한다(rally_escape/serve_jump_trace.mjs). */
  var oppFirst = DEF_CFG.OPP_FIRST === 1 && ballOurs && !ballOnOurHalf &&
    defOppContacts(s, isRight ? 0 : NET_X, isRight ? NET_X : GROUND_WIDTH).length > 0;
  var standbyC = standbyCenter(isRight, minX, maxX);   // [NEUTRAL v8]

  /* [EXP] 스스로 상대 코트로 넘어갈 공(낙하점 상대, 공은 내 코트, 상대는 지상이 아님): 그냥 보내면 상대에게 공짜 공.
   * 상대가 못 받는 킬이 있으면 먼저 친다. OPP_FIRST(공이 상대 코트) 와는 조건이 배타적이라 공존한다. 게이트는 findFastAttack/findKillJump 안의 것을 그대로 통과한다. */
  if (EXP_DRIFT_ATTACK && !ballOurs && ballOnOurHalf && !oppMayHit && s.opp.state !== 0) {
    var fa2 = findFastAttack(s, minX, maxX);
    if (fa2 !== null && EXP_DRIFT_ATTACK === 2 && !(fa2.confirmed || fa2.through)) fa2 = null;   // 2 = 확정/관통 킬일 때만
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
      if (DEF_CFG.KILL_COMMIT && !kj2.fly) { g_fast_attack_policy = kj2.smash; g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS; }
      return { x: kj2.jx, y: -1, hit: 0 };
    }
  }
  if (!ballOurs || oppMayHit || oppFirst) {
    var standbyT;
    /* [DEF] ALWAYS_DEF=1: 공이 상대 쪽이면 항상 defenseTarget(상대의 모든 접촉 시점×샷을 놓고 최악 여유가 최대인 x).
     * ALWAYS_DEF=0(v6): 상대가 임박했을 때만 defenseTarget, 아니면 adaptiveDefenseTarget(standbyC). oppFirst 면 항상 defenseTarget. */
    var useDef = DEF_CFG.ALWAYS_DEF ? (!ballOurs || oppFirst)
      : (oppFirst || s.opp.state === 1 || s.opp.state === 2 ||
         (Math.abs(ball.x - s.opp.x) < 90 && Math.abs(ball.y - s.opp.y) < 130));
    if (useDef) {
      var originalDefense = defenseTarget(s, minX, maxX, standbyC, myPredX);
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
    g_pass_jump_until = s.tick + DEF_CFG.PASS_JUMP_COMMIT;   // 의도한 점프: 공중에서 게이트 재거부로 허공에 뜨지 않게
    return { x: fastAttack.jx, y: -1, hit: 1 };
  }

  var kill = findKillJump(s, minX, maxX);
  if (kill !== null) {
    g_air_policy = kill.smash; g_pass_jump_until = s.tick + DEF_CFG.PASS_JUMP_COMMIT;   // 의도한 점프
    g_kill_plan = kill.fly ? { fly: kill.fly, ticks: kill.flyTicks, smash: kill.smash, tick0: s.tick } : null;   // [EXP-REACH]
    if (DEF_CFG.KILL_COMMIT && !kill.fly) { g_fast_attack_policy = kill.smash; g_fast_attack_until = s.tick + FAST_ATTACK_CFG.COMMIT_TICKS; }   // [KILL-C] fly 계획이면 체공 뒤에 커밋
    return { x: kill.jx, y: -1, hit: 0 };
  }

  var icept = findIntercept(s, myPredX, minX, maxX);
  if (icept !== null) {
    var jx = walkTo(icept.targetX, myPredX);
    return { x: jx, y: icept.jump ? -1 : 0, hit: 0 };
  }

  var offset = null;
  var upV = Math.max(15, Math.abs(ballAfter(ball, landFrames - 1).yV));
  var plan = DEF_CFG.GROUND_PASS ? groundPassPlan(s, landingX, landFrames, upV, isRight, minX, maxX, myPredX) : null;
  var planX = null;
  if (plan !== null) {
    planX = plan.standX;
    /* [PASS-JUMP] 지상으로 넘길 후보가 하나도 없으면(벽 구석 등) 점프+파워히트로 넘긴다 */
    if (!plan.anyCross && DEF_CFG.PASS_JUMP) {
      var pj = findPassJump(s, minX, maxX);
      if (pj !== null) {
        g_air_policy = pj.smash; g_pass_jump_until = s.tick + DEF_CFG.PASS_JUMP_COMMIT;
        return { x: pj.jx, y: -1, hit: 0 };
      }
    }
  }
  if (planX === null) {
    if (g_touches >= 3) offset = 18;
    else {
      var flight = 2 * upV + 2;
      var hoverX = isRight ? NET_X + 12 : NET_X - 12;
      var needXv = (hoverX - landingX) / flight;
      offset = clamp(Math.round(3 * Math.abs(needXv)) + 1, 4, 26);
    }
  }
  var targetX = planX !== null ? planX : clamp(landingX - towardNet * offset, minX, maxX);
  var dx = targetX - myPredX;
  var x = (plan !== null && plan.act) ? plan.act.x : walkTo(targetX, myPredX);   // [RECV v8] co-sim 의 첫 걸음을 그대로 낸다(walkTo 사각 없음)

  var dist = Math.abs(dx);
  /* [DIVE] 다이빙은 "걸어서는 몸(반폭 32)이 못 닿고 다이빙으로는 닿을 때"만. v5_1 규칙은 걷기 판정에서 반폭을 빼지 않아
   * 18px 떨어진 공에도 다이빙했다(rally_escape/dive_diag.mjs: RedTeam 상대 다이빙 170회 중 터치 67회). */
  if (DEF_CFG.DIVE_MODEL) {
    if (landFrames < 24) {
      var rs = defReachSplit(kgTrajectory(cloneBall(s.ball), 48), myPredX, 1, isRight);
      /* [DIVE] 걸어서는 못 닿고, "지금 시작하는" 다이빙으로 닿을 때만. 나중 다이빙으로 닿는 경우는 계속 걷는다(최대한 걷다가 마지막에 다이빙). 방향은 접촉점 쪽(뒤로도). */
      if (rs.walk < 0 && rs.diveNow >= 0) return { x: rs.diveDir || (landingX > myPredX ? 1 : -1), y: 0, hit: 1 };
      /* [DIVE-HM] 어느 쪽으로도 못 닿는다고 판단 = 이대로면 실점. 공이 곧(≤16프레임: 다이빙 11 + 누움 5 안) 떨어지면 마지막 시도로 다이빙. 나중 다이빙으로 닿는 경우(rs.dive≥0)는 위에서 걷기 유지. */
      if (DEF_CFG.DIVE_HAILMARY && rs.walk < 0 && rs.dive < 0 && landFrames <= 16 && landFrames >= 2) {
        return { x: landingX > myPredX ? 1 : -1, y: 0, hit: 1 };
      }
    }
  } else {
    var needWalk = dist - PLAYER_HALF;
    if (landFrames < 24 && needWalk > WALK_SPEED * landFrames + 2 &&
        dist <= DIVE_SPEED * landFrames + 44 && (ball.y > 140 || landFrames <= 10)) {
      return { x: dx > 0 ? 1 : -1, y: 0, hit: 1 };
    }
  }
  return { x: x, y: 0, hit: 0 };
}

function savePrev(s) {
  g_prev = {
    ball: { x: s.ball.x, y: s.ball.y, xVelocity: s.ball.xVelocity, yVelocity: s.ball.yVelocity },
    selfY: s.self.y, selfX: s.self.x,
    oppY: s.opp.y, oppState: s.opp.state   // [EXP-REACH]
  };
  g_prev_tick = s.tick;
}

function decide(s) {
  var action;
  try { action = decideCore(s); } catch (e) { action = fallbackAction(s); }
  g_prev_action = g_last_action;   // [EXP]
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
    last: function () { return g_last_action; },   // 검사용
    rx: { oppTouch: oppTouch, oppModelOf: oppModelOf, RX_JUMP: RX_JUMP, RX_DIVE: RX_DIVE, rxTrajOf: rxTrajOf },
    kg: { kgOppCanReach: kgOppCanReach, kgTrajectory: kgTrajectory, kgIsGuaranteedKill: kgIsGuaranteedKill, gateOppReach: gateOppReach, standbyCenter: standbyCenter, defWindow: defWindow, diveBody: diveBody, KILL_GATE: KILL_GATE, DEF_CFG: DEF_CFG }
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
