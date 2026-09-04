/* gates.mjs — 제출 게이트 일괄 실행(계획 §5). 사용: node --no-warnings bot-dev/dayof/gates.mjs <후보.js> [--base Lion_Eating_Bank_v12] [--opps OurBot_v12,NetCamper_v2] [--seeds 1] [--allow-shadow-diff "사유"] [--skip shadow,sk,rule]
 *   1 정적: 크기 ≤ 4MB · 최상위 decide · 로드 · SK 노브 값 출력
 *   2 shadow_diff: 후보 vs 기준의 x/y/hit 동일성. 기본은 불일치 0만 PASS. 당일 의도한 행동 변경은 --allow-shadow-diff "구체적 사유"로만 명시 승인
 *   3 sk_v2_test: 어댑터 기능 6 시나리오(v12_1 계열 전용; __sk 없으면 건너뜀)
 *   4 rule_check: 규칙·시간·예외 (builtin 상대 4경기)
 *   ENGINE_ROOT 가 설정돼 있으면 하위 도구에 그대로 전달된다(새 물리 위에서 게이트). 종료 코드 0 = 전부 통과 */
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const BASE = opt('--base', 'Lion_Eating_Bank_v12'), OPPS = opt('--opps', 'OurBot_v12,NetCamper_v2'), SEEDS = opt('--seeds', '1');
const ALLOW_SHADOW = opt('--allow-shadow-diff', '').trim();
const SKIP = opt('--skip', '').split(',').filter(Boolean);
const cand = args[0];
if (!cand) { console.error('usage: gates.mjs <후보.js> [--base ...]'); process.exit(2); }
const candPath = fs.existsSync(cand) ? path.resolve(cand) : path.join(ROOT, 'src/code-here', cand.endsWith('.js') ? cand : cand + '.js');
const results = []; const R = (name, ok, info) => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${info}`); };
const run = (script, a) => { const r = spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, script), ...a], { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const tail = (s, n) => s.trim().split('\n').slice(-n).map((l) => '      ' + l).join('\n');
console.log(`후보 ${candPath}\n기준 ${BASE}  상대 ${OPPS}  시드 ${SEEDS}  ENGINE_ROOT=${process.env.ENGINE_ROOT || '(기본)'}`);
if (ALLOW_SHADOW) console.log(`shadow 차이 승인 사유: ${ALLOW_SHADOW}`);

/* 1 정적 */
const src = fs.readFileSync(candPath, 'utf8');
R('크기 ≤ 4MB', src.length <= 4 * 1024 * 1024, `${(src.length / 1024).toFixed(1)} KB`);
let decide = null, loadErr = null;
try { decide = new Function(src + '\n;return (typeof decide === "function") ? decide : null;')(); } catch (e) { loadErr = e.message; }
R('로드 + 최상위 decide', !!decide, decide ? 'ok' : (loadErr || 'decide 없음'));
if (decide && decide.__sk) console.log('      SK = ' + JSON.stringify(decide.__sk));
if (decide) { const m = src.match(/^const THUNDER_SERVE = (\d)/m); console.log(`      THUNDER_SERVE = ${m ? m[1] : '?'}  DEBUG = ${(src.match(/^const DEBUG = (\w+)/m) || [])[1]}`); }

/* 2 shadow_diff */
if (!SKIP.includes('shadow')) {
  const r = run('bot-dev/v8/shadow_diff.mjs', [BASE, candPath, OPPS, SEEDS]);
  const m = r.out.match(/TOTAL calls=(\d+) mismatch=(\d+)/);
  const mismatches = m ? Number(m[2]) : -1;
  const approved = !!m && mismatches > 0 && !!ALLOW_SHADOW;
  R('shadow_diff x/y/hit 동일 vs ' + BASE, !!m && (mismatches === 0 || approved), m ? `${m[1]}틱 불일치 ${m[2]}${approved ? ` (명시 승인: ${ALLOW_SHADOW})` : ''}` : '실행 실패\n' + tail(r.out, 5));
}
/* 3 sk_v2_test */
if (!SKIP.includes('sk')) {
  if (decide && decide.__sk && decide.__skState) {
    const r = run('bot-dev/sk_v2_test.mjs', [BASE, candPath, OPPS, SEEDS]);
    R('sk_v2_test S1~S6', /ALL PASS/.test(r.out), /ALL PASS/.test(r.out) ? 'ALL PASS' : '\n' + tail(r.out.split('\n').filter((l) => /FAIL|first bad|^S\d/.test(l)).join('\n'), 12));
  } else console.log('skip  sk_v2_test (후보에 __sk/__skState 없음)');
}
/* 4 rule_check */
if (!SKIP.includes('rule')) {
  const r = run('bot-dev/rule_check.mjs', [candPath]);
  const ok = r.code === 0 && /forbidden-token lines: 0/.test(r.out) && /throws 0 invalid 0/.test(r.out) && />120ms 0/.test(r.out) && /RULE_CHECK PASS/.test(r.out);
  const stat = (r.out.match(/^\s*size .*$/m) || [''])[0];
  const line = (r.out.match(/^\s*decide: calls .*$/m) || [''])[0], ret = (r.out.match(/^\s*returns: .*$/m) || [''])[0];
  R('rule_check', ok, (stat + ' | ' + line + ' | ' + ret).trim() || '\n' + tail(r.out, 8));
}
const allOk = results.every((x) => x.ok);
console.log(allOk ? '\n게이트 전부 통과 → 제출 가능' : '\n게이트 실패 있음 → 제출 보류(동결 v12 유지)');
process.exit(allOk ? 0 : 1);
