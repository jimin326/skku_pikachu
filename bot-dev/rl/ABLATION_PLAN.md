# 사전 등록 ablation 계획 — 2026-09-03

이 문서는 **실행 전에** 고정한 계획이다. 결과를 보고 기준을 바꾸지 않는다.
근거 데이터는 `RL_PIPELINE_HANDOFF_2026-09-03.md`와 이 저장소에서 실제 실행한
`DIAGNOSTICS_2026-09-03.md`이다.

## 0. 사실 수준 표기

- `VERIFIED` — 이 저장소에서 실행했거나 handoff에 기록된 측정값.
- `INFERRED` — 측정값에서 끌어낸 해석.
- `UNKNOWN` — 아직 측정하지 않음.

## 1. 고정된 판정 기준 (변경 금지)

`bot-dev/rl/eval/gates.py`의 `GateThresholds`가 유일한 기준이며, 코드와 이 문서가
다르면 **코드가 기준**이다.

| gate | 기준 | 수준 |
|---|---|---|
| `benchmark_ci_lower` | v4-direct paired delta 95% block-cluster CI 하한 **> 0** | submission |
| `per_side_ci_lower` | 모든 non-benchmark opponent×side paired delta CI 하한 **≥ -0.05** | submission |
| `primary_ci_lower` | non-benchmark opponent-equal-weight delta CI 하한 ≥ -0.05 | submission |
| `self_destruction` | 패배 중 자멸 비율 **≤ 10%** (v4 = 2.04%) | submission |
| `runtime` | `ACCEPTANCE.md` §4 그대로: p95 ≤ 125 µs, p99 ≤ 1 ms, max ≤ 10 ms, raw JS ≤ 1 MiB, heap 증가 ≤ 10 MiB, invalid actions **= 0** | submission |
| `self_destruction_selectable` | 자멸 ≤ 25% | selection only |

`selectable`은 학습 중 best checkpoint 후보 자격일 뿐이고, `submission`이 참이
아니면 `src/code-here`에 아무것도 만들지 않는다.
**runtime 기준은 `ACCEPTANCE.md` §4에서 그대로 가져온 값이며 완화하지 않는다.**
`pipeline_tests.test_runtime_thresholds_match_acceptance_md`가 두 문서의 일치를
강제하고, benchmark가 보고하지 않은 지표는 통과로 처리하지 않는다.

`selectable`하지 않은 checkpoint는 **best로 기록되지 않는다** — 첫 번째라도
마찬가지다. `--max-unselectable-phases`(기본 3) 동안 selectable이 하나도 없으면
그 arm은 중단하고 best 없이 보고한다.

**선택 순서** (`gates.selection_key`, 사전 고정):
`selectable` → `submission` → non-benchmark paired delta → v4-direct paired delta
→ 낮은 자멸률 → rally 승률.

## 2. 이번에 측정한 것이 바꾼 전제

`VERIFIED` (`DIAGNOSTICS_2026-09-03.md` §2): teacher가 방문한 상태에서 hidden-state
aliasing은 사실상 없다. 4-frame 관찰을 소수점 2자리로 양자화했을 때 label 충돌
표본 비율 0.0065%, H(action|obs) = 5.3e-5 bit, accuracy ceiling 99.998%.
episode-held-out accuracy 91.2% (majority baseline 43.6%).

`VERIFIED`: **learner가 방문한 상태**(DAgger 수집분)에서는 같은 충돌률이
0.22~0.28%로 약 40배 높다. 거친 양자화에서는 4.6% → 8.5~8.9%다.
즉 aliasing은 분포에 의존하며, teacher 분포 측정만으로 "메모리 불필요"를
주장할 수 없다. 다만 실제 정밀도에서 accuracy ceiling은 learner 상태에서도
99.9%다.

`VERIFIED`: 같은 BC 정책이 learner rollout에서는 랠리 후반으로 갈수록 teacher와
갈라진다 (decision index 0–4에서 9.3% → 20+에서 38.2%), 패배 랠리의 마지막 5수
불일치 66.9% vs 승리 랠리 19.4%, 자멸 랠리 99.4%.

`INFERRED`: 따라서 **분포 이탈(compounding error)이 지배적 원인이고, aliasing은
관측된 범위에서 병목을 설명할 만큼 크지 않다.** 이 계획은 그 전제 위에 있다.
500k 원본 데이터셋에서 `bc_diagnostics.py`를 다시 돌려 결론이 유지되는지 먼저
확인한다(§5 A0). learner 상태 ceiling이 99% 아래로 내려가면 D1(recurrent)의
우선순위를 올린다.

## 3. Arm 정의

모든 arm은 동일 물리(engine `1f3cecb…`), 동일 validation split
(`builtin`, `fixed_chase` + benchmark `lion_v4`, seeds 21001…21191, 양 진영,
seed/side당 1경기), 동일 paired v4 arm, 동일 gate를 쓴다.
train split(`lion_v1/v2/v3`, `fixed_neutral`, seeds 11003…11173)과 겹치지 않는다.
sealed final은 열지 않는다.

| arm | 설명 | 구현 | 주 비용 |
|---|---|---|---|
| **A0** | 기존 500k BC 재진단 (학습 없음) | `bc_diagnostics.py` | ~5분 |
| **A1** | 기존 BC+PPO checkpoint sweep (학습 없음) | `checkpoint_sweep.py` | checkpoint당 ~1–3분 |
| **B1** | DAgger 1 라운드 (β=0), 집계 재학습 | `eval/teacher_shadow.mjs` + `bc_pretrain.py` | ~10분/100k |
| **B2** | DAgger 2 라운드 | 위와 동일 | B1 + ~10분 |
| **C1** | BC 초기화 + KL anchor PPO (`--anchor-kl-coef 0.5`, decay 없음) | `train_with_validation.py` | 100k step당 ~20–40분 |
| **C2** | C1 + `--policy-freeze-updates` (critic warm-up) + `--learning-rate 5e-5` | 위와 동일 | C1과 동일 |
| **D1** | 더 긴 history(frameStack 8) 또는 recurrent | **미구현** | 구현 1–2일 |

### 사전 등록 가설

- H1 (`INFERRED`): B1/B2는 non-benchmark paired delta를 개선한다.
- H2 (`INFERRED`): C1/C2는 BC-only 대비 v4-direct delta 악화(-50%p)를 막는다.
- H3 (`UNKNOWN`): 어떤 arm도 자멸률을 10% 이하로 내리지 못한다.
- H4 (`UNKNOWN`): D1의 이득은 구현 비용을 정당화하지 못한다.

각 가설은 위 gate 값으로만 판정한다. supervised accuracy로 판정하지 않는다.

## 4. 이미 실행한 결과 (B1·B2 축소판)

`VERIFIED`. 200k teacher 데이터 + 100k씩 2라운드, CPU. 자세한 내용은
`DIAGNOSTICS_2026-09-03.md` §3.

| arm | 경기 | 랠리 | non-benchmark delta (95% CI) | builtin / fixed_chase | v4-direct | 자멸 | gate |
|---|---:|---:|---|---|---:|---:|---|
| BC-200k | 25.00% | 41.17% | -0.875 [-0.969, -0.750] | -0.875 / -0.875 | 0.0 | 37.0% | 실패 |
| +DAgger r1 | 41.67% | 46.97% | -0.625 [-0.781, -0.469] | -0.813 / -0.438 | 0.0 | 45.0% | 실패 |
| +DAgger r2 | 64.58% | 56.12% | -0.281 [-0.406, -0.156] | -0.563 / **0.000** | 0.0 | 32.6% | 실패 |
| v4 (기준) | 83.33% | 75.74% | 0 | — | — | 2.04% | — |

`INFERRED`: H1은 지지된다. H3도 현재까지 지지된다 — 자멸률은 단조 감소하지 않았고
어떤 라운드도 25% selectable 기준조차 통과하지 못했다.

## 5. 실행 순서와 중단 규칙 — 제한된 1회 go/no-go

`INFERRED`: §4의 개선은 실재하지만, DAgger는 근본적으로 **v4를 더 잘 복제하는**
방법이고 강한 KL anchor는 정책을 teacher 성능에 묶을 수 있다. 자멸률도 단조
개선되지 않았다. 따라서 이 계획은 무제한 확장이 아니라 **마지막 bounded
go/no-go 단계**로 실행한다.

1. **A0, A1 먼저.** 비용이 없고(학습 없음), A1은 handoff의 UNKNOWN(중간
   checkpoint 궤적)을 직접 채운다. A1에서 forgetting 시작 step이 나오면 C의
   anchor 강도와 phase 길이를 그 step 이전으로 잡는다.
2. **실제 500k 데이터로 DAgger를 최대 2라운드만** 실행한다. §4는 200k 축소판이다.
   **각 라운드 직후 반드시 별도 validation을 수행한다** (노트북 stage B가
   stage C와 동일한 export → paired eval → stats → runtime → gates 경로를 쓴다).
3. **stage C 진입 조건 (go/no-go).** 2라운드 후 아래 세 조건 중 **하나도**
   만족하지 못하면 순수 정책 경로를 중단하고 실험 결과만 보고한다.
   - 자멸률 < 25%
   - non-benchmark paired delta CI 하한이 최소 -0.20 부근까지 개선
   - 라운드마다 teacher disagreement 감소
   세 조건 중 일부만 만족하면 `WEAK GO`이며, stage C는 **최대 2~3 phase**만 쓴다.
4. C는 `train_with_validation.py`로 100k step phase마다 validation·rollback한다.
   **초기값과 anchor를 구분한다** — 기본 arm은 최종 DAgger 모델에서 시작해
   그 모델을 anchor로 쓰고(`ANCHOR_SOURCE='dagger'`), 원본 BC를 anchor로 쓰는
   arm(`ANCHOR_SOURCE='bc'`)은 별도로 돌린다. 원본 BC anchor는 25% 짜리 약한
   teacher-분포 클론 쪽으로 정책을 되당길 수 있다.
5. **어떤 arm도 gate를 통과하지 못하면 seed를 늘리지 않는다.** 추가 seed는
   후보가 `submission` gate를 통과한 뒤에만, 최소 3개 독립 seed로 실행한다.
6. sealed final은 모델 선택이 끝난 뒤 한 번만 연다.

### 중단 규칙 (사전 고정, 코드로 구현됨)

- **자멸률이 두 phase(또는 DAgger 라운드) 연속 상승하면 즉시 중단한다.**
  `train_with_validation.Runner.select`와 노트북 stage B에 구현되어 있고
  `pipeline_tests.test_selection_rejects_unselectable_and_stops_on_rising_self_destruction`이
  검증한다.
- selectable checkpoint가 3 phase 동안 하나도 없으면 중단하고 best 없이 보고한다.
- `invalid actions > 0`이면 즉시 중단한다 (export 결함이며 runtime gate 실패다).
- validation에서 2 phase 연속 개선이 없으면 best로 rollback하고 learning rate를
  절반으로 내린다. rollback 2회 후에도 개선이 없으면 그 arm을 종료한다.
- 같은 결과가 arm 간 **완전히 동일**하게 나오면 그것은 "차이 없음"이 아니라
  그 파라미터가 결정을 바꾸지 못한다는 신호다. 격자를 넓히지 말고 계측한다.

## 6. 명시적으로 선택하지 않은 것

- **D1 (recurrent / frameStack 8)**: `UNKNOWN`. aliasing은 teacher 상태에서 거의
  0이고 learner 상태에서 40배 크지만, 그래도 accuracy ceiling 99.9%라 승률 25%를
  설명하지 못한다. **"메모리가 불필요하다"가 아니라 "지금 이것부터 구현할 근거가
  없다"는 뜻이다.** sequence PPO와 JS export parity를 함께 구현해야 해 비용이 가장
  크다. A0의 learner-state ceiling이 99% 아래이거나 stage C까지 실패하면 승격을
  재검토한다.
- **action imbalance 보정(class weight / focal)**: 전체 accuracy는 이미 91%이고
  majority baseline(43.6%)을 크게 넘는다. rollout 결과와 함께 평가하지 않는 한
  supervised 지표만 움직일 위험이 있다. B2 이후로 미룬다.
- **reward shaping(자멸 페널티)**: 매력적이지만 handoff §10의 point-only reward
  계약을 바꾼다. C1/C2가 자멸을 못 잡으면 그때 별도 arm으로 사전 등록한다.
  현재 H3(어떤 arm도 자멸 10% 미만을 달성하지 못한다)이 지지되고 있으므로,
  이 결정은 사람이 명시적으로 내려야 한다.
- **league self-play 확대**: 현재 실패는 학습 신호/분포 문제이지 상대 다양성
  문제라는 증거가 없다.
- **추가 seed·sealed final**: gate 통과 전까지 금지.

## 7. no-go일 때의 대안

`INFERRED`: 위 go/no-go를 통과하지 못하거나, stage C에서도 자멸률과 v4 대비
성능이 개선되지 않으면 **순수 RL로 v4를 대체하는 경로를 중단**하고 다음을
검토하는 편이 현실적이다.

- **v4 기본 정책 + rally 단위 RL 선택기 하이브리드.** `ROBUST_RL.md`가 현재
  hybrid를 제외한 이유는 rally 도중 정책을 바꾸면 v4의 내부 상태가 동기화되지
  않기 때문이다. 그 제약을 지키는 형태는 **두 정책을 매 decision 모두 실행해
  상태를 유지하고 rally 경계에서만 선택**하는 것이다. 이러면 최악의 경우가
  v4 성능으로 하한이 잡히며, 이는 순수 정책 경로가 지금까지 제공하지 못한
  성질이다.
- 이 경로는 별도 설계·구현·export parity gate가 필요하므로, 위 go/no-go 결과가
  나오기 전에는 착수하지 않는다.
