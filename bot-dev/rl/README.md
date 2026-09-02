# Legacy red-team harness

이 문서는 이전 v1 red-team 실험의 상세 기록이다. 현재 v4 기반 robust 시스템의 계약과 실행법은 [ROBUST_RL.md](ROBUST_RL.md), 승격 기준은 [ACCEPTANCE.md](ACCEPTANCE.md)를 우선한다. 아래의 thunder masking, 단일 victim, 1·3점 curriculum, 50% target은 robust SOTA 판정 기준이 아니다.

This directory trains a separate opponent against the frozen
`Lion_Eating_Bank_v1.js`. It never edits or fine-tunes the
victim.

## One-time setup

Requirements:

- Node.js 20 or newer;
- Python 3.10 or newer (Python 3.12 is the verified version);
- an official tournament game checkout containing the current `physics.js`
  with the vertical-velocity clamp.

The official engine is deliberately not copied into Git. Import the three
required files from your untouched, up-to-date game checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup_rl_engine.ps1 `
  -GameRoot C:\path\to\official-game
```

The copied files live under `src/resources/` in this repository and are
ignored by Git. The setup script prints their SHA-256 hashes. Verify the new
vertical-velocity rule and environment before training:

```powershell
node bot-dev/rl/physics_clamp_smoke.mjs
node bot-dev/rl/env_smoke.mjs
```

Create the Python environment and install the two training dependencies:

```powershell
py -3.12 -m venv .venv-rl
.\.venv-rl\Scripts\python.exe -m pip install --upgrade pip
.\.venv-rl\Scripts\python.exe -m pip install -r requirements-rl.txt
.\.venv-rl\Scripts\python.exe bot-dev/rl/ppo_tests.py
```

## Environment fidelity

`redteam_env.mjs` wraps `sim_real.mjs`, which directly runs the production
`src/resources/js/physics.js` engine. A step is one bot decision interval:

- the same 3 engine frames per bot tick;
- the same valid 18 `(x, y, hit)` actions;
- one engine frame of resolved Worker-response latency;
- production scoring, random serve, ready time, slow motion, and five-touch
  limit;
- one continuous victim instance for the whole match, so its cross-rally
  learning state is preserved;
- a fresh victim by default, or the same bot/input/tick state across games
  when `preserveBotState: true` is used for a seed/side series.

Rendering, audio, real wall-clock delays, Worker scheduling jitter, and the
360 ms timeout are intentionally absent. They do not alter deterministic game
physics; browser validation remains a final export check.

## API

```js
import { RedTeamEnv } from './redteam_env.mjs';

const env = new RedTeamEnv();
let { observation, info } = env.reset({ seed: 12345, side: 'random' });

while (true) {
  const actionIndex = 0; // integer 0..17
  const result = env.step(actionIndex);
  observation = result.observation;
  if (result.terminated || result.truncated) break;
}

// Next game in the same seed/side Worker history. Omit seed to continue the
// engine RNG stream as well as both bots' tick/state.
({ observation, info } = env.reset({ preserveBotState: true }));
```

The observation is a `Float32Array` with four stacked decision frames. Each
frame has 23 features and is mirrored so the learner always sees itself on
the LEFT. It contains only the official tournament snapshot fields plus the
currently applied previous action. In particular, `expectedLandingPointX`,
`isPowerHit`, and both players' `state`, `frameNumber`, and `divingDirection`
come directly from `botContract.js`; the environment does not recalculate
them. No hidden touch-limit state is included in the observation.

## Thunder masking and phase-chain metrics

For a Lion serve, real-game phase is `(Lion rally tick0 + 1) % 3`. Phases 0
and 2 are the fixed thunder serve. Every action result contains `info.lossMask`:

- `0` for thunder and post-game transitions;
- `1` for all other live-rally and READY transitions. READY actions are kept
  because the last resolved action carries into the next rally.

Keep every reward in the return/GAE recursion, but multiply only the PPO
policy/value/entropy losses by this mask. This removes uncontrollable thunder
actions from optimization without erasing the consequence of an earlier
action changing the next serve phase. The environment verifies the real phase
chain `(phase + rallyFrames + 41) % 3`.

`info.rallyStats` reports thunder-excluded wins/losses and win rate, Lion serve
phase counts, and `winningGameVictimServePhaseCounts`. These are the primary
success and phase-exploitation metrics.

## Python/PyTorch bridge

PPO belongs in Python/PyTorch. `batch_server.mjs` owns one or more real-game
environments, and `node_bridge.py` exchanges observations and batched actions
with it over a persistent child-process connection:

```python
from node_bridge import NodeVectorEnv

with NodeVectorEnv(8) as env:
    observations, infos = env.reset(
        {"seed": 1000 + i, "side": "LEFT" if i % 2 == 0 else "RIGHT"}
        for i in range(8)
    )
    observations, rewards, terminated, truncated, infos = env.step([0] * 8)
```

Training should continually rotate series seeds. Reproducible evaluation
should use a held-out fixed list of at least ten seeds, both sides, and several
games per seed/side with `preserveBotState: true`.

The default frozen victim SHA-256 is checked on every reset after normalizing
CRLF to LF, so Windows and Linux checkouts agree. Training stops immediately
if the actual source changes.

Run the parity and determinism checks with:

```powershell
node bot-dev/rl/env_smoke.mjs
```

Run the Node/Python batch bridge check with a Python that has NumPy:

```powershell
python bot-dev/rl/bridge_smoke.py
```

## Stage 3: beam-search gate

The black-box beam gate searches short action prefixes against the real,
frozen Lion process. Lion thunder serves (Lion-serve phases 0 and 2) are
excluded because RedTeam cannot affect them. The checked-in gate covers both
sides, every RedTeam serve phase, and Lion's non-thunder serve phase:

```powershell
node bot-dev/rl/redteam_beam.mjs --width=12 --depth=18
```

The output is `bot-dev/rl/checkpoints/beam_gate.json`. PPO is not considered
healthy until it can score in at least one context for which this gate found a
win.

## Stage 4: PyTorch PPO

Create/use the project environment and run the unit/bridge tests:

```powershell
.\.venv-rl\Scripts\python.exe bot-dev/rl/ppo_tests.py
```

Start training with independent Node workers. Seeds rotate continually during
training; games in each seed/side series preserve the Worker and Lion state:

```powershell
.\.venv-rl\Scripts\python.exe bot-dev/rl/ppo_train.py --workers 8 --total-steps 2000000
```

Resume to a target total step count with `--resume` (the seed/side schedules
restart with fresh training seeds, while model and optimizer state continue):

```powershell
.\.venv-rl\Scripts\python.exe bot-dev/rl/ppo_train.py --workers 8 --total-steps 2000000 --resume bot-dev/rl/checkpoints/ppo/checkpoint_000200000.pt
```

Evaluate a checkpoint deterministically on ten held-out seeds, both sides,
and three persistent games per seed/side:

```powershell
.\.venv-rl\Scripts\python.exe bot-dev/rl/ppo_eval.py bot-dev/rl/checkpoints/ppo/checkpoint_002000000.pt
```

The evaluator reports match win rate, thunder-excluded rally win rate, all
Lion-serve phase counts, and the phase distribution of RedTeam's winning
matches.

## Stage 5: automatic overnight experiments

`stage5_runner.py` repeatedly performs the whole improvement loop:

1. train with a 1-point, 3-point, then real 10-point curriculum;
2. rotate through four conservative PPO hyperparameter variants and new
   training seeds;
3. evaluate each finished trial on separate selection seeds, both sides;
4. atomically replace `best.pt` only when the score improves;
5. continue until the requested session time expires or the default 50%
   held-out match-win target is reached.

The trainer atomically updates `latest.pt` at least once every 60 minutes and
at every phase boundary. It includes model, optimizer, step counter, and RNG
state. The runner also writes `state.json` before and after each phase. A
failed trainer process is retried up to three times from `latest.pt`.

Run an eight-hour session from the repository root:

```powershell
.\.venv-rl\Scripts\python.exe bot-dev/rl/stage5_runner.py --hours 8
```

Running the exact same command again automatically resumes the active run.
Each invocation grants another eight-hour session budget. Use `Ctrl+C` to
pause; the latest completed hourly checkpoint remains recoverable. To ignore
the active run and deliberately create a separate experiment directory:

```powershell
.\.venv-rl\Scripts\python.exe bot-dev/rl/stage5_runner.py --hours 8 --new-run
```

Outputs are under `bot-dev/rl/runs/stage5_<timestamp>/`:

- `state.json`: active trial/phase, retries, and completed experiment list;
- `trial_*/latest.pt`: latest resumable checkpoint for each trial;
- `trial_*/evaluation.json`: trial evaluation;
- `best.pt` and `best.json`: current best checkpoint and its evidence.

The default trial target is 10 million decision steps. Override it with
`--trial-steps`, and change the safety interval with `--checkpoint-minutes`.
Change the early-stop threshold with `--target-match-win-rate`.
The PC must remain awake; Windows sleep/hibernation pauses the process.

## Export the best checkpoint as a pure JavaScript bot

The exporter writes the deterministic policy, observation encoder, four-frame
stack, and all trained weights into one synchronous `decide(snapshot)` file.
It has no Python, PyTorch, Node, or network dependency at game time:

```powershell
.\.venv-rl\Scripts\python.exe bot-dev/rl/export_policy.py `
  bot-dev/rl/runs/stage5_20260902_043737/best.pt `
  RedTeam_RL_v1.js
```

Verify neural-network numerical parity on 1,024 observations, then verify the
exported bot's stateful encoder against `RedTeamEnv` on both sides and across
persistent games:

```powershell
.\.venv-rl\Scripts\python.exe bot-dev/rl/export_policy_test.py `
  bot-dev/rl/runs/stage5_20260902_043737/best.pt `
  RedTeam_RL_v1.js

node bot-dev/rl/export_env_smoke.mjs RedTeam_RL_v1.js
```

The generated `decide.__rl` object contains read-only diagnostics used by the
tests. Tournament execution only calls the top-level synchronous `decide`.

## Extract and replay Lion loss patterns

Trace 1,000 real matches (100 seeds, both sides, five persistent games per
seed/side). Only rallies lost by Lion receive full decision/touch traces. All
coordinates and physical movement directions are normalized as if RedTeam
were on the LEFT, while the raw emitted action is preserved as well:

```powershell
node bot-dev/rl/trace_lion_losses.mjs `
  --seed-count=100 `
  --games-per-series=5 `
  --output=bot-dev/rl/runs/lion_analysis/lion_loss_traces.jsonl
```

Aggregate repeated mechanisms, landing zones, finishing actions, and RedTeam
serve prefixes. Lion thunder-serve rallies are counted but excluded from the
trainable vulnerability ranking:

```powershell
.\.venv-rl\Scripts\python.exe bot-dev/rl/analyze_lion_losses.py `
  bot-dev/rl/runs/lion_analysis/lion_loss_traces.jsonl
```

The analyzer creates `lion_loss_patterns.json`, `LION_LOSS_REPORT.md`, and a
list of replayable open-loop serve candidates. Validate a candidate on new
seeds with the neural policy used only before the target serve; during the
target rally the recorded canonical action sequence is forced and then falls
back to neutral input:

```powershell
node bot-dev/rl/replay_exploit.mjs `
  --patterns=bot-dev/rl/runs/lion_analysis/lion_loss_patterns.json `
  --candidate=serve_001 `
  --attempts=40 `
  --max-games=5
```
