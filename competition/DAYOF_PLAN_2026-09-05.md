# 당일 공개 대비 계획 (Lion_Eating_Bank_v12 기준, 2026-09-05)

근거: `bot-dev/SKILL_PREDICTION.md`(팀 main 과 동일), 심층 조사 PDF(`Lion_Eating_Bank_v11_당일스킬_심층조사.pdf`), v12 코드, 엔진 소스(`src/resources/js`), `COMPETITION_GUIDE.md`, `V11_VERIFY_REPORT_2026-09-05.md` B1~B7.
줄 번호는 전부 **v12** 기준(`src/code-here/Lion_Eating_Bank_v12.js`). 검증 수치 없이 쓴 문장은 "추론"으로 표시했다.

## 0. 결론 다섯 줄

1. PDF 가 "가장 중요한 발견"이라 한 **"sanitize 가 발동 키를 삭제한다"는 v11 원본(팀 main 2526행) 얘기다.** v11_1/v12 는 sanitize 뒤에 `SK.key` 를 다시 복사한다(v12 1932행). 이미 해결됨.
2. PDF 의 나머지 지적 3개는 v12 에도 유효하다: ① 스킬 후처리가 Thunder 에도 적용됨 ② 발동이 `external` 에 안 잡힘 ③ 재발동 latch 없음. 여기에 내가 하나 더 찾았다: ④ `guard` 가 상태를 안 보고 y=1→−1 로 바꿔서 **지상 다이빙 `{x:±1,y:1,hit:1}` 을 점프+파워히트로 바꿔 버린다.**
3. 두 문서가 일치하는 예측(게이지 존재, 발동 = 반환 객체의 추가 키, 효과 = 프레임 후처리 공 물리 변조 1순위)은 엔진 코드로 재확인됐다(§1). 단 정확한 키·경로·수치는 당일 빈칸이다.
4. 도구 공백 하나: 스킬 훅은 옛 `sim.mjs` 에만 있고, 벤치·규칙검사가 쓰는 `sim_real.mjs` 에는 없다. 당일 새 레포의 물리·스킬 모듈을 그대로 꽂을 수 있게 지금 만들어 둔다(§2 P3).
5. 당일은 "어댑터 설정값·노브·한 줄"만 만진다. 하나라도 모호하면 **동결 v12** 제출. v12 를 지금 사이트에 올려 두면(제출 0건) 당일 후퇴는 "덮어쓰지 않기"로 끝난다.

## 1. 두 문서 대조 — 무엇이 확인됐고 v12 는 어떤 상태인가

| 항목 | SKILL_PREDICTION | PDF | 엔진 코드 확인 | v12 현재 | 조치 |
|---|---|---|---|---|---|
| 게이지(충전 상태) 존재 | 확정(`skill/gauge.js` 흔적) | 95% | `rules/touchLimit.js` 10행 "Like skill/gauge.js this is a pure observer" | `SK.gauge='self.gauge'` 고정 경로, 숫자 ≥ `full`(100) 만 인정 | 경로·만충 판정을 설정형으로(숫자·boolean·객체 모두) — P2 |
| 스냅샷 `self.claw`/`opp.claw`, null 가능 객체 | 확정(`botWorkerPython.js` 주석) | 언급 없음 | 37행 `if s['self']['claw'] is None` | `skPick` 은 중간 null 이면 undefined 반환(안전). `logNewFields` 는 첫 틱 1회만 찍어 **처음 null 이던 필드가 나중에 객체가 되면 키를 못 본다** | 새 필드별 "첫 non-null 값·타입 변화" 로그(상한 있음) — P2 |
| 발동 = 반환 객체의 추가 키 | 높음(`isValidBotAction` x/y/hit 만) | 82% | `botWorker.js` 73행 `action: action` 그대로 post → `botInput.js` 174행 `latestAction = message.action` 전체 저장, 258~260행은 x/y/hit 만 읽음 → **추가 키 생존** | 1932행에서 `SK.key` 복사 → 통과 | 키 이름·값(`1`/`true`)만 당일 채움 |
| 효과 1순위 = 공 물리 변조(프레임 후처리) | 1순위 | 48%(직접 변경), 80%(공격 강화) | `console.js` 16행 "skill/setup.js ... never reaches into the physics engine" → `physics.js` 밖에서 공개 필드 덮어쓰기 | `expectedLandingPointX` 10곳 사용(1146·1390·1435·1613·1686~1696·1853). ELP 가 스킬을 모르면 오판 | 응급 한 줄 준비(§3 유형 A) |
| Thunder 자체가 스킬 | 아니다 | 10% | 97f6481 은 ±40 clamp 만 | v12 는 clamp 반영·Chrome 재검증 완료 | 새 물리 diff 가 깨끗하고 TH_EXPECT 일치하면 **유지** |
| "수비형은 안 통함, 매서운 공격" | 인용 | 인용 | 가이드 4cd5477 | 썬더 서브 + 확정킬 게이트 = 이미 공격형 | 방향 유지. 스킬 사용은 AC 소유 hit 틱에만 |
| Thunder/AC 구분 없이 스킬 합성 | — | 지적 | — | **유효.** `applySkill` 은 소유자를 모른다(1932행). guard 가 썬더 스파이크 틱 y=1 을 −1 로 바꾸면 오픈루프 시퀀스가 깨진다 | `owner==='AC'` 에만 적용 — P2 |
| 발동이 `external` 미반영 | — | 지적 | — | **유효(경미).** 1933행 `external` 은 x/y/hit 변화만 본다. 스킬이 공 물리를 바꾸면 `g_air_policy`(1829행에서 지워지는 값)가 옛 가정으로 남음 | `fired → external` — P2 |
| 만충 유지 시 매 hit 틱 재발동 | — | 지적 | — | **유효(조건부).** 46행은 `hit===1 && state===1` 마다 키를 붙인다. 소모 엣지가 "접촉"이면 헛발동 뒤 재시도가 오히려 맞고, "입력"이면 낭비 | latch 를 노브로(기본 켬, 게이지가 만충 아래로 내려가면 해제) — P2 |
| 상대 만충 → 무조건 y=−1 guard | — | 제거 권고 | 가이드 §5.3: 지상 `{x≠0, y≠−1, hit:1}` = 다이빙, y=−1 이면 점프+파워히트 | **버그.** 45행에 `state` 조건이 없어 다이빙을 점프로 바꿈. 공중에서도 "강스매시 금지"는 검증 안 된 가설 | 기본 `guard: 0`, 켤 때도 `s.self.state===1` 필수 — P2 |
| 발동 게이트 "1~4프레임 내 충돌 예측" | — | 권고 | — | AC 의 `hit:1` 은 (a) 지상 점프 틱(1711·1756, y=−1 동반) (b) 공중 스매시 틱(g_air_policy 재생) (c) 다이빙(1795) 에서만 나간다. 현 fire 조건 `state===1` 은 (b) 만 통과 | 1차는 그대로. 소모 엣지가 "입력"으로 확인될 때만 접촉 프레임 정밀 맞춤 검토(§3) |
| 상대 만충 근접 시 랠리 빨리 끝내기 | 권고 | threat mode 는 나중에 | — | 근거 없는 노브 변경은 하지 않는다(팀 원칙: 벤치·추측으로 노브 끄지 않기) | 시뮬에서 재현된 뒤에만 |

## 2. 대회 전(지금) 할 일 — P1~P6

우선순위 순. 예상 시간은 작업 시간. 전부 "당일에 하면 못 끝나는 것"만 골랐다.

### P1. v12 를 지금 제출해 베이스라인을 만든다 (5분, 사람)
- 사이트는 최신본만 쓰고 09-05 기준 제출 0건. 업로드 파일명 `사자먹는은행.js`(v12.md §6).
- 효과: 당일 어떤 게이트라도 실패하면 "새 파일을 올리지 않는다"가 후퇴 절차가 된다.

### P2. 스킬 어댑터 v2 → `Lion_Eating_Bank_v12_1.js` (60~90분) — **완료 2026-09-05**
결과: `bot-dev/sk_v2_patch.mjs`(앵커 7건) 로 생성, `SK.on=false` shadow_diff 22,134틱 불일치 0, 기능 검사 `bot-dev/sk_v2_test.mjs` S1~S6 전부 통과, rule_check 통과. 문서 `src/code-here/Lion_Eating_Bank_v12_1.md`.
계획과 달라진 점: "발동 → external" 은 `resync` 노브로 두고 **기본 0**. 근거: fire 는 x/y/hit 을 바꾸지 않고 AC 가 매 틱 공중 정책을 재점수(−400 기준)해 스스로 버리는데, resync 1 은 44랠리 중 4개에서 하류 출력을 갈라 놓았다(S5). 필드 로그는 "첫 등장"도 찍도록 확장(활성 중에만 나타나는 키 대비).

v12 는 생성기 산출물이라 손 편집 금지. **`bot-dev/sk_v2_patch.mjs`**(앵커 정확히 1회 일치 검사) 로 v12 → v12_1 을 만든다. 채택 조건: `SK.on=false` 에서 v12 와 출력 동일(`bot-dev/v8/shadow_diff.mjs` 불일치 0).

바꾸는 것(27~49행 SK 블록, 1863~1871행 `logNewFields`, 1929~1934행 오케스트레이터):

```js
var SK = {
  on: false,
  key: 'skill', value: 1,            // 당일: 제공 봇 return 문에서 그대로 복사
  gauge: 'self.gauge', ogauge: 'opp.gauge',
  full: 100,                          // 숫자면 ≥full, boolean 이면 true, 객체면 .ready===true||.active===true
  owner: 'AC',                        // 이 소유자일 때만 fire/guard. TH·WAIT·FALLBACK 에는 절대 합성 안 함
  fire: 0, guard: 0, latch: 1
};
```
- `skFull(v)`: number ≥ full / `v === true` / object 의 `ready`·`active`·`full` 중 true. 당일 필드 모양이 뭐든 한 줄로 맞춘다.
- `applySkill(s, a, owner)`: `owner !== SK.owner` 면 즉시 반환. guard 는 `s.self.state === 1` 일 때만. fire 는 `hit===1 && state===1 && 만충 && !latched` → `a[SK.key] = SK.value`, `latched = true`. 게이지가 만충 아래로 내려가면 `latched = false`.
- 오케스트레이터: `applySkill(s, pre, owner)`; 발동했으면 `external = true`; `DEBUG` 면 경기당 최대 5회 `스킬 발동 tick=… gauge=…` 로그.
- `logNewFields` v2: 새 키마다 "첫 값 / 첫 non-null 값 / 타입이 바뀔 때" 최대 3회, 총 12줄 상한. `claw` 처럼 처음 null 인 객체의 키를 볼 수 있어야 한다.
- 규칙상 금지 행동 필터 자리(B4-d)는 지금처럼 `applySkill` try 블록 안에 둔다.

### P3. `sim_real.mjs` 에 스킬 훅 + 엔진 경로 환경변수 (60~90분) — **완료 2026-09-05**
결과: `sim_real.mjs` 에 `ENGINE_ROOT`(레포 루트 또는 src, 기본 ../src) + 훅 5개(`init/onRally/extend/filterInput/observe`) + `awardPoint` 공통 경로 + shim 3개(`pikaVolleyShim/tickerShim/operatorShim`). 봇 반환 객체의 추가 키를 `latestAction` 에 보존(실엔진과 같게). 새 도구 `bot-dev/eval_skill_real.mjs`(스킬 OFF/ON 같은 시드, builtin 상대 가능, `--sk` 로 봇 노브 대입), 템플릿 `bot-dev/skills/today.mjs`(A 공 물리·B 스턴·C 득점 원형, `SKILL_CFG` 환경변수로 전환). `shadow_diff`·`sk_v2_test`·`rule_check` 의 시드는 sim_real 이 export 하는 `setCustomRng` 로 통일(ENGINE_ROOT 를 바꿔도 같은 rand 인스턴스).
검증: 훅 없이 수정 전후 8경기 랠리 단위 동일, `ENGINE_ROOT=<이 레포>` 도 동일, 잘못된 경로는 즉시 오류. A/B/C 원형 각각 v12_1 `fire=1` 로 발동 5~9회·규칙 armed/소모 일치, C 는 `how='skill'` 랠리 5. 가짜 `setUpSkill(pikaVolley, ticker, operator)` 를 shim 에 붙여 ticker 콜백 매 프레임·`keyboardArray[i].latestAction.skill` 관측·`operator.awardPoint` 득점(10랠리 전부 skill) 확인. 회귀: sk_v2_test S1~S6 수치 동일, shadow_diff 0, rule_check 4-0·예외 0.
당일 주의: `awardPoint` 는 라운드 종료·경기 종료 뒤에는 거절한다(실엔진 operator 와 같음). skill ↔ touchLimit 관찰 순서는 새 `main.js` 에서 확인해 `step()` 의 호출 순서를 맞춘다.
- `ENGINE_ROOT` 환경변수(기본 `../src`)로 `physics.js`·`rand.js`·`botContract.js` import 경로를 바꿀 수 있게 한다. 당일 새 레포를 가리키면 **새 물리·새 스냅샷 빌더를 그대로 얻는다.** 우리가 스킬 물리를 손으로 흉내낼 필요가 없어진다.
- `RealGame` 에 훅 4개: `extend(snapshot, side)` → `BotInput.getInput` 의 `buildSnapshot` 뒤, `filterInput(side, action)` → 큐에서 꺼내 적용하기 직전, `observe(phys, game)` → `runEngineForNextFrame` 뒤(`observeTouchLimit` 옆, 여기가 assembly-layer 후처리와 같은 자리), `award` 반환 시 `endRally`+점수. 시그니처는 `skills/example_gauge.mjs` 와 같게.
- 새 레포의 `skill/setup.js` 가 `setUpSkill(pikaVolley, ticker, …)` 꼴(`main.js` 157행 `setUpTouchLimit` 과 같은 패턴, 추론)이면, `RealGame` 을 `{physics, keyboardArray: inputs, scores, isPlayer2Serve, state}` 모양 shim 으로 감싸 **그들 코드를 직접 호출**한다. shim 은 지금 만들어 두고 당일 필드명만 맞춘다.
- `eval_skill.mjs` 를 sim_real 위로 옮긴 `eval_skill_real.mjs`(좌우×서브권×N, 스킬 OFF/ON, 스킬로 끝난 랠리 수). 기본 봇 경로를 v12 로.
- `skills/today.mjs` 템플릿: 유형 A(공 속도 덮어쓰기)·B(스턴)·C(득점) 세 원형을 주석으로 미리 써 두고 당일 하나만 살린다.

### P4. 당일 스크립트 묶음 `bot-dev/dayof/` (40분) — **완료 2026-09-05**
결과(전부 Node 스크립트, 사용법은 `bot-dev/dayof/README.md` 의 T+ 순서):
- `diff_engine.mjs <새레포>`: 상수표(B1) · 핵심 12파일 diff · 새 레포에만 있는 파일 · claw|gauge|skill grep · skill/ 모듈 전문 · 제공 봇 return 줄. 가짜 레포(중력·상한 변경 + skill/setup.js·gauge.js + Staff_v1.js)로 전 항목 출력 확인. `out/diff_*.txt` 저장.
- `thunder_check.mjs <새레포>`: ENGINE_ROOT 로 새 물리 위에서 봇을 돌려 TH_EXPECT 와 대조. 판정 = 불일치 0 · 봇 SELF_CHECK 이탈 0 · 표 커버리지 80/80 · 발동 관측 · 틱그룹 3. 우리 엔진 80/80 유지, 중력 바꾼 가짜 레포는 "이탈 12회·커버리지 2/80 → THUNDER_SERVE=0"(초반 2틱만 일치하던 함정을 커버리지로 잡음).
- `gates.mjs <후보>`: 크기·로드·SK 노브 출력 → shadow_diff → sk_v2_test → rule_check, PASS/FAIL 표 + 종료 코드. v12_1 전부 PASS.
- `harness_dayof.mjs <새레포> --opp <제공봇.js>`: 봇 복사 → webpack 빌드(7초) → 정적 서버 → Chrome 좌우 2경기 병렬 → 점수·타이밍(p50/p99/timeouts/invalid/restarts)·오류 줄·새 필드 로그·스킬 발동·썬더 로그 요약, `out/chrome_*.json`. 이 레포를 새 레포 삼아 3점 경기로 end-to-end 확인(18~20초/경기, 워커 p99 3.5ms).
- `bot-dev/harness/dayof.json` 템플릿, `.gitignore` 에 `bot-dev/dayof/out/`.
계획과 달라진 점: `.sh` 대신 `.mjs`(팀원 PC 의 셸 차이 회피). 봇 파일명 규약은 registry 와 같게 "마지막 `_v` 뒤 임의 버전"(v12_1 허용).
- `diff_engine.sh <새레포경로>`: `physics.js`·`bot/botContract.js`·`bot/botInput.js`·`bot/botWorker.js`·`pikavolley.js`·`main.js`·`rules/` 를 우리 것과 diff, 새 레포 전체에서 `claw|gauge|skill` grep, `skill/setup.js`·`skill/gauge.js`·제공 봇의 `return` 문을 한 화면에 출력.
- `harness/dayof.json`: `Lion_Eating_Bank_v12_1` vs 제공 봇, 좌우 2경기, `parallel 2`, `speed fast`. 제공 봇은 `<팀>_v<n>.js` 이름으로 `src/code-here/` 에 복사해야 드롭다운에 뜬다(`botRegistry.js` 43행).
- `thunder_check.sh`: `thunder_expect_capture.mjs` 를 `ENGINE_ROOT=새레포` 로 돌려 `TH_EXPECT`(81행) 와 전 구간 비교. 불일치 1개라도 있으면 `THUNDER_SERVE=0`.
- `gates.sh <후보.js>`: `rule_check.mjs` + `shadow_diff`(SK off, v12 대비 0) + 파일 크기 + 최상위 `decide` 를 한 번에.
- 시간 제약 기록: Chrome 1세트 = **344~447초**(fast, chrome_v12 결과). 1시간에 실기는 4세트가 한계 → 벤치는 sim_real, Chrome 은 마지막 확인용.

### P5. 1시간 런북 교체 (이 문서 §4·§5·§6 이 런북이다) — **완료 2026-09-05**
- `bot-dev/RUNBOOK_당일.md` 는 3시간·v9 템플릿(`skillPolicy`, `render9.mjs`) 기준이라 폐기. 5개 문서(COMPETITION_GUIDE·SKILL_PREDICTION·TEAM_VERIFY_PROMPT·V11_VERIFY_REPORT·이 문서)가 파일명을 가리키므로 삭제 대신 **폐기 머리말 + 새 절차 안내 스텁**으로 교체(옛 내용은 Git 이력). 유효한 원칙 3개(5줄 받아적기·시간 없으면 동결판·제출 뒤 수정 금지)만 남겼다.
- `src/code-here/Lion_Eating_Bank_v12.md` §6 을 이 문서·`dayof/README.md`·v12_1 로 갱신. `bot-dev/README.md` 도구 표에 `eval_skill_real`·`skills/today`·`dayof/`·`sk_v2_*` 행 추가.

### P6. 팀 공유 (10분)
- 이 문서 + `dayof/` + `sk_v2_patch.mjs` + `eval_skill_real.mjs` 를 `skku-pikachu` main 에 push. 팀 저장소에는 검증 도구가 없다(keunhyung 리뷰 #9).

## 3. 당일 판단 트리 — 스킬 유형별 조치 (v12 줄 번호)

먼저 5줄을 채운다: ① 새 필드 이름·위치·타입·범위 ② 충전 조건·만충치·리셋 ③ 발동 키·값·소모 엣지(입력 시점인가 접촉 시점인가) ④ 효과 종류·지속 ⑤ 규칙상 실점 행동. 그 다음 유형을 고른다.

| 유형 | 판별 | 우리가 쓰기 | 방어 | Thunder |
|---|---|---|---|---|
| **A. 공 물리 변조(발동 순간 속도·위치 덮어쓰기, 불연속)** | `setup.js` 가 `ball.xVelocity/yVelocity/x/y` 를 한 번 쓴다 | `SK.fire=1`, `owner:'AC'`. AC 는 매 틱 스냅샷에서 다시 계산하므로 발동 뒤 1틱(3프레임) 안에 재동기화된다 | ELP 가 스킬을 반영하는지 확인. 안 하면 1696행 `= ball.expectedLandingPointX` → `= ballAfter(ball, framesToLanding(ball)).x`(자체 물리, 391·397행. 두 함수가 안에서 `cloneBall` 을 하므로 스냅샷 공 객체를 그대로 넘긴다). 1390행(`recordOpponentAttack`, 기록용)은 `s.ball` 로 같은 형. 상대 활성이 관측되면 413행 `DEF_CFG.REACT` 4→5 | 유지. 우리 서브에는 합성 안 함(시퀀스가 기대표에 묶임) |
| **A2. 지속형 물리 변화(중력·속도가 N프레임 동안 다름)** | `setup.js` 가 매 프레임 쓴다 / `active` 카운트다운 | `fire=0`(우리 킬 판정 `microSim` 658·709행이 그 구간에 틀림) | 371행 `stepBall` 에 조건부 분기가 필요하지만 스냅샷에 활성 상태가 있어야 가능. 없으면 관측 방어만(REACT 5) | `SELF_CHECK`(허용 2px)가 이탈을 잡아 AC 로 넘김(자동). 상대 스킬이 서브 공에 닿으면 어차피 랠리 |
| **B. 상대 무력화(스턴·눕힘·입력 무시)** | `setup.js` 가 상대 `keyboardArray`/`state`/`lyingDownDurationLeft` 를 쓴다 | `fire=1`. 접촉 소모형이면 현 hit 틱 그대로; 입력 소모형이면 헛발동이 손해라 latch 켬 | 우리가 스턴되면 어떤 노브도 못 막는다. 상대 만충이 보이면 "확정킬 우선"은 이미 기본(§2.3 게이트) — 추가 변경은 시뮬 근거가 있을 때만 | 유지 |
| **C. 판정형(득점·랠리 종료)** | `awardPoint` 호출 | 게이지를 채우는 행동이 우리가 이미 많이 하는 것(파워히트)이면 그대로. 아니면 손대지 않음 | 없음 | 유지 |
| **D. 자기 강화(이동속도·점프·히트박스)** | `player.x/y/state` 를 쓴다 | `fire=1` 은 우리 도달 모델(282·278행)을 낙관으로 만들 뿐 이득 불명 → 기본 0 | B4-(e): 407행 `KILL_GATE.MARGIN` 을 증가분 px 또는 999. 순간이동이면 17행 `BANDIT_MODES='flat,ac,thunder'` | 유지, 킬 틱 이탈은 `CAMP_ESCAPE` 가 처리 |
| **E. 잡기(claw grab, 공 소유·던지기)** | `claw` 객체에 공 위치가 들어감 / 공이 멈춘다 | 1시간 안에 시뮬 재현 불가(추론) → `fire=0` | 관측만. 공이 멈춘 뒤 다시 움직일 때 AC 가 재계산 | 유지(서브 킬은 잡기 전에 끝남) |
| **불명확** | 문서·샘플 봇 불일치, 효과 확률적 | **동결 v12** | — | 물리 diff 깨끗할 때만 유지 |

공통: `THUNDER_SERVE`(14행)는 물리 diff 또는 `thunder_check` 불일치 시에만 0. 최후 안전판은 14행 0 + 407행 `MARGIN=999`(수비형 — 운영진이 안 통한다 했으니 마지막 선택).

## 4. 당일 60분 시간표 (A 규칙·시뮬 / B 봇 / C 검증·제출)

| 시각 | A (규칙·시뮬) | B (봇) | C (검증·제출) |
|---|---|---|---|
| T+0 | 새 레포 받기 → `npm install` 백그라운드 | v12_1 해시·원본 동결. `bot-dev/submitted/` 에 사본 | 새 레포 `src/code-here/` 에 v12_1 + 제공 봇 복사(`<팀>_v<n>.js` 규약) |
| T+3 | `dayof/diff_engine.sh` → 물리·틱·서브·5터치 변화 여부를 B1 표와 대조 | 제공 봇 `decide` 의 return 문 → **키·값·조건** 을 5줄 시트에 | 가이드·API 문서에서 5줄 시트 채우기 |
| T+8 | `ENGINE_ROOT=새레포` 로 `eval_skill_real.mjs` v12_1(SK off) vs 제공 봇 → 기준 승률·실점 유형 | `SK` 값 채우기(key·value·gauge·ogauge·full). `fire 0` 으로 먼저 | `npm start` 또는 빌드+`harness dayof.json`(좌우 병렬) 1회: F12 `새 스냅샷 필드`, `decide() failed` 없음, `썬더 발동` |
| T+15 | 유형 판정(§3). `setup.js` 를 shim 으로 직접 호출 못 하면 `skills/today.mjs` 에 한 원형만 | 유형별 조치 적용(노브·한 줄, **새 로직 금지**) | 실기 결과 보고: 점수·실점 유형(스킬 직접/리시브/공격 막힘/자책) |
| T+25 | `eval_skill_real` 재실행: SK off vs on, 좌우 | 결과 보고 실점 유형으로 2차 수정(한 번만) | `thunder_check.sh` → THUNDER_SERVE 판정 |
| T+35 | — | 후보 확정 | Chrome 후보 좌우 1세트씩(병렬, ≈7분) |
| T+45 | — | — | `dayof/gates.sh 후보` → §5 게이트 전부 통과 시 제출, 내역 페이지에서 버전 확인, `submitted/` 사본 |
| T+52 | — | — | 예비. 게이트 하나라도 실패 → **P1 에서 올린 v12 를 그대로 둔다**(새 파일 안 올림) |

LLM 3회(회당 300자, 링크·코드 붙이기 불가):
1. T+5~15: "첨부한 `skill/setup.js` 발췌와 샘플 봇 return 문만 근거로, 발동 키·값 타입·필수 조건·소모 시점(입력/접촉)·지속 프레임을 표로. 추측은 분리." (키를 코드로 못 읽을 때만)
2. T+15~30: "구·신 `physics.js` diff 요약에서 공/선수 상태 전이·틱 순서·상수 변화만 골라 낙하지점 예측과 오픈루프 서브에 미치는 영향을 300자 이내로."
3. 예비: F12 예외 메시지 1줄 해석, 또는 "이 대응이 규칙상 실점인가".

## 5. 제출 게이트 (전부 통과해야 새 파일을 올린다)

| 게이트 | 도구 |
|---|---|
| `SK.on=false` 에서 v12 와 출력 동일 | `bot-dev/v8/shadow_diff.mjs` 불일치 0 |
| `fire=0, guard=0` 에서 x·y·hit 동일 | 같은 도구, SK.on=true |
| 발동 키가 최종 return 에 실제로 남음 | `eval_skill_real` 의 `bySkill`>0 또는 F12 발동 로그 |
| 한 충전 주기에 한 번만 발동(latch) | 발동 로그 tick 간격 |
| Thunder 소유 틱 출력이 v12 와 완전 동일 | shadow_diff 를 내 서브 랠리로 한정 |
| 좌우 대칭 | 좌우 각각 실행 |
| 제공 봇의 스킬을 양쪽에서 관측, 최소 1회 방어 | Chrome 1세트씩 + 실점 유형 |
| 물리·틱 동일할 때만 THUNDER_SERVE=1 | `diff_engine.sh` + `thunder_check.sh` |
| 예외·무효 반환·타임아웃 0, p99 ≤ 40ms | `rule_check.mjs`(v12 단독 p99 8.7ms, 스로틀4 66ms) |
| 파일 크기·최상위 `decide`·금지 토큰 | `rule_check.mjs` 정적 검사 |

## 6. 중단(후퇴) 조건

다음 중 하나면 스킬 기능을 줄이고 `fire=0`(관측 방어판) 또는 동결 v12 로 간다: 샘플 봇과 문서가 불일치, 효과가 확률적, physics diff 가 광범위, 좌우 중 한쪽만 실패, latch 해제 엣지 불명확, 실제 브라우저에서 발동 확인 불가, Chrome 실기에서 `decide() failed`·타임아웃 1회 이상.

## 7. 두 문서에서 채택하지 않은 것과 이유

- PDF "v11 sanitize 가 키 삭제": v12 에는 해당 없음(1932행). 대신 그 전제 위의 권장 구조(코어 {x,y,hit} → sanitize → 마지막에 키 부착)는 v12 가 이미 그 형태다.
- PDF "guard 제거": 채택(기본 0). 켜야 할 근거(상대 만충 때 강스매시가 손해라는 관측)가 생기면 `state===1` 조건과 함께.
- PDF "1~4프레임 내 충돌 예측 게이트": AC 의 `hit:1` 이 이미 계획된 접촉 틱에만 나가므로 별도 예측기는 만들지 않는다. 소모 엣지가 "입력"으로 확인되고 헛발동이 실측되면 그때 `EXP_S2_TRACK` 의 접촉 프레임을 조건에 추가.
- SKILL_PREDICTION "상대 만충 근접 시 공격 빈도↑": 시뮬 근거 없는 노브 변경 금지(팀 원칙). `eval_skill_real` 에서 재현된 뒤에만.
- 두 문서 모두의 "Thunder 선제 비활성화 불필요": 동의. 단 판정은 diff·TH_EXPECT·Chrome 발동 로그 세 가지로.

## 8. 남은 확인 사항(당일 전에 알 수 없는 것)

- 발동 키 이름(`skill`/`claw`/기타), 값 타입, 게이지 경로와 만충치, 소모 엣지, 효과·지속, 스냅샷에 상대 게이지가 보이는지.
- 새 레포에 `skill/setup.js` 가 `main.js` 에서 어떻게 조립되는지(ticker 순서가 gameLoop 앞인지 뒤인지 — 후처리 프레임이 봇 스냅샷에 언제 반영되는지 결정).
- 제공 봇의 실력(우리 벤치 풀 기준으로 판단하지 않는다 — 검증 상대로만).
