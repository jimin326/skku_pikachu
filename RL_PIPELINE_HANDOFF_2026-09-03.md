# Robust RL pipeline handoff — 2026-09-03

이 문서는 현재까지 실제로 실행된 피카츄 배구 RL 실험 결과를 다음 설계·구현 agent에게 전달하기 위한 단일 근거 문서다. 실행하지 않은 결과를 예상치로 채우지 않았으며, 사실 수준을 `VERIFIED`, `INFERRED`, `UNKNOWN`으로 구분한다.

## 1. 결론

`VERIFIED`: 현재 생성된 모델은 어느 것도 `Lion_Eating_Bank_v4.js`를 대체할 수 없다.

- 순수 PPO는 전체 경기 승률 47.92%, v4는 동일 평가에서 83.33%였다.
- BC-only는 전체 경기 승률 25.00%, 자멸률 38.84%였다.
- BC+PPO는 전체 경기 승률 31.25%, v4 직접 paired 차이 -50%p, 자멸률 32.97%였다.
- BC+PPO의 JS 추론 속도·크기·행동 유효성은 사전 runtime gate를 통과했지만, efficacy와 robustness gate는 명확히 실패했다.
- 현재 모델을 `src/code-here`에 복사하거나 SOTA로 선언하면 안 된다.
- 동일 설정의 추가 seed나 단순 step 증가 전에 학습 파이프라인 진단과 변경이 필요하다.

## 2. 코드 및 물리 기준

### VERIFIED

- 프로젝트 저장소: `https://github.com/jimin326/skku_pikachu`
- 작업 브랜치: `robust-rl-colab`
- 이 문서 작성 직전 브랜치 HEAD: `88912545e82f7f119ad51bc5ce4d83be7b962718`
- 기준 프로젝트 main 커밋: `4db00207169f04b7943fa3d87b3bcce38acb82f1`
- 공식 게임 저장소: `https://github.com/SKKU-x-HYU-SW-Competition/leonyi-volleyball.git`
- 고정 공식 엔진 커밋: `1f3cecb90aca174ffc42ac6be4c384cc725d9e91`
- 엔진 manifest는 `sha256-lf-v1` 정규화 해시를 사용한다.
- production differential: 2 persistent matches, 13 rallies, 1,416 processed frames와 touch-limit fixture 통과.
- 기준 봇: `Lion_Eating_Bank_v4.js`
- v4 raw SHA-256: `3278f08abda26016cb4e68a9d0970c8428d4dbc4a5d86ced00dfe08f5afa88a5`
- v4 normalized SHA-256: `408bf16e4f986f893a4a5dabc749d7d494657a14811544eddcbe82c9e58bc17f`
- `Lion_Eating_Bank_v4.js`는 생성 산출물이므로 직접 수정하지 않는다.

### 런타임 계약 요약

- 행동: `x ∈ {-1,0,1}`, `y ∈ {-1,0,1}`, `hit ∈ {0,1}`, 총 18개.
- 관찰: 23 features × 4 frames = 92차원.
- RIGHT 관찰·행동은 학습기 내부 canonical 좌표로 변환하고 실제 엔진 적용 시 global 좌표로 되돌린다.
- 공의 yVelocity는 integration 전에 ±40으로 clamp된다. 충돌·중력 직후 snapshot에서는 일시적으로 범위를 넘을 수 있다.
- 제출 런타임은 self-contained synchronous JavaScript이며 PyTorch를 사용할 수 없다.
- 평가 latency model은 1 processed-frame이다. 실제 Chrome Worker scheduling 분포는 `UNKNOWN`이다.

## 3. 공통 validation 조건

### VERIFIED

- 물리: 위 공식 엔진 커밋과 동일.
- 승리 점수: 10.
- 서브: production random serve.
- 양쪽 진영 모두 평가.
- games per seed/side: 1.
- validation seeds: `21001, 21023, 21059, 21089, 21101, 21139, 21157, 21191`.
- non-benchmark opponents: `builtin`, `fixed_chase`.
- benchmark-only opponent: `lion_v4`.
- 각 후보와 v4 기준 arm을 동일 초기 RNG seed로 paired 실행.
- paired CI 단위는 개별 rally가 아니라 opponent×seed block이다.

주의: `builtin`과 `fixed_chase`는 v4에게 매우 쉬운 상대다. 이 validation set만으로 robust generalization 또는 최종 SOTA를 증명할 수 없다.

## 4. v4 재측정 기준선

### VERIFIED

| 지표 | 결과 |
|---|---:|
| 경기 | 40/48 = 83.33% |
| 경기 Wilson 95% 보조 CI | 70.42–91.30% |
| 랠리 | 459/606 = 75.74% |
| 랠리 Wilson 95% 보조 CI | 72.17–78.99% |
| 평균 랠리 길이 | 146.45 processed frames |
| self-destruction | 3/147 losses = 2.04% |
| builtin | 16/16 |
| fixed_chase | 16/16 |
| v4 self-play | 8/16 |

구조화된 기준선: `bot-dev/rl/baselines/v4_1f3cecb.json`.

## 5. 실험 A — 순수 PPO

### 설정

- `VERIFIED`: training seed `20260902`.
- `VERIFIED`: 최종 checkpoint `checkpoint_002002944.pt`.
- `VERIFIED`: global step `2,002,944`.
- `VERIFIED`: checkpoint SHA-256 `b9bc76e3054ff1a9e0aef0aa34b965fdbb7aecacd851d97c787c6208166d12ed`.
- `VERIFIED`: exported JS normalized SHA-256 `0dd69970be89ae05e1bf8733f761bba0c75ca74f6c8d3a76456f44915c0b38bd`.
- `INFERRED`: 사용자가 기본 노트북 설정을 유지했으므로 random initialization PPO로 판단한다. 당시 실제 `RUN_BC` 값은 checkpoint 출력에 포함되지 않아 별도 확인 전까지 완전한 VERIFIED는 아니다.
- PPO 기본값: FF `92-tanh64-tanh64-(policy18,value1)`, point-only reward, 16 envs, rollout 256, learning rate 3e-4, clip 0.2, entropy coefficient 0.01, 4 update epochs.
- train opponent split: `lion_v1`, `lion_v2`, `lion_v3`, `fixed_neutral`.

### 기능 검증

- export parity: 1,024 samples, maximum absolute logit error `2.86102294921875e-06`, action mismatches 0.
- exported bot environment smoke: PASS.

### 평가 결과

| 지표 | 순수 PPO | v4 |
|---|---:|---:|
| 경기 | 23/48 = 47.92% | 40/48 = 83.33% |
| 랠리 | 353/737 = 47.90% | 459/606 = 75.74% |
| 평균 랠리 길이 | 110.18 | 146.45 |
| self-destruction | 71/384 losses = 18.49% | 3/147 = 2.04% |

Paired 결과:

- non-benchmark estimate: `-0.50`, 95% CI `[-0.50, -0.50]`.
- by opponent: builtin `-1.00`, fixed_chase `0.00`.
- v4-direct estimate: `-0.0625`, 95% CI `[-0.25, 0.125]`.
- v4 상대 후보 성적: LEFT 3/8, RIGHT 4/8, 합계 7/16.
- builtin 상대 후보 성적: LEFT 0/8, RIGHT 0/8.
- fixed_chase 상대 후보 성적: LEFT 8/8, RIGHT 8/8.
- 후보 서브 랠리: 230/374 = 61.50%.
- 상대 서브 랠리: 123/363 = 33.88%.

판정: efficacy, robustness, self-destruction gate 실패.

## 6. 실험 B — v4 BC-only

### 설정

- v4 teacher rollout 500,000 decisions.
- 데이터 경로: `/content/drive/MyDrive/pikachu_rl/bc/v4_500k.jsonl`.
- 모델 경로: `/content/drive/MyDrive/pikachu_rl/bc/v4_500k_ff.pt`.
- 동일 FF 92→64→64→18 정책을 cross-entropy로 10 epochs 학습.
- teacher는 train split opponent와 대전하며 LEFT/RIGHT를 교대로 수집.

### 평가 결과

| 지표 | BC-only | v4 |
|---|---:|---:|
| 경기 | 12/48 = 25.00% | 40/48 = 83.33% |
| 랠리 | 293/741 = 39.54% | 459/606 = 75.74% |
| self-destruction | 174/448 losses = 38.84% | 3/147 = 2.04% |

Paired 결과:

- non-benchmark estimate: `-0.875`, 95% CI `[-0.96875, -0.78125]`.
- by opponent: builtin `-0.9375`, fixed_chase `-0.8125`.
- v4-direct estimate: `0.0`, 95% CI `[0.0, 0.0]`.

중요한 해석:

- v4-direct delta 0만 보고 v4와 동급이라고 결론 내리면 안 된다.
- 전체 성능과 self-destruction은 매우 나쁘며, non-benchmark 상대에서 재현 가능한 큰 열화가 있다.
- teacher-induced states에서만 학습한 supervised BC가 learner rollout의 분포 이탈을 견디지 못했을 가능성이 높다.

### UNKNOWN

- epoch별 마지막 BC cross-entropy와 training accuracy가 전달되지 않았다.
- episode-held-out BC accuracy가 측정되지 않았다.
- action class 분포, per-class precision/recall, calibration이 기록되지 않았다.
- BC-only exported JS hash와 runtime 지표가 전달되지 않았다.

## 7. 실험 C — BC 초기화 후 PPO

### 설정

- training seed `20260903`.
- experiment id `bc_ppo_seed20260903`.
- 최종 checkpoint `checkpoint_002002944.pt`.
- checkpoint SHA-256 `f57552606b61a795e994ebea95bc5c7641625dda4b6691d15d6ef5b97b501dff`.
- exported JS SHA-256 `7177f2b95f34e7bb9062fe72592c4636c256d25e2db079cf66315bd3176d5f49`.
- global step `2,002,944`.
- BC 모델로 policy를 초기화한 뒤 기본 PPO hyperparameters와 point-only reward로 fine-tuning.

### 평가 결과

| 지표 | BC+PPO | v4 |
|---|---:|---:|
| 경기 | 15/48 = 31.25% | 40/48 = 83.33% |
| 랠리 | 246/616 = 39.94% | 459/606 = 75.74% |
| 평균 랠리 길이 | 147.33 | 146.45 |
| self-destruction | 122/370 losses = 32.97% | 3/147 = 2.04% |

Paired 결과:

- non-benchmark estimate: `-0.53125`, 95% CI `[-0.625, -0.4375]`.
- by opponent: builtin `-0.9375`, fixed_chase `-0.125`.
- v4-direct estimate: `-0.50`, 95% CI `[-0.50, -0.50]`.

Runtime:

| 지표 | 결과 |
|---|---:|
| p50 | 39.237 µs |
| p95 | 77.928 µs |
| p99 | 92.876 µs |
| max | 2.114 ms |
| load | 7.592 ms |
| raw JS | 235,450 bytes |
| gzip | 106,403 bytes |
| measured heap delta | 1,306,320 bytes |
| invalid actions | 0 |

평가 산출물 경로: `/content/drive/MyDrive/pikachu_rl/evaluations/bc_ppo_seed20260903_step2002944`.

판정: runtime gate는 통과했지만 efficacy, robustness, self-destruction gate는 실패.

## 8. 실험 간 비교와 현재 진단

| 지표 | 순수 PPO | BC-only | BC+PPO | v4 |
|---|---:|---:|---:|---:|
| 전체 경기 승률 | 47.92% | 25.00% | 31.25% | 83.33% |
| 전체 랠리 승률 | 47.90% | 39.54% | 39.94% | 75.74% |
| v4-direct paired delta | -6.25%p | 0%p | -50%p | 기준 |
| non-benchmark paired delta | -50.00%p | -87.50%p | -53.13%p | 기준 |
| self-destruction | 18.49% | 38.84% | 32.97% | 2.04% |

### VERIFIED observations

1. BC-only는 v4-direct paired outcome은 유지했지만 builtin/fixed_chase 및 자멸에서 크게 실패했다.
2. PPO fine-tuning은 BC-only 대비 non-benchmark 성능을 일부 회복했지만 v4-direct delta를 0에서 -50%p로 악화시켰다.
3. 평균 랠리 길이만 v4와 유사해져도 승률이나 안전성이 개선되는 것은 아니다.
4. 네트워크 크기와 JS inference 속도는 현재 병목이 아니다.
5. 동일 설정을 다른 seed로 반복하기 전에 학습 데이터·목표·모델 선택 절차를 바꿔야 한다.

### INFERRED hypotheses — 반드시 ablation으로 확인

1. **BC covariate shift/compounding error:** teacher가 만든 상태만 학습해 learner가 한 번 이탈한 뒤의 복구 상태를 보지 못했다.
2. **Teacher hidden-state aliasing:** v4는 장기 내부 상태를 가지므로 4-frame FF observation만으로 teacher action이 완전히 결정되지 않을 수 있다.
3. **PPO catastrophic forgetting:** point-only reward, learning rate 3e-4, entropy 0.01의 fine-tuning이 BC policy를 빠르게 이탈시켰을 수 있다.
4. **Opponent/objective mismatch:** train pool에서 얻는 개선이 v4와 builtin으로 전이되지 않았다.
5. **Latest-checkpoint bias:** training 중 held-out validation 없이 마지막 2M checkpoint만 선택해 더 좋은 중간 checkpoint를 놓쳤을 수 있다.

### UNKNOWN — 다음 설계가 먼저 측정해야 할 항목

- BC dataset action histogram과 episode별 분포.
- episode/family-held-out imitation accuracy 및 per-action confusion matrix.
- BC policy와 v4 teacher 사이 rollout-state action disagreement.
- learner-visited states에서 teacher correction을 사용했을 때의 개선량.
- 100k/200k/.../2M PPO checkpoint별 validation trajectory.
- PPO 진행 중 BC policy와의 KL divergence.
- learning rate, entropy, clip, BC/KL anchor coefficient ablation.
- FF history 길이와 recurrent policy의 비용 대비 효과.
- 독립적인 강력 opponent family가 추가된 sealed final 성능.
- 여러 독립 training seed 간 분산.

## 9. 다음 agent가 설계해야 할 최소 실험 순서

아래 항목은 정답으로 미리 고정하지 말고, 가장 작은 falsifiable experiment부터 진행한다.

1. **BC 진단 강화**
   - episode 단위 train/validation split.
   - action histogram, majority baseline, overall/per-action accuracy, confusion matrix.
   - teacher internal state가 label ambiguity를 만드는지 같은 observation neighborhood의 action entropy로 점검.
2. **중간 checkpoint sweep**
   - 저장된 BC+PPO checkpoint 중 0/100k/200k/500k/1M/2M 부근을 동일 validation set에서 평가.
   - 성능 붕괴가 시작된 step과 KL/action disagreement 추적.
3. **분포 이탈 대응 후보 비교**
   - DAgger 또는 learner-visited-state corrective labeling.
   - 더 긴 history 또는 recurrent policy.
   - action imbalance 보정은 전체 accuracy가 아닌 rollout 결과와 함께 평가.
4. **BC 보존형 RL 후보 비교**
   - 낮은 learning rate.
   - 낮은 entropy coefficient.
   - frozen BC teacher에 대한 KL 또는 auxiliary imitation loss.
   - 초기에는 BC anchor를 강하게 두고 validation 개선이 확인될 때만 완화.
5. **모델 선택**
   - latest checkpoint를 자동 선택하지 않는다.
   - 일정 step마다 validation하고 사전 정의된 primary/robustness/self-destruction/runtime gate로 best를 선택한다.
   - validation 악화 시 best checkpoint로 복귀한다.
6. **seed 및 sealed final**
   - 유망 구성을 고른 뒤에만 최소 3개 독립 seed 실행.
   - 모델 선택 완료 전 sealed final opponent/seed를 열지 않는다.

## 10. 변경 불가 원칙

- production physics와 engine manifest 검증을 우회하지 않는다.
- 오래된 시뮬레이터 결과를 현재 성능 근거로 사용하지 않는다.
- `Lion_Eating_Bank_v4.js`를 수정하지 않는다.
- 기존 사용자 파일과 main 변경을 보존한다.
- validation/test opponent family와 seed 누출을 금지한다.
- 최종 평가는 동일 물리, paired seed, 양쪽 진영으로 한 번만 실행한다.
- CI가 불명확하거나 주요 상대·좌우·자멸·runtime이 악화되면 SOTA로 교체하지 않는다.
- 학습기 전체를 제출 JS에 넣지 않는다.

## 11. Agent에게 보낼 프롬프트

아래 프롬프트와 이 Markdown 파일을 함께 전달한다.

```text
당신은 피카츄 배구 프로젝트의 다음 RL 학습 파이프라인을 설계·구현·검증할 리드 ML/RL 엔지니어다.

첨부된 `RL_PIPELINE_HANDOFF_2026-09-03.md`를 현재까지 실제 실행된 실험의 근거 문서로 사용하라. 저장소는 https://github.com/jimin326/skku_pikachu 이고 작업 기준 브랜치는 `robust-rl-colab`이다. 공식 게임 엔진은 https://github.com/SKKU-x-HYU-SW-Competition/leonyi-volleyball 의 커밋 `1f3cecb90aca174ffc42ac6be4c384cc725d9e91`이다.

핵심 현상은 다음과 같다.
- 순수 PPO는 전체 47.92%로 v4의 83.33%보다 낮다.
- BC-only는 v4-direct paired delta 0이지만 전체 25.00%, 자멸률 38.84%다.
- BC+PPO는 전체 31.25%, v4-direct delta -50%p, 자멸률 32.97%다.
- BC+PPO runtime은 통과했으나 efficacy와 robustness는 실패했다.

이 수치를 다시 추측하거나 예상치로 대체하지 말라. 문서와 저장소에서 확인한 사실은 VERIFIED, 데이터로부터의 해석은 INFERRED, 아직 측정하지 않은 것은 UNKNOWN으로 구분하라.

목표:
1. BC-only의 분포 이탈과 teacher hidden-state aliasing을 구분할 진단을 구현한다.
2. PPO 중간 checkpoint sweep으로 catastrophic forgetting이 시작된 시점을 측정한다.
3. DAgger/learner-state correction, 더 긴 history 또는 recurrent policy, BC/KL 보존형 PPO 후보를 비용과 효과 기준으로 비교한다.
4. Colab 단일 T4에서 현실적인 다음 최소 파이프라인을 설계한다.
5. latest checkpoint가 아닌 held-out validation 기반 모델 선택과 rollback을 구현한다.
6. 후보가 validation gate를 통과하기 전 추가 seed나 sealed final을 실행하지 않는다.

작업 방식:
- 먼저 저장소의 현재 구현과 첨부 문서의 해시·설정·결과를 감사하라.
- 알고리즘을 미리 정답으로 가정하지 말고 가장 작은 진단과 ablation부터 실행 가능하게 만들어라.
- production physics와 differential test를 유지하라.
- `Lion_Eating_Bank_v4.js`는 수정하지 마라.
- train/validation/test family와 seed 분리를 유지하라.
- 기존 체크포인트와 사용자 변경을 덮어쓰지 마라.
- 큰 변경을 한 번에 만들지 말고 단계별 테스트를 추가하라.
- 실행하지 않은 학습 결과를 작성하지 마라.

우선 산출물:
- BC episode-heldout 진단: action histogram, majority baseline, overall/per-action accuracy, confusion matrix.
- learner rollout에서 v4 teacher action disagreement 및 자멸 원인 분석.
- 기존 BC+PPO checkpoint sweep 도구와 구조화된 결과 파일.
- 최소 2개 이상의 forgetting 방지 구성에 대한 사전 등록 ablation 계획.
- 선택한 다음 학습 구성과 선택하지 않은 구성의 근거.
- Colab에서 Drive checkpoint를 안전하게 재개하고 validation 결과를 보존하는 수정 노트북.
- 테스트 결과와 남은 UNKNOWN/BLOCKED 목록.

성공 기준:
- 단순 supervised accuracy가 아니라 paired validation match/rally 성능과 self-destruction으로 판단한다.
- v4 직접 비교의 95% block-cluster CI 하한이 0보다 커야 한다.
- 주요 독립 opponent family와 양쪽 진영에서 candidate-v4 CI 하한이 -0.05 이상이어야 한다.
- runtime gate와 invalid action 0을 유지해야 한다.
- 기준을 통과하지 못하면 `src/code-here`에 제출 모델을 만들지 말고 실험 결과만 보고한다.

보고 형식:
1. 결과
2. 핵심 근거
3. 생성·변경 파일
4. 실행한 검증과 실제 결과
5. UNKNOWN/BLOCKED 및 다음 작업
```

## 12. Agent에게 함께 전달할 파일

필수 첨부:

1. 이 파일: `RL_PIPELINE_HANDOFF_2026-09-03.md`

agent가 로컬 저장소 또는 GitHub private branch에 접근하지 못한다면 추가 첨부:

2. `/content/drive/MyDrive/pikachu_rl/evaluations/bc_ppo_seed20260903_step2002944/validation_stats.json`
3. `/content/drive/MyDrive/pikachu_rl/evaluations/bc_ppo_seed20260903_step2002944/validation.jsonl`
4. `/content/drive/MyDrive/pikachu_rl/evaluations/bc_ppo_seed20260903_step2002944/runtime.json`
5. `/content/drive/MyDrive/pikachu_rl/evaluations/bc_only_v4_500k/validation_stats.json`
6. `/content/drive/MyDrive/pikachu_rl/evaluations/bc_only_v4_500k/validation.jsonl`

체크포인트 `.pt`, 500k JSONL dataset, exported JS는 agent가 분석 또는 재현에 실제로 필요하다고 확인한 경우에만 추가한다. 토큰, Colab Secret, GitHub credential은 절대 첨부하지 않는다.
