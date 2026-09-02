# 사전 등록된 모델 승격 기준

이 기준은 RL 장기 학습 전에 고정한다. 현재 가용 validation 상대가 v4에게 모두 패하는 약한 상대를 포함하므로, 단순 평균 승률은 개선을 식별하지 못한다.

1. Fidelity gate
   - engine manifest의 커밋과 모든 해시가 일치해야 한다.
   - persistent 2-match production-method differential, physics clamp, environment, bridge, export parity가 모두 통과해야 한다.
2. Primary efficacy gate
   - candidate와 v4를 각각 `lion_v4`와 붙인 paired block 평가에서 match-win-rate 차이의 95% block-cluster bootstrap CI 하한이 0보다 커야 한다.
   - final block은 상대·seed·양 진영·persistent series를 함께 재표집한다.
3. Robustness non-inferiority gate
   - sealed final의 각 주요 독립 opponent family와 LEFT/RIGHT에서 candidate-v4 match-win-rate 차이의 95% CI 하한이 -0.05 이상이어야 한다.
   - 자멸률, 평균 rally 길이, truncation은 v4보다 실질적으로 악화되면 안 된다. 원인별 임계치는 validation pilot 후 final manifest를 만들기 전에 수치로 고정한다.
4. Runtime gate
   - 현재 머신의 v4 compute-only 기준은 5,000 snapshot에서 p95 60.4–62.5 µs, p99 101–154 µs, 최대 1.13 ms였다.
   - 같은 corpus/process에서 candidate p95 ≤ 125 µs, p99 ≤ 1 ms, 최대 ≤ 10 ms, invalid action 0을 요구한다.
   - raw JS ≤ 1 MiB, steady-state heap 증가 ≤ 10 MiB를 요구한다.
   - Chrome Worker end-to-end 지연 기준은 실제 trace를 얻기 전까지 `UNKNOWN`이며 위 Node 기준으로 대체하지 않는다.
5. Reproducibility gate
   - 최소 3개 독립 training seed를 평가하고 seed별 결과와 분산을 보고한다.
   - validation으로 checkpoint를 선택한 뒤 candidate SHA를 동결한다.
   - 외부 보관 sealed final manifest는 한 번만 실행한다. 실패 후 튜닝하면 기존 final set을 폐기한다.

독립 상대 family가 추가되지 않으면 3번 gate는 충족 여부를 판정할 수 없으므로 SOTA 승격은 `BLOCKED`다.
