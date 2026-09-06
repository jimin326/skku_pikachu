# 당일 추가 스킬 예측 (2026-09-05)

근거: 주최 측 공개 저장소(leonyi-volleyball)의 코드에 남은 흔적과 원작(gorisanson) 코드와의 diff.

## 1. 공개 코드에 남은 스킬 흔적 (확정 사실)

| 위치 | 원문 | 의미 |
|---|---|---|
| `src/resources/js/operator/console.js` 헤더 | "Like bot/testSetup.js and **skill/setup.js**, this is assembly-layer code: it drives PikachuVolleyball through its own public fields and never reaches into the physics engine." | 개발 저장소에 `skill/setup.js` 모듈이 있고, 공개판에서 디렉터리째 삭제됨. 물리 엔진(physics.js)을 고치지 않고 PikachuVolleyball 공개 필드(keyboardArray, physics.ball/playerN 필드, scores 등)를 조작하는 방식 |
| `src/resources/js/rules/touchLimit.js` 헤더 | "Like **skill/gauge.js** this is a pure observer -- it reads physics state that already exists and never writes to the engine." | 스킬에 **게이지**가 있고, 게이지는 물리 상태(충돌 플래그·공 상태 등)를 관찰해 채워짐. touchLimit 과 같은 ticker 훅 구조 |
| `src/resources/js/bot/botWorkerPython.js` `nullsToUndefined` 주석 | "the obvious Python spelling of an absent field -- **`if s['self']['claw'] is None`** -- silently does the wrong thing" | 스냅샷에 **`self.claw`**(대칭이므로 `opp.claw`) 필드가 있고, 값이 **null 일 수 있는 객체**. JS null→Python None 변환기가 이 필드 때문에 생김 |
| 같은 주석의 ADR-0029 언급 | claw 필드 관련 사고가 ADR-0029 에서 발견됨 | ADR-0031(2026-08-27, 벽 대칭) 이전 → 스킬은 **공개(08-28) 전에 이미 구현**돼 있었고 공개판에서만 뺐음 |
| `nullsToUndefined` 가 배열도 순회 | | 스냅샷에 배열 필드가 있을 가능성(예: claw 목록) |
| physics.js diff (원작 대비) | 벽 대칭 + y속도 상한 40 만 추가 | 스킬 물리는 physics.js 에 없음 → 프레임 뒤 후처리로 구현(assembly-layer 와 일치) |
| 스프라이트 | 캐릭터 7상태(걷기·점프·파워히트·다이빙·눕기·승·패)뿐, 공은 비트코인 동전, 게이지 UI 없음 | 스킬 그래픽·UI는 당일 레포에서 추가 |

이름 정리: 캐릭터 리온이 = 한양대 사자 마스코트. **claw = 사자 발톱**. "발톱" 스킬.

## 2. 예측

### 2.1 스냅샷 (필드명 신뢰도 높음, 구조는 중간)

```
self.claw / opp.claw : null | { ... }      // 확정된 이름. null 이면 "발톱 없음/비활성"
self.gauge (또는 claw 안의 gauge/charge)   // gauge.js 존재로 추정. 숫자
config.* 에 스킬 설정값(만충치·지속 프레임 등)이 붙을 가능성
```

두 가지 해석 중 하나:
- (a) `claw` = 활성 상태 객체. 발동 중일 때만 객체(남은 프레임, 위치 등), 평소 null. 게이지는 별도 숫자 필드.
- (b) `claw` = 스킬 정보 컨테이너(`{gauge, ready, active, cooldown}`), 스킬이 꺼진 매치에서만 null.

어느 쪽이든 봇은 `s.self.claw == null` 을 먼저 검사하고 객체 키를 그때 읽어야 한다(Python 은 `is None`).

### 2.2 발동

- 기존 봇이 "스킬 사용만 제외하고" 정상 → 발동은 **반환 객체의 새 키**(예: `claw: 1` 또는 `skill: 1`). `isValidBotAction` 은 x·y·hit 만 검사하고 `latestAction` 은 여분 키를 그대로 보관하므로 assembly 계층이 `keyboardArray[i].latestAction.<키>` 를 읽으면 엔진 무수정으로 구현된다.
- 게이지 만충 조건부. 게이지는 관찰형이므로 **터치·파워히트·랠리 프레임·득점** 중 하나로 충전(둘 다 공평하게 채워지는 행동). 리셋은 세트 단위일 가능성.

### 2.3 효과 후보 (구현 가능성 × 힌트 부합 순)

1. **공 물리 변조형 "발톱 강타"** — 프레임 뒤 `physics.ball.xVelocity/yVelocity`(또는 위치)를 덮어씀. 급가속·커브·낙하 급변.
   - 근거: assembly 계층에서 가장 자연스럽고, `expectedLandingPointX` 는 physics 안에서 계산되므로 **스킬 효과를 모르고 계산됨** → 낙하지점만 따라가는 수비형이 무너짐("수비형은 통하지 않음")이면서, 원속도로 직접 시뮬하면 받을 수 있음("이론적으로 방어 가능").
   - 주의: physics 의 y속도 상한 40 이 매 프레임 걸리므로, 후처리 값도 다음 프레임에 40 으로 잘림.
2. **공 낚아채기(claw machine)** — 동전(공)을 발톱으로 잡아 위치/속도를 바꿔 놓음. 1 과 같은 구현 부류. `claw` 가 "잡힌 상태" 객체라면 null 가능성과 잘 맞음.
3. **상대 무력화(스턴)** — 상대 입력을 중립으로 덮거나 `state=4`, `lyingDownDurationLeft` 를 써 눕힘(엔진에 이미 카운트다운 처리 존재). 수비형 붕괴에 부합, 거리·타이밍으로 회피 가능.
4. **판정형(점수·랠리)** — operator `awardPoint` 재사용. 구현은 쉽지만 "스킬 사용" 이라는 표현과 덜 맞음.

## 3. 봇 준비 (스킬 공개 전 할 수 있는 것)

1. SK 블록 필드 경로를 `self.gauge` 고정에서 **탐색형**으로: 첫 틱에 self/opp/ball/meta/config 의 미지 키를 재귀(배열 포함) 덤프, `claw` 는 null 검사 후 키 나열.
2. 발동 키 후보 `claw`·`skill` 둘 다 설정 가능하게. 당일 첫 5분에 확인할 파일 순서:
   `src/resources/js/skill/setup.js` → `skill/gauge.js` → `bot/botContract.js` diff(`buildGameStateSnapshot`, `isValidBotAction`) → 제공되는 스킬 봇의 `return` 문.
3. 시뮬 재현: 물리는 그대로 두고 **프레임 후처리 훅**(observe 후 ball/player 필드 덮어쓰기)으로 옮긴다. `expectedLandingPointX` 는 엔진값 그대로(스킬 미반영)인지 당일 확인 — 미반영이면 우리 봇은 `opp.claw != null` 일 때 낙하지점을 속도에서 재계산.
4. 수비 대응 기본값: 상대 게이지 만충 근접 시 랠리를 빨리 끝내는 쪽(공격 빈도↑, 이미 RUNBOOK 2번), 스킬 활성 표시가 뜨면 낙하지점 불신.
5. RUNBOOK_당일.md 를 3시간 → 1시간 판으로 압축(규칙 읽기 10분 / 시뮬 이식 20분 / 튠 20분 / 제출 10분).
