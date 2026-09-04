# [폐기] 대회 당일 3시간 런북 → 1시간 판으로 대체됨 (2026-09-05)

이 파일은 **v9 템플릿·3시간·LLM 미사용** 전제로 쓴 옛 런북이었다. 규칙이 바뀌어(스킬 공개 → 첫 경기 **1시간**, LLM 팀당 3회·300자) 더 이상 맞지 않고, 참조하던 봇(`OurBot_v9.js`)도 없다. 다른 문서가 이 파일명을 가리키고 있어 이름만 남긴다.

## 대신 볼 것
| 무엇 | 어디 |
|---|---|
| 계획 전체: 두 예측 문서 대조 · 스킬 유형별 판단 트리(v12 줄 번호) · 60분 시간표(A/B/C 역할) · 제출 게이트 · 중단 조건 · LLM 3회 초안 | `bot-dev/DAYOF_PLAN_2026-09-05.md` §3~§6 |
| 당일 **명령 순서**(T+0 ~ 제출, 막혔을 때) | `bot-dev/dayof/README.md` |
| 당일 도구: 새 레포 diff · 썬더 유지/끄기 판정 · 제출 게이트 · Chrome 실기 | `bot-dev/dayof/diff_engine.mjs` · `thunder_check.mjs` · `gates.mjs` · `harness_dayof.mjs` |
| 스킬 재현(실게임 흐름, 새 물리 위에서) | `bot-dev/eval_skill_real.mjs` + `bot-dev/skills/today.mjs` (`ENGINE_ROOT=<새레포>`) |
| 제출 후보와 어댑터 노브 채우는 순서 | `src/code-here/Lion_Eating_Bank_v12_1.js` 33~40행 `SK`, `Lion_Eating_Bank_v12_1.md` §1·§4 |
| **처음 하는 사람용 스텝 바이 스텝(명령 복붙)** | `bot-dev/DAYOF_PLAN_2026-09-05.md` §4.1 |
| 실패 모드별 손 절차(노브·한 줄 수정, v11 줄 번호) | `bot-dev/V11_VERIFY_REPORT_2026-09-05.md` B4 — 줄 번호는 `DAYOF_PLAN` §3 표의 v12 번호를 쓴다 |

## 옛 런북에서 그대로 유효한 원칙
- 규칙 공개 직후 5줄(새 필드 / 충전 / 발동 / 효과 / 지속)을 정확한 이름·숫자로 받아적는다. 모르면 "모름"이라 쓰고 F12 로 확인한다.
- 시간이 없으면 규칙 재현을 포기하고 검증된 판(동결 v12)을 낸다. 스킬 대응은 "안 하면 불리"일 뿐 "안 하면 죽는" 게 아니다.
- 제출 뒤 코드 수정 금지. 제출본은 `bot-dev/submitted/` 에 사본을 둔다.

옛 3시간 절차(v9 템플릿 `skillPolicy`, `render9.mjs`, `search9.mjs`)는 Git 이력(`git log -- bot-dev/RUNBOOK_당일.md`)에서 볼 수 있다.
