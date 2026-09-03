# RL 파이프라인 진단 결과 — 2026-09-03

이 문서는 `RL_PIPELINE_HANDOFF_2026-09-03.md`의 UNKNOWN 항목 중 **이 세션에서 실제로
실행해 측정한 것**만 담는다. 실행하지 않은 값은 UNKNOWN으로 남겼다.

사실 수준: `VERIFIED` = 실행·확인, `INFERRED` = 데이터 해석, `UNKNOWN` = 미측정.

## 0. 감사 결과 (저장소 ↔ handoff 대조)

`VERIFIED`:

- 브랜치 `robust-rl-colab` HEAD = `a4eb3ef` (`docs: add RL pipeline experiment handoff`).
  handoff가 기록한 직전 HEAD `8891254`는 그 부모다. 일치.
- 공식 엔진 체크아웃 `.external/leonyi-volleyball` HEAD =
  `1f3cecb90aca174ffc42ac6be4c384cc725d9e91`. 일치.
- `Lion_Eating_Bank_v4.js` raw SHA-256 =
  `3278f08abda26016cb4e68a9d0970c8428d4dbc4a5d86ced00dfe08f5afa88a5`. 일치.
  normalized 해시 `408bf16e…8bc17f`는 `config.mjs`의 `FROZEN_VICTIM`,
  `eval/opponents.json`, `collect_bc.mjs`, `bc_pretrain.py`에서 동일하게 강제된다.
- validation split = `builtin`, `fixed_chase` + benchmark-only `lion_v4`,
  seeds `21001,21023,21059,21089,21101,21139,21157,21191`, 양 진영, seed/side당 1경기.
  train split과 opponent·seed 교집합 0 (`pipeline_tests.test_split_leakage_guard`).
- v4 재측정 기준선 `runs/baseline_v4/`는 candidate arm과 v4 arm이 **동일 해시**
  (`408bf16e…`)로 실행된 self-paired 실행이다. 경기 40/48, 랠리 459/606,
  자멸 3/147 = 2.04%. handoff §4와 일치.

`VERIFIED` — 기준선 데이터에서 새로 확인한 구조적 사실: `lion_v4` 상대 블록에서
candidate와 v4는 좌우 전부 **점수·랠리 수·프레임 수까지 바이트 단위로 동일**하고,
LEFT 8경기 중 3승 / RIGHT 8경기 중 5승으로 정확히 8/16이다. v4-direct paired delta는
정의상 0이 되며 **자기 자신과의 미러 경기**다.

`INFERRED`: 따라서 v4-direct delta는 후보가 v4와 **다르게 행동할 때만** 0이 아닌
값을 가진다. BC 계열 후보에서 delta가 0으로 나오는 것은 성능 동등이 아니라
**행동 동일**의 신호일 수 있다. §2에서 이를 직접 측정했다.

`UNKNOWN`: handoff §5–§7의 checkpoint(`b9bc76e3…`, `f57552…`), exported JS
(`0dd699…`, `7177f2…`), 500k BC 데이터셋, Drive의 evaluation 산출물은 이 세션에서
접근할 수 없었다. Colab Drive에만 있다. 해당 해시는 재확인하지 못했다.

## 1. 새로 만든 도구

| 파일 | 역할 |
|---|---|
| `bot-dev/rl/bc_diagnostics.py` | episode-held-out BC 진단: action histogram, majority baseline, per-action precision/recall, confusion matrix, **관찰 양자화 버킷 기반 label aliasing 측정** |
| `bot-dev/rl/config_actions.py` | `config.mjs` 행동표의 Python 미러 (테스트로 동기화 강제) |
| `bot-dev/rl/eval/teacher_shadow.mjs` | learner rollout의 모든 상태에서 v4 teacher를 조회 → 불일치·자멸 원인 분석, `--beta`로 DAgger 데이터 수집 |
| `bot-dev/rl/eval/gates.py` | 사전 등록 gate + opponent×side별 block-cluster CI + 선택 순서 |
| `bot-dev/rl/checkpoint_sweep.py` | 저장된 모든 checkpoint를 동일 validation으로 평가, anchor 대비 KL·argmax drift, forgetting 시작 step 탐지, 재개 가능 |
| `bot-dev/rl/train_with_validation.py` | phase별 학습 → validation → best 선택 → rollback, Drive 복구 |
| `bot-dev/rl/ppo_tests.py`(기존), `anchor_tests.py`, `pipeline_tests.py` | 테스트 |

`ppo_train.py`에는 **기본값이 모두 off인** 옵션만 추가했다:
`--anchor-model`, `--anchor-kl-coef`, `--anchor-kl-decay-updates`, `--anchor-kl-floor`,
`--policy-freeze-updates`, `--reseed-on-resume`. 옵션을 주지 않으면 학습 경로는
이전과 동일하다.

## 2. BC 진단 — aliasing이 아니라 분포 이탈

`Lion_Eating_Bank_v4.js`는 수정하지 않았다. 기존 checkpoint도 건드리지 않았다.
Drive의 500k 데이터셋에 접근할 수 없어 **동일 파이프라인으로 200k를 새로 수집**해
축소 재현했다 (`collect_bc.mjs --decisions=200000`, 248 episodes, train split).

### 2-1. Supervised 지표 (`VERIFIED`)

episode 단위 80/20 분할 (train 158,976 / held-out 41,024 결정, held-out 50 episodes).

| 지표 | 값 |
|---|---:|
| majority baseline (held-out) | 43.59% (`x+0_y+0_h0`) |
| train-episode만 학습한 정책의 held-out accuracy (10 epochs) | **91.25%** |
| 전체 데이터로 학습한 정책의 held-out accuracy (누출 있음, 참고용) | 94.43% |
| 행동 분포 | neutral 44.0%, `x+1` 24.4%, `x-1` 13.6%, hit=1 전체 8.2% |

per-action recall (held-out, support > 0): neutral 0.945, `x+1_y+0_h0` 0.905,
`x-1_y+0_h0` 0.882, `x+1_y+1_h1`(점프 스매시) 0.928, `x+0_y+1_h1` 0.971.
support가 100 미만인 희소 행동은 무너진다: `x-1_y-1_h1` 0.234 (support 94),
`x-1_y+1_h1` 0.0 (22), `x+0_y+0_h1` 0.0 (31), `x+1_y+1_h0` 0.0 (39).
최다 혼동은 `x+1_y+0_h0` ↔ `x+0_y+0_h0` (774 / 758건) — 이동 시작·정지 시점의
1틱 차이다.

### 2-2. Teacher hidden-state aliasing (`VERIFIED`)

같은 관찰 버킷 안에서 teacher가 다른 행동을 내는 비율을 직접 셌다.

| 관찰 view | 양자화 | 중복 표본 비율 | **label 충돌 표본 비율** | H(action‖obs) | accuracy ceiling |
|---|---|---:|---:|---:|---:|
| 최근 1 frame | 소수 2자리 | 90.9% | 0.0065% | 5.3e-5 bit | 99.998% |
| 4 frame 전체 | 소수 2자리 | 90.3% | 0.0065% | 5.3e-5 bit | 99.998% |
| 최근 1 frame | 소수 0자리 | 99.4% | 16.1% | 0.115 bit | 96.00% |
| 4 frame 전체 | 소수 0자리 | 98.4% | 4.6% | 0.027 bit | 99.26% |

**이 표는 teacher가 방문한 상태 분포에서만 잰 값이다.** learner가 이탈한 뒤
방문하는 상태에서도 같은지는 별도 측정이 필요하므로, DAgger로 수집한
learner-visited 상태(§3)에서 동일 지표를 다시 쟀다.

| 상태 분포 | 표본 | 충돌 (4f, 소수 2자리) | ceiling | 충돌 (4f, 소수 0자리) | ceiling |
|---|---:|---:|---:|---:|---:|
| teacher-visited (BC 200k) | 200,000 | **0.006%** | 99.998% | 4.57% | 99.26% |
| learner-visited (DAgger r1) | 100,000 | **0.261%** | 99.898% | 8.54% | 97.99% |
| learner-visited (DAgger r2) | 100,000 | **0.224%** | 99.931% | 8.87% | 97.85% |

`VERIFIED`: learner 상태에서 label 충돌은 teacher 상태 대비 **약 40배** 높다
(0.006% → 0.22~0.28%). 거친 양자화에서도 4.6% → 8.5~8.9%로 약 2배다.

`INFERRED`: 두 가지를 구분해서 말해야 한다.

1. **aliasing은 teacher 분포에서 사실상 없고, learner 분포에서 유의하게 커진다.**
   따라서 "장기 메모리가 어디서도 필요 없다"고 말할 수 없다. 이 지표는 관찰
   버킷 안의 label 일관성만 재며, 정책이 실제로 활용할 수 있는 장기 의존성의
   부재를 증명하지 않는다.
2. 그럼에도 실제 정밀도에서 accuracy ceiling은 learner 상태에서도 99.9%이고,
   4 frame이 1 frame보다 일관되게 낫다. **지금 recurrent 정책을 구현할 근거로는
   부족하다** — 남은 0.1%가 승률 25%를 만들 수는 없다. 이것이 D1 arm을 보류한
   이유이며, "메모리는 불필요하다"는 결론이 아니다.

`INFERRED`: 91% held-out accuracy로는 경기 승률 25%를 설명할 수 없다. 나머지
설명은 rollout에 있다.

### 2-3. Learner rollout에서의 teacher 불일치 (`VERIFIED`)

`eval/teacher_shadow.mjs`, validation split 48 episodes, 39,815 결정, invalid action 0.

| 지표 | BC-200k |
|---|---:|
| 전체 행동 불일치 | 27.2% |
| 성분별 불일치 | x 24.5% / y 7.6% / hit 2.5% |
| 랠리 내 결정 인덱스 0–4 | **9.3%** |
| 5–9 | 5.6% |
| 10–19 | 14.2% |
| 20+ | **38.2%** |
| 승리 랠리 마지막 5수 | 19.4% |
| 패배 랠리 마지막 5수 | **66.9%** |
| 자멸 랠리 마지막 5수 | **99.4%** (첫 불일치 평균 인덱스 6.7) |
| 자멸 (패배 중) | 37.0% |

원인별 랠리 평균 불일치: `self_last_touch_then_own_ground` 0.503 (159 랠리),
`untouched_self_serve_ground_on_own_half` 0.943 (5), `opponent_last_touch_score` 0.188,
승리 랠리 0.181.

`INFERRED`: 서브 직후(teacher가 실제로 방문하는 상태)에서는 9% 수준으로 일치하고,
랠리가 길어질수록 불일치가 4배로 커지며, 자멸하는 랠리는 마지막 5수가 거의 100%
teacher와 다르다. **compounding covariate shift의 교과서적 서명**이다.

### 2-4. v4-direct delta 0의 정체 (`VERIFIED`)

같은 실행의 상대별 분해:

| 상대 | 랠리 승률 | teacher 불일치 | 자멸 |
|---|---:|---:|---:|
| `builtin` | 32.6% | 42.0% | 92 |
| `fixed_chase` | 39.0% | 39.6% | 72 |
| `lion_v4` | **50.0%** (139/278) | **0.0000** | **0** |

독립 재현: seed 21001 LEFT에서 400 결정 동안 BC 정책과 v4의 행동 인덱스가
400/400 일치. 같은 조건에서 `builtin` 상대로는 208/400 불일치.

`INFERRED`: BC 정책은 v4를 상대할 때 v4와 **행동이 완전히 동일**해지고, 그래서
경기가 미러가 되어 정확히 절반을 이긴다. handoff의 "BC-only v4-direct paired
delta = 0"은 성능 동등이 아니라 이 자기일치의 산물이다. 한 번 일치하면 궤적이
teacher 자신의 상태 분포를 벗어나지 않아 계속 일치하는 안정한 고정점이다.
**v4-direct gate는 BC 계열 후보에 대해 분해능이 0이며, 통과하려면 후보가 v4와
다르게 행동하면서 이겨야 한다.**

## 3. DAgger 축소 실험 (`VERIFIED`)

`teacher_shadow.mjs --beta=0`으로 learner가 방문한 상태에 teacher 라벨을 붙여
train split에서만 수집하고(validation 상대·seed 미사용), 기존 데이터와 합쳐 재학습했다.
라운드당 100k 결정, 10 epochs, CPU.

| arm | 데이터 | 경기 | 랠리 | non-benchmark delta (95% CI) | builtin / fixed_chase | v4-direct | 자멸 | 불일치 |
|---|---:|---:|---:|---|---|---:|---:|---:|
| BC | 200k | 25.00% | 41.17% | -0.875 [-0.969, -0.750] | -0.875 / -0.875 | 0.0 | 37.0% | 27.2% |
| +DAgger r1 | 300k | 41.67% | 46.97% | -0.625 [-0.781, -0.469] | -0.813 / -0.438 | 0.0 | 45.0% | 30.1% |
| +DAgger r2 | 400k | **64.58%** | **56.12%** | **-0.281 [-0.406, -0.156]** | -0.563 / **0.000** | 0.0 | 32.6% | 22.4% |
| v4 (기준) | — | 83.33% | 75.74% | 0 | — | — | 2.04% | 0 |

모든 arm에서 export parity action mismatch 0, invalid action 0.
DAgger r2 runtime: max 0.506 ms.

랠리 후반 불일치도 함께 내려갔다 (20+ 결정 구간: 38.2% → 42.2% → 33.7%,
패배 랠리 마지막 5수: 66.9% → 50.8% → 42.9%).

`INFERRED`:

1. 축소 규모에서도 DAgger는 non-benchmark paired delta를 -0.875 → -0.281로
   0.594 개선했고, `fixed_chase`에서는 v4와 동률(0.000)에 도달했다.
   **비용은 라운드당 약 1분 수집 + 20초 재학습이었다.** 순수 PPO 2M step이
   -0.50에 머문 것과 비교하면 비용 대비 효과가 압도적이다.
2. 그럼에도 **자멸률은 32.6%로 v4의 2.04%와 여전히 15배 차이**다. 단조 감소하지도
   않았다(37.0 → 45.0 → 32.6). 분포 이탈만 고쳐서는 자멸이 해결되지 않는다.
3. v4-direct delta는 세 arm 모두 정확히 0이다. §2-4의 미러 고정점이 유지된다.

`UNKNOWN`: 500k 원본 데이터셋과 T4에서 같은 절차를 돌렸을 때의 값. 라운드 3 이상의
수익 체감. DAgger 이후 PPO를 얹었을 때의 상호작용.

## 4. 아직 측정하지 못한 것

- `UNKNOWN`: BC+PPO 중간 checkpoint 궤적. `checkpoint_sweep.py`는 완성했고
  마이크로 실행으로 검증했지만, 실제 checkpoint가 Drive에만 있어 돌리지 못했다.
  Colab에서 노트북 셀 하나로 실행된다.
- `UNKNOWN`: PPO 진행 중 BC 정책과의 KL. `--anchor-model`을 주면 매 update마다
  `train.jsonl`에 `anchorKl`로 기록되지만, 그 학습은 아직 실행하지 않았다.
- `UNKNOWN`: recurrent 또는 frameStack 8의 효과. 미구현.
- `UNKNOWN`: 독립 seed 간 분산, sealed final 성능. gate 통과 전이라 실행 금지.

## 5. 결론

`INFERRED`: 다음 학습은 **DAgger로 분포 이탈을 먼저 줄이고, 그 위에 KL anchor를
건 PPO를 얹되, latest가 아니라 validation 기반으로 checkpoint를 고르는** 구성이
가장 근거가 강하다. 근거와 기각한 대안은 `ABLATION_PLAN.md`에 있다.

`VERIFIED`: 이 세션에서 만든 어떤 모델도 gate를 통과하지 못했다
(최고치 DAgger r2: non-benchmark CI 하한 -0.406, 자멸 32.6%).
따라서 `src/code-here`에 제출 모델을 만들지 않았다.

### 이 근거가 지지하지 않는 것

`INFERRED`: DAgger는 본질적으로 **v4를 더 잘 복제하는 방법**이다. v4 수준에
가까운 안정적 초기화에는 유효하지만, 그 자체로 v4를 넘는 구조가 아니다.
강한 KL anchor도 망각을 막는 대신 teacher 성능에 정책을 묶을 수 있다.
따라서 §3의 단조 개선을 "라운드를 더 늘리면 v4를 넘는다"는 근거로 쓰면 안 된다.

`VERIFIED`: 자멸률은 37.0% → 45.0% → 32.6%로 **단조 감소하지 않았고**, 세
arm 모두 selectable 기준(25%)조차 통과하지 못했다. 분포 이탈 교정만으로 자멸이
해결된다는 증거는 없다.

`INFERRED`: 그러므로 다음 실험은 무제한 확장이 아니라 **한 번의 제한된
go/no-go 단계**여야 한다. 조건과 중단 규칙은 `ABLATION_PLAN.md` §5에 있고,
실패 시의 대안(v4 기본 정책 + rally 단위 RL 선택기 하이브리드)은 §7에 있다.
