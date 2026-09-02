# Lion_Eating_Bank_v4.js — 팀 봇 설명서

> 한 줄 요약: **v2의 모양(코어 격리 + 오케스트레이터) + v3의 내용물(3위상 썬더) + AdaptiveCounter_v5_2 랠리 코어 하나.** Saja 코어는 뺐다.
> 손으로 만든 파일이 아니라 게임 저장소(`jimin326/jimin_pika`) `bot-dev/build_v4.mjs`가 원본에서 조립한 파일이다. 고칠 일이 있으면 생성기나 원본을 고치고 다시 만든다.
> 모든 수치는 2026-09-02 현재 물리(공 vy ±40 클램프)에서 잰 것. 상세 근거·검증 절차는 `jimin_pika/bot-dev/LION_MERGE_PLAN.md`.

---

## 1. 왜 v4인가 — v1·v2 대비 (같은 조건, 10시드 × 좌우 × 2경기)

| 랠리 승률 | v1 | v2 | **v4** |
|---|---|---|---|
| vs AdaptiveCounter_v5_2 | 62.6% | 68.2% | **80.5%** (경기 40-0) |
| vs Sajamokneun_v3_2 | 73.5% | 75.6% | **100%** |
| vs OurBot_v11 | 90.3% | 87.3% | **93.2%** |
| vs RedTeam_RL_v1 | 54.4% | 59.2% | **62.5%** |
| vs 내장 AI | – | – | **96.9%** |
| vs Jayce_v1.py (경기) | 14-6 | 12-8 | **20-0** |
| 내 서브 랠리 승률 | 58~90% | 72~100% | **100% (전 상대)** |
| decide 실행시간 | 0.02 ms | 0.5 ms | **0.015 ms** |

차이의 대부분은 **썬더**다. v1·v2가 실은 구형 썬더는 물리 클램프 뒤 네트 상단에 걸려 로브가 되어 죽었고(내장 AI만 못 받음), v4는 v3의 3위상 신형 시퀀스를 쓴다(실제 Chrome 강제 위상 40/40 × 3, 자연 위상 연속 경기 48/48).
상대 서브 랠리는 셋 다 같은 AC 코어라 비슷하고, v4는 적응 수비를 꺼서 탐색형 상대(Saja)에게 46% → 100%가 됐다.

---

## 2. 파일 구조

```
Lion_Eating_Bank_v4.js
├─ §0 노브        DEBUG, LAT_GUARD, LAT_WINDOW, SELF_CHECK, SELF_CHECK_TOL, CAMP_ABORT_X, MAX_BLEND + 스킬 블록(SK, applySkill)
├─ §1 Thunder     var Thunder = (function(){ TH_SEQS(v3 3위상) / TH_EXPECT(기대 궤적) / step, kill })()
├─ §2 ACCore      var ACCore  = (function(){ AdaptiveCounter_v5_2 전문 / decide, sync })()   ← MAX_BLEND 한 줄만 노브로 치환
└─ §3 오케스트레이터  M 상태, core(), decide()
```

세 블록은 `(function(){…})()`로 격리돼 이름이 겹쳐도 서로 안 보인다. AC 원본은 바이트 그대로이고(sha256 앞 12자리가 파일 헤더에 찍힘) `sync(a, external)`만 노출한다.

### 틱마다 하는 일 (§3 `core`)

```
(1) 지연 증거   지상에서 직전 두 출력의 x가 다르면 3프레임 변위로 지연 1/2프레임 증거를 센다(최근 30개 창)
(2) 데드볼 가드 점수가 바뀐 뒤 다음 서브공(x 56/376, vx 0, 낙하 초기)이 보일 때까지 중립  ← 점수 상수 없음(15점제여도 안전)
(3) 랠리 감지   rallyFrameCount 감소 또는 점수합 변화
(4) 썬더        Thunder.step(s). 가드: 틱그룹≠3 → 비활성 / 첫 틱 시작위치(x=36, 지상) 아님 → 포기 /
                지연2 증거 > 지연1 증거 → 포기 / 기대 궤적과 2px 이상 어긋남 → 포기 / (노브) 스파이크 틱에 상대가 네트 앞 → 포기
(5) AC 그림자   ACCore.decide(s)를 매 틱 호출해 접촉 수·상태를 살려둔다
(6) 출력        썬더가 내면 썬더, 아니면 AC, AC가 죽으면 낙하점 걷기 폴백
                → applySkill → sanitize → ACCore.sync(최종 입력, external) → 반환
```

썬더가 포기하면 **그 틱부터** AC가 랠리를 맡는다. 어느 이유로 포기했는지는 `decide.__thunder.state`
(`IDLE / ACTIVE / NO_PLAN / NO_GROUP / ABORT_POS / ABORT_LAT / ABORT_DEVIATION / ABORT_CAMP / DONE / ERROR`)와 F12 로그로 본다.

---

## 3. 당일 노브 (§0)

| 노브 | 기본 | 언제 바꾸나 |
|---|---|---|
| `MAX_BLEND` | 0 | AC 적응 수비. 0=OFF가 미지 상대 기본(5상대 평균 상대서브 65→73%). 상대 공격 코스가 뻔히 반복되면 0.62 |
| `CAMP_ABORT_X` | 0 | 상대가 **우리 서브마다 네트 앞(x≈248)에 서서 썬더 공을 몸으로 받아내면** 262. 평소엔 끔(§5) |
| `SK` | off | 당일 스킬 규칙이 나오면 §0 일곱 줄만 채운다. 최종 출력 직전에 적용되고 그 결과가 sync된다 |
| `LAT_GUARD` | 1 | 끌 이유 없음. 지연 1프레임에서는 결과에 영향 0 |
| `SELF_CHECK` | 1 | 끌 이유 없음. 오발동 0 확인(시뮬·Chrome) |
| `DEBUG` | true | F12 로그. 랠리당 1줄이라 제출 시 true여도 무방 |

승리 점수 상수는 **없다**(v2의 `WIN_SCORE`는 규칙이 다르면 경기 중 멈추는 문제가 있어 뺐다).

**F12 로그 읽기**
- `[OurBot v4 LEFT] 썬더 발동 phase=N (TH_SEQS[i], k ticks)` — 내 서브마다 한 줄. 안 찍히면 포기 로그를 본다.
- `썬더 포기: 시작 위치 아님 / 지연 2프레임 증거 a > b / 궤적 이탈 planTick=… / 상대가 네트 앞 x=…` — 가드 발동 사유.
- `썬더 비활성: tickFrameGroupSize=N` — 틱그룹이 3이 아님(시퀀스 전제 깨짐).
- `새 스냅샷 필드: …` — 첫 틱에 규약 밖 필드(게이지 등)가 있으면 여기 찍힌다.
- `… 예외: …` — 코어 예외. 경기당 1회만 찍히고 `decide.__state.errors`에 누적.

---

## 4. 검증 기록

| 검사 | 결과 |
|---|---|
| 조립·문법 | 생성기 앵커 전부 1회 일치, `node --check` 통과 |
| 단위 (`bot-dev/v4_checks.mjs`, 합성 스냅샷) | 17/17: 틱그룹 가드, 데드볼 가드(15점제 포함), 스킬→sanitize→sync 순서(400틱 불일치 0), 깨진 스냅샷 5종 무예외, 무작위 3000 스냅샷 계약, 궤적 이탈 포기, 캠퍼 포기 |
| 회귀 (`bot-dev/lion_bench.mjs`, 10시드) | 위 1절 표. 내서브 전 상대 100% |
| 지연 2프레임 vs AC | 내서브 46.2% (v3 12.9%, v2+Saja 폴백 0%) |
| 결정 지터 2% vs AC | 내서브 89.7% |
| 15점제 | 정상 완주 |
| 실제 Chrome 자연 위상 연속 10점 경기 8판 (좌우 × 내장 AI/AC) | 내 서브 **48/48 직접 득점**, 상대 접촉 0, 포기·이탈·예외 로그 0건 |
| 입력 지연 실측 (Probe 봇, 실제 Chrome) | 무부하·8경기 동시·CPU 포화·Python 상대·메인스레드 4~16배 스로틀 전부 1프레임(200여 표본, 2프레임 0건). 봇 decide가 38ms를 넘어야 2프레임 |

---

## 5. 알려진 약점 — 네트 캠퍼

썬더 공은 스파이크 뒤 4프레임 만에 네트 너머 x≈248~252에 꽂히는데, **그 순간 x∈[216,280]에 서 있는 상대 몸에 맞는다.** 맞은 공은 상대 뒷코트로 떠오르고, 우리는 시퀀스 끝 위치(공중)에서 물러나는 중이라 상대의 스파이크를 못 받는다.

| 가상 상대 | 내서브 직접득점 | 경기 |
|---|---|---|
| 네트 앞에 서 있기만 하는 봇(랠리는 엉성) | 0/100 | 20-0 (랠리는 이김) |
| **우리 서브 때만 네트 앞에 서고 나머지는 AC인 봇** | 0/224 | **1-39** |

지금 있는 상대 봇들은 아무도 그렇게 서지 않는다(AC·Saja·v11·내장·Jayce; RedTeam만 7%). 즉 우리 썬더를 알고 일부러 만든 상대에게만 나오는 약점이다.
`CAMP_ABORT_X=262`로 켜면 그 상대에게 13% → 48%가 되지만, 보통 AC도 같은 자리에 섰다가 점프하기 때문에 켜두면 오탐으로 vs AC가 40-0 → 17-23. 그래서 기본은 끔이고 **당일에 눈으로 보고 켠다.** 근본 해결(캠퍼가 못 받는 대안 스파이크)은 다음 연구.

---

## 6. 다시 만들기·벤치 (게임 저장소 `jimin_pika`의 `bot-dev/`에서)

```
node --no-warnings build_v4.mjs                                   # AdaptiveCounter_v5_2.js + Lion_Eating_Bank_v3.js(TH_SEQS) + thunder_expect.json → ../src/code-here/Lion_Eating_Bank_v4.js
node --no-warnings v4_checks.mjs                                  # 단위 17개
node --no-warnings lion_bench.mjs ../src/code-here/Lion_Eating_Bank_v4.js ../src/code-here/AdaptiveCounter_v5_2.js   # 10시드 벤치(상대는 파일 또는 builtin)
node --no-warnings lion_bench.mjs ../src/code-here/Lion_Eating_Bank_v4.js builtin 101,202,303,404,505,606,707,808,909,1010 2 2   # 지연 2프레임
node --no-warnings lion_trace_serve.mjs ../src/code-here/Lion_Eating_Bank_v4.js ../src/code-here/Sajamokneun_v3_2.js  # 상대가 건드린 서브 랠리 추적
```

AC 원본을 고치면 생성기를 다시 돌리고 위 순서를 전부 다시 통과시킨다. 썬더 시퀀스를 바꾸면 `thunder_expect_capture.mjs`로 기대 궤적도 다시 캡처해야 한다(안 하면 생성기가 길이 불일치로 멈춘다).
