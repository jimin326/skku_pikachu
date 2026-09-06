# 리온이 배구 AI 봇 — 2026 SKKU × HYU CSE 교류전 AI 부문 **우승**

팀 **사자먹는은행** (성균관대학교). 피카츄 배구 웹 버전을 개조한 대회 엔진 위에서, 매 3프레임마다 스냅샷을 받아 `{x, y, hit}` 을 돌려주는 봇으로 겨루는 대회입니다. 대회 당일 공개된 스킬(발톱)까지 한 시간 안에 대응해 우승했습니다.

> **English.** Winning bot of the 2026 SKKU × HYU CSE AI volleyball competition (a modified Pikachu Volleyball engine; bots return `{x, y, hit}` every 3 frames). Highlights: a frame-exact re-implementation of the game loop for offline simulation, an open-loop "thunder" serve found by exhaustive search, a rally core built around a guaranteed-kill gate, a submission gate (5 automated checks + headless-Chrome matches), and same-day adaptation to a hidden skill revealed at the event. Engine code is **not** included; see *실행 방법*.

## 결과

| 항목 | 내용 |
|---|---|
| 대회 | 2026 성균관대학교 × 한양대학교 CSE 교류전 AI 부문 (2026-09-05) |
| 결과 | **우승** |
| 제출본 | [`bot/submitted/사자먹는은행_v1.js`](bot/submitted/사자먹는은행_v1.js) — 유래·검증은 [`bot/submitted/SUBMISSION.md`](bot/submitted/SUBMISSION.md) |
| 팀원 | [@jimin326](https://github.com/jimin326) (최종 봇 라인 `Lion_Eating_Bank`·시뮬레이터·검증 도구), [@keunhyung](https://github.com/keunhyung) (RL/BC 실험 `robust-rl-colab`, 수비 봇 v6), [@kimmykimmim](https://github.com/kimmykimmim) (`AdaptiveCounter` 시리즈, 상대 적응 수비). 역할은 브랜치·커밋 기준 |

증빙(상장·순위표)은 `docs/results/` 에 추가 예정.

## 봇 구조 (`Lion_Eating_Bank_v13` → `v15` / 제출본)

```
§0 당일 노브     DEBUG, THUNDER_SERVE, 스킬 노브 SK … 대회 당일 손댈 수 있는 상수만 모아 둠
§1 Thunder      내 서브 공의 낙하 위상(3가지)별로 미리 찾아 둔 24~29틱 오픈루프 입력 시퀀스.
                 상대 코트에 3터치 킬. 밴딧이 위상별 서브 모드(thunder/ac/flat)를 고르고, 자기검증이 어긋나면 즉시 랠리 로직으로
§2 ACCore       랠리 로직. 공·플레이어 물리를 프레임 단위로 재현(microSim)해 후보 행동을 채점.
                 확정킬 게이트(상대가 서기·점프·다이빙 어느 것으로도 못 닿는 궤적만 킬), 최소 이동 수비 위치, 넘기기 시뮬
§3 오케스트레이터  소유자(TH > AC > 폴백) 선택 → 스킬 층 적용 → sanitize → 반환. 예외는 삼키되 세고 F12 에 1회 로그
스킬 층          발톱(claw) 회피(예고 중 위험 반경이면 도피, 단 공이 먼저 오면 공) + 낙하점 시전(상대가 받으려면 서 있어야 할 자리에)
```

핵심 전제: 스냅샷은 그 프레임의 물리 실행 **전**에 찍히고 응답은 다음 프레임부터 적용된다. 이 한 줄이 이륙 직후 속도 추정(F1) 같은 버그의 원인이자 썬더 서브의 위상 개념의 근거입니다.

## 검증 체계 (`tools/`)

| 도구 | 하는 일 |
|---|---|
| `sim_real.mjs` | 실게임 프레임 단위 재현(랜덤 서브, READY 30프레임, 5터치 제한, 지연 1프레임). `ENGINE_ROOT` 로 주최 측 엔진을 그대로 import |
| `v8/shadow_diff.mjs` | 두 봇에 같은 스냅샷 열을 주고 x/y/hit 동일성 검사. 리팩터·어댑터 채택 조건 |
| `rule_check.mjs` | 4MB·최상위 `decide`·금지 토큰·표준 전역만 있는 vm 로드·p99/max 시간·throw/null/invalid 반환·내부 예외 |
| `sk_v2_test.mjs` | 스킬 어댑터 6 시나리오 |
| `dayof/gates.mjs` | 위 검사를 묶은 제출 게이트. 하나라도 FAIL 이면 제출하지 않는 규칙 |
| `dayof/thunder_check.mjs` | 새 엔진 위에서 썬더 기대 궤적 표(80항목) 대조 → 서브 유지/끄기 판정 |
| `dayof/harness_dayof.mjs` + `harness/run.mjs` | 주최 측 레포를 빌드해 헤드리스 Chrome 에서 실제 Worker 로 좌우 2경기, F12 로그 요약(Playwright) |
| `dayof/diff_engine.mjs` | 당일 새 레포 vs 이전 엔진: 상수표·핵심 파일 diff·`skill/` 전문·제공 봇 return 줄 |
| `skills/claw_real.mjs` | 공개된 `skill/gauge.js`·`claw.js` 를 그대로 시뮬에 붙여 스킬 OFF/ON·노브별 대결 |

## 타임라인과 수치

- **v1 → v12** (8월 말 ~ 9월 초): 썬더 서브 발견(위상 3종 × 40/40 Chrome 검증) → 밴딧·이탈 → 상태 인지 도달 모델 → 확정킬 게이트 → 클린코드판 v12(출력 동일 검증).
- **9/5 새벽, 외부 리뷰 4건**: 이륙 직후 vy 오추정(모든 점프의 첫 스냅샷 100%), y=244 공중 프레임 조기 착지, 누운 상대 몸 접촉 누락, `null` 반환을 통과시키는 게이트. 전부 엔진 소스 대조로 재현 뒤 수정 → **v13**. v13 vs v12 자기대전 **10-0**(좌우 5시드), 약한 상대 3종엔 변화 없음.
- **9/5 스킬 공개(발톱)**: 규칙 코드 정독 → 시뮬 훅으로 실제 코드 이식 → 회피 + 낙하점 시전 → **v14/v15**. 예제 봇 상대 6-0, 시전 14회 중 12회 적중, 피격 12회 중 2회(회피 없으면 6회). Chrome 실기에서 실제 시전 확인.
- **제출**: v14 를 당일 손편집(썬더 끔, 회피 제거)한 파일. 사후 비교에서 회피·썬더를 살린 v15 가 제출본에 4-2 — 개선 여지로 기록.

| 검사 | 수치 |
|---|---|
| 제출 게이트 | 5개 PASS (shadow 0, 어댑터 6 시나리오, throw/invalid 0, >120ms 0) |
| decide 시간 (rule_check) | p99 15~25ms, max < 120ms (틱 예산 120ms) |
| Chrome 실기 | v13 3:0 / 0:3, v14·v15 5:0 / 0:5 (타임아웃·예외 0) |

## 실행 방법

엔진은 라이선스가 명시되지 않아 이 저장소에 넣지 않았습니다. 주최 측 공개 저장소를 받아 `ENGINE_ROOT` 로 지정합니다.

```bash
git clone https://github.com/SKKU-x-HYU-SW-Competition/leonyi-volleyball-skill.git ../engine
(cd ../engine && npm install)          # Chrome 실기 빌드용
npm install                            # 이 저장소: playwright-core 만
export ENGINE_ROOT=../engine
node --no-warnings tools/dayof/gates.mjs bot/Lion_Eating_Bank_v15.js --base Lion_Eating_Bank_v13
node --no-warnings tools/eval_skill_real.mjs ./skills/claw_real.mjs Lion_Eating_Bank_v15 skill-example_v1 3
node --no-warnings tools/dayof/thunder_check.mjs ../engine Lion_Eating_Bank_v15
node tools/dayof/harness_dayof.mjs ../engine --bot Lion_Eating_Bank_v15.js --opp skill-example_v1.js --score 5   # Chrome 필요
```

PowerShell 은 `npm.cmd`, `$env:ENGINE_ROOT = '..\engine'`. 셸별 명령은 [`tools/dayof/SHELL_COMMANDS.md`](tools/dayof/SHELL_COMMANDS.md).

## 저장소 구조

```
bot/                 봇 풀(도구가 이름으로 찾는 곳). 제출본 submitted/, 최종 라인 v12~v15 + 설계 문서, 검증 상대 봇
bot/archive/         v1 ~ v11 과 실험 봇
tools/               시뮬레이터·게이트·Chrome 하네스·스킬 훅 (옛 bot-dev/)
docs/                대회 규칙 정리, 당일 계획, 스킬 예측, 검증 보고서, 외부 리뷰, 결과 증빙
```

브랜치: `main`(이 구조), 팀원 브랜치 `kyubeom`·`keunhyung`·`robust-rl-colab` 은 각자의 작업 그대로. 태그 `v12-baseline`, `v13-physics-fix`, `submitted-2026-09-05`, `day-of-2026-09-05`, `archive/*` 로 이력을 보존합니다.

## 배운 점

- 엔진을 프레임 단위로 재현하는 데 투자한 시간이 나머지 전부를 가능하게 했다. 벤치 수치가 흔들리면 시드부터 고정한다.
- "출력 동일" 검사(shadow_diff)가 있으면 리팩터·어댑터·당일 패치를 두려움 없이 할 수 있다.
- 검증 도구도 검증 대상이다. `null` 을 통과시키던 게이트는 외부 리뷰가 잡았다.
- 당일엔 코드를 최소로 고치고 게이트가 결정하게 한다. 그래도 손편집(회피 제거)이 들어갔고, 사후 비교에서 그것이 손해였다.

## 크레딧

- 원작 피카츄 배구 웹 버전: [gorisanson/pikachu-volleyball](https://github.com/gorisanson/pikachu-volleyball). 원작 게임 © 1997 SACHI SOFT / SAWAYAKAN Programmers, Satoshi Takenouchi.
- 대회 엔진·스킬 규칙: [SKKU-x-HYU-SW-Competition](https://github.com/SKKU-x-HYU-SW-Competition). 이 저장소는 엔진·에셋을 포함하지 않으며, 검증 상대로 쓴 예제 봇 `bot/skill-example_v1.js` 만 주최 측 공개 저장소에서 가져왔습니다.
- 라이선스: 팀 합의 후 추가 예정.
