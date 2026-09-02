# Robust RL 시스템

## 확정된 문제 정의

| 항목 | 결정 | 상태 |
|---|---|---|
| 물리 | official `leonyi-volleyball` commit `1f3cecb...`, ball `yVelocity` clamp ±40 | VERIFIED |
| 관찰 | official snapshot 20개 값 + 현재 적용 action 3개, 4 decision-frame stack = 92 float | VERIFIED/IMPLEMENTED |
| 대칭 | RIGHT를 LEFT 관점으로 x·xVelocity·divingDirection·serve 의미까지 mirror | IMPLEMENTED |
| 행동 | `(x,y,hit)` Cartesian 18개; 학습 API의 범위 밖 index는 오류, exported bot 오류는 neutral | VERIFIED/IMPLEMENTED |
| 시간 | 환경 step 1회 = bot decision interval 3 physics frames; 추가 frame skip/action repeat 없음 | VERIFIED/IMPLEMENTED |
| 지연 | deterministic harness는 응답 1 processed-frame 지연 | IMPLEMENTED approximation |
| episode | 10점 match가 episode, rally는 통계/reward 경계; READY 포함, game-end 이후 neutral transition 포함 | IMPLEMENTED |
| reward | 득점 +1, 실점 -1만 사용; touch/cross/match 중복 보상 0 | IMPLEMENTED |
| 메모리 | 최소 기준은 4-frame stack FF PPO. POMDP이므로 GRU는 별도 후보지만 validation 이득 전에는 기본값이 아님 | DECIDED; GRU NOT IMPLEMENTED |
| 런타임 | self-contained synchronous JavaScript; PyTorch/외부 파일 없음 | VERIFIED/IMPLEMENTED exporter |

부분관측성의 근거는 snapshot에 player velocity, collision edge, touch-limit counter, Worker pending/latency, 상대 내부 메모리가 없다는 점이다. 4-frame stack은 작은 재현 가능 기준선이다. recurrent PPO는 타당한 후보지만 sequence PPO와 JS gate parity를 함께 구현·검증하기 전에는 성능 가정으로 채택하지 않는다.

## 학습 구성

- 순수 RL: FF PPO를 point-only reward와 opponent pool로 학습한다.
- 모방 초기화: `collect_bc.mjs`가 frozen v4의 full-match 행동을 수집하고 `bc_pretrain.py`가 actor를 초기화한다. PPO에는 `--initial-model`로 넣는다.
- self-play: `league.py`가 exported historical checkpoint를 immutable SHA로 등록한다. `--league-manifest` 사용 시 scheduler가 anchor와 league에 각각 50% 질량을 주고 내부에서 균등 표집한다.
- curriculum: 실제 최종 비교는 10점/random serve만 사용한다. 1·3점은 smoke 또는 명시적 training curriculum일 뿐 성능 근거가 아니다.
- hybrid/residual: 현재 제외한다. v4는 내부 상태가 있어 rally 도중 정책을 바꾸면 상태가 동기화되지 않으며, 두 행동 평균은 합법적인 의미가 없다. 향후 hybrid는 양 정책을 매 decision 모두 실행해 상태를 유지하고 rally boundary에서만 선택해야 한다.

BC, 순수 PPO, BC→PPO, league self-play는 동일 validation manifest로 비교한다. recurrent 및 rally-level hybrid는 구현·export parity gate를 통과한 뒤 별도 ablation arm으로 추가한다.

## 실행

공식 엔진을 정확한 checkout에서 복사한다.

```powershell
node scripts/setup_rl_engine.mjs C:\path\to\leonyi-volleyball
node bot-dev/rl/production_differential.mjs --game-root C:\path\to\leonyi-volleyball
node bot-dev/rl/env_smoke.mjs
python bot-dev/rl/bridge_smoke.py
python bot-dev/rl/ppo_tests.py
```

v4 모방 데이터와 초기 checkpoint를 만든다.

```powershell
node bot-dev/rl/collect_bc.mjs --decisions=500000 --output=bot-dev/rl/runs/bc/v4.jsonl
python bot-dev/rl/bc_pretrain.py bot-dev/rl/runs/bc/v4.jsonl bot-dev/rl/runs/bc/v4_ff.pt --device=auto
```

학습과 Drive 같은 recovery 디렉터리 재개:

```powershell
python bot-dev/rl/ppo_train.py --device=auto --workers=4 --envs-per-worker=4 `
  --total-steps=2000000 --initial-model=bot-dev/rl/runs/bc/v4_ff.pt `
  --recovery-dir=D:\pikachu_rl\checkpoints
```

`latest.json`의 SHA를 확인한 checkpoint를 `--resume`으로 지정한다. 재개는 진행 중 JS/physics 객체를 직렬화하지 않고 scheduler RNG를 복원한 다음 새 episode에서 시작하는 `fresh-episodes` 방식이다.

과거 exported checkpoint를 다음 run의 league에 넣는다.

```powershell
python bot-dev/rl/league.py bot-dev/rl/runs/league/league.json path/to/Robust_RL_v1.js `
  --run-id=seed20260903 --step=2000000
python bot-dev/rl/ppo_train.py --league-manifest=bot-dev/rl/runs/league/league.json ...
```

export와 validation:

```powershell
python bot-dev/rl/export_policy.py checkpoint.pt src/code-here/Robust_RL_v1.js
python bot-dev/rl/export_policy_test.py checkpoint.pt src/code-here/Robust_RL_v1.js
node bot-dev/rl/export_env_smoke.mjs src/code-here/Robust_RL_v1.js
node bot-dev/rl/eval/paired_eval.mjs --candidate=src/code-here/Robust_RL_v1.js `
  --output=bot-dev/rl/runs/evaluation/validation.jsonl
python bot-dev/rl/eval/stats.py bot-dev/rl/runs/evaluation/validation.jsonl
```

Colab T4의 전체 순서는 `notebooks/Pikachu_Robust_RL_Colab.ipynb`에 있다.

## 평가 해석 제한

- paired block은 같은 초기 RNG seed를 사용하지만 행동에 따라 rally 수가 달라지면 이후 serve RNG stream도 달라질 수 있다.
- bootstrap 단위는 row/rally가 아니라 opponent×seed block이다.
- Wilson interval은 보조 지표다.
- builtin/fixed 상대는 현재 v4에게 ceiling이므로 일반화 성능을 충분히 식별하지 못한다.
- Worker scheduling, pending request, timeout/restart, 실제 Chrome 적용 지연은 deterministic harness에 없다.
