# skku_pikachu

2026 SKKU × HYU CSE 교류전 AI 부문 — 팀 **사자먹는은행**.

이 저장소 하나로 엔진·봇·당일 도구가 전부 돌아간다. 다른 저장소를 받을 필요 없다.

## 처음 받았을 때 (2분)

```
git clone https://github.com/jimin326/skku_pikachu.git
cd skku_pikachu
npm install
node --no-warnings bot-dev/dayof/gates.mjs src/code-here/Lion_Eating_Bank_v12_1.js
```

마지막 줄이 `게이트 전부 통과 → 제출 가능` 이면 준비 끝이다. Node 18 이상이 필요하다.

## 폴더

| 경로 | 무엇 |
|---|---|
| `competition/` | **대회 당일 폴더.** 제출 후보·후퇴판 봇과 당일 계획. 시작은 `competition/README.md` |
| `bot-dev/` | 당일 도구(엔진 diff·썬더 판정·제출 게이트·Chrome 실기·스킬 재현). 명령 순서는 `bot-dev/dayof/README.md` |
| `src/` | 게임 엔진(`resources/js/`)과 봇(`code-here/`). 빌드 대상 |
| 루트 `Lion_Eating_Bank_v*.js/.md` | 이전 버전과 설계 문서 |
| `COMPETITION_GUIDE.md` | 대회 규칙·Q&A 정리본 |

## 당일 한 줄 요약

새 레포 받기 → `bot-dev` 도구로 diff·썬더 판정 → `SK` 노브 채우기 → 시뮬(스킬 OFF/ON) → Chrome 좌우 1세트 → 게이트 전부 PASS 면 `사자먹는은행.js` 로 업로드. 하나라도 FAIL 이면 **올리지 않는다**.
