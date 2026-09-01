# Lion_Eating_Bank_v1 통합 설계 문서

> 문서 기준일: 2026-09-02  
> 대상 파일: `Lion_Eating_Bank_v1.js`  
> 생성기: `bot-dev/build_v12.mjs`  
> 회귀 테스트: `bot-dev/v12_regression.mjs`

## 1. 한 줄 요약

OurBot v12는 다음 우선순위로 동작하는 단일 파일 봇이다.

1. **OurBot_v11의 썬더서브가 진행 중이면 썬더 행동을 무조건 출력한다.**
2. 그 외 모든 상황은 **AdaptiveCounter_v5_2가 일반 플레이를 담당한다.**
3. OurBot_v11의 상황별 수비와 Sajamokneun_v3_2의 상태 인식 모델은 코드에 통합돼 있지만,
   A/B 테스트에서 범용 이득이 확인되지 않아 **기본값은 OFF**다.

즉, 세 파일을 단순히 이어 붙인 봇이 아니다. 각 봇의 역할을 분리하고, 검증된 모듈만
실제 출력 권한을 갖도록 만든 계층형 하이브리드다.

---

## 2. 통합 대상과 채택 결과

| 원본 | 가져온 부분 | v12 기본 상태 | 판단 근거 |
|---|---|---:|---|
| `OurBot_v11.js` | 썬더 상태, 서브 프레임 역산, 오픈루프 시퀀스, 좌우 미러 출력 | **ON** | 지원 위상에서 즉시득점이 검증됨 |
| `OurBot_v11.js` | 상황키 기반 실점 수비와 `DFN_BACK` 적응 | OFF | kyu_v15 A/B에서 ON 82.8%, OFF 84.5% |
| `AdaptiveCounter_v5_2.js` | 일반 플레이 전체, 마이크로 시뮬레이션, 빠른 공격, 공중 정책, 적응 수비 | **ON** | 강한 JS 상대와 일반 랠리에서 가장 좋은 기준선 |
| `Sajamokneun_v3_2.js` | 정확한 점프/다이빙 수직속도 추정 | OFF | kyu에는 이득, Adaptive·내장 AI에는 큰 손해 |
| `Sajamokneun_v3_2.js` | 다이빙·누움·공중 상태를 반영한 상대 도달 구간 | OFF | 240포인트와 실게임형 12게임에서 결과가 완전히 동일 |
| `Sajamokneun_v3_2.js` | 전체 빔서치 | 미채택 | 전체 정책 성능이 낮고 Adaptive의 확정 전술과 충돌 가능 |
| `Sajamokneun_v3_2.js` | 당일 스킬 블록 | 미채택 | 현재 스킬 필드가 확정되지 않았고 `SK.on`도 원본에서 false |

### 중요한 해석

“세 코드를 합쳤다”는 말은 세 봇이 매 tick 투표한다는 뜻이 아니다.

- OurBot은 **서브 필살기 소유자**다.
- AdaptiveCounter는 **일반 랠리의 주 정책**이다.
- Sajamokneun은 **물리 모델 후보를 제공한 연구·실험 모듈**이다.
- 손해가 확인된 기능은 코드에 실험 스위치로 남겼지만 실제 경기 기본값에서는 개입하지 않는다.

---

## 3. 최종 실행 흐름

```text
decide(snapshot)
│
├─ 1. v12ObserveDefence(snapshot)
│     └─ V12_DFN_ENABLED=0이면 즉시 반환
│
├─ 2. thunderAction(snapshot)
│     ├─ 썬더 진행 중: thunder action 반환
│     └─ 썬더 아님/포기: null 반환
│
├─ 3. adaptiveDecide(snapshot)
│     └─ 썬더 여부와 관계없이 매 tick 관측 및 일반 행동 계산
│
├─ 4. 출력 중재
│     ├─ thunder action 존재
│     │    ├─ adaptiveCommitExternalAction(thunder action)
│     │    └─ thunder action 출력
│     └─ thunder action 없음
│          └─ AdaptiveCounter action 출력
│
└─ 5. v12Sanitize(action)
      └─ x/y를 -1,0,1로, hit를 0,1로 강제
```

### AdaptiveCounter를 썬더 중에도 실행하는 이유

AdaptiveCounter는 다음 상태를 tick 사이에 기억한다.

- 직전 스냅샷 `g_prev`
- 직전 tick `g_prev_tick`
- 직전 행동 `g_last_action`
- 공중 공격 정책 `g_air_policy`
- 빠른 공격 커밋 상태
- 상대 공격 학습 통계

썬더 중 AdaptiveCounter를 완전히 멈추면 랠리 전환이나 점수 변화 관측을 놓칠 수 있다.
따라서 매 tick `adaptiveDecide()`를 실행해 관측 상태는 유지한다. 다만 실제 출력이 썬더였을 때는
`adaptiveCommitExternalAction()`으로 AdaptiveCounter가 기억하는 직전 행동을 썬더의 실제 행동으로
덮어쓴다. 이 동기화가 없으면 썬더가 중간에 포기됐을 때 AdaptiveCounter의 1프레임 지연 모델과
실제 캐릭터 움직임이 달라질 수 있다.

---

## 4. OurBot_v11에서 가져온 썬더서브

### 4.1 상태

```js
var TH = {
  seenScore: -1,
  armed: false,
  dead: false,
  fEst: -1
};
```

| 필드 | 의미 |
|---|---|
| `seenScore` | `self + opp` 점수 합. 새 랠리 감지에 사용 |
| `armed` | 현재 랠리에서 썬더 시퀀스를 추적 중인지 |
| `dead` | 현재 랠리에서는 썬더를 포기했는지 |
| `fEst` | 서브 시작 이후 물리 프레임 추정값 |

### 4.2 서브 감지

썬더는 LEFT 기준 좌표로 정규화한 뒤 아래 조건으로 자기 서브 낙하를 찾는다.

```js
myServeDrop = normalisedBallX === 56 && normalisedBallVx === 0;
```

RIGHT 진영이면 다음처럼 좌우를 뒤집는다.

```text
normalisedBallX  = 432 - ball.x
normalisedBallVx = -ball.xVelocity
```

### 4.3 y좌표로 물리 프레임 복구

서브 공은 초기 `y=0`, `vy=1`에서 자유낙하한다. `TH_YTABLE`은 관측한 y좌표를
서브 시작 후 물리 프레임으로 바꾼다.

```text
y 관측 → TH_YTABLE[y] → fEst
```

이 방식은 tick이 3프레임 단위여도 중간에 y좌표를 다시 관측할 때마다 오픈루프 시퀀스를
재동기화할 수 있게 한다.

### 4.4 위상과 시퀀스 선택

```js
phase = (3 - (fEst % 3)) % 3;
planIndex = (phase + 2) % 3;
```

`TH_SEQS`는 LEFT 기준 `[x, y, hit]` 시퀀스다.

- `TH_SEQS[0] = null`: 안전한 썬더 해가 없는 경우
- `TH_SEQS[1]`: 검증된 썬더 시퀀스 1
- `TH_SEQS[2]`: 검증된 썬더 시퀀스 2

시퀀스가 `null`이거나 끝나면 `TH.dead=true`로 만들고 그 tick부터 AdaptiveCounter로 폴백한다.

### 4.5 좌우 출력

시퀀스는 LEFT 기준이므로 RIGHT에서는 x만 반전한다.

```js
return isRight
  ? { x: -e[0], y: e[1], hit: e[2] }
  : { x:  e[0], y: e[1], hit: e[2] };
```

### 4.6 보존 검증

`OurBot_v11`과 `OurBot_v12`를 동일한 상대·시드·진영·지원 위상에서 비교했다.

비교 항목:

- 승자
- 랠리 프레임 수
- 착지 x
- 봇 접촉 수
- 실제 연결된 파워히트 수

결과는 **4/4 완전 동일**이었다.

---

## 5. AdaptiveCounter_v5_2에서 가져온 일반 플레이

AdaptiveCounter는 썬더가 행동을 소유하지 않는 모든 tick의 기본 정책이다.

### 5.1 물리 예측

| 함수 | 역할 |
|---|---|
| `stepBall` | 벽·천장·네트·중력까지 한 프레임 전진 |
| `ballAfter` | n프레임 뒤 공 상태 계산 |
| `framesToLanding` | 착지까지 남은 프레임 계산 |
| `powerHitLanding` | 파워히트 후 착지점과 비행시간 예측 |
| `microSim` | 하나의 공중 행동을 끝까지 평가 |
| `microSimSeq` | 점프 준비→타격 같은 단계별 행동 시퀀스 평가 |

### 5.2 공격 우선순위

지상에서 공이 우리 코트로 올 때 공격 후보는 다음 순서로 평가된다.

1. `findFastAttack`
   - 일반 공격보다 1~2프레임 먼저 hit를 준비한다.
   - 상대 대응 창, 착지 여유, 접촉 수, 낙하시간을 모두 통과한 경우에만 사용한다.
2. `findKillJump`
   - 점프 방향과 스매시 각도를 조합해 상대가 받기 어려운 착지를 찾는다.
3. `findIntercept`
   - 하강 중인 공과 점프 궤적의 교점을 찾아 점프 여부와 목표 x를 정한다.
4. 일반 낙하점 이동 또는 다이빙

### 5.3 공중 정책

공중에서는 `chooseAirPolicy()`가 후보 행동을 다시 평가한다.

```text
x ∈ {-1, 0, 1}
y ∈ {-1, 0, 1}  (hit일 때)
hit ∈ {0, 1}
```

현재 커밋된 행동이 충분히 안전하면 유지하고, 새로운 후보가 일정 점수 이상 더 좋을 때만 바꾼다.
빠른 공격도 현재 궤적이 예상과 달라지면 즉시 취소한다.

### 5.4 일반 적응 수비

AdaptiveCounter는 상대의 실제 타격으로 판단되는 사건만 기록한다.

기록 항목:

- 공격 횟수
- 착지 깊이 평균과 분산
- 최근 착지 EMA
- 뒤/중앙/앞 구역 횟수
- 느림/빠름 × 아치/수평/하향 유형

표본 수, 반복도, 분산을 이용해 `adaptiveConfidence()`를 계산하고, 신뢰도가 높을 때만
기존 수비 목표를 최대 72px까지 보정한다.

### 5.5 터치 리밋 대응

공의 예측 궤적과 실제 궤적 차이, 공의 좌우 코트 이동을 이용해 연속 접촉 수를 추정한다.
남은 접촉 예산은 빠른 공격과 공중 행동 시뮬레이션의 유효성 검사에 사용된다.

---

## 6. OurBot 상황별 실점 수비 오버레이

### 6.1 목적

OurBot_v11은 상대가 공중에서 공격을 준비하던 상황을 좌표 구간 키로 저장한다.
같은 상황에서 실점이 반복되면 학습한 착지점보다 `DFN_BACK`만큼 뒤에 서서 상대의 킬각을
없애는 방식이다.

### 6.2 v12 구현

v12에는 다음 스위치와 상태가 포함돼 있다.

```js
const V12_DFN_ENABLED = 0;
```

주요 값:

| 상수 | 기본값 | 의미 |
|---|---:|---|
| `V12_DFN_LEAD` | 4 | 실점 전 공격 준비 구간에서 사용할 선행 tick |
| `V12_DFN_BX` | 24 | 상황키 공 x 구간 폭 |
| `V12_DFN_BY` | 30 | 상황키 공 y 구간 폭 |
| `V12_DFN_MIN` | 1 | 반응을 시작할 최소 관측 횟수 |
| `V12_DFN_HOLD` | 12 | 학습 목표 위치를 유지할 tick 수 |
| `V12_DFN_BACK` | 52 | 학습 착지점보다 뒤에 설 거리 |
| `V12_DFN_ADAPT_STEP` | 24 | 실점 방향에 따른 오프셋 조절 폭 |

### 6.3 기본 OFF인 이유

실게임형 하니스에서 `kyu_v15`를 상대로 동일 설정을 비교했다.

| 설정 | 게임 | 랠리 승률 |
|---|---:|---:|
| DFN ON | 12승 0패 | 82.8% |
| DFN OFF | 12승 0패 | **84.5%** |

게임 승패는 같았지만 랠리 성능이 소폭 감소했다. 특정 상대에게 다시 유효할 가능성은 있어
코드는 보존했지만 범용 제출 설정에서는 끈다.

---

## 7. Sajamokneun 상태 인식 모델

### 7.1 수직속도 추정

AdaptiveCounter의 원래 `estimateMyVy()`는 이전 y와 경과 tick으로 속도를 근사한다.
Sajamokneun 방식은 실제 점프·다이빙 포물선 테이블에서 현재 y와 이전 y가 일치하는 프레임을 찾아
정확한 vy 후보를 고른다.

스위치:

```js
const V12_INFER_VY = 0;
```

A/B 결과:

| 상대 | OFF | ON | 변화 |
|---|---:|---:|---:|
| kyu_v15 | 75.0% | 77.1% | +2.1%p |
| AdaptiveCounter_v5_2 | **83.3%** | 77.1% | -6.2%p |
| 내장 AI | **90.0%** | 81.7% | -8.3%p |
| Sajamokneun_v3_2 | 91.7% | 91.7% | 동일 |

한 상대에게는 좋아졌지만 범용성이 크게 떨어져 기본 OFF다.

### 7.2 상대 도달 구간

원래 AdaptiveCounter는 다음과 같은 단순 거리식으로 상대의 수비 가능성을 본다.

```text
|ball.x - opp.x| <= WALK_SPEED × framesSinceHit + bodyMargin
```

Sajamokneun 기반 `v12OpponentReach()`는 다음을 추가로 고려한다.

- 다이빙 중이면 강제 방향으로 8px/frame 이동
- 누운 상태면 약 5프레임 이동 불가
- 공중이면 착지 전까지 걷기 불가
- 상태가 풀린 뒤에만 남은 프레임만큼 걷기 가능

스위치:

```js
const V12_STATE_REACH = 0;
```

240포인트 고정 시드와 실게임형 12게임에서 ON/OFF의 행동 및 결과가 같았다.
명확한 이득이 없으므로 기본 OFF다.

### 7.3 전체 빔서치를 넣지 않은 이유

Sajamokneun의 `search()`는 물리를 정확히 전개하지만 현재 평가함수와 상대 정책의 성능이
AdaptiveCounter보다 낮았다.

기준 결과:

- AdaptiveCounter vs Sajamokneun: Adaptive 승률 91.7%
- Sajamokneun vs kyu_v15: Sajamokneun 승률 8.3%
- 판단시간 평균: Sajamokneun 0.468ms, AdaptiveCounter 0.020ms

전체 빔서치를 최종 행동 결정자로 넣으면 다음 충돌이 생긴다.

- AdaptiveCounter의 빠른 공격 커밋을 중간에 취소할 수 있음
- 두 봇의 `prevAct`와 지연 보정 상태가 서로 달라짐
- 터치 수 추정 방식이 중복됨
- 빔 평가함수가 확정 킬보다 단기 위치 점수를 우선할 수 있음

따라서 v12에서는 전체 검색기를 합치지 않고, 독립적으로 검증 가능한 물리 부품만 실험 코드로 남겼다.

---

## 8. 전역 상태 소유권

| 상태 | 소유 모듈 | 설명 |
|---|---|---|
| `TH.*` | Thunder | 서브 시퀀스 진행 상태 |
| `g_prev`, `g_prev_tick` | Adaptive | 이전 스냅샷과 시간 |
| `g_last_action` | Adaptive + v12 중재 | 실제 출력과 반드시 동기화 |
| `g_air_policy` | Adaptive | 공중 행동 커밋 |
| `g_fast_attack_*` | Adaptive | 빠른 공격 커밋과 만료 tick |
| `g_adapt` | Adaptive | 상대 공격 패턴 통계 |
| `v12Dfn*` | 선택적 DFN | 상황키 실점 수비 학습 |
| `V12_JUMP_*`, `V12_DIVE_*` | 선택적 Sajamokneun 모델 | 수직속도 테이블 |

### 상태 충돌 방지 원칙

1. 최종 출력 권한은 한 tick에 한 모듈만 갖는다.
2. 썬더가 출력한 행동은 `g_last_action`에 반드시 반영한다.
3. 썬더 중에도 AdaptiveCounter의 관측은 계속한다.
4. 선택적 수비 오버레이는 AdaptiveCounter의 공격 결정을 덮지 않는다.
5. 최종 액션은 항상 `v12Sanitize()`를 통과한다.

---

## 9. 파일 생성 구조

`OurBot_v12.js`는 생성 파일이다. 직접 수정하지 않는 것을 원칙으로 한다.

```text
AdaptiveCounter_v5_2.js ──┐
                          ├─ build_v12.mjs ──> OurBot_v12.js
Thunder 코드/실험 오버레이 ┘
```

생성기는 다음 작업을 한다.

1. `AdaptiveCounter_v5_2.js`를 읽는다.
2. 줄바꿈을 LF로 정규화한다.
3. 원본 `decide()`를 `adaptiveDecide()`로 이름 변경한다.
4. `adaptiveDefenseTarget()`을 base 함수로 이름 변경하고 선택적 DFN 래퍼를 추가한다.
5. `estimateMyVy()`에 Sajamokneun 방식 선택 스위치를 추가한다.
6. 상대 도달 판정 호출을 선택적 상태 인식 래퍼로 연결한다.
7. Thunder 상태·시퀀스·최종 `decide()`를 추가한다.
8. 단일 JS 파일로 저장한다.

변환 대상 함수나 코드 모양이 예상과 다르면 생성기는 오류를 내고 중단한다. 원본이 바뀌었는데
조용히 잘못된 파일을 만드는 것을 막기 위한 안전장치다.

### 주의

Thunder 시퀀스는 생성기 내부에 복사돼 있다. `OurBot_v11.js`의 썬더를 수정해도 자동으로
가져오지 않는다. 썬더 변경 시 `build_v12.mjs`의 `TH_SEQS`와 `thunderAction()`도 함께 갱신하고
썬더 parity 테스트를 다시 통과해야 한다.

---

## 10. 빌드와 실행 방법

모든 명령은 저장소 루트 또는 `bot-dev`에서 실행할 수 있다.

### v12 재생성

```powershell
cd bot-dev
node build_v12.mjs
```

출력:

```text
src/code-here/OurBot_v12.js
```

### 고정 시드 회귀 테스트

```powershell
cd bot-dev
node v12_regression.mjs 120
```

숫자 `120`은 JS 상대마다 실행할 포인트 수다. 12의 배수를 쓰면
좌·우 × 내/상대 서브 × phase 0/1/2에 균등하게 분배된다.

### 실게임형 연속 랠리 테스트

```powershell
cd bot-dev
node --input-type=module -e "process.env.ME='OurBot_v12.js';process.env.OPP='kyu_v15.js';process.env.GAMES='2';await import('./_real_bench.mjs');"
```

이 하니스는 다음을 포함한다.

- 지연 1프레임
- READY 구간 스냅샷
- 연속 tick
- 랜덤 서브권
- 10점 경기
- 5회 터치 리밋
- 경기 중 점수 누적과 학습 상태

### 프로젝트 검증

```powershell
npm.cmd run lint
npm.cmd run build
```

---

## 11. 실험 스위치 사용법

생성기는 환경변수로 선택 기능을 켤 수 있다.

| 환경변수 | 기본 | 역할 |
|---|---:|---|
| `V12_DFN` | 0 | OurBot 상황별 실점 수비 |
| `V12_INFER_VY` | 0 | Sajamokneun 수직속도 추정 |
| `V12_STATE_REACH` | 0 | Sajamokneun 상태별 상대 도달 구간 |
| `V12_OUTPUT` | 기본 v12 경로 | 다른 파일로 실험 빌드 출력 |

예시:

```powershell
$env:V12_DFN = '1'
$env:V12_OUTPUT = "$env:TEMP/OurBot_v12_dfn.js"
node build_v12.mjs
Remove-Item Env:V12_DFN
Remove-Item Env:V12_OUTPUT
```

기본 제출 파일을 실험 설정으로 덮어쓰지 않도록 `V12_OUTPUT`을 임시 경로로 지정하는 것을 권장한다.

---

## 12. 최종 검증 결과

### 12.1 고정 시드 120포인트

| 상대 | 승-패 | 승률 |
|---|---:|---:|
| kyu_v15 | 96-24 | **80.0%** |
| AdaptiveCounter_v5_2 | 96-24 | **80.0%** |
| Sajamokneun_v3_2 | 110-10 | **91.7%** |
| OurBot_v11 | 80-40 | **66.7%** |
| 내장 AI | 108-12 | **90.0%** |

### 12.2 실게임형 kyu_v15

| 항목 | 결과 |
|---|---:|
| 경기 | **12승 0패** |
| 랠리 | 120승 22패 |
| 랠리 승률 | **84.5%** |
| 내 서브 | 63/67 |
| 상대 서브 | 57/75 |
| decide 예외 | 0 |
| tick 누락 | 0 |

### 12.3 썬더 보존

| 항목 | 결과 |
|---|---:|
| v11과 지원 위상 물리 결과 동일 | **4/4** |

### 12.4 실행시간

| 지표 | 결과 |
|---|---:|
| 호출 수 | 1,358 |
| 평균 | 0.0117ms |
| p99 | 0.0575ms |
| 최대 | 0.2945ms |

### 12.5 정적·프로젝트 검증

- `node --check`: 통과
- `npm run lint`: 통과
- `npm run build`: 통과
- webpack 경고는 기존 번들 크기 및 오래된 Browserslist 데이터에 관한 것으로 v12 오류가 아니다.

---

## 13. 알려진 약점

### 13.1 특정 상대 서브 위상 셀

고정 시드 결과에서 다음 수신 셀이 약하다.

```text
vs kyu_v15 / AdaptiveCounter
  LEFT, 상대 서브, phase 1: 0/10
  RIGHT, 상대 서브, phase 0: 0/10
  LEFT, 상대 서브, phase 2: 6/10
```

전체 승률은 썬더와 다른 강한 셀 덕분에 높지만, 상대 서브에서 결정적인 위상 약점이 남아 있다.
다음 버전의 최우선 연구 대상은 새로운 공격 기능보다 이 세 수신 셀이다.

### 13.2 썬더는 모든 위상에서 필살기가 아니다

고정 시드 표에서 자기 서브가 모든 위상 100%여도, 그중 일부는 썬더가 아니라
AdaptiveCounter 폴백으로 이긴 것이다. `TH_SEQS[0]`은 여전히 `null`이다.

### 13.3 학습 수치는 상대와 경기 길이에 의존한다

Adaptive 학습과 선택적 DFN은 한두 포인트 테스트보다 점수가 누적되는 실게임형 하니스에서
평가해야 한다. 포인트마다 봇을 다시 로드하는 테스트만으로 학습 기능을 판단하면 안 된다.

### 13.4 테스트 상대 풀이 제한적이다

현재 주요 검증 상대는 다음과 같다.

- 내장 AI
- kyu_v15
- AdaptiveCounter_v5_2
- Sajamokneun_v3_2
- OurBot_v11

새로운 대회 봇, Python 봇, 당일 스킬 환경에서는 결과가 달라질 수 있다.

---

## 14. 수정 원칙

### Adaptive 일반 로직을 바꿀 때

1. `AdaptiveCounter_v5_2.js` 또는 후속 원본을 수정한다.
2. 생성기의 변환 대상 이름이 맞는지 확인한다.
3. `node build_v12.mjs`로 다시 생성한다.
4. `node v12_regression.mjs 120`을 실행한다.
5. 실게임형 연속 경기까지 확인한다.

### Thunder를 바꿀 때

1. `build_v12.mjs`의 `TH_YTABLE`, `TH_SEQS`, `thunderAction()`을 수정한다.
2. 지원 위상에서 v11 또는 새 기준 봇과 프레임·착지·접촉 parity를 확인한다.
3. 상대 서브에서 오발동하지 않는지 확인한다.
4. LEFT와 RIGHT를 모두 검사한다.

### 실험 기능을 켤 때

1. 기본 파일을 바로 덮어쓰지 않는다.
2. `V12_OUTPUT`으로 별도 파일을 만든다.
3. 동일 시드 ON/OFF를 모두 실행한다.
4. 전체 승률뿐 아니라 12개 셀 붕괴 여부를 본다.
5. 실게임형 경기에서 점수 누적 학습을 확인한다.
6. 검증 시드에서도 이득이 재현될 때만 기본값을 바꾼다.

---

## 15. 다음 개선 우선순위

1. **상대 서브 약점 셀 분석**
   - `LRp1`, `RRp0`, `LRp2` 패배 trace 수집
   - 첫 리시브 위치, 점프 타이밍, 빠른 공격 오판 분류
2. **Thunder 미지원 위상 연구**
   - `TH_SEQS[0]`의 안전한 해가 새 물리/전략에서 가능한지 재탐색
3. **상대별 모듈 게이팅**
   - 범용 ON 대신 충분한 표본이 쌓였을 때만 DFN이나 상태 도달 모델 활성화
4. **당일 스킬 훅**
   - 실제 게이지·스킬 필드가 확정된 뒤 최종 sanitizer 직전에 적용
5. **더 넓은 상대 풀**
   - Python 강봇과 실브라우저 장시간 경기 추가

---

## 16. 파일 목록

| 파일 | 역할 |
|---|---|
| `src/code-here/OurBot_v11.js` | Thunder 원본 및 비교 기준 |
| `src/code-here/AdaptiveCounter_v5_2.js` | 일반 플레이 원본 |
| `src/code-here/Sajamokneun_v3_2.js` | 모델 기반 탐색·상태 인식 연구 원본 |
| `Lion_Eating_Bank_v1.js` | 최종 생성된 단일 파일 봇 |
| `bot-dev/build_v12.mjs` | v12 생성기와 통합 로직의 실제 소스 |
| `bot-dev/v12_regression.mjs` | 고정 시드, 썬더 parity, 실행시간 회귀 테스트 |
| `bot-dev/sim.mjs` | 포인트 단위 헤드리스 시뮬레이터 |
| `bot-dev/sim_real.mjs` | READY·점수·연속 tick을 포함한 실게임형 하니스 |

## 17. 최종 결론

OurBot v12의 핵심 성능 향상은 복잡한 세 정책 투표에서 나온 것이 아니다.

- 결정적인 자기 서브는 OurBot_v11의 썬더가 책임진다.
- 썬더가 아닌 모든 랠리는 AdaptiveCounter_v5_2가 책임진다.
- 두 정책의 내부 상태를 실제 출력에 맞게 동기화한다.
- Sajamokneun과 OurBot의 추가 모듈은 A/B 결과에 따라 보수적으로 비활성화한다.

이 구조는 “좋아 보이는 코드를 모두 켜는 것”보다, **검증된 역할을 충돌 없이 조합하고
손해인 기능은 과감하게 끄는 것**을 목표로 한다.
