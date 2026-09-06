# Lion_Eating_Bank_v15 — v13 + 발톱(claw) 스킬만 얹은 최소 수정판 (2026-09-05)

`Lion_Eating_Bank_v15.js` = **v13 원본에서 세 곳만** 바뀐 파일. 봇 로직(§1 Thunder·§2 ACCore·§3 오케스트레이터)은 v13 그대로다(`diff` 85줄, 전부 스킬 블록).
1. 머리말 2줄.
2. v13 에 이미 있던 빈 스킬 훅 자리(`SK` 블록 + `applySkill`, 26~50행)를 발톱 회피·시전 코드로 교체(26~99행). 어댑터 v2(fire/guard/latch/resync, 필드 로그 v2)는 넣지 않았다.
3. 검사 도구용 노출 1줄 `decide.__clawState = SK_ST`.

오케스트레이터가 원래 하던 대로 최종 출력 직전에 `applySkill` 을 한 번 부르고, `sanitize` 가 버리는 `SK.key`(=`skillX`)만 따로 복사한다. **`config.claw` 가 없는 엔진에서는 아무 것도 안 해 v13 과 출력이 같다**(게이트 shadow 불일치 0).

공개 규칙 정리는 `Lion_Eating_Bank_v14.md` §공개 규칙 참조. 정책은 v14 와 동일한 두 가지다(함수 본문 동일):

| 노브(`SK`, 34행) | 값 | 뜻 |
|---|---|---|
| `on` | true | 끄면 v13 |
| `key` | `'skillX'` | 시전 키(조준 x) |
| `dodge` / `dodgeMargin` / `dodgeMinFrames` | 1 / 10 / 3 | `opp.claw` 예고 중 `|x − centerX| ≤ 62 + 10` 이면 x 를 도피 방향으로(벽이면 반대). 공이 예고 종료 전에 내 코트에 떨어지면 도피하지 않고 친다. 지상 다이빙 금지 |
| `claw` / `castMinLand` / `castMaxLand` | 1 / 18 / 40 | 게이지 ≥ cost · 내 발톱 없음 · 공이 상대 코트에 18~40프레임 뒤 낙하 · 상대가 닿을 수 있음 → 낙하점에 `skillX` |

v14 와의 차이: v14 는 v13_1(어댑터 v2) 위에 같은 정책을 얹었고 소유자(AC)에만 시전한다. v15 는 소유자 구분 없이 적용하지만 썬더 중엔 공이 내 코트라 시전 조건이 안 맞아 실제 동작은 같다(v14 vs v15 자기대전 3-3, 적중 19/18). F12 로그는 `스킬 발동 tick=… skillX=… gauge=…`(Worker 당 5줄)만 찍는다.

## 검증 (2026-09-05, 새 엔진 + 실제 gauge/claw 코드)

- 게이트(`ENGINE_ROOT=새레포`, `--base Lion_Eating_Bank_v13`): 4개 PASS(sk_v2_test 는 어댑터 v2 전용이라 건너뜀) — shadow 불일치 0, rule_check throws 0 invalid 0, >120ms 0. thunder_check(새 엔진): THUNDER_SERVE=1 유지.
- 매치업(3시드 × 좌우 6경기, `tools/skills/claw_real.mjs`):

| 봇 vs 상대 | 승-패 (L / R) | 득-실 | 시전 내/상대 | 적중 내/상대 | 회피 | 예외 |
|---|---|---|---|---|---|---|
| v15 vs skill-example_v1 | 6-0 (3-0 / 3-0) | 60-3 | 14/12 | 12/2 | 35 | 0 |
| v15 vs v13(회피 없음) | 6-0 | 60-16 | 46/0 | 44/0 | 0 | 0 |
| v15 vs v14 | 3-3 | 51-47 | 47/47 | 19/18 | 162 | 0 |

- Chrome 실기(새 레포 빌드, 실제 Worker·스킬 층, v15 vs skill-example_v1 좌우 5점): **5:0 / 0:5**, timeouts 0, invalid 0, >120ms 0. F12: `스킬 발동 tick=258 skillX=86 gauge=60` 등 3회 — 반환 `skillX` 가 실제 엔진에서 시전됨. `tools/dayof/out/chrome_2026-09-05T04-26-16.json`.
- 한계: 시드 3개, 예제 봇이 약해 승패 차이는 안 보인다. 시전 창(18~40)은 첫 값.

## 당일 사용

```
ENGINE_ROOT=<새레포> node --no-warnings tools/dayof/gates.mjs bot/Lion_Eating_Bank_v15.js --base Lion_Eating_Bank_v13
ENGINE_ROOT=<새레포> node --no-warnings tools/eval_skill_real.mjs ./skills/claw_real.mjs Lion_Eating_Bank_v15 skill-example_v1 3
node tools/dayof/harness_dayof.mjs <새레포> --bot Lion_Eating_Bank_v15.js --opp skill-example_v1.js
```
후퇴: `dodge: 0, claw: 0` 또는 `on: false`(= v13) → 사이트의 v12.
