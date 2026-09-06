# 셸별 명령 — Git Bash / PowerShell / CMD

당일 본문(`tools/dayof/README.md`, `competition/DAYOF_PLAN_2026-09-05.md`)은 **Git Bash 기준**이다. Windows에서는 Git Bash가 가장 간단하다. PowerShell과 CMD를 써도 되지만 환경변수·복사·해시 문법이 다르므로 아래 형식을 사용한다.

## 1. 팀 저장소 처음 받기

### Git Bash (권장)

```bash
git clone --branch feat/selfcontained-competition-repo --single-branch https://github.com/jimin326/skku_pikachu.git
cd skku_pikachu
npm ci
node --no-warnings tools/dayof/gates.mjs bot/Lion_Eating_Bank_v12_1.js
```

### PowerShell

```powershell
git clone --branch feat/selfcontained-competition-repo --single-branch https://github.com/jimin326/skku_pikachu.git
Set-Location .\skku_pikachu
npm.cmd ci
node.exe --no-warnings tools/dayof/gates.mjs bot/Lion_Eating_Bank_v12_1.js
```

PowerShell 실행 정책이 `npm.ps1`을 막을 수 있으므로 `npm` 대신 `npm.cmd`를 사용한다.

### CMD

```bat
git clone --branch feat/selfcontained-competition-repo --single-branch https://github.com/jimin326/skku_pikachu.git
cd /d skku_pikachu
npm.cmd ci
node --no-warnings tools/dayof/gates.mjs bot/Lion_Eating_Bank_v12_1.js
```

## 2. 당일 새 레포와 ENGINE_ROOT

### Git Bash

```bash
NEW=/c/SKKU/pika/newrepo
ENGINE_ROOT="$NEW" node --no-warnings tools/dayof/gates.mjs bot/Lion_Eating_Bank_v12_1.js
```

### PowerShell

```powershell
$NEW = 'C:\SKKU\pika\newrepo'
$env:ENGINE_ROOT = $NEW
node.exe --no-warnings tools/dayof/gates.mjs bot/Lion_Eating_Bank_v12_1.js
Remove-Item Env:ENGINE_ROOT
```

### CMD

```bat
set "NEW=C:\SKKU\pika\newrepo"
set "ENGINE_ROOT=%NEW%"
node --no-warnings tools/dayof/gates.mjs bot/Lion_Eating_Bank_v12_1.js
set "ENGINE_ROOT="
```

## 3. 폴더·복사·해시

### Git Bash

```bash
mkdir -p tools/dayof/out tools/submitted
cp bot/Lion_Eating_Bank_v12_1.js "$NEW/bot/"
sha256sum bot/Lion_Eating_Bank_v12_1.js > tools/dayof/out/hashes.txt
```

### PowerShell

```powershell
New-Item -ItemType Directory -Force tools/dayof/out, tools/submitted | Out-Null
Copy-Item bot/Lion_Eating_Bank_v12_1.js (Join-Path $NEW 'bot/') -Force
Get-FileHash bot/Lion_Eating_Bank_v12_1.js -Algorithm SHA256 | Format-List | Out-File tools/dayof/out/hashes.txt
```

### CMD

```bat
if not exist bot-dev\dayof\out mkdir bot-dev\dayof\out
if not exist bot-dev\submitted mkdir bot-dev\submitted
copy /Y src\code-here\Lion_Eating_Bank_v12_1.js "%NEW%\src\code-here\"
certutil -hashfile src\code-here\Lion_Eating_Bank_v12_1.js SHA256 > bot-dev\dayof\out\hashes.txt
```

## 4. Chrome 자동 탐색 실패 시

보통은 지정할 필요 없다. 자동 탐색이 실패할 때만 설정한다.

### Git Bash

```bash
CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe" node tools/dayof/harness_dayof.mjs "$NEW" --opp Staff_v1.js
```

### PowerShell

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node.exe tools/dayof/harness_dayof.mjs $NEW --opp Staff_v1.js
Remove-Item Env:CHROME_PATH
```

### CMD

```bat
set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
node tools/dayof/harness_dayof.mjs "%NEW%" --opp Staff_v1.js
set "CHROME_PATH="
```

경로에 공백이 있으면 항상 따옴표로 감싼다. CMD에서는 `tee` 대신 `> 파일명`을 사용한다.
