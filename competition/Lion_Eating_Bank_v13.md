# Lion_Eating_Bank_v13 — v12 + 플레이어 물리 예측 수정 3건 (2026-09-05)

`Lion_Eating_Bank_v13.js` 는 v12 에서 아래 세 곳만 고친 파일이다. `Lion_Eating_Bank_v13_1.js` 는 v13 + 스킬 어댑터 v2 로,
`node bot-dev/sk_v2_patch.mjs src/code-here/Lion_Eating_Bank_v13.js src/code-here/Lion_Eating_Bank_v13_1.js` 가 만든다(손으로 고치지 말 것).
그 외 설계·노브·당일 절차는 `Lion_Eating_Bank_v12.md` / `Lion_Eating_Bank_v12_1.md` 그대로다.

출처: 외부 리뷰(2026-09-05, v12_1 최종 제출 리뷰)의 F1~F4. 네 건 모두 엔진 소스(physics.js, botInput.js) 대조와 재현으로 사실 확인.
F1~F3 은 v2 이후 전 버전이 공유하던 결함이며, 검증 상대 봇(AdaptiveCounter_v5_2·NetCamper_v2)도 같은 코드를 쓴다. v12 로 되돌려도 해결되지 않는다.

## 수정 내용

| # | 위치 | 문제 | 수정 |
|---|---|---|---|
| F2 | `microSim` / `microSimSeq` 착지 분기 | `futureY < 244` 가 아니면 즉시 착지. 엔진은 `> 244` 일 때만 착지하고 정확히 244 인 프레임은 공중(state·vy 유지, 파워히트 가능). 모든 점프의 마지막 프레임이 여기 해당 | 엔진과 같은 `else if (futureY > 244)` |
| F1 | `estimateMyVy` | 스냅샷은 그 프레임 물리 전에 찍히고 응답은 다음 프레임부터 적용되므로 이륙 후 첫 스냅샷은 공중 2프레임뿐. 공식 `dy/d + (d+1)/2` 는 3프레임 가정이라 이륙 스냅샷을 100% 오추정(y=213 → -8.33, 실제 -14). 소수가 `microSim` 초기 vy 로 들어감 | 공중 (y, vy) 는 항상 점프 포물선 `RX_JUMP` 위의 점. 공식 결과가 표의 쌍이면 채택(정점 통과 포함), 아니면 상승부에서 y 로 역조회. y=244 공중 프레임은 16 |
| F3 | `kgOppMotion` state 4 | 누운 상대를 첫 스텝에 "닿을 수 없음"(`ys: []`)으로 처리. 엔진은 state 4 에도 충돌 판정을 해 몸이 공을 튕김 → 확정킬 판정이 낙관적 | 누운 동안 몸(y 244) 접촉 유지, 이동·점프·다이빙은 일어난 뒤(lie+2 스텝)부터 |
| F4 | `bot-dev/rule_check.mjs` (도구) | `return null` 봇이 게이트 통과. 엔진은 null 을 malformed 와 같이 취급(중립 입력 대체 + 경고) | null 도 invalid 로 계산. 오케스트레이터가 삼킨 내부 예외(`decide.__state.errors`)도 0 이어야 PASS |

`bot-dev/sk_v2_patch.mjs` 는 머리말(A0) 앵커를 입력 파일에서 읽도록 바꿔 v13 에도 붙는다. v12 → v12_1 결과는 종전과 바이트 동일.

## 검증 (2026-09-05, 이 저장소 엔진)

- 재현 검사(실게임 4경기·좌우·builtin/NetCamper): 이륙 스냅샷 vy 오추정 v12 139/139 → v13 0/132. 공중 스냅샷 불일치 v12 205/1601 → v13 49/1522(전부 득점 직후 슬로모션 구간, 랠리 중 0). y=244 프레임 파워히트: 두 예측기 모두 엔진과 일치(vx 10, vy 0). 누운 상대 1프레임 뒤 접촉: 도달 판정 true.
- 게이트 `node --no-warnings bot-dev/dayof/gates.mjs src/code-here/Lion_Eating_Bank_v13_1.js --base Lion_Eating_Bank_v13`: 5개 PASS (shadow 불일치 0, sk_v2_test S1~S6 ALL PASS, rule_check throws 0 invalid 0, >120ms 0, 내부 예외 0).
- v13 vs v12 shadow_diff: 2269틱 중 46틱 출력 다름(의도한 변경). thunder_check: THUNDER_SERVE=1 유지(표 80/80 일치).
- 대결(sim_real, 10점 선취): v13 vs v12 **10-0 (L 5-0 / R 5-0)**, 역할 교체 0-10. v12 자기대전은 L 3-0 / R 0-3 이었으므로 오른쪽에서도 이기는 것이 차이. vs AdaptiveCounter_v5_2·NetCamper_v2·OurBot_v12: v12·v13 모두 6-0 으로 같음.
- Chrome 실기(v13 vs OurBot_v12, 3점 좌우): 3:0 / 0:3, timeouts 0, invalid 0, >120ms 0, 예외 0.
- 도구 F4: `return null` 봇·throw 봇 → 게이트 FAIL(종료 코드 1).
- 한계: 시드 5개 결과라 표본이 작다. 4분 시간 규칙은 시뮬에 없다. 단계별(F1/F2/F3 각각) 기여는 측정하지 않았다.

## 당일 사용

v12_1 대신 v13_1 을 쓰면 `bot-dev/dayof/README.md` 명령의 `Lion_Eating_Bank_v12_1` 을 `Lion_Eating_Bank_v13_1` 로 바꾸고, 게이트에는 `--base Lion_Eating_Bank_v13` 을 붙인다
(기본 기준 v12 와는 46틱이 다르므로 그대로 두면 shadow FAIL). `SK` 노브(33~40행)와 `THUNDER_SERVE`(14행)는 v12_1 과 같은 줄이다. 후퇴판은 그대로 사이트의 v12.
