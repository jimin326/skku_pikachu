# Lion_Eating_Bank_v11 검증 보고서 (2026-09-05)

검증 파일: `src/code-here/Lion_Eating_Bank_v11.js` SHA-256 `3a2981e2ff241600b42a704b10847f671f21b1e77c3ee02c96ceff30e283ffc1`, 2,541줄 / 182,700바이트. 사본 확보 2026-09-05 00:48:18, 01:03:19 재확인 시 해시 동일(검증 중 변경 없음). 원문 프롬프트의 `{{담당}}` 자리가 비어 있어 A·B·C 세 영역을 모두 깊게 다뤘다.

## 판정

**제출 가능(현재 파일 그대로).** 실격·크래시·무입력·좌우 비대칭에 해당하는 치명 항목은 없다. 단 두 가지를 알고 제출할 것.

1. `SK.fire`(스킬 발동 키를 반환 객체에 넣는 경로)는 지금 상태로는 **무효**다. `sanitize`가 키를 버린다(실행으로 확인). 당일 "반환 객체에 새 키를 넣어 발동하는" 스킬이면 한 줄 수정이 필요하다(#1).
2. 데드볼 가드가 "서브공이 x 56/376·y≤6에 보일 때"만 풀린다. 스킬이 서브 시작 위치·초기 공을 바꾸는 종류면 첫 득점 뒤 경기 내내 무입력이 된다. 가이드상 룰 불변이라 발생 가능성은 낮지만, 정상 흐름 출력이 동일한 한 줄 백스톱이 있다(#2).

## 검증에 쓴 실행 결과 (이번 세션)

| 항목 | 결과 |
|---|---|
| `node --check` | 문법 OK |
| `bot-dev/rule_check.mjs` (vs builtin, v10, 시드 101, 좌우) | 178.4KB, 최상위 decide 있음, 금지 토큰 0, init 2.6ms, 10,151회 호출 avg 4.4 / p50 5.1 / p99 10.5 / max 41.0ms, >120ms 0, >360ms 0, 예외 0, 무효 반환 0, 4-0 |
| 내부 예외 카운터 (`decide.__state.errors`, `__ac.errors()`), sim_real 4경기 | 전부 0 |
| `eval_skill.mjs` + `skills/example_gauge.mjs` (v11, N=1) | 스킬 OFF 12-0(100%), ON 11-1(91.7%) → 훅이 v11에 그대로 먹힘 |
| Chrome 실측 (이 세션은 미실행, `Lion_Eating_Bank_v11.md` 09-04/05 기록) | 워커 왕복 p99 ≤14ms, max 93ms, 타임아웃·무효·재시작·PAGEERROR 0 |
| 4배 CPU 스로틀 (v10, `harness/rule_timing_throttle4.json`) | p50 32 / p99 66 / max 98.5ms, >120ms 0 |

## 지적 표

등급: 치명 = 실격·크래시·무입력·좌우 비대칭 등 결과 직결 / 중요 = 특정 조건에서 점수·대응력 손실 / 정리 = 동작 불변 정리 또는 기록.

| # | 영역 | 등급 | 파일:줄 | 문제 | 근거 | 재현 | 수정안 | 확신도 |
|---|---|---|---|---|---|---|---|---|
| 1 | B3/A1 | 중요 | v11.js:2526 (+2442, 181) | `SK.fire=1`이 반환 객체에 넣는 `a[SK.key]=1`이 최종 반환에서 사라진다. 당일 "새 키로 발동"형 스킬이면 스킬 블록이 아무 일도 안 함 | `sanitize`(2442)는 `{x,y,hit}` 세 키만 가진 새 객체를 만들고, 2526은 `fin = sanitize(applySkill(...))`로 그 결과만 쓴다 | 스크래치 `sk_key_test.mjs`: SK.on=true, fire 조건을 무조건 참으로 바꿔 호출 → 반환 `{"x":0,"y":0,"hit":0}`, `skill` 키 없음 | 2526 한 줄 교체: `try { var skA = applySkill(s, { x: pre.x, y: pre.y, hit: pre.hit }) \|\| pre; fin = sanitize(skA); if (SK.on && skA[SK.key]) fin[SK.key] = skA[SK.key]; } catch (e) { M.errors.skill++; fin = pre; }` (엔진 `isValidBotAction`은 추가 키를 무시하므로 안전). SK.on=false면 출력 동일 | 100%(실행) |
| 2 | B1/A5 | 중요(잠재) | v11.js:2483-2485, 2496 | 데드볼 가드 `waitingForServe`는 득점 뒤 "공 x∈{56,376}·xV 0·y≤6"을 봐야만 풀린다. 서브 위치·초기 공 상태를 바꾸는 스킬·룰이 오면 첫 득점 뒤 경기 끝까지 `neutral()` 반환 | 2484 `serveBall` 조건, 2485 해제 조건이 이것뿐 | 추론(엔진 `initializeForNewRound` x를 바꿔 sim_real을 돌리면 재현 가능, 미실행). 가이드 §3·§12는 룰 불변을 명시 | 2485 한 줄: `if (M.waitingForServe && (serveBall \|\| (rfc >= 45 && s.self.state < 5 && (sc.self \| 0) < 10 && (sc.opp \| 0) < 10))) M.waitingForServe = false;` (`sc`·`rfc`는 2478·2480에서 정의됨). 정상 흐름에서는 READY 첫 스냅샷(rfc 12~13)에 serveBall로 먼저 풀리고, 경기 종료 뒤(포즈 state 5/6·10점)는 제외되므로 출력 동일 — 아래 "수정안 검증" 참조. `state < 5`·`< 10` 조건이 없는 단순형은 경기 종료 뒤 211프레임(공이 계속 튀는 구간)에서 WAIT를 풀어 시뮬에서 493틱 불일치가 났다(실엔진은 포즈 state라 무해하지만 굳이 다르게 둘 이유 없음) | 결함 조건은 추론, 코드 경로는 100% |
| 3 | A5/A6 | 정리 | v11.js:2088, 2496, 2090 | 랠리 시작 터치 리셋 `rallyFrameCount < 4`(2088)가 실전 흐름에서 도달 불가. 득점 스냅샷(rfc 0~2)은 2496 WAIT가 삼켜 `ACCore.decide`가 불리지 않고, 다음 호출은 READY(rfc ≥11). 게다가 2090 `ballAfter(g_prev.ball, dt)`에 틱 간격 상한이 없어 죽은 공의 바운스 궤적이 내 스윕 상자를 지나 가짜 터치 +1 | sim_real 계측(`touch_carry.mjs`): 경기당 리셋 도달 1회(첫 스냅샷뿐), READY 첫 스냅샷에서 내 서브 랠리 5/6이 `g_touches=1`로 시작 | 위 스크립트 | 영향: 내 서브에서 썬더가 소유하는 동안은 무관, AC 서브(밴딧 ac·썬더 포기)·서브 직후 공중 정책에서만 터치 예산이 1 적어짐. 한 줄 수정 `if (s.meta.rallyFrameCount < 4 \|\| (s.ball.xVelocity === 0 && s.ball.y === 0 && (s.ball.x === 56 \|\| s.ball.x === 376)))` 전후: 8경기(v10·NetCamper 각 2시드×좌우) 점수·랠리 수 전부 동일, shadow_diff 18,788틱 중 8틱만 다름(전부 v10 상대 내 서브 직후 state 2에서 원본은 걷기, 수정본은 예산이 남아 강타 선택) → **대회 전 수정 불필요**, 기록만 | 100% |
| 4 | A5 | 정리 | v11.js:155, 253-279 | `NEW_GAME_RESET=0`: 서브 모드 밴딧 기록(`BC.stats`)이 세트·매치·상대 교체를 넘어 이월. 운영 PC에서 우리 side 설정이 같으면 Worker가 재사용된다(가이드 §5.1) | 코드·가이드 | — | **유지 권고.** 본선 3세트에서 세트 간 학습 유지 이득이 크고, 이월 손실은 위상당 최대 1랠리(ac로 져도 `AC_LOSS_COMEBACK`이 썬더 복귀). 상대 교체 시 매번 손해 보는 구조가 아님 | 판단 |
| 5 | A4 | 정리 | v11.js:1114-1115, 1817, 2172, 2279 (1791은 비활성) | 틱 그룹 3 하드코딩(점프 유지 `until: 4`, 체공 `4+3h`, `1+3*`, `%3`). Thunder는 329에서 스스로 꺼짐 | 계약 `TICK_FRAME_GROUP_SIZE=3` 고정, 당일 "새 필드 추가만" | — | 손대지 말 것. 만약 바뀌면 THUNDER_SERVE=0 + 위 4곳을 `g_group`으로 | 100% |
| 6 | A6 | 정리 | (해당 코드 없음) | 4분 제한·골든볼 인지 로직 없음. 앞설 때/뒤질 때 행동 차이 없음 | 엔진에도 없음(가이드 §15) | — | 전날 추가 금지. 교착은 STALE(2074, `STALE_N 3`)이 자리를 바꿔 깨뜨림 | 100% |
| 7 | B3 | 중요 | v11.js:561-579, 148 | "공격 끄기" 단일 스위치 없음. `KILL_GATE.MARGIN 999`는 지상 킬 점프를 47→29, 47→18, 33→12, 44→18로 줄이지만 공중 상대 대상 킬(736 분기)과 넘기기 점프(1803, 게이트 없음)는 남음 | `margin_test.mjs`(v10 상대 2시드×좌우, 점수 10:6/10:5/10:0/10:5 유지) | 위 스크립트 | 당일 최후 안전판을 **`THUNDER_SERVE=0`(148) + `KILL_GATE.MARGIN=999`(565)** 조합으로 문서화("확정킬 대부분 차단, 넘기기 유지"). 완전 무점프는 벽 구석 공을 못 넘겨 터치초과 실점이 되므로 만들지 않는다 | 100% |
| 8 | A3 | 정리 | v11.js:2437 | `M` 초기값의 `loggedFields: false, loggedError: false,`가 앞 주석에 삼켜져 정의되지 않음(STEP 6 CLEAN 패치 사고) | `undefined`도 falsy라 `logOnce`·`logNewFields`는 같은 동작 | — | 두 항목을 다음 줄로 옮기기(출력 동일). 급하지 않음 | 100% |
| 9 | A4 | 정리 | v11.js:1501-1560, 1690-1760 | 후보 스캔이 `minX→maxX` 오름차순이라 완전 동점 시 first-found가 LEFT는 벽 쪽, RIGHT는 네트 쪽 | 코드. 이전 세션 검증(메모리 teammate-v10-feedback-verdict): 미러 좌편향은 동점순서 원인 아님·실상대 좌우 차이 없음 | — | 손대지 말 것 | 90% |
| 10 | A5 | 정리 | v11.js:141-142, 2436, 2470-2477 | `M.latWin`(지연 증거)은 리셋되지 않음. 일시적 부하로 지연2 증거가 30샘플 창에서 우세하면 이후 서브에서 썬더 포기 → AC 서브(승률 낮음) | 코드 | — | 의도된 가드(지연2에서 썬더 0%). 창 30이라 자동 복구. 기록만 | 100% |
| 11 | B2 | 정리 | v11.js:140, 2453-2460 | 새 필드 로그가 `DEBUG`에 묶임. 로그는 Worker당 1회, `self/opp/ball/meta/config` 하위와 최상위 새 키를 값과 함께 출력 | 코드 | 실행: 새 필드 없을 때 `새 스냅샷 필드: 없음` 출력 확인 | **DEBUG=true 유지**(제출본 그대로). 로그 비용은 랠리당 ≤2줄(썬더 발동·포기·이탈·모드 전환), 문자열 조립은 전부 `if (DEBUG)` 안 | 100% |
| 12 | C3 | 중요(저장소) | `.gitignore` | `bot-dev/runs/` 3.2GB, `bot-dev/*/out/` 28MB+가 미추적·미무시. `git add -A` 한 번에 3.2GB가 스테이징됨 | `du -sh` | — | `.gitignore`에 `bot-dev/runs/`, `bot-dev/*/out/` 두 줄 추가 | 100% |
| 13 | A9 | 미확인 | — | 제출 파일명: 가이드 §4.1은 `팀명.js` 업로드 시 `_v버전` 자동 부여. 한글 팀명("사자먹는은행") 업로드 허용 여부는 사이트에서 미확인 | 가이드 | — | 제출 직후 /submissions 내역에서 표시 확인. 거부되면 영문 팀명으로 문의. 로컬 레지스트리(`botRegistry.js:27,43`)는 한글 파일명을 받는다 | 미확인 |
| 14 | A1/A2/A7/A8 | 확인 | v11.js:2532-2535, 2442, 177-184 | 최상위 `decide` 존재, 이중 try/catch(오케스트레이터 → `sanitize(fallbackAction)` → `neutral()`), `sanitize`가 `\|0`·`clampDir`로 NaN·소수·범위 밖을 정수 -1/0/1·0/1로 강제. fetch/XHR/Worker/import/require/DOM/Date/performance/setTimeout 사용 없음(grep 0, rule_check 0). 스냅샷 새 필드는 열거 로그만 하고 검증·구조분해 없음. 초기화 무거운 연산 없음(init 2.6ms, 표 크기 작음) | rule_check·grep·코드 | rule_check | 이상 없음 | 100% |
| 15 | A3 | 확인 | v11.js:233, 270, 2436, 2489, 2101 | 무한 성장 전역 없음: `BC.log` ≤120, `M.rallies` ≤400, `M.latWin` ≤30, `g_touch_hist` ≤8, `recentDepths` ≤8, `g_neutral_cache` 2. 최악 경로(지상: findFastAttack 18 + findKillJump 270 microSimSeq + groundPassPlan 77목표 + PASS_SIM)도 Node max 41ms, Chrome max 93ms | 코드·실측 | rule_check | 이상 없음 | 100% |
| 16 | A6 | 확인 | v11.js:2084-2114, 1086, 1164, 1252, 1292, 1806 | 5터치: 내 터치는 관측 간 궤적 이탈 × 스윕 상자로 감지, 진영 교대(216 기준 스냅샷 관측) 시 0. 예산 `4 − g_touches`로 4번째 터치까지만 계획(5번째 = 실점과 일치). 엔진 `touchLimit.js`와 리셋 조건 같음(스냅샷 3프레임 간격 때문에 짧은 네트 리바운드 왕복은 봇이 과다 계수 → 보수적) | 코드 대조 | — | 이상 없음(#3의 이월만 예외) | 95% |
| 17 | A5 | 확인 | v11.js:1849-1867, 1954-1966, 253-259 | 학습 상태 초기화: `g_adapt`·`g_nt`(TH_RETREAT의 깊은 평타 EMA)는 점수 감소(새 게임)·side 변경에서 초기화(1966). 밴딧은 #4. `MAX_BLEND 0`이라 적응 수비는 어차피 무효. 15회 타임아웃 재시작 후: 전역 전부 초기 → `M.prevScore -1`이라 WAIT 없이 즉시 참여, `g_prev null`이라 첫 틱 터치 감지만 건너뜀 | 코드 | — | 이상 없음 | 100% |
| 18 | A4 | 확인 | v11.js:319-331, 399, 282, 2468-2470, 2146-2149 | 좌우: Thunder는 x를 `432−x`로 정규화·출력 x 부호 반전(399), 상대 위치·지연 증거·시작 위치 검사 모두 정규화. AC는 `isRight`로 코트 범위·방향·hover·서브 위치(56/376) 분기. 파워히트 방향은 엔진과 같이 네트 기준(1013, 1067) | 코드 | rule_check 좌우 각 2경기 4-0 | 이상 없음(#9 제외) | 100% |

### 수정안 검증 (shadow_diff, 같은 스냅샷 열에서 출력 비교)

`node --no-warnings bot-dev/v8/shadow_diff.mjs src/code-here/Lion_Eating_Bank_v11.js <후보> Lion_Eating_Bank_v10,NetCamper_v2,AdaptiveCounter_v5_2 2` (시드 2×좌우 = 상대당 4경기, 18,788틱).

- #1+#2 묶음(위 표의 최종형): **mismatch 0 / 18,788**, 예외 0, 시간 동일(p99 0.70ms). → 지금 적용해도 정상 흐름 출력이 바뀌지 않는다.
- #1+#2 단순형(`rfc >= 45`만): mismatch 493(2.6%) — 전부 경기 종료 뒤 211프레임 구간(시뮬은 승패 포즈 state 5/6을 안 세워 봇이 걷기 시작). 실엔진에서는 무해하나 최종형을 쓸 것.
- #3(터치 리셋): mismatch 8(0.04%), 전부 v10 상대 내 서브 직후 state 2 틱(원본은 예산 부족으로 걷기, 수정본은 강타). 8경기 점수·랠리 수 동일.

세 수정을 앵커 검사와 함께 적용하는 스크립트: `node bot-dev/v11_patch.mjs <파일> [--check] [--touch]` (기본은 #1+#2, `--touch`를 주면 #3까지). 적용 뒤 반드시 `rule_check.mjs`와 위 shadow_diff를 다시 돌린다.

## B1. 엔진 가정 목록 — 스킬이 바꾸면 어디가 깨지는가

모든 공 궤적은 `stepBall`(509-524) 한 함수를 지난다. 파워히트·몸리시브 공식은 여러 곳에 복제돼 있다.

| 가정 | 값 | 코드 위치 | 스킬이 바꾸면 | 당일 조치 |
|---|---|---|---|---|
| 중력 +1/프레임, 천장 y<0→vy 1, 벽 x<0·>432 반사, 네트 176/192·반폭 25, 바닥 252 | 엔진과 동일 | `stepBall` 509-524; 서브 낙하표 `TH_YTABLE` 191; 썬더 기대 위치 `TH_EXPECT` 216 | 수비 자리·킬 게이트·넘기기·다이빙 판정 전부 어긋남. 썬더는 `SELF_CHECK`(365-373)가 1틱 안에 이탈을 잡아 AC로 넘김(자동) | `THUNDER_SERVE=0`(148) 먼저. 그 다음 새 `physics.js`의 `processCollisionBetweenBallAndWorldAndSetBallPosition`을 `stepBall`에 그대로 옮김 |
| 공 y속도 상한 ±40 | 40 | 417, `stepBall` 510 | 급강하 착지 예측 오차 → 킬 게이트 과신·수비 자리 | 417 값 변경 |
| 파워히트: xV = (\|x\|+1)·10, 방향은 네트 기준, yV = max(15,\|vy\|)·y·2 | 엔진과 동일 | 내 강타 `microSim` 1013-1014, `microSimSeq` 1067-1068, `powerHitLanding` 538-543; 상대 샷 위협 `defShotTrajs` 1388-1390; (비활성) `kgCoverGate` 797 | 내 강타: 게이트를 통과한 샷이 네트에 걸리거나 아웃. 상대 샷: 위협 집합이 틀려 수비 자리 오류 | 4곳 공식을 새 값으로. 상대만 강화되면 `defShotTrajs`에 강화 궤적을 추가(B4-b) |
| 몸리시브: xV = ±idiv(\|dx\|,3), yV = −max(15,\|vy\|), xV 0이면 rand(−1..1)(코드는 0 가정) | 엔진과 동일 | 1005-1010, 1059-1064, `groundPassPlan` 1707-1710, 상대 몸리시브 근사 `defShotTrajs` 1394(bvs 10/5/1) | 지상 리시브 자리·넘기기 착지 예측 오류 → 자책·터치초과 | 3곳 공식 변경 |
| 걷기 6px/프레임, 점프 vy −16 +1/프레임(정점 16프레임), 다이빙 첫 +6 뒤 +8×12·y표·누움 5프레임 | 엔진 실측 | 422 `WALK_SPEED`; 점프 `microSimSeq` 1046, `selfStep` 466-475, `KG_JUMP_Y` 651, `RX_JUMP` 849, `BC_JUMP_Y` 235; 다이빙 `KG_DIVE_Y` 657, `DIVE_Y_TABLE` 668, `DIVE_TOUCH_FRAMES` 669, `RX_DIVE` 850 | 상대 도달 모델(킬 게이트 722·수비 1331)이 상대를 과소평가 → 막히는 스파이크·수비 구멍. 내 점프 접촉 예측(1026)·다이빙 판정(1432) 오류 | 상대만 강화: `KILL_GATE.MARGIN`↑(565), `REACT` 3→2(564), `DEF_CFG.REACT`↑(581). 나까지 바뀌면 위 표를 새 값으로 재생성(`(function(){...})()` 표는 vy 초기값·증분만 바꾸면 됨) |
| 히트박스: 플레이어·공 겹침 = \|dx\|≤32 & \|dy\|≤32 | 32 | 418 `PLAYER_HALF`(나·상대 공용, 전역 사용) | 크기 변화 스킬. 상대만 커지면 별도 상수가 없어 도달 모델이 과소평가 | 상대만: `KILL_GATE.MARGIN`에 크기 증가분을 더함(565). 나만: 418 변경 |
| 코트: 플레이어 x LEFT [32,184]·RIGHT [248,400], 네트 216 | 계약과 동일 | 413-414, 2146-2149 | 이동 범위 변화 시 walkTo·후보 격자가 벽에 붙음 | 2146-2149 |
| 서브: 공 x 56/376, y 0, vy 1, xV 0; 나는 x 36/396 | 엔진 `initializeForNewRound` | Thunder 332·340-341; 데드볼 가드 2484; `M.myServe` 2494; `groundPassPlan` serveBall 1697; `ntObserve` 1926; 시작 위치 검사 2503 | **가장 위험**: 2484-2485의 WAIT가 안 풀려 첫 득점 뒤 영구 무입력(#2). Thunder는 `myServeDrop`이 거짓이라 자동 비활성(안전) | #2 백스톱 한 줄. 룰 불변이면 무해 |
| 연속 5회 접촉 실점 | 5 | 예산 `4 − g_touches` 1086, 1164, 1252, 1292, 1806; `g_touches >= 3` 오프셋 2350; `SET_MAX_TOUCH` 1 | 한도가 N으로 바뀌면 `4` → `N−1` | 5곳 상수 |
| 결정 주기 3프레임, 입력 지연 1프레임 | 3 / 1 | `g_group`(2136), `LATENCY_FRAMES` 424 → `myPredX` 2152; 하드코딩 #5 | 지연 2가 되면 썬더 0%(LAT_GUARD가 포기), 수비 반응 모델(`DEF_CFG.REACT` 4)이 1 낙관 | `LATENCY_FRAMES` 2, `DEF_CFG.REACT` 5 |
| 누움(state 4) 지속: 스냅샷에 없어 "다음 스텝에 일어남"으로 보수 처리 | 0 가정(엔진 3) | 687 | 스킬이 누움을 늘리면 더 보수적일 뿐(안전) | 없음 |
| state 2 유지 5+5 프레임 뒤 state 1 복귀 | 엔진과 동일 | 466-475, 1051-1055 | 파워히트 판정창 변화 → 접촉 프레임 예측 오차 | 두 곳 `delay = 5`, `fn > 4` |
| `rallyFrameCount`: 새 랠리 첫 관측 41~43 | — | 1697(`< 60` 서브 세트 금지), 2088(#3), 2327(비활성) | 값 체계가 바뀌면 1697 조건이 거짓 → 서브 첫 터치 세트 금지가 풀림(SET_MAX_TOUCH 1이라 실질 영향 없음) | 없음 |
| `expectedLandingPointX`: 엔진 예측 = 내 `stepBall`과 같은 물리 | — | `ballOurs`·`landingX` 2233-2235, `oppFirst` 2239, keep 궤적 1509, 상대 공격 기록 1884, 폴백 2126/2443 | 스킬 효과를 ELP가 반영 안 하면 공격/수비 분기 오판 | 응급: 2233을 `var landingX = ballAfter(ball, framesToLanding(ball)).x;`로(자체 물리) |
| 서브권 `isPlayer2Serve` | 미사용 | 2452(KNOWN 목록만) | 무관 | 없음 |

## B2. 새 필드 탐지 · 스킬 무시 시 동작

- `logNewFields`(2453-2460)는 `DEBUG=true`일 때 Worker당 1회, 최상위·`self`·`opp`·`ball`·`meta`·`config` 아래의 모르는 키를 `키=JSON.stringify(값)`으로 F12에 찍는다. 태그 `[OurBot v4bc LEFT] 새 스냅샷 필드: ...`. 중첩 객체도 통째로 보인다. **DEBUG를 false로 바꾸면 이 로그가 사라지므로 당일 필드명 확인 전엔 true 유지.**
- 스킬을 완전히 무시하면(`SK.on=false`, 기본값) 기존 동작 그대로다. `applySkill`(177)은 `SK.on`이 거짓이면 즉시 반환. 새 필드는 어떤 코드도 읽지 않는다(예외: 운영진이 `opp.yVelocity`·`opp.lyingDownDurationLeft`라는 이름을 실제로 추가하면 687·694·808·946에서 그대로 쓰인다 — 정확한 값이면 오히려 이득, 의미가 다르면 킬 게이트가 틀어짐. 필드 로그에 이 두 이름이 보이면 확인할 것).

## B3. 당일 노브 목록

§0(139-159)에 있는 것. `[당일 노브]` 표기는 `THUNDER_SERVE`·`CAMP_ABORT_X`뿐이지만 §0 전체가 그 용도다. 각 줄 주석은 뜻·근거·안전 값을 담고 있어 처음 보는 팀원도 읽을 수 있다(`BANDIT_MODES`·`CAMP_ESCAPE`는 근거 문서 이름만 있고 "언제 바꾸나"가 약함).

| 노브 | 줄 | 기본 | 뜻 | 당일 바꾸는 경우 | 안전 범위 |
|---|---|---|---|---|---|
| `DEBUG` | 140 | true | F12 로그(랠리당 ≤2줄) | 바꾸지 말 것(#11) | true |
| `LAT_GUARD`, `LAT_WINDOW` | 141-142 | 1, 30 | 지연2 증거 우세 시 썬더 포기 | 대회 PC가 느려 썬더가 자꾸 포기 로그를 내면 0 | 0/1 |
| `SELF_CHECK`, `SELF_CHECK_TOL` | 143-144 | 1, 2px | 썬더 기대 궤적 대조, 이탈 시 즉시 AC | 스킬이 공 물리를 바꾸면 자동으로 썬더를 꺼 주는 안전판. 끄지 말 것 | 1 |
| `CAMP_ABORT_X` | 145 | 0 | 스파이크 틱에 상대가 네트 앞(정규화 x ≤ 값)이면 썬더 포기 | 상대가 매 서브 네트에 붙어 썬더 공을 몸으로 받아내면 262 | 0 또는 262 |
| `THUNDER_SERVE` | 148 | 1 | 0이면 서브를 랠리 로직으로 | 서브 물리·규칙이 바뀌었거나 썬더가 실점 원인이면 0. 비용: v6D·v10 계열 상대 승률 급락(v11.md) | 0/1 |
| `SERVE_BANDIT`, `BANDIT_BLOCKWIN`, `BANDIT_MODES`, `CAMP_ESCAPE`, `AC_LOSS_COMEBACK` | 149-154 | 1, 0.5, thunder,ac,flat, 1, 1 | 위상별 서브 모드 학습·킬 틱 평타 이탈 | 스킬로 썬더가 막히면 밴딧이 자동으로 ac/flat으로 옮김. 손댈 일 거의 없음 | 기본 |
| `NEW_GAME_RESET` | 155 | 0 | 0:0 복귀 시 밴딧 기록 초기화 | #4. 유지 | 0 |
| `EXP_DRIFT_ATTACK`, `EXP_S2_TRACK`, `EXP_REACH` | 156-158 | 1, 1, 1 | v5_2 이식 기능 | 손대지 말 것 | 1 |
| `MAX_BLEND` | 159 | 0 | 적응 수비 혼합 | 코스가 뻔한 상대면 0.62(벤치 근거는 우리 풀 기준, 미지 상대엔 0) | 0 |
| `SK.*` | 162-170 | on false | 게이지 경로·만충값·발동 키·fire·guard | 필드명 확인 뒤 `on=true`, 경로·`full`·`key` 채움. `fire=1`은 #1 수정 뒤에만 의미 있음 | — |

깊은 노브(당일 손댈 수 있는 것만): `KILL_GATE.REACT/MARGIN`(564-565, 상대 반응·도달 여유), `KILL_GATE.FLAT_RELAX`(569), `DEF_CFG.REACT`(581, 내 반응), `DEF_CFG.KILL_MAX_CONTACT`(612), `DEF_CFG.NET_HAZ`(633, 네트 근접 파워히트 금지 거리; 메모리상 3이 이득 후보), `DEF_CFG.TH_RETREAT*`(600), `FAST_ATTACK_CFG.OPP_WINDOW`(447). 이들은 `ACCore` IIFE 안의 `var` 객체라 §0처럼 파일 상단에서 바꿀 수 없다 — 해당 줄을 직접 고친다.

노브가 없어 코드 본문을 파야 하는 시나리오:
1. 공격 전면 금지 스위치(#7): 없음 → `MARGIN 999` 근사.
2. 특정 구역 진입·타격 금지: 없음 → `applySkill`(177-184)에 필터 추가(B4-d).
3. 스킬 발동 조건 감지·발동 입력: `SK.fire`는 "내 게이지 만충 + 공중(state 1) + hit 틱"에만 키를 넣는다. 발동 조건이 다르면(지상, 특정 입력 조합) `applySkill` 181을 고쳐야 한다.
4. 상대 강화 샷 모델: `defShotTrajs`(1384) 편집(B4-b).
5. 다이빙·점프 금지: 없음 → `applySkill` 필터(B4-d).

## B7. 스킬 재현 도구

- `bot-dev/eval_skill.mjs` + `skills/example_gauge.mjs`는 v11로 그대로 돈다(이번 실행: OFF 12-0 → ON 11-1, 스턴 예시가 실제로 결과를 바꿈). 훅 4개(`init/extend/filterInput/observe`)는 `sim.mjs` 53-57, 86-89, 113-114에서 호출된다.
- 유효 범위: 필드형(`extend`), 입력형(`filterInput`), 규칙·득점형(`observe` → 'LEFT'/'RIGHT')은 정확. 물리형은 엔진을 못 바꾸므로 `observe`에서 `phys.ball.xVelocity/yVelocity`를 덮어쓰는 근사만 가능(중력·반사 변경은 재현 불가).
- 주의: `sim.mjs`는 포인트 단위(rfc 0 시작, 데드볼 없음)라 #3 같은 실전 흐름 문제는 안 보인다. 실전 흐름은 `sim_real.mjs`(rule_check·cmp_bench·shadow_diff가 사용).

## 당일 1시간 절차 (B4 + B5)

전제: 스킬 공개 T+0, 첫 경기 T+60. 사람 3명(A 규칙 파악, B 코드 수정, C 실행·검증·제출). LLM 3회·300자·링크 불가. 웹 검색 불가. 기존 `RUNBOOK_당일.md`(3시간·OurBot_v9·render9/search9 기준)는 폐기하고 아래를 쓴다.

### 시간표

| 시각 | C (실행·제출) | A (규칙) | B (코드) |
|---|---|---|---|
| T+0 | 새 저장소 clone → `npm install` 즉시 시작(백그라운드, 수 분). 끝나면 `src/code-here/`에 v11 복사(`사자먹는은행_v11.js` 등 `_v` 규약 이름) + 제공 스킬 봇 확인 | 가이드·API 문서에서 5줄 받아적기: ① 새 필드 이름·위치·타입·범위 ② 충전/발동 조건 ③ 효과 종류(점수·입력·물리·자기강화) ④ 지속·쿨다운 ⑤ 규칙상 실점 행동 | 새 저장소 `src/resources/js/physics.js`·`bot/botContract.js`·`pikavolley.js`·`rules/`를 우리 것과 diff(에디터 비교). 물리 상수·서브·5터치·틱이 바뀌었는지 B1 표와 대조 |
| T+8 | `npm start` → 봇 설정: LEFT v11 / RIGHT 제공 스킬 봇 → 1세트. F12에서 ① `새 스냅샷 필드:` 줄 ② `decide() failed` 없음 ③ `썬더 발동` 로그. 좌우 바꿔 1세트 더 | 제공 스킬 봇 코드의 `decide`에서 스킬 쓰는 조건·반환 형태를 읽어 ②③ 확정 | diff 결과를 A에게 전달. 바뀐 게 없으면 "물리 동일" 선언 |
| T+20 | 결과 보고: 점수, 실점 유형(스킬 직접 실점 / 리시브 실패 / 공격 막힘 / 자책) | 판단: 스킬 유형 → 아래 (a)~(e) 중 어느 절차인가 | 절차에 따른 노브·한 줄 수정 착수. **새 로직 작성 금지**, 노브·필터·상수만 |
| T+35 | 수정본으로 재실행: 스킬 봇 상대 좌우 각 1세트 + 내장 AI 1세트(퇴행 확인용, 승패 판단 근거는 아님) | 실점 유형 재분류 | 필요 시 2차 수정(한 번만) |
| T+45 | 우리 저장소에서 `node --no-warnings bot-dev/rule_check.mjs <새 파일>` (문법·최상위 decide·금지 토큰·예외·시간). 통과 시 shaims 제출, 내역 페이지에서 버전 확인. 제출본을 `bot-dev/submitted/사자먹는은행_v11_<시각>.js`로 복사 | 제출 확인 | 코드 프리즈 |
| T+55 | 예비. 문제가 남아 있으면 **수정 전 v11 원본을 제출**(이미 검증된 상태) | | |

### LLM 3회 배분 (회당 300자, 코드 붙여넣기 사실상 불가)

1. T+10~20: 제공 스킬 봇의 발동 조건을 코드로 못 읽겠을 때 — "이 게임에서 스킬 X는 어떤 입력/조건으로 발동되고 반환 객체에 무엇을 넣어야 하나"처럼 문서 해석 질문.
2. T+25~35: 수정 중 F12 예외 메시지를 해석 못 할 때 — 에러 문구 1줄 + "원인과 한 줄 수정".
3. 예비. T+45 이후 남으면 "우리 대응(요약)이 규칙상 실점인가" 확인용.

### 실패 모드별 손 절차 (B4)

각 절차는 "노브 → 한 줄 → 재실행" 순서다. 파일은 v11의 줄 번호 기준.

**(a) 낙하점 예측이 틀림(공 물리·ELP 의미 변화)**
1. 148 `THUNDER_SERVE = 0` (썬더는 기대 궤적표에 묶여 있어 물리가 바뀌면 무의미. SELF_CHECK가 어차피 포기하지만 매 서브 1틱을 버린다).
2. B의 diff에서 `physics.js`의 공 처리 함수가 바뀐 부분을 509-524 `stepBall`에 그대로 옮긴다(중력 증분·상한 40·벽·네트·바닥 순서 유지).
3. ELP만 다르면(스킬 효과를 엔진 예측이 반영 안 함) 2233을 `var landingX = ballAfter(ball, framesToLanding(ball)).x;`로.
4. 재실행. 리시브 자책이 줄었는지 F12·점수로 확인.

**(b) 상대 공이 빨라지거나 궤적이 바뀜(강화 스매시·커브)**
1. 1384-1400 `defShotTrajs`의 파워히트 루프 뒤에 강화 궤적을 추가한다. 예: 속도 배수 K, 각도 배수 M이면 `for (var xa2 = 0; xa2 <= 1; xa2++) for (var yd2 = -1; yd2 <= 1; yd2++) trs.push(defTraj(c.ball.x, c.ball.y, toMe * (xa2 + 1) * 10 * K, Math.max(15, Math.abs(c.ball.yV)) * yd2 * 2 * M));` (수비 자리·대기 위치가 강화 샷까지 막는 자리로 이동. 일반 샷 수비는 다소 보수화).
2. 배수를 모르면 581 `DEF_CFG.REACT` 4→5(내 반응을 느리게 가정 = 더 이른 자리 선점). 효과 확인 후 결정.
3. 강화 샷이 "게이지 만충일 때만"이면 1의 추가를 `s`가 없어 조건부로 못 건다 — 무조건 추가가 답(전날 리팩터 금지).

**(c) 우리 공격이 막히거나 되받아침**
1. 서브: 아무것도 안 한다. 밴딧(`SERVE_BANDIT`)이 위상별로 ac/flat로 옮기고 `CAMP_ESCAPE`가 킬 틱에 평타로 빠진다. 상대가 매 서브 네트에 붙어 있으면 145 `CAMP_ABORT_X = 262`.
2. 랠리 킬: 565 `KILL_GATE.MARGIN` 6→12(더 보수적), 그래도 막히면 564 `REACT` 3→2, 569 `FLAT_RELAX` 1→0.
3. 상대가 강화 능력으로 받아내면(순간이동·점프 강화): 565 `MARGIN = 999`(#7, 지상 킬 대부분 차단, 넘기기 유지) + 썬더는 유지(오픈루프 최속 킬).

**(d) 어떤 행동이 규칙상 실점(예: 다이빙·특정 구역 타격 금지)**
`applySkill`(177-184)의 try 블록에 필터를 넣는다. `SK.on = true`가 필요하다(게이지 경로가 없으면 `gauge`·`ogauge`를 아무 문자열로 두고 `fire 0`, `guard 0`).
- 다이빙 금지: `if (s.self.state === 0 && a.hit === 1 && a.x !== 0 && a.y !== -1) a.hit = 0;` (v11은 4경기에 다이빙 0회라 손실 없음)
- 지상 점프 금지: `if (s.self.state === 0 && a.y === -1) a.y = 0;` + 148 `THUNDER_SERVE = 0`. 비용: 벽 구석 공을 못 넘겨 터치초과 실점 가능.
- 구역 금지(예: 네트 앞 40px에서 파워히트 실점): `if (a.hit === 1 && s.self.state === 1 && Math.abs(s.self.x - 216) < 40) a.hit = 0;` (`external` 플래그가 켜져 AC의 공중 정책이 지워지므로 다음 틱에 몸터치 후보로 재계획된다).
- 강스매시 금지: 이미 `SK.guard`(180)가 상대 만충 조건에서 y=1→−1로 바꾼다. 조건을 없애려면 `skFull(...)` 부분을 `true`로.

**(e) 상대 자기 강화(순간이동·크기·속도)**
1. 565 `KILL_GATE.MARGIN`을 크기 증가분(px) 또는 999로. 속도 강화면 `KG_JUMP_Y`·`WALK_SPEED`가 상대에게만 적용되는 경로가 없으므로 `MARGIN`으로만 흡수.
2. 썬더는 유지. 킬 틱에 상대가 닿을 수 있으면 `CAMP_ESCAPE`가 평타로 빠지는데, 그 판정(286-304 `bcBlockable`)은 걷기 6·점프표 기준이라 순간이동은 못 본다 → 순간이동이면 `BANDIT_MODES`를 `'flat,ac,thunder'`로(평타 우선).
3. 제공 스킬 봇 상대 결과로 (썬더 on/off) × (MARGIN 6/999) 4조합 중 하나를 고른다. 한 조합당 1세트, 좌우 1회씩.

**최후의 안전판(한 줄 스위치)**: 148 `THUNDER_SERVE = 0` + 565 `KILL_GATE.MARGIN = 999` (+ 필요 시 (d)의 점프 금지 필터). 완전 수비형이며 운영진이 "수비형은 안 통할 가능성 높음"이라 했으므로 마지막 선택지다.

## B6. v11 코드 지도 (CODE_MAP.md 대체용)

`bot-dev/CODE_MAP.md`는 OurBot v9 기준(`v9_template.js`·`render9`·`skillPolicy`·`//@PARAMS`)이라 v11과 맞지 않는다. 아래로 교체할 것.

파일 = §0 노브(139-170) → §1 Thunder(186-405) → §2 ACCore(407-2431) → §3 오케스트레이터(2433-2541). 최상위 `decide`는 2532.

```
decide(snapshot) 2532            ← try/catch: 실패 시 sanitize(fallbackAction) → neutral
└ core(s) 2466
   (1) 지연 증거 2470-2477 (LAT_GUARD)
   (2) 데드볼 가드 2483-2485 (waitingForServe)      ← #2
   (3) 랠리 감지·기록 2487-2494
   (4) Thunder.step(s) 318 + 시작위치/지연 가드 2499-2514
   (5) ACCore.decide(s) 2517 (그림자 호출, 매 틱)
   (6) 소유자: TH > AC > FALLBACK 2520-2522 → applySkill 177 → sanitize 2442 → ACCore.sync 2528 → 반환
ACCore.decide(s) 2399 ← try/catch → decideCore
└ decideCore(s) 2133
   updateTouches 2084 → selfSync 477 → observeOpponentPattern 1954 → ntObserve 1923 → kgOppVx/oppModelOf 2141-2142
   state≥3 → 중립 2144
   공중(state 1/2) 2154-2226: 킬 플랜 유지 2162-2178 → 빠른공격 커밋 2201-2210 → chooseAirPolicy 1297(scoreAirAction 1248) → 아니면 착지점/대기 걷기
   지상: ballOurs·oppFirst 2233-2239 → [EXP] 드리프트 공격 2246-2262
         → 수비 분기 2264-2302: TH_RETREAT 2268-2290 → defenseTarget 1501(defOppContacts 1331 × defShotTrajs 1384 × defReachSlack 1407) → walkTo 2116
         → 공격: findFastAttack 1160 → findKillJump 1082 (둘 다 KILL-GATE gateOppReach 936)
         → 리시브: groundPassPlan 1690 (gpWalkContact 1644 co-sim, passThreatSlack 1671) → findPassJump 1803
         → 다이빙 2368-2380 (defReachSplit 1432)
```

| 함수(줄) | 하는 일 | 언제 고치나 |
|---|---|---|
| `stepBall` 509 | 공 1프레임 물리(엔진 복제). 모든 궤적 함수의 원천 | 공 물리가 바뀔 때만 (B4-a) |
| `powerHitLanding` 538, `microSim` 975, `microSimSeq` 1026 | 내 입력 시퀀스로 나+공을 같이 진행, 접촉·파워히트·착지 계산 | 파워히트·몸리시브·점프 공식 변화 |
| `kgOppMotion` 682, `kgOppCanReach` 722, `gateOppReach` 936 | 상대가 궤적에 닿을 수 있는가(킬 게이트 술어). `KILL_GATE.REACT/MARGIN` | 상대 강화 (B4-c/e) |
| `oppTouch` 865, `oppModelOf` 855 | 전지 수비수 모델(확정 판정 보조) | 손대지 말 것 |
| `findFastAttack` 1160 / `findKillJump` 1082 | 점프+파워히트 후보 탐색, 게이트 통과 시 채택 | 공격 강도 조절은 게이트 노브로 |
| `scoreAirAction` 1248, `chooseAirPolicy` 1297 | 공중에서 매 틱 재계획(AIR_GATE) | — |
| `defOppContacts` 1331, `defShotTrajs` 1384, `defReachSlack` 1407, `defenseTargetNew` 1501, `standbyCenter` 1460 | 상대 접촉 시점 × 샷 궤적 × 내 도달 여유 → 수비 자리 | 상대 샷이 바뀔 때 `defShotTrajs` (B4-b) |
| `groundPassPlan` 1690, `gpWalkContact` 1644, `passThreatSlack` 1671 | 지상 몸리시브 자리 co-sim, 넘기기 채점 | 몸리시브 공식 변화 |
| `findPassJump` 1803 | 지상으로 못 넘기는 공을 점프로 넘김(게이트 없음) | — |
| `defReachSplit` 1432 + 2368-2380 | 다이빙 판정 | 다이빙 물리 변화 |
| `updateTouches` 2084 | 내 연속 터치 수(5터치 규칙) | 터치 규칙 변화 |
| `Thunder.step` 318, `TH_SEQS` 196, `TH_EXPECT` 216, `TH_KILL` 223 | 오픈루프 서브 3위상 + 자기검증 + 밴딧·이탈 | 서브·물리 변화 시 `THUNDER_SERVE 0`뿐 |
| `bcModeFor` 237, `bcOnScoreChange` 253, `bcBlockable` 286 | 서브 모드 밴딧, 킬 틱 블록 예측 | — |
| `applySkill` 177, `SK` 162 | 최종 출력 직전 스킬 필터/발동 | **당일 1순위 수정 지점** (#1 수정 필요) |
| `logNewFields` 2453, `KNOWN` 2449 | 새 필드 1회 로그 | 필드 확인 후 KNOWN에 추가하면 조용해짐(선택) |
| `sanitize` 2442 | 반환값 정수화 | #1 |

## 삭제 후보 (C)

원칙: 제출 전날이라 **v11 본문은 아무것도 지우지 않는다**(사고 확률 > 이득). 아래는 대회 뒤 정리용 목록이며, 각 항목은 지운 뒤 `node --no-warnings bot-dev/v8/shadow_diff.mjs src/code-here/Lion_Eating_Bank_v11.js <정리본> Lion_Eating_Bank_v10,NetCamper_v2,AdaptiveCounter_v5_2,mixed_v2 8`로 mismatch 0을 확인하고 `rule_check.mjs`를 다시 돌린다.

### C1. v11 안의 죽은 코드·꺼진 실험

| 항목 | 줄 | 근거 | 삭제 방식 |
|---|---|---|---|
| `jumpYAt` | 1833-1837 | 참조 1(정의뿐), 호출 0 | 함수 삭제 |
| `defenseTargetV6` + `defenseTarget` 분기 | 1584-1612, 1614-1617 | `DEF_CFG.NEW_DEF 1` 고정 → 경로 미사용 | 함수 삭제, 1614를 `defenseTargetNew` 직접 호출로 |
| `findServeJump` + 호출 블록 | 1767-1800, 2327-2340 | `SERVE_JUMP 0` | 함수·블록 삭제 |
| `kgCoverGate`, `kgCoverFrac`, `kgGate` 래퍼 | 784-830 | `PREDICATE 'kg'`, `COVER_SEL 0`, `AIR_RESELECT 0` | 세 함수 삭제, `kgGate` 호출 2곳(1125, 1191)을 `kgIsGuaranteedKill`로 |
| `AIR_RESELECT` 블록 | 2185-2200 | 노브 0 | 블록 삭제 |
| `preProbeUpdate`, `g_pre_probe`, `g_opp_pre` 갱신 | 919-935, 2101, 2222, 2231, 2249, 2258, 2310, 2319 | `OPP_PRE 0` → `g_opp_pre`는 쓰이지 않음(947은 노브 뒤) | 갱신 코드 삭제(6곳) |
| `PASS_DIG` 코드(bestDig) | 1748-1752, 1761, 2343 | 노브 0 | 분기 삭제 |
| `DIVE_HAILMARY` | 2373-2375 | 노브 0, 검증서 "628회 발동 0 터치" | 블록 삭제 |
| `DIVE_LATE`, `NET_TOP_LAT`, `DEF_GRID`, `DEF_HOLD_K`, `TP_EXT`, `PJ_SIM`, `KILL_OUR_HALF`, `FLAT_NODIVE`, `PRE_WALK` | 각 노브 줄 + 사용처 1곳씩 | 전부 0/기각 기록 | 노브별로 조건식 한 줄 삭제 |
| `STAND_GRID`, `PASS_ROBUST` | 613, 616 | 코드에서 읽는 곳 0(주석만) | 노브 줄 삭제 |
| `ADAPT` 계열(`adaptiveDefenseTarget` 2029, `adaptiveConfidence` 2008, `recordOpponentAttack` 1884 등) | 1869-2069 | `MAX_BLEND 0`이라 `adaptiveDefenseTarget`은 `baseTarget` 그대로 반환. 단 `observeOpponentPattern`(1954)은 새 랠리 커밋 해제(1974-1977)와 `resetAdaptiveLearning`(g_nt 초기화, TH_RETREAT 학습)에 필요 | **삭제 금지**(삭제만으로 안 끝남). 유지 |
| `M.rallies` 기록 | 2438, 2488-2490 | 디버그용, 400 상한 | 유지(비용 0) |
| `decide.__state/__thunder/__bc/__ac/__sk` | 2536-2541 | 검사 도구용 | 유지 |
| 머리말 주석(2-132) | — | 벤치 기록 130줄 | 유지 또는 md로 이동. 동작 무관 |

### C2. 로그·디버그

`DEBUG=true` 유지. 로그는 썬더 발동(랠리당 1)·포기/이탈/모드 전환(사건당 1)·새 필드(Worker당 1)·예외(경기당 1)뿐이며 매 틱 로그 없음. 문자열 조립은 전부 `if (DEBUG)` 뒤. `JSON.stringify(BC.stats[...])`(359)는 ac 모드 선택 시에만. 제출 정책: 그대로.

### C3. 저장소

`src/code-here/` 70파일 중 git 추적 12(작업트리에서 삭제된 `AdaptiveCounter_v5_1.js`·`Sajamokneun_v3.js`·`kyu_v15.js` 포함 → 삭제를 커밋할 것), 미추적 58. 로컬 빌드 시 `botRegistry`가 전부 드롭다운에 올리므로 정리는 편의 문제이며 대회 PC(새 저장소)와 무관.

| 분류 | 파일 | 처리 |
|---|---|---|
| 제출본 | `Lion_Eating_Bank_v11.js` (+ `v11.md`, `v10.md`) | 유지·커밋 |
| 벤치 상대(검증서·메모리에 이름 등장) | `AdaptiveCounter_v5_2`, `NetCamper_v1/v2`, `OurBot_v11/v12`, `RedTeam_RL_v1`, `LionBC_v4`, `Lion_Eating_Bank_v5_1`, `v6_Defense`, `v10`, `mixed_v2`, `mixed_v2_adaptive`, `Jayce_v1.py`, `ThunderRecovery_v1`, `Example_v1.js/.py`, `Probe_v1`(하네스) | 유지 |
| 계보(생성기 입력·비교용) | `Lion_Eating_Bank_v1`~`v9_1`, `v10_1`, `v7`(생성기 원본, 20 참조), `v3`(썬더 시퀀스 출처) | 대회 뒤 `bot-dev/archive/lineage/`로 |
| 실험(bot-dev 참조 0~5) | `123_v1/v2`, `AdaptiveCounter_v6/_hybrid`, `Duckll_AI_v1`, `LionBC_D4_v1/v2`, `LionBC_SL_v1`, `PossessionAttack_RL_v1`, `PossessionConfirmedSkill_*`(3), `RedTeam_ServePattern_v1`, `RedTeam_vs_Lion_v5_RL_v1`, `ThunderP12_*`(20), `ThunderRecovery_phase1/2_candidate`, `mixed_v1` | 대회 뒤 `bot-dev/archive/experiments/`로 |

주의: `cmp_bench`·`shadow_diff` 등은 상대 이름을 CLI 인자로 받아 grep 참조 수가 0이어도 쓰였을 수 있다. 위 분류는 v11.md·메모리의 벤치 표를 기준으로 했다.

`bot-dev/`:
- `_*.mjs` 132개(전부 추적됨)는 일회성 진단이다. 대회 뒤 `git mv bot-dev/_*.mjs bot-dev/archive/oneoff/` 한 번(경로가 깨져도 재실행 안 함).
- `RUNBOOK_당일.md`·`CODE_MAP.md`·`README.md`의 루틴 표는 v9 기준. 이 보고서의 B5·B6로 교체.
- `.gitignore`에 `bot-dev/runs/`(3.2GB), `bot-dev/*/out/` 추가(#12). `bot-dev/rl/`(330MB)도 `rl/runs/` 외 산출물이 있으면 추가.

### C4. 우선순위

1. 지금: `.gitignore` 두 줄(#12), 작업트리 삭제 3건 커밋, `LION_MERGE_PLAN.md`·`OURBOT_V12_DESIGN.md`·`TEAM_VERIFY_PROMPT.md`·이 보고서 커밋 여부 결정.
2. 당일 전: v11 본문은 #1(스킬 키) 한 줄만, 그것도 당일 스킬이 "반환 키" 방식일 때. #2 백스톱은 shadow_diff mismatch 0이면 적용해도 됨(선택).
3. 대회 뒤: C1·C3 아카이브.

## 확인하지 못한 것

- 브라우저(Chrome) 실행은 이 세션에서 하지 않았다. 시간·예외 수치는 Node `rule_check`(이번)와 `Lion_Eating_Bank_v11.md`의 09-04/05 Chrome 기록, v10의 스로틀 기록을 인용했다.
- shaims 제출 페이지(한글 파일명 허용, 자동 버전 부여 동작)는 확인하지 않았다(#13).
- #2의 결함 조건(서브 위치 변경)은 시뮬로 재현하지 않았다. 코드 경로만 확인.
- `NEW_GAME_RESET` 0/1의 우열은 벤치하지 않았다(#4는 구조 분석).
- 4분 제한·골든볼은 엔진·시뮬 어디에도 없어 교착 시 실제 판정 흐름(운영진 수동?)을 모른다.
- `_*.mjs` 132개는 개별 검토하지 않았다(파일명·크기만).
- `mixed_v2`는 벽시계 예산 때문에 비결정이라(메모리) 이번 검증 상대에서 제외했다.
- 당일 새 저장소의 내용(엔진 변경 여부)은 알 수 없다. B1 표는 "우리 엔진 = 대회 엔진"을 전제로 한다.
