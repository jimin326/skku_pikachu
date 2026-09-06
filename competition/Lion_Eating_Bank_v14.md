# Lion_Eating_Bank_v14 — v13_1 + 발톱(claw) 정책 (2026-09-05 스킬 공개 대응)

`Lion_Eating_Bank_v14.js` = v13_1(v13 + 스킬 어댑터 v2)에서 **어댑터 구역(SK 블록·applySkill, 37~127행)만** 확장한 파일. 봇 로직(§1 Thunder·§2 ACCore)은 v13 그대로.
`config.claw` 가 없는 엔진(구 레포·shadow_diff·sk_v2_test)에서는 발톱 정책이 꺼져 **v13 과 출력이 같다**(게이트 shadow 불일치 0).

새 레포: https://github.com/SKKU-x-HYU-SW-Competition/leonyi-volleyball-skill (커밋 0f1de4b, 로컬 `C:\SKKU\pikachu\leonyi-volleyball-skill`).
`bot-dev/dayof/diff_engine.mjs` 결과: 물리 상수·틱 규약 전부 동일, physics.js 는 주석만 변경. 바뀐 것은 스킬 층(`skill/`)과 스냅샷·응답 필드뿐.

## 공개 규칙 (skill/claw.js · skill/gauge.js · bot/botContract.js 원문 기준)

- **발동**: 반환 객체에 `skillX`(조준 x, 0~432. 코트 밖은 클램프). 응답당 1회. 게이지 < 55, 내 발톱이 비행 중(예고 25 + 표시 10 프레임), 내가 누움/기절(state ≥ 4), 랠리 밖(READY·득점 뒤)이면 **조용히 무시**(게이지 안 씀).
- **타격**: 시전 뒤 25프레임에 딱 한 번. 그때 상대 x 가 `|x − centerX| ≤ 30 + 32 = 62` 면 기절: y=244 로 떨어지고 state 4, `lyingDownDurationLeft` 43 → **45프레임 입력 불가**. 점프로 못 피함. 랠리가 끝나면 비행 중 발톱 소멸(환불 없음).
- **게이지** 0~100, 경기 시작 0, 랠리 넘어 유지(새 경기에 리셋). 서브 0, 리시브(상대가 친 공의 첫 터치) **+15**, 같은 쪽 3터치째부터 **−5**, 파워히트 성공(state 2 접촉) **−10 추가**. 비용 **55**. 예: 리시브+스매시 = +5, 리시브+세트+스매시 = 0.
- **스냅샷**: `self/opp.gauge`, `self/opp.claw` = null | `{centerX, framesUntilStrike, framesLeftActive}` (**시전자 기준** → `opp.claw` 가 나를 노리는 발톱), `self/opp.lyingDownDurationLeft`, `config.claw {cost 55, width 60, warningFrames 25, stunFrames 45, activeFrames 10}`, `config.gauge {onReceive 15, onExtraTouch −5, extraTouchStartsAt 3, onPowerHit −10, onServe 0}`.
- 사람 키: P1 `C`, P2 오른쪽 `Shift`(상대 현재 x 에 시전). 제공 예제 봇 `skill-example_v1.js` 는 위험 반경이면 도피, 게이지 되면 상대의 8틱 뒤 예측 위치에 시전.

## 정책 (SK 노브, 파일 37~46행)

| 노브 | 값 | 뜻 |
|---|---|---|
| `on` | true | 어댑터 켬 |
| `key` | `'skillX'` | 시전 키. **`fire` 는 0 유지** — skillX 는 좌표라 fire 로 보내면 x=1 에 시전된다 |
| `full` | 55 | 비용(런타임엔 `config.claw.cost` 우선) |
| `dodge` / `dodgeMargin` / `dodgeMinFrames` | 1 / 10 / 3 | `opp.claw` 예고 중 `|x − centerX| ≤ 62 + 10` 이면 x 를 도피 방향으로 덮어씀(그쪽이 벽이면 반대). **소유자 무관**(썬더 중이면 시퀀스가 깨져 AC 로 넘어가지만 기절보다 낫다). 공이 예고 종료 전에 내 코트에 떨어지면 도피하지 않고 친다(도피 = 확실한 실점). 지상 다이빙 금지(누움 5프레임 동안 못 피함) |
| `claw` / `castMinLand` / `castMaxLand` | 1 / 18 / 40 | 게이지 ≥ cost · 내 발톱 없음 · 공이 상대 코트에 18~40프레임 뒤 떨어지는 궤도 · 상대가 닿을 수 있음(못 닿으면 확정킬이라 아낌) → **낙하점**(상대 코트 안으로 클램프)에 시전. 받으려면 그 자리에 있어야 하고 피하면 공을 놓친다. AC 소유 틱만 |

검사 도구: `decide.__skState = {fired, casts, dodged, errors, …}`. F12 에는 `스킬 발동 tick=… skillX=… gauge=…` 가 Worker 당 최대 5줄.

## 검증 (2026-09-05, 새 엔진 + 실제 gauge/claw 코드)

시뮬 훅 `bot-dev/skills/claw_real.mjs` 는 가짜 규칙(today.mjs)이 아니라 새 레포의 `skill/gauge.js`·`skill/claw.js` 를 그대로 붙여 실게임 배선 순서(gauge.observe → 시전 → claw.observe)로 돈다.

- 게이트(`ENGINE_ROOT=새레포`, `--base Lion_Eating_Bank_v13`): 5개 PASS — shadow 불일치 0, sk_v2_test S1~S6 ALL PASS, rule_check throws 0 invalid 0, >120ms 0. thunder_check(새 엔진): THUNDER_SERVE=1 유지(80/80).
- 매치업(3시드 × 좌우 = 6경기, 10점 선취):

| 봇(노브) vs 상대 | 승-패 (L / R) | 득-실 | 시전 내/상대 | 적중 내/상대 | 회피 | 예외 |
|---|---|---|---|---|---|---|
| v14 vs skill-example_v1 | 6-0 (3-0 / 3-0) | 60-3 | 14/12 | **12**/**2** | 35 | 0 |
| v13_1(발톱 없음) vs skill-example_v1 | 6-0 | 60-5 | 0/15 | 0/6 | 0 | 0 |
| v14 dodge=0 vs skill-example_v1 | 6-0 | 60-4 | 14/12 | 12/6 | 0 | 0 |
| v14 claw=0 vs skill-example_v1 | 6-0 | 60-3 | 0/14 | 0/3 | 24 | 0 |
| v14 vs v13(회피 없음) | 6-0 | 60-17 | 46/0 | 43/0 | 0 | 0 |
| v14 vs v14 | 3-3 | 47-47 | 49/49 | 19/19 | 180 | 0 |

읽기: 회피로 피격 6 → 2, 낙하점 시전은 예제 봇(도피 로직 있음) 상대로도 14회 중 12회 적중, 회피 못 하는 봇(v13)에는 43/46. 예제 봇 자체가 약해 승패 차이는 안 보인다.
- Chrome 실기(새 레포 빌드, 헤드리스 Chrome, 실제 Worker·스킬 층, v14 vs skill-example_v1 좌우 5점): **5:0 / 0:5**, timeouts 0, invalid 0, >120ms 0, p99 ≈14ms. F12 에 `스킬 발동 tick=651 skillX=133 gauge=60` 뒤 `self.claw 첫 non-null {centerX:133, framesUntilStrike:23}` — 반환 `skillX` 가 실제 엔진에서 시전으로 등록됨을 확인. 결과 `bot-dev/dayof/out/chrome_2026-09-05T03-49-30.json`.
- 한계: 시드 3개. 다른 팀 봇의 시전 습관은 모른다. 시전 타이밍 창(18~40)은 첫 값이며 실전 로그로 조정할 것.

## 당일 사용

```
ENGINE_ROOT=<새레포> node --no-warnings bot-dev/dayof/gates.mjs src/code-here/Lion_Eating_Bank_v14.js --base Lion_Eating_Bank_v13
ENGINE_ROOT=<새레포> node --no-warnings bot-dev/eval_skill_real.mjs ./skills/claw_real.mjs Lion_Eating_Bank_v14 skill-example_v1 3
node bot-dev/dayof/harness_dayof.mjs <새레포> --bot Lion_Eating_Bank_v14.js --opp skill-example_v1.js
```
후퇴 순서: 발톱 정책만 끄기 `dodge: 0, claw: 0`(= v13_1 과 같은 동작) → 어댑터 끄기 `on: false`(= v13) → 사이트의 v12.
