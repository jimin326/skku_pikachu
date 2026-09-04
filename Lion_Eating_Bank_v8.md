# Lion_Eating_Bank_v8 — 기능 설명

2026-09-04. v7 을 몸통으로 v5_2·v6_Defense·mixed_v2 의 검증된 기능을 이식한 병합본.
생성기·검증 도구는 개발 저장소 jimin_pika 의 `bot-dev/` 에 있다(이 저장소에는 봇 파일과 이 문서만 올린다).
`bot-dev/v8/build_v8.mjs` 가 v7 에서 생성한다(**파일을 손으로 고치지 말고 생성기를 고칠 것**, 당일 노브만 예외).

```
node --no-warnings bot-dev/v8/build_v8.mjs            # 기본 = STEP 5, kg/REACT 3, canon, fast, path, THUNDER 1
V8_THUNDER=0 node --no-warnings bot-dev/v8/build_v8.mjs 5 out.js   # 썬더 끈 빌드
node --no-warnings bot-dev/v4_checks.mjs src/code-here/Lion_Eating_Bank_v8.js   # 17/17
```

설계 원칙(사용자): ① 수비는 최소 이동으로 상대의 모든 경우를 막는 자리 ② 점프는 확정킬·안전한 넘기기·썬더 서브에만 ③ 다이빙은 걸어서 못 닿고 다이빙으로 닿을 때만.
판정 근거는 우리 봇 풀 벤치가 아니라 엔진 물리·정확 모델 대조를 우선했다.

---

## 1. 구조

| 절 | 내용 | 출처 |
|---|---|---|
| §0 당일 노브 | `THUNDER_SERVE`, `DEBUG`, `LAT_GUARD`, `SERVE_BANDIT`, `CAMP_ESCAPE`, `AC_LOSS_COMEBACK`, `EXP_*` | v7 + v5_2 + v8 |
| §1 Thunder | 3위상 오픈루프 서브(d=4 세트) + [BC] 서브 모드 밴딧·킬 틱 평타 이탈·자기검증·시작위치 가드 | v5_1/v7 |
| §2 ACCore | 랠리 판단부: KILL-GATE 공격, 수비 위치, 리시브 co-sim, 다이빙, 터치 감지, 자기상태 추적 | v7 + v5_2 + v6_Defense + mixed_v2 |
| §3 오케스트레이터 | 지연 증거·데드볼 가드·랠리 감지·썬더/AC 소유자 선택·스킬 훅·sanitize | v7 |

---

## 2. 당일 노브

| 노브 | 기본 | 뜻 |
|---|---|---|
| `THUNDER_SERVE` | 1 | 0 이면 썬더 모듈이 매 틱 물러나고(TH.state `OFF`) 서브 공을 평소 랠리 로직이 맡는다(확정킬이면 킬, 아니면 세트 뒤 안전하게 넘기기). 밴딧·이탈·자기검증·시작위치 가드 전부 무효. 벤치: AC 100 / NetCamper 84 / RedTeam 98 / OurBot 100% 서브 랠리 |
| `DEBUG` | true | F12 로그(썬더 발동/포기, 새 필드, 예외 1회). 제출 전 false 권장(1랠리 1줄이라 true 여도 무방) |
| `LAT_GUARD` | 1 | 최근 30 관측에서 지연 2 증거가 많으면 썬더 포기 |
| `SERVE_BANDIT` / `BANDIT_MODES` | 1 / thunder,ac,flat | 위상별 서브 모드 밴딧. 승패 (승+1)/(시도+2) |
| `CAMP_ESCAPE` | 1 | 킬 틱에 상대가 닿을 수 있으면 평타로 이탈 |
| `AC_LOSS_COMEBACK` | 1 | ac 서브 랠리를 지면 그 위상 기록을 비우고 썬더 복귀 |
| `EXP_DRIFT_ATTACK` | 1 | 공이 내 코트·낙하점 상대 코트·상대 공중이면 킬 탐색 먼저 |
| `EXP_S2_TRACK` | 1 | 내 출력 스트림으로 state2 delay/frameNumber 정확 추적 |
| `EXP_REACH` | 1 | 전지 수비수 도달 모델 oppTouch(확정 티어 가산) + 체공 방향전환 킬 계획 |
| `KILL_GATE.PREDICATE` / `REACT` | kg / 3 | 확정킬 술어. `oppTouch`(L2) 는 벤치에서 과보수라 기각, 확정 티어 가산으로만 씀 |
| `DEF_CFG.STANDBY_MODE` | canon | 위협이 없을 때 대기 x: 표준 네트앞 위협 × 여유 모델로 유도(LEFT x=160, 네트 −56). `fixed` = NET±92(v7) |
| `DEF_CFG.PRIORITY` | fast | 못 막을 때 먼저 막을 샷. `lethal`(접촉창) 은 기각 |
| `DEF_CFG.TOUCH_DETECT` | path | 내 터치 감지: 관측 사이 공 경로 × 내 몸 스윕 상자(엔진 기록과 100% 일치). `box` = v7 |
| `DEF_CFG.PASS_REACH` / `PASS_WINDOW` | gate / 0 | 넘기기 도달 판정·후보 창(둘 다 결과 무변화, 기본 끔) |
| `DEF_CFG` 나머지 | v7 | MIN_MOVE·FAST_FIRST·OPP_FIRST·GROUND_PASS·PASS_JUMP·KILL_MAX_CONTACT 16·TOUCH_MARGIN 9·DIVE_MODEL 등 |

---

## 3. 기능

### 3.1 서브 (§1 Thunder + [BC])
- 3위상 녹화 시퀀스(d=4 세트: 위상별 킬 s90/s86/s73). 서브 랠리 100%(풀 5종), Chrome 12/12·26/26 직접 득점.
- 밴딧: 위상별 thunder/ac/flat 모드를 내 서브 랠리 승패로 고른다. 킬 틱에 상대가 닿을 수 있으면(bcBlockable) 평타 이탈. 자기검증(TH_EXPECT)·시작위치 가드(x=36)·지연 가드.
- `THUNDER_SERVE=0` 이면 위 전부 생략, 랠리 로직이 서브.

### 3.2 수비 위치 (공이 상대 코트)
- `defenseTargetNew`: 상대의 접촉 시점(최대 8표본, 30스텝) × 샷 9종(파워 6·몸리시브 3) 궤적에 대해 내 최악 여유(반응 3·걷기 6·다이빙·상자 32)를 최대화하는 x. `MIN_MOVE` 히스테리시스(안전하면 24px 이상 개선일 때만 이동), `FAST_FIRST`(착지 14스텝 이하 샷 먼저).
- [v8 수정] **상대 yVelocity 복원**: 스냅샷에 상대 yVelocity 가 없어 v7 은 공중 상대를 "그 높이에 멈춘 것"으로 계산했다. 점프 인덱스에서 vy=−16+m 을 복원(`oppVyEst`). RedTeam 리시브 패의 94~100% 가 이 때문에 승인된 킬 점프가 블록당한 것이었다.
- [v8 수정] **충돌 래치**: 상대가 방금 친 공은 상대 몸과 겹쳐 있어 떨어질 때까지 다시 못 친다(엔진 isCollisionWithBallHappened). 이걸 몰라 가짜 "재접촉" 위협 쪽으로 자리를 옮기던 것을 제거.
- [v8 수정] **현재 궤적(KEEP)**: 착지점이 내 코트면 상대가 안 칠 경우의 지금 궤적도 위협 집합에 넣는다.
- [v8] **중립 위치 canon**: 위협이 없을 때 표준 네트앞 위협(y≈171, 내리꽂기·수평·아치, 입사 19·30)을 v7 여유 모델로 풀어 x=160. mixed_v2(네트앞 내리꽂기형) 맞대결 13-35 → 46-2. 풀 비용은 RedTeam 95→88 뿐.
- `OPP_FIRST`: 공이 상대 코트에 있고 상대가 먼저 닿을 수 있으면 공격 분기 금지(썬더 토스에 킬 점프 나가던 버그).

### 3.3 리시브 (공이 내 코트로, 상대는 못 건드림)
- 순서: 반박자 빠른 공격(findFastAttack) → 킬 점프(findKillJump) → 지상 몸리시브 계획(groundPassPlan) → 넘길 후보 없으면 PASS_JUMP.
- [v8] **groundPassPlan = 컨트롤러 co-sim**(v6_Defense simWalkContact 이식): 목표 x 마다 실제 컨트롤러(3프레임 묶음·18px 격자·지연 1)를 그대로 돌려 "첫 접촉 프레임 × 접촉 위치"를 찾고 같은 쌍은 한 번만 채점. 반사 궤적을 끝까지 전개(네트 되돌림·재접촉 자동). 우선순위 = 상대가 못 닿는 넘기기 > 첫 터치 세트(네트 앞 hover) > 상대에서 먼 넘기기. 이번 틱 걸음은 co-sim 의 첫 입력(walkTo 사각 없음). v7 의 자책(4px 격자 × 18px 걸음) 제거.
- 리시브 점프 없음(`NO_JUMP_RECEIVE`). 넘길 후보가 없을 때만 점프+파워히트(PASS_JUMP, 게이트 없음).

### 3.4 공격 (KILL-GATE)
- 지상 킬 점프·반박자 공격·공중 새 스매시(AIR_GATE) 전부 `kgIsGuaranteedKill` 통과 시에만. 술어 = `gateOppReach`: 상대를 관측 속도로 접촉 시점까지 외삽하고, 접촉 뒤 반응 3·걷기 6·점프 궤적·다이빙 13프레임·상자 32 로 닿을 수 있는지(kg 모델). 정확 모델 대조(gate_verify) 위험 불일치 3~4/12,215(d=2..4).
- [v5_2] **oppTouch 확정 티어**: 전지 수비수(L2, 접촉 전 자유 이동 포함) 도달 모델로 못 닿으면 +400/+300/+350 가산. 게이트로 쓰면 킬이 거의 사라져 기각(AC 46·OurBot 34).
- [v5_2] **체공 방향전환 킬 계획**(g_kill_plan): 점프 뒤 1~2틱 x 이동 후 스매시, 매 틱 재검증. v5_2 원본은 궤적 배열을 후보마다 비우지 않아 확정 티어가 거의 안 켜졌다(v8 은 리셋).
- [v5_2] **드리프트 공격**: 낙하점은 상대 코트인데 공이 내 코트에 있고 상대가 공중이면 킬 탐색 먼저.
- [v5_2] **자기상태 추적**(selfSync): state2 delay/frameNumber 를 내 출력으로 정확히 추적(고정 3 추정이 접촉을 state1 틈에 떨어뜨리던 몸빵 방지).
- `KILL_MAX_CONTACT 16`, `PASS_JUMP_COMMIT 20`, `KILL_COMMIT`(fly 계획이면 체공 뒤 커밋), SAFE_PASS.
- [v8 수정] kgOppMotion 누운 상대(state 4)에 `grounded:true` — 일어난 뒤 재점프를 못 보던 버그.

### 3.5 다이빙
- `defReachSplit`: 걸어서 못 닿고 **이번 틱에 시작하는** 다이빙으로 닿을 때만(diveNow). 나중 다이빙으로 닿으면 계속 걷는다.
- [v8 수정] 운동학 표 = 엔진 실측 13프레임 102px(입력 +6, 이후 12프레임 +8, y 239→229→239→244→244, 착지 후 5프레임 누움). v7 표는 86px/11프레임으로 16px 과소.

### 3.6 내 터치 감지 (mixed_v2 selfSetup 이식)
- 궤적 이탈이 있을 때 직전 스냅샷의 공을 프레임별로 굴려 내 몸 스윕 상자(두 스냅샷 위치의 min/max ±32, y ±4)와 겹친 프레임이 있으면 내 터치. 엔진 터치 기록과 726/726 랠리 일치(v7 상자는 9~42% 과다 감지). 4터치 예산·세트 허용의 입력.

---

## 4. 검증 (2026-09-04)

24시드 × 좌우 = 48경기/칸, 지연 1, 10점 (`bot-dev/rally_escape/cmp_bench.mjs`). 경기 W-L / 리시브 랠리 승률.

| | NetCamper_v2 | AC_v5_2 | RedTeam_RL | OurBot_v12 | LionBC_v4 | mixed_v2 |
|---|---|---|---|---|---|---|
| v7 | 47-1 / 98 | 48-0 / 100 | 48-0 / 77 | 48-0 / 77 | 48-0 / 60 | — |
| **v8** | 48-0 / 100 | 48-0 / 100 | 48-0 / 88 | 48-0 / 100 | 37-11 / 21 | 46-2 / 45 |

내 서브 랠리는 전 상대 100%(mixed_v2 89%). 다이빙 0(LionBC 만 0.4/랠리), 터치초과 0, 예외 0, decide p99 0.6~1.1ms.
Chrome(headless, fast 30fps, 10점, 실제 Web Worker): AC·NetCamper·RedTeam 좌우 6전 6승(RT-v8R 2:10, 나머지 10:0), 썬더 26회 발동·포기 0, PAGEERROR 0 — `bot-dev/v8/browser_v8_final_canon.json`.

알려진 트레이드오프
- LionBC_v4 리시브 21%: v8 이 킬 착지점에 정확히 서므로 LionBC 의 CAMP_ESCAPE 가 매번 평타로 이탈해 136px 먼 곳에 떨어뜨린다. 결정론 위치 대 최적반응 서버의 값은 0 이라 범용 근거로는 손대지 않았다(v7 의 60 은 위치가 어긋나 LionBC 가 킬을 쳤던 것).
- RedTeam 88: canon 대기 위치의 비용(fixed 92 는 95, 대신 mixed_v2 에 13-35).

---

## 5. 기각한 것과 이유
- oppTouch(L2) 를 게이트로: "상대가 내 스매시를 미리 안다"는 가정이라 확정킬이 거의 사라짐(AC 46·OurBot 34, 터치초과 발생).
- v6_Defense 의 점수 하한 밴딧 공격 게이트, 다이빙 허용 수신, GD_ATTACK_PH, 코스 학습(clsMul/COND): 확정 여부와 무관하거나 fictitious play.
- mixed 의 썬더 비활성·계산 서브(AC 상대 57%)·MixedRoute 본체(마무리 판정이 상대 걷기만 모델, p99 11ms).
- PRIORITY lethal(접촉창 우선): NetCamper 41·AC 25.
- kg REACT 2: 약간 손해(NC 95·AC 96).

---

## 6. 도구
- 생성기 `bot-dev/v8/build_v8.mjs` (env: V8_PRED, V8_REACT, V8_STANDBY, V8_PRIO, V8_TOUCH, V8_PASS_REACH, V8_PASS_WINDOW, V8_THUNDER)
- `bot-dev/v4_checks.mjs` 단위 검사 17개(썬더 꺼진 빌드는 5개 FAIL 이 정상)
- `bot-dev/possession_audit/gate_verify.mjs [N] [bot]` 킬 게이트 ↔ 정확 모델 대조
- `bot-dev/v8/recv_kinds.mjs` 리시브 랠리의 계획 종류·점프 출처(승패별), `bot-dev/v8/trace_loss.mjs` 패 랠리 마지막 N틱, `bot-dev/v8/touch_audit.mjs` 터치 감지 ↔ 엔진 기록
- `bot-dev/rally_escape/cmp_bench.mjs`, `loss_diag.mjs` (경로 인자 가능)
- Chrome: `HARNESS_CONFIG="$(cat bot-dev/v8/browser_cfg_v8.json)" node bot-dev/harness/run.mjs` (스크래치 dist + serve_static 8767)

## 7. 제출 체크리스트
1. `DEBUG=false` 권장.
2. `THUNDER_SERVE` 결정(1 기본). 지연 2 환경이면 LAT_GUARD 가 알아서 썬더를 포기한다.
3. 파일명 규칙 `<Team>_v<ver>.js` 유지(드롭다운 등록).
4. 바꾼 뒤 `v4_checks` 17/17, `cmp_bench` 5상대, Chrome 좌우 1경기씩.
