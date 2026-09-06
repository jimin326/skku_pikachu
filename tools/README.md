> **엔진은 이 저장소에 없다.** 주최 측 공개 저장소(https://github.com/SKKU-x-HYU-SW-Competition/leonyi-volleyball-skill)를 clone 해 `npm install` 한 뒤, 모든 도구를 `ENGINE_ROOT=<그 저장소>` 로 실행한다. 봇 풀은 `bot/`(이름만 주면 여기서 찾는다).

# tools/ — 당일 도구

저장소 **루트에서** 실행한다. 스크립트가 `../..` 를 저장소 루트로 보고 `src/resources/js`(엔진)·`bot`(봇)·`node_modules` 를 찾는다. 사전 준비는 `npm ci` 한 번뿐이다. 셸별 명령은 `dayof/SHELL_COMMANDS.md`.

명령 순서는 **`tools/dayof/README.md`** 에 T+0 부터 제출까지 정리돼 있다.

## 빠른 확인

```
node --no-warnings tools/dayof/gates.mjs bot/Lion_Eating_Bank_v12_1.js
```

## 들어 있는 것

| 경로 | 무엇 |
|---|---|
| `dayof/README.md` | **당일 명령 순서** (T+0 ~ 제출, 막혔을 때) |
| `dayof/diff_engine.mjs` | 새 레포 vs 우리 엔진: 상수표·핵심 파일 diff·skill/ 모듈 전문·제공 봇 return 줄 |
| `dayof/thunder_check.mjs` | 새 물리 위에서 썬더 기대 궤적 대조 → `THUNDER_SERVE` 유지/끄기 판정 |
| `dayof/gates.mjs` | 제출 게이트 일괄(크기·로드·SK → shadow_diff → sk_v2_test → rule_check) |
| `dayof/harness_dayof.mjs` | 새 레포 빌드 + 정적 서버 + 헤드리스 Chrome 좌우 2경기 병렬 + F12 요약 (Playwright·Chrome 경로 자동 탐색) |
| `sim_real.mjs` | 실게임 재현 시뮬. `ENGINE_ROOT=<새레포>` 로 새 물리 사용, 스킬 훅 5개, setup.js 용 shim |
| `eval_skill_real.mjs` + `skills/today.mjs` | 스킬 OFF/ON 같은 시드 비교 + 당일 스킬 재현 템플릿(A 공 물리·B 스턴·C 득점) |
| `sk_v2_patch.mjs` / `sk_v2_test.mjs` | 어댑터 v2 생성기(v12 → v12_1, 손 편집 금지) / 기능 검사 S1~S6 |
| `rule_check.mjs` | 규칙·시간·예외 검사 (4MB·최상위 decide·금지 토큰·p99·무효 반환) |
| `v8/shadow_diff.mjs` | 두 봇의 같은 스냅샷 출력 동일성(리팩터·어댑터 채택 조건) |
| `harness/run.mjs`, `harness/dayof.json` | Playwright 하네스 본체 + 당일 설정 템플릿 |
| `thunder_phase12/serve_static.mjs` | 빌드 dist 정적 서버(의존성 없음) |
| `RUNBOOK_당일.md` | 옛 3시간 런북의 폐기 스텁(새 절차 안내) |

## 검증에 쓰는 상대 봇

`bot/` 의 `OurBot_v12.js`, `NetCamper_v2.js`, `AdaptiveCounter_v5_2.js` 가 shadow_diff·sk_v2_test·eval 의 기본 상대다. 이미 들어 있다. 다른 봇을 쓰려면 인자로 준다.

## Chrome 실기(harness_dayof)

`playwright-core`는 `npm ci`로 함께 설치된다. Chrome/Chromium은 일반 설치 경로를 자동 탐색하며, 자동 탐색이 실패할 때만 `CHROME_PATH`를 지정한다.

```
node tools/dayof/harness_dayof.mjs <새레포> --opp <제공봇.js>
```

Chrome 자동 탐색이 실패할 때만 `CHROME_PATH`를 지정한다. 셸별 문법은 `dayof/SHELL_COMMANDS.md`.
