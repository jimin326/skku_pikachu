# Lion_Eating_Bank_v12_1 — v12 + 스킬 어댑터 v2

`Lion_Eating_Bank_v12_1.js` = v12 + 스킬 어댑터 v2. **`SK.on=false`(기본)에서 v12 와 출력 동일**(§3). 랠리·서브 로직은 v12 그대로이므로 설계·근거는 `Lion_Eating_Bank_v12.md` 를 본다.
생성: `node tools/sk_v2_patch.mjs` (v12 → 앵커 7건 치환 → v12_1). 손으로 고치지 말고 생성기를 고친다. 왜 필요한지는 `tools/DAYOF_PLAN_2026-09-05.md` §1·§2 P2.

v12 어댑터의 구멍 4개를 메웠다: ① 썬더 시퀀스에도 스킬을 합성하던 것 ② 발동이 AC 정책 재동기화에 안 잡히던 것 ③ 만충 유지 시 매 hit 틱 재발동 ④ `guard` 가 지상 다이빙 `{x:±1, y:1, hit:1}` 을 점프+파워히트로 바꾸던 것.

## §1 어댑터 노브 `SK` (파일 33~40행, 설명 주석 26~32행)

| 노브 | 기본 | 뜻 | 당일 채우기 |
|---|---|---|---|
| `on` | false | false 면 아무 것도 안 함(v12 와 동일) | 스킬 필드가 확인되면 true |
| `key`, `value` | `'skill'`, `1` | 반환 객체에 붙일 발동 키와 값 | 제공 봇 `return` 문에서 그대로 복사 |
| `gauge`, `ogauge` | `'self.gauge'`, `'opp.gauge'` | 내·상대 게이지 스냅샷 경로. 중간이 null 이면 undefined(만충 아님) | F12 `새 스냅샷 필드` 로그의 경로 |
| `full` | 100 | 만충 판정. 숫자면 ≥full, `true` 면 만충, 객체면 `ready`/`full`/`active` 가 true 또는 `.gauge ≥ full` | 문서의 만충치 |
| `owner` | `'AC'` | 이 소유자 출력에만 fire/guard. TH(썬더)·WAIT·FALLBACK 에는 절대 합성 안 함 | 바꾸지 않음 |
| `fire` | 0 | 내 게이지 만충 + 공중(state 1) + hit 틱에 `key=value` | 효과가 유형 A/B(계획 §3)이고 시뮬에서 이득이면 1 |
| `latch` | 1 | 만충 구간(게이지가 만충 아래로 내려가기 전) 또는 랠리당 1회만 발동 | 소모 엣지가 "접촉"이고 헛발동 뒤 재시도가 필요하면 0 |
| `guard` | 0 | 상대 만충이면 공중 강스매시(y=1)를 아치(y=−1)로. 공중(state 1)에만 | 상대 만충 때 강스매시가 손해라는 관측이 있을 때만 1 |
| `resync` | 0 | 1 이면 발동 틱에 AC 공중 정책을 지워 다음 틱 재계획 | 발동이 공 물리를 바꾸는데 AC 재점수(§2.4, −400 기준)가 못 잡을 때만 1 |

`applySkill(s, a, owner)` 순서: 랠리 바뀜(rfc 감소) → latch 해제 / 내 게이지 만충 아님 → latch 해제 / `owner !== SK.owner` → 그대로 반환 / (규칙상 금지 행동 필터 자리) / guard / fire. 상태는 `SK_ST {latched, rfc, fired, guarded}`, 검사 도구용 `decide.__sk`·`decide.__skState`.

오케스트레이터(§3 (6)): `applySkill(s, pre, owner)` → `sanitize` → `SK.key` 복사(sanitize 가 버리므로) → 발동 로그(DEBUG, Worker 당 ≤5줄: tick·key·gauge·state) → `external = (fired && resync===1) || owner!=='AC' || x/y/hit 변화` → `ACCore.sync`. `M.lastOwner` 에 틱 소유자 기록.

## §2 새 필드 로그 v2 (`logNewFields`)

첫 틱에 요약 1줄 `새 스냅샷 필드: …/없음`(v12 와 같은 문장). 그 뒤 매 틱 스냅샷의 `self/opp/ball/meta/config` 와 최상위에서 KNOWN 목록 밖의 키를 훑어(키 ~25개, µs 단위) 키마다 **첫 등장 / 첫 non-null / 타입 변화** 를 최대 3회, 총 12줄까지 찍는다. 처음 null 이던 `claw` 가 나중에 객체가 될 때, 활성 중에만 나타나는 키가 생길 때 키 이름과 값을 볼 수 있다. 값은 JSON 160자에서 자른다. 합성 검사(claw null→객체→숫자→문자열 왕복, 최상위 키 늦게 등장): 7줄 출력 뒤 침묵, 예산 6 남음.

## §3 검증 (2026-09-05)

| 항목 | 결과 |
|---|---|
| 앵커 | 7건 전부 정확히 1회 일치, 잔여 참조 0. 1,948 → 1,999줄, 106.5KB |
| shadow_diff v12 vs v12_1 (`SK.on=false`), OurBot_v12·NetCamper_v2·AdaptiveCounter_v5_2·v12 미러 × 2시드 × 좌우 | 16경기 **22,134틱 불일치 0**, 예외 0. p50/p99 0.178/0.889 vs 0.175/0.871 ms |
| rule_check (builtin 상대 4경기, 다른 검증 2종과 동시 실행) | 최상위 decide·금지 토큰 0·init 2.1ms·5,167회 avg 4.6 / p99 12.4 / max 44ms·>120ms 0·예외·무효 0, 4-0 (v12 단독 측정은 p99 8.7) |
| `tools/sk_v2_test.mjs` — 가짜 게이지를 스냅샷에 주입해 v12_1 이 경기를 몰고 v12 가 그림자로 비교(OurBot_v12·NetCamper_v2 × 좌우, 44랠리 2,269틱) | 아래 |
| S1 on·fire 0·guard 0 | x/y/hit 전 틱 동일, 발동 0 |
| S2 fire 1, 내 게이지 항상 100(접촉 소모형) | 발동 14회, 전부 소유자 AC·state 1·hit 1, 랠리당 ≤1(latch), x/y/hit 전 틱 동일 |
| S3 fire 1, 발동 시 0 → +5/호출(입력 소모형) | 발동 14회, 간격 최소 64호출, x/y/hit 동일 |
| S4 guard 1, 상대 게이지 항상 100 | 9랠리에서 y=1→−1, 랠리의 첫 불일치 전부 공중(state 1) 패턴, 지상 불일치 0. 하류 포함 21틱 |
| S5 S2 + `resync 1` | 발동 뒤 4/44 랠리에서 하류 출력이 갈라짐(12틱) → **기본 0 의 근거** (fire 는 x/y/hit 을 바꾸지 않고, AC 가 매 틱 정책을 재점수하므로 지울 이유가 없다) |
| S6 fire 1, 게이지 `true` / `{ready:true}` 교대 | skFull 형식 허용, 발동 14회, 출력 동일 |

## §4 당일 채우는 순서

1. 새 레포 실행 → F12 첫 줄 `새 스냅샷 필드:` 와 이어지는 `새 필드 … 첫 등장/첫 non-null` 줄로 경로·타입 확정.
2. 제공 봇 `return` 문에서 `key`·`value`. 문서에서 `full`.
3. `on: true`, `fire: 0` 으로 먼저 실행해 예외·로그 확인 → 계획 §3 유형 판정 → `fire` 결정.
4. 규칙상 금지 행동이 생기면 `applySkill` 의 필터 자리(주석 표시)에 한 줄.
5. 게이트: `node --no-warnings tools/v8/shadow_diff.mjs Lion_Eating_Bank_v12 <후보> …`(SK off 동일), `node --no-warnings tools/sk_v2_test.mjs Lion_Eating_Bank_v12 <후보>`, `node --no-warnings tools/rule_check.mjs bot/<후보>.js`(rule_check 는 파일 경로만 받는다. `gates.mjs` 는 이름만 줘도 된다).
