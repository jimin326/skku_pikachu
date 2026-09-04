/* harness_dayof.mjs — 새 레포를 빌드해 헤드리스 Chrome 에서 우리 봇 vs 제공 봇 좌우 2경기(병렬)를 돌리고 F12 로그를 요약.
 * 사용: node bot-dev/dayof/harness_dayof.mjs <새레포 루트> --opp <제공봇.js> [--bot Lion_Eating_Bank_v12_1.js] [--speed fast] [--score 10] [--parallel 2] [--port 8765] [--max-min 14]
 *   1) 우리 봇(src/code-here/<bot>)을 새 레포 src/code-here/ 로 복사(내용이 다르면 덮어씀). 제공 봇은 새 레포에 이미 있어야 한다(<팀>_v<n>.js 규약, botRegistry 43행)
 *   2) 새 레포에서 npx webpack --config webpack.prod.js --output-path <scratch dist> (node_modules 필요, 약 10초)
 *   3) serve_static 으로 dist 를 띄우고  4) bot-dev/harness/run.mjs 실행(timing 켬)  5) 점수·시간·타이밍·오류·스킬 필드 로그 요약
 * 환경: playwright-core 는 이 저장소 devDependency를 우선 사용한다. Chrome은 일반 설치 경로를 자동 탐색하며, 필요할 때만 NODE_PATH/CHROME_PATH로 덮어쓴다.
 * 결과 bot-dev/dayof/out/chrome_<시각>.json. 소요: 10점 1세트 ≈ 6~8분(fast). --score 3 이면 연습용 1~2분.
 * 실패하면(UI id 변경 등) 수동: 새 레포 npm start → 봇 설정 좌 우리/우 제공 봇 → F12 콘솔에서 [OurBot 줄 확인 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import { spawn, spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const OPP = opt('--opp', null), BOT = opt('--bot', 'Lion_Eating_Bank_v12_1.js'), SPEED = opt('--speed', 'fast'), SCORE = Number(opt('--score', '10'));
const PAR = Number(opt('--parallel', '2')), PORT = Number(opt('--port', '8765')), MAXMIN = Number(opt('--max-min', '14'));
const REPO = path.resolve(args[0] || '.');
const die = (m) => { console.error('!! ' + m); process.exit(2); };
if (!OPP) die('--opp <제공봇.js> 가 필요 (새 레포 src/code-here 안의 파일명)');
if (!fs.existsSync(path.join(REPO, 'webpack.prod.js'))) die('새 레포에 webpack.prod.js 가 없음: ' + REPO);
if (!fs.existsSync(path.join(REPO, 'node_modules', 'webpack'))) die('새 레포에 node_modules 가 없음 → 먼저 npm install (T+0 에 백그라운드로)');
const firstExisting = (xs, probe = (x) => x) => xs.filter(Boolean).find((x) => fs.existsSync(probe(x)));
const nodeRoots = [
  ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
  path.join(ROOT, 'node_modules'),
];
const NODE_PATH = firstExisting(nodeRoots, (x) => path.join(x, 'playwright-core'));
const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const CHROME = firstExisting(chromeCandidates);
if (!NODE_PATH) die('playwright-core 를 못 찾음. 이 저장소에서 npm ci 후 재시도하거나 NODE_PATH=<node_modules> 지정');
if (!CHROME) die('Chrome/Chromium 을 못 찾음. 설치 후 CHROME_PATH=<실행 파일> 지정');
console.log(`브라우저 의존성: playwright-core=${path.join(NODE_PATH, 'playwright-core')}  chrome=${CHROME}`);
const nameOk = (f) => /^(.+)_v([^.]+)\.(js|py)$/.test(f);   // botRegistry: 마지막 '_v' 로 나눔. 버전은 '12_1' 같은 것도 허용
if (!nameOk(BOT)) die(`우리 봇 파일명이 <팀>_v<n>.js 규약이 아님: ${BOT}`);
if (!nameOk(OPP)) die(`제공 봇 파일명이 <팀>_v<n>.<js|py> 규약이 아님(드롭다운에 안 뜸): ${OPP} → 새 레포 src/code-here 에서 규약 이름으로 복사`);
const codeHere = path.join(REPO, 'src', 'code-here'); fs.mkdirSync(codeHere, { recursive: true });
const oppPath = path.join(codeHere, OPP); if (!fs.existsSync(oppPath)) die('제공 봇이 새 레포 src/code-here 에 없음: ' + oppPath);
const botSrc = path.join(ROOT, 'src', 'code-here', BOT), botDst = path.join(codeHere, BOT);
if (!fs.existsSync(botSrc)) die('우리 봇 파일이 없음: ' + botSrc);
if (!fs.existsSync(botDst) || fs.readFileSync(botDst, 'utf8') !== fs.readFileSync(botSrc, 'utf8')) { fs.copyFileSync(botSrc, botDst); console.log(`복사 ${BOT} → ${codeHere}`); } else console.log(`${BOT} 는 새 레포에 이미 같은 내용`);

const outDir = path.join(HERE, 'out'); fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dist = path.join(outDir, 'dist_' + path.basename(REPO));
console.log(`빌드: ${REPO} → ${dist}`);
const wp = path.join(REPO, 'node_modules', 'webpack', 'bin', 'webpack.js');   // npx 대신 직접 실행(셸 불필요, Windows 경고 없음)
const b = spawnSync(process.execPath, [wp, '--config', 'webpack.prod.js', '--output-path', dist], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (b.status !== 0) { console.error(b.stdout, b.stderr); die('webpack 빌드 실패'); }
console.log('빌드 완료 ' + ((b.stdout.match(/compiled .*$/m) || [''])[0]));
if (!fs.existsSync(path.join(dist, 'ko', 'index.html'))) die('dist/ko/index.html 이 없음(빌드 산출물 구조가 바뀌었나?): ' + dist);
const bots = spawnSync(process.execPath, ['-e', `const fs=require('fs');const s=fs.readdirSync(${JSON.stringify(dist)}).filter(f=>f.endsWith('.bundle.js'));let hit=[];for(const f of s){const t=fs.readFileSync(require('path').join(${JSON.stringify(dist)},f),'utf8');for(const n of [${JSON.stringify(BOT)},${JSON.stringify(OPP)}]) if(t.includes(n.replace(/\\.js$/,'')))hit.push(n);}console.log([...new Set(hit)].join(','))`], { encoding: 'utf8' }).stdout.trim();
console.log(`번들에 포함된 봇 이름: ${bots || '(확인 불가)'}`);

/* 3 정적 서버 */
const server = spawn(process.execPath, [path.join(ROOT, 'bot-dev/thunder_phase12/serve_static.mjs'), dist, String(PORT)], { stdio: 'ignore' });
const url = `http://127.0.0.1:${PORT}/ko/index.html`;
const waitUp = () => new Promise((res, rej) => { let n = 0; const t = setInterval(() => { http.get(url, (r) => { clearInterval(t); res(r.statusCode); }).on('error', () => { if (++n > 50) { clearInterval(t); rej(new Error('서버 응답 없음 ' + url)); } }); }, 200); });
try { console.log(`서버 ${url} → HTTP ${await waitUp()}`); } catch (e) { server.kill(); die(e.message); }

/* 4 하네스 */
const label = (l, r) => `${l.replace(/\.js$/, '')}L-vs-${r.replace(/\.js$/, '')}R`;
const cfg = { parallel: PAR, maxMinutes: MAXMIN, matches: [
  { label: label(BOT, OPP), left: { mode: 'bot', bot: BOT }, right: { mode: 'bot', bot: OPP }, speed: SPEED, timing: true, ...(SCORE !== 10 ? { winningScore: SCORE } : {}) },
  { label: label(OPP, BOT), left: { mode: 'bot', bot: OPP }, right: { mode: 'bot', bot: BOT }, speed: SPEED, timing: true, ...(SCORE !== 10 ? { winningScore: SCORE } : {}) },
] };
const outJson = path.join(outDir, `chrome_${stamp}.json`);
console.log(`하네스 실행(병렬 ${PAR}, ${SPEED}, ${SCORE}점, 최대 ${MAXMIN}분)…`);
const h = spawnSync(process.execPath, [path.join(ROOT, 'bot-dev/harness/run.mjs'), JSON.stringify(cfg)], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_PATH, CHROME_PATH: CHROME, GAME_URL: url, OUT: outJson }, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
server.kill();
if (h.status !== 0 || !fs.existsSync(outJson)) { console.error(h.stdout, h.stderr); die('하네스 실패 — 수동 절차(npm start + F12)로'); }

/* 5 요약 */
const res = JSON.parse(fs.readFileSync(outJson, 'utf8'));
const pick = (logs, re, n = 6) => logs.filter((l) => re.test(l)).slice(0, n);
for (const m of res) {
  console.log(`\n══ ${m.label}: 점수 ${m.score ? m.score.join(':') : '?'}  ${m.finished ? '종료' : '!! 미종료'}  ${m.seconds}s  상태 ${JSON.stringify(m.statuses)}`);
  if (m.timing) for (const side of Object.keys(m.timing)) { const t = m.timing[side]; console.log(`   ${side}: 호출 ${t.calls} p50 ${t.p50} p99 ${t.p99} max ${t.max}ms  >120ms ${t.over120}  timeouts ${t.timeouts}  invalid ${t.bad}  restarts ${t.restarts}${t.errors.length ? '  errors ' + JSON.stringify(t.errors) : ''}`); }
  const bad = pick(m.logs, /PAGEERROR|decide\(\) failed|failed|Error|error/i, 5); if (bad.length) console.log('   !! 오류 줄:\n      ' + bad.join('\n      '));
  const fields = pick(m.logs, /새 스냅샷 필드|새 필드/, 14); console.log('   새 필드 로그:' + (fields.length ? '\n      ' + fields.join('\n      ') : ' (없음)'));
  const sk = pick(m.logs, /스킬 발동/, 5); console.log('   스킬 발동:' + (sk.length ? '\n      ' + sk.join('\n      ') : ' 0'));
  const th = m.logs.filter((l) => /썬더/.test(l)); const thK = {}; for (const l of th) { const k = l.replace(/^\d+ms /, '').replace(/[-\d.]+/g, '#').slice(0, 70); thK[k] = (thK[k] || 0) + 1; }
  console.log('   썬더 로그: ' + (Object.keys(thK).length ? Object.entries(thK).map(([k, c]) => `${c}× ${k}`).join(' | ') : '없음'));
}
console.log(`\n저장 ${outJson}`);
