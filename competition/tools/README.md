# competition/tools/ — 당일 도구 사본

이 폴더는 개발 저장소 **jimin326/jimin_pika**(브랜치 `feature/thunder-recovery-v1`)의 `bot-dev/` 에서 필요한 파일만 **같은 상대 경로로** 복사한 것이다. 스크립트는 자기 위치에서 `../..` 를 저장소 루트로 보고 `src/resources/js/`(엔진)·`src/code-here/`(봇)·`node_modules` 를 찾으므로 **이 폴더에서 직접 실행되지 않는다.**

## 실행하는 방법
1. jimin_pika 를 받아 `npm install` (엔진 + 상대 봇 풀 + 하네스가 거기 있다).
2. 이 폴더의 `bot-dev/` 를 그 저장소 `bot-dev/` 위에 덮어쓴다(같은 경로).
   ```
   cp -r competition/tools/bot-dev/* <jimin_pika>/bot-dev/
   cp competition/Lion_Eating_Bank_v12_1.js competition/Lion_Eating_Bank_v12.js <jimin_pika>/src/code-here/
   ```
3. `<jimin_pika>` 루트에서 `bot-dev/dayof/README.md` 의 T+ 순서대로 실행한다.

## 들어 있는 것
| 경로 | 무엇 |
|---|---|
| `bot-dev/dayof/README.md` | **당일 명령 순서** (T+0 ~ 제출, 막혔을 때) |
| `bot-dev/dayof/diff_engine.mjs` | 새 레포 vs 우리 엔진: 상수표·핵심 파일 diff·skill/ 모듈 전문·제공 봇 return 줄 |
| `bot-dev/dayof/thunder_check.mjs` | 새 물리 위에서 썬더 기대 궤적 대조 → `THUNDER_SERVE` 유지/끄기 판정 |
| `bot-dev/dayof/gates.mjs` | 제출 게이트 일괄(크기·로드·SK → shadow_diff → sk_v2_test → rule_check) |
| `bot-dev/dayof/harness_dayof.mjs` | 새 레포 빌드 + 정적 서버 + 헤드리스 Chrome 좌우 2경기 병렬 + F12 요약 (`NODE_PATH`=playwright-core, `CHROME_PATH` 필요) |
| `bot-dev/sim_real.mjs` | 실게임 재현 시뮬. `ENGINE_ROOT=<새레포>` 로 새 물리 사용, 스킬 훅 5개, setup.js 용 shim |
| `bot-dev/eval_skill_real.mjs` + `bot-dev/skills/today.mjs` | 스킬 OFF/ON 같은 시드 비교 + 당일 스킬 재현 템플릿(A 공 물리·B 스턴·C 득점) |
| `bot-dev/sk_v2_patch.mjs` / `bot-dev/sk_v2_test.mjs` | 어댑터 v2 생성기(v12 → v12_1, 손 편집 금지) / 기능 검사 S1~S6 |
| `bot-dev/rule_check.mjs` | 규칙·시간·예외 검사 (4MB·최상위 decide·금지 토큰·p99·무효 반환) |
| `bot-dev/v8/shadow_diff.mjs` | 두 봇의 같은 스냅샷 출력 동일성(리팩터·어댑터 채택 조건) |
| `bot-dev/harness/run.mjs`, `bot-dev/harness/dayof.json` | Playwright 하네스 본체 + 당일 설정 템플릿 |
| `bot-dev/thunder_phase12/serve_static.mjs` | 빌드 dist 정적 서버(의존성 없음) |
| `bot-dev/RUNBOOK_당일.md` | 옛 3시간 런북의 폐기 스텁(새 절차 안내) |

## 필요한 상대 봇(jimin_pika `src/code-here/` 에 있음)
`OurBot_v12.js`, `NetCamper_v2.js`, `AdaptiveCounter_v5_2.js` — shadow_diff·sk_v2_test·eval 의 기본 상대. 없으면 인자로 다른 봇을 준다.
