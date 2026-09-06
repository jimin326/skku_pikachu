# Lion_Eating_Bank_v11 — v10 + 썬더 서브 리시브 (2026-09-04 밤, 최종 기본값 TH_RETREAT_ADAPT 2)

생성: `V8_THUNDER=1 V8_NET_HAZ=0 V8_DEF_HOLD_K=0 V8_TOUCH_MARGIN_EXACT=9 V8_NET_TOP=0 node --no-warnings tools/v8/build_v8.mjs 32 bot/Lion_Eating_Bank_v11.js`
(v10 레시피 STEP 28 + STEP 30·31, STEP 29 는 코드만 포함·`NET_TOP: 0` 비활성, STEP 32 는 노브 `DIVE_LATE: 0`). 손으로 고치지 말 것.

## 바뀐 것 (v10 대비)

1. **STEP 30 [WALK-FIX]** — 다이빙 게이트(defReachSplit)의 걷기 도달이 1프레임(6px) 낙관이었다. 스냅샷 스텝에는 이전 입력이 적용되고 그 몫은 myPredX 에 이미 들어 있으므로 새 입력으로 걷는 프레임은 `p.n − react` 개. 다이빙 항은 실측과 일치. 증상: 걷기 여유 0~5 로 나오면 걷다가 1~5px 놓치고 다이빙을 안 냈다.
2. **STEP 31 [TH-RETREAT]** — 상대 서브 시퀀스(STEP 29 의 `g_nt.seq`, 공이 아직 내 코트로 안 넘어옴)에서 상대가 네트 앞(≤64px) 공중이고 첫 접촉이 4스텝 안이며 내가 블록 자리(네트 ≤72px)면 네트 반대쪽으로 걷는다. 한 번 시작하면 접촉까지 유지.
   - 왜: Lion 계열 썬더(v5_1·v6D·v10·LionBC 의 CAMP_ESCAPE)는 킬 틱 스냅샷(접촉 4프레임 전)에 내가 블록 자리면 킬(248) 대신 평타(vy0 → 뒷벽 → 388)로 이탈한다. 정지해 있으면 그 평타는 어떤 타이밍으로도 못 받고(오라클), 이탈 판정 전에 물러나면 진짜 킬이 온다. 유일한 창 = 이탈 판정 스냅샷부터 접촉 전까지 후퇴.
   - NEED: 예측 킬 접촉(y≈171 에 가장 가까운 접촉)의 평타를 이 위상의 관측 지연으로 지금 자리에서 받을 수 있으면 후퇴하지 않는다(LionBC 는 킬 프레임이 스냅샷과 겹쳐 264 에서 그대로 받는다 → v10 동작 유지).
   - ADAPT 2(최종 기본값, opt-in): STEP 29 의 터치 순번별 깊은 평타 EMA 가 그 순번에서 ≥0.5 로 기록된 뒤에만 후퇴한다. 첫 서브는 v10 처럼 블록 자리를 지킨다 → 진짜 킬을 치는 서버·일반 봇엔 v10 과 결정이 같고, 이탈 서버에겐 게임당 위상별 첫 서브만 내준 뒤 100% 받는다. ADAPT 1(급강하 기록이 없으면 후퇴)은 우리 포크 상대에만 유리하고 비이탈 서버 상대 ph1 랠리 승 100→56% 라 기각. 제출은 한 값으로 고정해야 하므로 2.
3. 기각·꺼둔 것: 헤일메리 다이빙(DIVE_HAILMARY, 628회 발동 0 터치), DIVE-LATE(늦은 다이빙이 뒷벽에서 끝나 v10 서버 ph2 리시브 뒤 승 26%→0%), NET-TOP(STEP 29, 미검증·기본 0).

## 벤치 (tools/rally_escape/cmp_bench.mjs, 24시드×좌우=48경기/칸, 지연 1)

| 상대 | v10 | v11 |
|---|---|---|
| NetCamper_v2 / AC_v5_2 / OurBot_v12 / RedTeam_RL_v1 | 48-0 (100/100/100/97%) | 동일 |
| LionBC_v4 | 48-0 84% (리시브 67%) | 48-0 84% (68%) |
| Lion_Eating_Bank_v5_1 | 24-24 (리시브 0%) | 48-0 100% |
| Lion_Eating_Bank_v6_Defense | 29-19 (0%) | 48-0 69% (40%) |
| Lion_Eating_Bank_v10 | 24-24 (0%) | 43-5 63% (26%) |

썬더 서브 터치율(tools/ph0_recv/th_recv.mjs, 12시드, 게임마다 새 인스턴스): ADAPT 1 이면 v5_1·v6D·v10·LionBC 전 위상 100%, 최종 ADAPT 2 는 v5_1 상대 ph0 68%·ph1 48%·ph2 72%(위상별 첫 서브 손실 뒤 100%). 이탈 없는 서버(CAMP_ESCAPE 0) 상대는 v10 과 동일(블록 100%). ADAPT 2 풀 12시드: NC/AC/OurBot/RT 24-0, LionBC 24-0 85%, v5_1 24-0 85%, v6D 24-0 69%, v10 22-2 62%. 위 24시드 표는 ADAPT 1 기준.
지연 지터 10%(내 쪽만): LionBC 21-3, v5_1 24-0, v10 16-8 (v10 기본은 14-10 / 3-21 / —). 결정 시간 p99 ≤ 0.45ms, max ≤ 8ms.

## 주의

- 후퇴 창이 1~2스냅샷이라 실기(Chrome) 검증 필수. 결과는 tools/ph0_recv/ 와 메모리 ph0-serve-v6d-vs-v10 참조.
- defReachSlack(수비 자리 평가, REACT 4)에도 같은 `+1` 식이 있으나 손대지 않았다(수비 자리 전체가 바뀌므로 별도 벤치 필요).

## Chrome 실기 (2026-09-04 22:3x, tools/harness/run.mjs, fast, 10점, 스크래치 dist, 결과 tools/ph0_recv/out/chrome_v11_2026-09-04.json, 파서 tools/ph0_recv/chrome_parse.mjs)

| 경기 | 점수 | 상대 썬더 서브 리시브(터치/서브) |
|---|---|---|
| v5_1(L) vs v11(R) | 0-10 | ph0 1/1 · ph1 1/1 (그 뒤 v5_1 밴딧이 ac 로 전환) |
| v11(L) vs v5_1(R) | 10-0 | ph0 2/2 |
| v10(L) vs v11(R) | 6-10 | ph0 2/2 · ph1 1/1 · ph2 4/4 |
| v11(L) vs v10(R) | 10-9 | ph0 3/3 · ph1 1/1 · ph2 2/2 |

Lion 계열 썬더(이탈 평타) 리시브 실기 17/17 터치. 터치 뒤 랠리 승은 v5_1 상대 100%, v10 상대 3/13(시뮬과 같은 경향). 반대로 v10 은 v11 서브를 ph0·ph1 에서 0/7 터치(ph2 이탈 평타는 6/9 터치했으나 0승).

## Chrome 실기 2차 — 최종 ADAPT 2 (결과 tools/ph0_recv/out/chrome_v11_adapt2_2026-09-04.json)

| 경기 | 점수 | 상대 썬더 서브 리시브(터치/서브) |
|---|---|---|
| v11(L) vs v5_1(R) | 10-2 | ph0 3/4 (첫 서브 손실 뒤 3/3) |
| v5_1(L) vs v11(R) | 1-10 | ph0 4/5 |
| v10(L) vs v11(R) | 6-10 | ph0 1/2 · ph1 1/1 · ph2 3/4 |
| v11(L) vs v10(R) | 10-5 | ph0 0/1 · ph1 1/2 · ph2 2/2 |

학습(깊은 평타 관측 뒤 후퇴)이 실기에서도 동작: 위상별 첫 서브만 내주고 이후 리시브. 내준 점수가 ADAPT 1 의 10-0 대비 1~2점.

## FLY-3 추가 (2026-09-05 새벽, 사용자 지시)

`node tools/flyticks/apply_fly3.mjs bot/Lion_Eating_Bank_v11.js` — findKillJump 체공 방향 전환 후보 [0,1,2]→[0,1,2,3] (v10_1 에 있던 것과 같은 패치, 앵커 2개·중복 적용 방지). 상한 3 = KILL_MAX_CONTACT 16 에서 유도, 4 이상은 동일. 근거 tools/flyticks/FINDINGS.md.

검증 (fly3 전/후를 같은 시드로, 이 파일 기준 THUNDER_SERVE 1):

| 항목 | fly3 전 | fly3 후 |
|---|---|---|
| 결정론 풀 24시드×좌우 (NC/AC/OurBot/RT/LionBC/v5_1/v6D/v10) | 8칸 전부 48-0 | 동일 (승패·랠리·점프·다이빙 횟수까지 일치) |
| mixed_v2 가짜시계 (bench_fly.mjs, seed0 1000, 24시드) | 48-0 랠리 83% (내 서브 86%) | 48-0 랠리 87% (내 서브 93%) |
| mixed_v2_adaptive 가짜시계 | 48-0 80% | 48-0 81% |
| 맞대결 fly3 vs 전 (THUNDER 0 미러) | 24-24 50% | — |
| rule_check (vs v10·LionBC) | — | p99 12.7ms, max 63ms, 예외 0 |

THUNDER_SERVE 를 0 으로 바꾼 같은 파일에서는 fly3 전후가 전 칸 동일(mixed_v2 47-1 69%, adaptive 35-13 60%). fly3 이득은 썬더 서브 뒤 킬 국면에서만 나온다.

주의 — THUNDER_SERVE 0 의 비용(같은 파일, 노브만 0, 24시드): LionBC 48-0→44-4, v6D 48-0→23-25, v10(THUNDER 0) 48-0→24-24, mixed_v2 83→69%, adaptive 80→60%. NC/AC/OurBot/RT/v5_1 은 48-0 유지. Chrome 에서도 THUNDER 0 미러(v10 상대)는 8분 상한에 걸려 5-4 / 4-5 미완.

Chrome 실기 (tools/harness/run.mjs, fast, 10점, 스크래치 dist, 8분 상한, timing 훅):
- THUNDER 0 + fly3 (작업트리 파일, 결과 스크래치 chrome_fly3.json): v5_1 상대 10-3 / 3-10, mixed_v2 상대 10-3 / 7-2(미완), v10(THUNDER 0) 상대 5-4 / 4-5(미완, 교착 랠리). 워커 왕복 p99 ≤ 13ms, max 23ms, 타임아웃·무효응답·재시작·PAGEERROR 0.
- THUNDER 1 + fly3 (이 파일, 임시 이름 Lion_Eating_Bank_v11T1 로 빌드, 결과 스크래치 chrome_T1fly3.json): 6경기 전승 — v5_1 상대 10-1 / 2-10, v10(THUNDER 0) 상대 10-1 / 0-10, mixed_v2 상대 10-1 / 3-10. 워커 왕복 p99 ≤ 14ms, max 93ms(v10 경기 1회, 120ms 목표 안), 타임아웃·무효응답·재시작·PAGEERROR 0. Lion 계열 썬더 리시브(TH-RETREAT)는 fly3 뒤에도 동작(v5_1 ph0 이탈 서브 3/4·2/3 터치, v10 ph2 이탈 서브 7/8·5/5 터치).
