# 피카츄 배구 RL 감사 보고서

## 1. 결과

- 프로젝트 기준: `jimin326/skku_pikachu` main `4db00207169f04b7943fa3d87b3bcce38acb82f1`.
- production 기준: `SKKU-x-HYU-SW-Competition/leonyi-volleyball` main `1f3cecb90aca174ffc42ac6be4c384cc725d9e91`.
- 기존 `Lion_Eating_Bank_v4.js`는 변경하지 않았다. raw SHA-256은 `3278f08a...afa88a5`, newline-normalized SHA-256은 `408bf16e...8bc17f`다.
- production 물리와 state-method headless differential gate를 추가했다.
- v4 단일 상대용 기존 하니스를 v4 기본값, point-only reward, 좌우 행동 대칭, opponent/league pool, BC 초기화, recovery checkpoint, paired evaluation으로 일반화했다.
- 장기 T4 학습, 3-seed ablation, sealed final, 최종 제출 봇 승격은 실행하지 않았다.

## 2. 핵심 근거

### 게임 및 런타임 계약

| 항목 | 확인 내용 | 상태 |
|---|---|---|
| 좌표 | x는 오른쪽+, y는 아래쪽+, width 432, net x=216 | VERIFIED |
| 공 물리 순서 | 이전 위치 저장 → yVelocity ±40 clamp → world collision/integration → gravity | VERIFIED |
| 관찰 가능한 속도 | collision/gravity 뒤 snapshot에서는 일시적으로 `abs(yVelocity)>40` 가능 | VERIFIED |
| 틱 | normal 25 FPS, bot snapshot은 `tickFrameGroupSize=3`마다 전송 | VERIFIED |
| 행동 | x/y 각각 -1,0,1, hit 0,1의 18개 | VERIFIED |
| 좌우 snapshot | self/opp와 score 관점만 교환; global ball 좌표는 mirror되지 않음 | VERIFIED |
| 입력 | Worker response는 최소 다음 processed frame에 적용; pending request는 새 dispatch를 막음 | VERIFIED |
| timeout | 360 ms, 15회 연속 timeout 시 Worker 재시작 | VERIFIED |
| 경기 | 기본 10점, deuce 없음, 기본 serve random, touch limit 5 | VERIFIED |
| 런타임 | JS source를 Worker의 `new Function`으로 로드; self-contained sync `decide` 필요 | VERIFIED |
| 실제 지연 분포 | Chrome/기기별 scheduling trace 없음 | UNKNOWN |

### v4 계약

| 구분 | 내용 | 근거 상태 |
|---|---|---|
| 입력 | `tick, side, self, opp, ball, meta, config`와 공식 snapshot 하위 필드 | VERIFIED |
| 출력 | `{x,y,hit}`, x/y ∈ {-1,0,1}, hit ∈ {0,1}; 오류 시 neutral | VERIFIED |
| 내부 상태 | Thunder serve state, adaptive controller 통계, 이전 state/action 및 latency history | VERIFIED |
| 좌우 처리 | 내부 canonical LEFT mirror | VERIFIED |
| 크기 | 50,522 bytes | VERIFIED |
| 문서상 성능 | AC 80.5%, Saja 100%, v11 93.2%, RedTeam 62.5%, builtin 96.9%, Jayce 20-0 | DOCUMENTED ONLY |
| 알려진 약점 | net-camper 계열 | DOCUMENTED ONLY |

v4 내부 `stepBall`은 정책 예측기이며 production 물리 kernel이 아니다.

## 3. 생성·변경 파일

- fidelity: `engine_manifest.json`, `setup_rl_engine.ps1/.mjs`, `production_differential.mjs`, `sim_real.mjs`
- 환경/학습: `config.mjs`, `redteam_env.mjs`, `opponent_pool.py`, `collect_bc.mjs`, `bc_pretrain.py`, `ppo_train.py`, `league.py`
- 평가: `eval/opponents.json`, split manifests, `schema.py`, `paired_eval.mjs`, `stats.py`, `runtime_bench.mjs`와 smoke tests
- export: `export_policy.py`, `export_env_smoke.mjs`
- Colab/문서: `notebooks/Pikachu_Robust_RL_Colab.ipynb`, `ROBUST_RL.md`, `ACCEPTANCE.md`

## 4. 실행한 검증과 실제 결과

- production engine setup: exact commit 및 13개 source hash 검증 PASS.
- production-method differential: 동일 Apply의 persistent 2경기, 13 rallies, 1,416 processed frames + touch-limit match-point fixture PASS.
- physics clamp smoke PASS.
- environment determinism/direct parity PASS.
- Node/Python bridge PASS.
- PPO unit test PASS.
- 8-step CPU train 및 8→16-step fresh-episode resume PASS.
- point-only 설정의 명시적 match-point terminal signal 1회 발생 회귀 test PASS.
- 32-decision v4 BC 수집, 1-epoch BC, BC checkpoint→4-step PPO 초기화 PASS. 이는 기능 smoke이며 성능 학습 결과가 아니다.
- historical exported checkpoint league 등록 및 5-worker pool load smoke PASS.
- Python/JS export parity 128 samples: max absolute logit error `6.52e-9`, action mismatch 0.
- exported stateful encoder 양 진영·persistent 2경기 parity 및 malformed snapshot neutral fallback PASS.
- canonical RIGHT `+x` → global `-x`, applied-action feature 및 export 역변환 parity PASS.
- versioned recovery checkpoint와 `latest.json` SHA 검증 PASS.
- paired identical-arm smoke: fixed neutral/chase, builtin, v4, 양 진영 모두 exact match PASS.
- 현재 물리 v4 가용 상대 기준선, 8 validation seeds × 양 진영:
  - overall matches 40/48 = 83.33%, auxiliary Wilson 95% CI 70.42–91.30%.
  - rallies 459/606 = 75.74%, auxiliary Wilson 95% CI 72.17–78.99%.
  - builtin 16/16, fixed chase 16/16.
  - v4 self-play LEFT 3/8, RIGHT 5/8, 합계 8/16 = 50%.
  - mean rally length 146.45 processed frames.
  - candidate arm에도 v4를 넣은 paired delta는 non-benchmark 16 blocks와 v4 benchmark 8 blocks에서 각각 0, bootstrap CI [0,0].
- v4 Node compute-only runtime, 5,000 production snapshots:
  - 반복 arm p50 0.4 µs, p95 60.4–62.5 µs, p99 101–154 µs, max 0.672–1.129 ms.
  - raw 50,522 bytes, gzip 15,778 bytes, invalid action 0.
- official webpack build에서 v4와 smoke exported neural bot 모두 registry/bundle 포함 PASS. test copy 두 개는 이후 official checkout에서 제거해 clean 상태로 복구했다. 브라우저 UI interaction은 browser runtime 부재로 미실행.

## 5. UNKNOWN/BLOCKED 및 다음 작업

- `UNKNOWN`: 실제 Chrome Worker response/apply latency 분포, jitter, timeout/restart 빈도.
- `BLOCKED`: AC/Saja/v11/RedTeam/Jayce 등 독립 강한 상대 source가 현재 두 저장소에 없다. builtin/fixed는 v4 ceiling이라 robust 일반화 승격을 판정하기 부족하다.
- `NOT TRAINED`: T4 장기 run, 여러 training seed, pure RL/BC/self-play ablation.
- `NOT IMPLEMENTED`: recurrent PPO/GRU JS export, rally-level hybrid. FF history baseline 결과가 나온 뒤 추가한다.
- `NOT IMPLEMENTED`: 새 paired validation CI를 이용한 자동 best-checkpoint 선택/rollback. 기존 `stage5_runner.py`는 legacy selection이므로 SOTA 선택에 사용하지 않는다.
- `NOT VALIDATED`: sealed final set. 외부 평가자가 family-disjoint opponent와 seed manifest를 보관해야 한다.
- 따라서 새 봇을 `src/code-here/`에 승격하지 않았다. smoke checkpoint를 제출 파일로 위장하지 않는다.

다음 순서는 Colab에서 FF pure RL과 BC→PPO를 각각 3 seeds 실행하고, historical exports를 다음 self-play run의 league에 넣은 뒤 validation으로 하나의 SHA를 동결하는 것이다. 독립 opponent family가 확보된 후에만 sealed final을 한 번 실행하고 승격 기준을 적용한다.

최종 분리 검토는 처음 `fix-first`로 좌우 action, terminal, cause, fallback 결함을 찾았고 수정 후 구현된 범위에 `ship` 판정을 내렸다. 이 판정은 위의 미학습·미구현·BLOCKED 항목을 완료로 바꾸지 않는다.
