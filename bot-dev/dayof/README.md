# 당일 도구 묶음 `bot-dev/dayof/` — 60분 명령 순서

계획 본문: `competition/DAYOF_PLAN_2026-09-05.md` §3(판단 트리)·§4(시간표)·§5(게이트). 여기는 **Git Bash 명령**만 적는다. PowerShell·CMD는 `bot-dev/dayof/SHELL_COMMANDS.md`. 경로는 이 저장소 루트에서 실행 기준. `<NEW>` = 당일 새 레포 루트.

## 사전 준비(전날)
- v12 를 사이트에 올려 둔다(베이스라인). 당일 게이트 실패 시 후퇴 = "새 파일을 안 올린다".
- Chrome 실기 도구: `playwright-core`는 `npm ci`로 함께 설치된다. Chrome/Chromium은 일반 설치 경로를 자동 탐색하고, 못 찾을 때만 `CHROME_PATH`를 지정한다.
- 이 저장소는 `npm ci`가 끝나 있어야 함(하네스·sim_real은 여기서 돈다). 새 레포도 `npm install` 필요(빌드용).

## T+0 (전원) — 받기·동결
```
git clone <새 레포 URL> <NEW>      또는 zip 해제
(cd <NEW> && npm install)          # 백그라운드. 5~10분 걸릴 수 있음. Chrome 실기 전까지만 끝나면 됨
cp src/code-here/Lion_Eating_Bank_v12_1.js <NEW>/src/code-here/
sha256sum src/code-here/Lion_Eating_Bank_v12_1.js <NEW>/src/code-here/*.js > bot-dev/dayof/out/hashes.txt
```
제공 봇 파일명이 `<팀>_v<n>.js` 가 아니면 새 레포 `src/code-here/` 에 규약 이름으로 복사(드롭다운 등록 조건).

## T+3 (A·C) — 무엇이 바뀌었나
```
node bot-dev/dayof/diff_engine.mjs <NEW>            # 상수표·핵심 파일 diff·skill/ 전문·제공 봇 return 줄. out/diff_*.txt 에 저장
node bot-dev/dayof/diff_engine.mjs <NEW> --full     # diff 전체가 필요할 때
```
읽는 순서: §5 제공 봇 return 줄 → §4 skill/setup.js → gauge.js → §1 botContract/botInput diff → physics diff → §0 상수표.
5줄 시트에 기록: ① 새 필드 이름·위치·타입·범위 ② 충전·만충·리셋 ③ 발동 키·값·소모 엣지(입력/접촉) ④ 효과·지속 ⑤ 규칙상 실점 행동.

## T+8 (A) — 새 물리 위에서 기준 벤치, (B) 노브 채우기, (C) 실기 1회
```
ENGINE_ROOT=<NEW> node --no-warnings bot-dev/eval_skill_real.mjs ./skills/today.mjs Lion_Eating_Bank_v12_1 OurBot_v12 1      # 스킬 훅 없이도 새 물리로 돈다
node --no-warnings bot-dev/dayof/thunder_check.mjs <NEW>                                                                    # THUNDER_SERVE 판정(불일치 0 이어야 유지)
node bot-dev/dayof/harness_dayof.mjs <NEW> --opp <제공봇.js>                                                                 # 빌드 + Chrome 좌우 2경기(병렬) + F12 요약. 6~8분
```
B: `Lion_Eating_Bank_v12_1.js` 33~40행 `SK` 에 key·value·gauge·ogauge·full 채우고 `on: true, fire: 0`. `THUNDER_SERVE`(14행)는 thunder_check 결과대로. 자세한 복붙 절차는 `competition/DAYOF_PLAN_2026-09-05.md` §4.1.

## T+15 (A) — 스킬 재현
- 새 레포 `skill/setup.js` 가 `setUpSkill(pikaVolley, ticker, operator)` 꼴이면 `bot-dev/skills/today.mjs` 의 `init` 에서 shim 으로 직접 호출(파일 머리말 예시). 필드명이 다르면 `bot-dev/sim_real.mjs` 의 `pikaVolleyShim` 에 getter 추가.
- 아니면 `today.mjs` 의 `CFG`(TYPE A/B/C, KEY, FULL, CHARGE, PRESS_CONSUME…)만 규칙에 맞춘다.
```
ENGINE_ROOT=<NEW> node --no-warnings bot-dev/eval_skill_real.mjs ./skills/today.mjs Lion_Eating_Bank_v12_1 OurBot_v12 2 --sk on=1,fire=0
ENGINE_ROOT=<NEW> node --no-warnings bot-dev/eval_skill_real.mjs ./skills/today.mjs Lion_Eating_Bank_v12_1 OurBot_v12 2 --sk on=1,fire=1
```
fire 1 이 0 보다 나쁘거나 같으면 fire 0. 유형별 한 줄 수정은 계획 §3 표.

## T+35 (C) — 후보 실기
```
node bot-dev/dayof/harness_dayof.mjs <NEW> --opp <제공봇.js>                 # 후보를 항상 새로 빌드한 뒤 검사
```

## T+45 (C) — 게이트 + 제출
```
ENGINE_ROOT=<NEW> node --no-warnings bot-dev/dayof/gates.mjs src/code-here/Lion_Eating_Bank_v12_1.js
mkdir -p bot-dev/submitted && cp src/code-here/Lion_Eating_Bank_v12_1.js bot-dev/submitted/사자먹는은행_$(date +%H%M).js
```
전부 PASS 일 때만 `사자먹는은행.js` 로 업로드. 하나라도 FAIL 이면 올리지 않는다(사이트의 v12 가 그대로 쓰임).
의도적으로 `THUNDER_SERVE`·REACT·MARGIN 등을 바꿔 shadow 차이가 난 경우, `git diff -- src/code-here/Lion_Eating_Bank_v12_1.js`로 변경 범위를 확인한 뒤에만 게이트 명령에 `--allow-shadow-diff "변경값: 근거"`를 추가한다.

## 막혔을 때
- 하네스가 UI 요소를 못 찾음(새 레포 UI 변경) → 새 레포에서 `npm start`, 봇 설정 좌 v12_1 / 우 제공 봇, F12 에서 `[OurBot` 줄 확인.
- `새 스냅샷 필드: 없음` 인데 문서엔 필드가 있다 → 필드가 활성 중에만 생기는지 확인(`새 필드 … 첫 등장` 줄이 나중에 찍힘). 페이지 새로고침 후 Apply.
- thunder_check 불일치 → `THUNDER_SERVE = 0`. 미련 두지 않는다.
- 봇 예외(`decide() failed`) → 대개 새 필드 접근. `SK.gauge` 경로 오타부터 확인.
- 시간 부족 → `fire: 0` 관측판(어댑터 on, 발동 없음) 또는 v12 유지.
