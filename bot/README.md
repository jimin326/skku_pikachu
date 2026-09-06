# bot/ — 봇 풀

도구(`tools/`)는 봇을 **이름만 주면 이 폴더에서** 찾는다(`Lion_Eating_Bank_v15` → `bot/Lion_Eating_Bank_v15.js`). 경로를 주면 어디든 된다.

| 파일 | 무엇 |
|---|---|
| `submitted/사자먹는은행_v1.js` | **실제 제출본.** 유래·손편집 내역·검증: `submitted/SUBMISSION.md` |
| `Lion_Eating_Bank_v15.js` / `.md` | v13 + 발톱 스킬만 얹은 최소 수정판(회피 + 낙하점 시전). 사후 비교 최강 |
| `Lion_Eating_Bank_v14.js` / `.md` | 같은 발톱 정책을 v13_1(어댑터 v2) 위에 얹은 판. 제출본의 원본. 공개 규칙 정리는 이 md |
| `Lion_Eating_Bank_v13.js` / `.md` | v12 + 외부 리뷰 F1~F3 물리 예측 수정. v14/v15 의 shadow_diff 기준 |
| `Lion_Eating_Bank_v13_1.js` | v13 + 스킬 어댑터 v2 (`tools/sk_v2_patch.mjs` 생성) |
| `Lion_Eating_Bank_v12.js` / `.md` | 대회 전 기준판(v11_1 클린코드판). **설계·근거·벤치 문서의 본체** |
| `Lion_Eating_Bank_v12_1.js` / `.md` | v12 + 어댑터 v2. 어댑터 노브 표 |
| `OurBot_v12.js`, `NetCamper_v2.js`, `AdaptiveCounter_v5_2.js` | 검증 상대 봇(게이트·썬더 검사 기본 상대) |
| `skill-example_v1.js` | 주최 측 제공 예제 봇(발톱 사용). 발톱 벤치 상대 |
| `archive/` | v1 ~ v11 과 그 설계 문서, 실험 봇(OurBot_v11, ThunderRecovery_v1, Probe_v1) |

계보: v1(썬더 서브) → v3(3위상) → v4(밴딧·이탈) → v5_2(상태 인지 도달 모델) → v8~v10(수비 위치·넘기기 시뮬) → v11(썬더 리시브, FLY-3) → v12(클린코드) → v13(물리 수정) → v14/v15(발톱) → 제출본.
