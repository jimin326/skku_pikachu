/* diff_engine.mjs — 당일 새 레포와 우리 엔진(src/resources/js)을 비교해 "무엇이 바뀌었나"를 한 화면에.
 * 사용: node bot-dev/dayof/diff_engine.mjs <새레포 루트 또는 그 src> [--full] [--ours <우리 레포 루트>]
 * 출력 순서(계획 §4 T+3, B1 표 대조용):
 *   0 상수 비교(물리·틱·타임아웃·5터치)   1 핵심 파일 diff 줄 수 + 통합 diff(파일당 120줄, --full 전부)
 *   2 새 레포에만 있는 파일(skill/ 등)·우리에만 있는 파일   3 claw|gauge|skill grep   4 skill/setup.js·skill/gauge.js 전문
 *   5 새 레포 src/code-here 의 낯선 봇(제공 스킬 봇): return 줄·스킬 관련 줄
 * 결과는 화면 + bot-dev/dayof/out/diff_<시각>.txt */
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const FULL = args.includes('--full');
const OURS = path.resolve(opt('--ours') || path.join(HERE, '..', '..'));
const target = args.find((a) => !a.startsWith('--') && a !== opt('--ours'));
if (!target) { console.error('usage: node bot-dev/dayof/diff_engine.mjs <새레포 루트 또는 src> [--full]'); process.exit(2); }
const srcOf = (root) => { for (const c of [root, path.join(root, 'src')]) if (fs.existsSync(path.join(c, 'resources/js/physics.js'))) return c; return null; };
const THEIRS = srcOf(path.resolve(target)), OURSRC = srcOf(OURS);
if (!THEIRS) { console.error('새 레포에서 resources/js/physics.js 를 못 찾음: ' + target); process.exit(2); }
const out = []; const P = (s = '') => { out.push(s); console.log(s); };
const jsDir = (s) => path.join(s, 'resources/js');
const walk = (dir, base = dir, acc = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, base, acc); else acc.push(path.relative(base, p).replace(/\\/g, '/')); } return acc; };
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const git = (a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const H = (t) => { P(); P('═'.repeat(8) + ' ' + t + ' ' + '═'.repeat(Math.max(0, 70 - t.length))); };

P(`우리: ${OURSRC}`); P(`새 레포: ${THEIRS}`);

/* 0 상수 */
H('0. 상수 비교 (B1 표)');
const CONSTS = [
  ['physics.js', ['GROUND_WIDTH', 'PLAYER_LENGTH', 'PLAYER_TOUCHING_GROUND_Y_COORD', 'BALL_RADIUS', 'BALL_MAX_Y_VELOCITY', 'BALL_TOUCHING_GROUND_Y_COORD', 'NET_PILLAR_HALF_WIDTH', 'NET_PILLAR_TOP_TOP_Y_COORD', 'NET_PILLAR_TOP_BOTTOM_Y_COORD', 'INFINITE_LOOP_LIMIT']],
  ['bot/botContract.js', ['TICK_FRAME_GROUP_SIZE', 'BOT_RESPONSE_TIMEOUT_MS', 'MAX_CONSECUTIVE_TIMEOUTS_BEFORE_RESTART', 'NORMAL_FPS']],
  ['rules/touchLimit.js', ['MAX_TOUCHES_PER_SIDE']],
];
const constOf = (src, name) => { if (!src) return '(파일 없음)'; const m = src.match(new RegExp('(?:export\\s+)?const\\s+' + name + '\\s*=\\s*([^;]+);')); return m ? m[1].trim() : '(없음)'; };
for (const [f, names] of CONSTS) {
  const a = read(path.join(jsDir(OURSRC), f)), b = read(path.join(jsDir(THEIRS), f));
  for (const n of names) { const va = constOf(a, n), vb = constOf(b, n); P(`${(va === vb ? '  ' : '!!')} ${f.padEnd(22)} ${n.padEnd(40)} 우리 ${va.padEnd(28)} 새 ${vb}`); }
}
/* 물리 안의 인라인 상수(걷기 6·점프 -16·중력 +1·파워히트 공식) 는 diff 로 본다. 핵심 토큰 존재 여부만 표시 */
const physB = read(path.join(jsDir(THEIRS), 'physics.js')) || '';
for (const tok of ['xDirection * 6', 'yVelocity = -16', '* 10;', 'Math.abs(ball.yVelocity) * userInput.yDirection * 2', 'BALL_MAX_Y_VELOCITY']) P(`  physics.js 토큰 '${tok}': ${physB.includes(tok) ? '있음' : '!! 없음(공식 변경 가능성)'}`);

/* 1 핵심 파일 diff */
H('1. 핵심 파일 diff');
const KEY = ['physics.js', 'rand.js', 'pikavolley.js', 'main.js', 'bot/botContract.js', 'bot/botInput.js', 'bot/botWorker.js', 'bot/botWorkerPython.js', 'bot/botRegistry.js', 'bot/testSetup.js', 'rules/touchLimit.js', 'operator/console.js'];
const diffs = [];
for (const f of KEY) {
  const a = path.join(jsDir(OURSRC), f), b = path.join(jsDir(THEIRS), f);
  if (!fs.existsSync(b)) { P(`!! ${f}: 새 레포에 없음`); continue; }
  if (!fs.existsSync(a)) { P(`!! ${f}: 우리에 없음`); continue; }
  const r = git(['diff', '--no-index', '--numstat', '--', a, b]);
  const m = (r.stdout || '').match(/^(\d+)\t(\d+)\t/);
  if (!m) { P(`   ${f.padEnd(26)} 동일`); continue; }
  P(`!! ${f.padEnd(26)} +${m[1]} -${m[2]}`); diffs.push(f);
}
for (const f of diffs) {
  const r = git(['diff', '--no-index', '-U2', '--', path.join(jsDir(OURSRC), f), path.join(jsDir(THEIRS), f)]);
  const lines = (r.stdout || '').split('\n').slice(4);
  P(); P(`── diff ${f} (${lines.length}줄${FULL || lines.length <= 120 ? '' : ', 앞 120줄. --full 로 전부'}) ──`);
  for (const l of (FULL ? lines : lines.slice(0, 120))) P(l);
}

/* 2 파일 목록 차이 */
H('2. 파일 목록 차이 (resources/js)');
const oursFiles = new Set(walk(jsDir(OURSRC))), theirsFiles = new Set(walk(jsDir(THEIRS)));
const onlyTheirs = [...theirsFiles].filter((f) => !oursFiles.has(f)).sort(), onlyOurs = [...oursFiles].filter((f) => !theirsFiles.has(f)).sort();
P('새 레포에만: ' + (onlyTheirs.length ? '' : '없음')); for (const f of onlyTheirs) P('  + ' + f + `  (${fs.statSync(path.join(jsDir(THEIRS), f)).size}B)`);
P('우리에만: ' + (onlyOurs.length ? onlyOurs.join(', ') : '없음'));

/* 3 grep */
H('3. claw | gauge | skill grep (새 레포 resources/js)');
let hits = 0;
for (const f of [...theirsFiles].sort()) {
  if (!/\.(js|mjs|py|json|md)$/.test(f)) continue;
  const lines = read(path.join(jsDir(THEIRS), f)).split('\n');
  lines.forEach((l, i) => { if (/claw|gauge|skill/i.test(l) && hits < 200) { hits++; P(`  ${f}:${i + 1}: ${l.trim().slice(0, 160)}`); } });
}
if (!hits) P('  (없음)');

/* 4 skill 모듈 전문 */
H('4. skill/ 모듈 전문');
const skillFiles = onlyTheirs.filter((f) => /^skill\//.test(f));
if (!skillFiles.length) P('  skill/ 디렉터리 없음 — 3 의 grep 결과로 위치를 찾을 것');
for (const f of skillFiles) { P(); P(`── ${f} ──`); for (const l of read(path.join(jsDir(THEIRS), f)).split('\n')) P(l); }

/* 5 제공 봇 */
H('5. 새 레포 src/code-here 의 낯선 봇 (제공 스킬 봇 후보)');
const ch = (s) => path.join(s, 'code-here');
const ourBots = fs.existsSync(ch(OURSRC)) ? new Set(fs.readdirSync(ch(OURSRC))) : new Set();
const theirBots = fs.existsSync(ch(THEIRS)) ? fs.readdirSync(ch(THEIRS)).filter((f) => /\.(js|py)$/.test(f) && !ourBots.has(f)) : [];
if (!theirBots.length) P('  없음');
for (const f of theirBots) {
  const src = read(path.join(ch(THEIRS), f)), lines = src.split('\n');
  P(); P(`── ${f} (${lines.length}줄, ${src.length}B) ${/^(.+)_v(\d+)\.(js|py)$/.test(f) ? '' : '!! 파일명이 <팀>_v<n>.<js|py> 규약이 아님 → 드롭다운에 안 뜸'} ──`);
  let n = 0; lines.forEach((l, i) => { if (/\breturn\b/.test(l) && /hit|\{|dict/.test(l) && n < 40) { n++; P(`  ${String(i + 1).padStart(4)}: ${l.trim().slice(0, 200)}`); } });
  P('  -- 스킬 관련 줄 --'); n = 0; lines.forEach((l, i) => { if (/claw|gauge|skill/i.test(l) && n < 40) { n++; P(`  ${String(i + 1).padStart(4)}: ${l.trim().slice(0, 200)}`); } });
}
H('끝');
const outDir = path.join(HERE, 'out'); fs.mkdirSync(outDir, { recursive: true });
const of = path.join(outDir, `diff_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`);
fs.writeFileSync(of, out.join('\n')); console.log('saved ' + of);
