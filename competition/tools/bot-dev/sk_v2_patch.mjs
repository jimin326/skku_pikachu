/* sk_v2_patch.mjs — 스킬 어댑터 v2 를 v12 에 적용해 v12_1 을 만든다 (bot-dev/DAYOF_PLAN_2026-09-05.md §2 P2).
 * 사용: node bot-dev/sk_v2_patch.mjs [<in.js>] [<out.js>] [--check]
 *   기본 in  = src/code-here/Lion_Eating_Bank_v12.js
 *   기본 out = src/code-here/Lion_Eating_Bank_v12_1.js
 *   --check: 앵커 존재 여부만 출력. 앵커가 정확히 1개씩이 아니면 아무것도 쓰지 않고 코드 1.
 * 채택 조건: SK.on=false 에서 v12 와 출력 동일 (node --no-warnings bot-dev/v8/shadow_diff.mjs Lion_Eating_Bank_v12 Lion_Eating_Bank_v12_1 ...)
 * 기능 검증: node --no-warnings bot-dev/sk_v2_test.mjs
 * 패치 7건:
 *   A0 머리말                — 파일명·문서 참조
 *   A1 SK 블록 v2            — key/value·owner·latch·resync 노브, skFull 숫자/boolean/객체, applySkill(s, a, owner):
 *                              owner≠SK.owner 면 무합성(썬더 보호), guard 는 공중(state 1)에만(지상 다이빙 {x,1,1} 보호), fire 는 latch 1회
 *   A2 M 상태                — 필드 로그 예산·발동 로그 수·마지막 소유자
 *   A3 logNewFields v2       — 첫 틱 요약 1줄 + 새 필드별 첫 non-null·타입 변화 최대 3회(총 12줄). 처음 null 인 claw 같은 객체의 키를 볼 수 있게
 *   A4 오케스트레이터        — applySkill 에 owner 전달, 발동 감지(fired), 발동 로그 ≤5줄, resync 노브
 *   A5 M.lastOwner 기록      — 검사 도구용
 *   A6 검사 도구 노출        — decide.__skState */
import fs from 'node:fs';
const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const inF = pos[0] || 'src/code-here/Lion_Eating_Bank_v12.js';
const outF = pos[1] || 'src/code-here/Lion_Eating_Bank_v12_1.js';
const check = args.includes('--check');
let s = fs.readFileSync(inF, 'utf8');

const P = [
  { name: 'A0 머리말',
    old: "/* Lion_Eating_Bank_v12.js — 사자먹는은행 제출 봇. v11_1 의 클린코드판(동작·출력 동일, bot-dev/v12_clean.mjs 가 v11_1 에서 생성).\n *   설계·근거·벤치·당일 절차: src/code-here/Lion_Eating_Bank_v12.md (§번호는 이 파일의 주석과 대응)",
    neu: "/* Lion_Eating_Bank_v12_1.js — 사자먹는은행 제출 봇. v12 + 스킬 어댑터 v2 (SK.on=false 면 v12 와 출력 동일. bot-dev/sk_v2_patch.mjs 가 v12 에서 생성, 손으로 고치지 말 것).\n *   어댑터 v2 노브·검증: src/code-here/Lion_Eating_Bank_v12_1.md. 그 외 설계·근거·벤치·당일 절차: Lion_Eating_Bank_v12.md (§번호는 이 파일의 주석과 대응)" },

  { name: 'A1 SK 블록 v2',
    old: "/* 스킬 어댑터(당일용). SK.on=false 면 아무 것도 안 함. 최종 출력 직전에 한 번 적용(§3). md §0.2 */\n" +
      "var SK = {\n  on:    false,\n  gauge: 'self.gauge',\n  ogauge:'opp.gauge',\n  full:  100,\n  key:   'skill',\n  fire:  0,\n  guard: 1\n};\n" +
      "function skPick(o, path) {\n  var p = path.split('.'), v = o;\n  for (var i = 0; i < p.length; i++) { if (v == null) return undefined; v = v[p[i]]; }\n  return v;\n}\n" +
      "function skFull(v) { return typeof v === 'number' && v >= SK.full; }\n" +
      "function applySkill(s, a) {\n  if (!SK.on || !a) return a;\n  try {\n" +
      "    if (SK.guard && skFull(skPick(s, SK.ogauge)) && a.hit === 1 && a.y === 1) a.y = -1;\n" +
      "    if (SK.fire && skFull(skPick(s, SK.gauge)) && a.hit === 1 && s.self.state === 1) a[SK.key] = 1;\n" +
      "  } catch (e) { }\n  return a;\n}\n",
    neu: "/* 스킬 어댑터 v2(당일용). SK.on=false 면 아무 것도 안 함 → v12 와 출력 동일. 최종 출력 직전에 소유자와 함께 한 번 적용(§3). v12_1.md §1\n" +
      " *   key/value: 제공 봇 return 문에서 복사. gauge/ogauge: 스냅샷 경로('self.claw.gauge' 처럼 중간이 null 이면 undefined → 만충 아님).\n" +
      " *   full: 숫자면 ≥full, true 면 만충, 객체면 ready/full/active 가 true 이거나 .gauge ≥ full.\n" +
      " *   owner: 이 소유자 출력에만 합성('AC'). 썬더(TH)·WAIT·FALLBACK 에는 절대 붙이지 않는다(오픈루프 시퀀스 보호).\n" +
      " *   fire: 내 게이지 만충 + 공중(state 1) + hit 틱에 반환 객체에 key=value. latch: 1 이면 만충 구간(또는 랠리)당 1회.\n" +
      " *   guard: 상대 만충이면 공중 강스매시(y=1)를 아치(y=-1)로. 검증 안 된 가설이라 기본 0. 지상(state 0)에는 적용하지 않음(다이빙 {x,1,1} 보호).\n" +
      " *   resync: 1 이면 발동 틱에 AC 공중 정책을 지워 다음 틱 재계획. AC 는 매 틱 정책을 재점수(§2.4)하므로 기본 0. */\n" +
      "var SK = {\n  on:     false,\n  key:    'skill', value: 1,\n  gauge:  'self.gauge', ogauge: 'opp.gauge',\n  full:   100,\n  owner:  'AC',\n  fire:   0, guard: 0, latch: 1, resync: 0\n};\n" +
      "var SK_ST = { latched: false, rfc: -1, fired: 0, guarded: 0 };\n" +
      "function skPick(o, path) {\n  var p = path.split('.'), v = o;\n  for (var i = 0; i < p.length; i++) { if (v == null) return undefined; v = v[p[i]]; }\n  return v;\n}\n" +
      "function skFull(v) {\n  if (typeof v === 'number') return v >= SK.full;\n  if (v === true) return true;\n" +
      "  if (v && typeof v === 'object') return v.ready === true || v.full === true || v.active === true || (typeof v.gauge === 'number' && v.gauge >= SK.full);\n  return false;\n}\n" +
      "function applySkill(s, a, owner) {\n  if (!SK.on || !a) return a;\n  try {\n" +
      "    var rfc = s.meta ? (s.meta.rallyFrameCount | 0) : 0;\n" +
      "    if (rfc < SK_ST.rfc) SK_ST.latched = false;   // 새 랠리\n" +
      "    SK_ST.rfc = rfc;\n" +
      "    var full = skFull(skPick(s, SK.gauge));\n" +
      "    if (!full) SK_ST.latched = false;             // 게이지가 만충 아래로 내려가면 latch 해제\n" +
      "    if (owner !== SK.owner) return a;\n" +
      "    /* 규칙상 금지 행동 필터는 여기에(예: 지상 점프 금지 if (s.self.state === 0 && a.y === -1) a.y = 0;) */\n" +
      "    if (SK.guard && s.self.state === 1 && a.hit === 1 && a.y === 1 && skFull(skPick(s, SK.ogauge))) { a.y = -1; SK_ST.guarded++; }\n" +
      "    if (SK.fire && full && a.hit === 1 && s.self.state === 1 && !(SK.latch && SK_ST.latched)) { a[SK.key] = SK.value; SK_ST.latched = true; SK_ST.fired++; }\n" +
      "  } catch (e) { }\n  return a;\n}\n" },

  { name: 'A2 M 상태',
    old: "  loggedFields: false, loggedError: false,\n  rallyOwner: 'AC', rallies: []",
    neu: "  loggedFields: false, loggedError: false, fieldLog: {}, fieldLogBudget: 12, skLogs: 0, lastOwner: null,\n  rallyOwner: 'AC', rallies: []" },

  { name: 'A3 logNewFields v2',
    old: "/* 새 스냅샷 필드 1회 로그(당일 스킬 필드 확인용) */\n" +
      "var KNOWN = { top: ['tick', 'side', 'self', 'opp', 'ball', 'meta', 'config'],\n" +
      "  self: ['x', 'y', 'state', 'frameNumber', 'divingDirection'],\n" +
      "  ball: ['x', 'y', 'xVelocity', 'yVelocity', 'isPowerHit', 'expectedLandingPointX'],\n" +
      "  meta: ['score', 'isPlayer2Serve', 'rallyFrameCount'], config: ['tickFrameGroupSize'] };\n" +
      "function logNewFields(s) {\n" +
      "  if (M.loggedFields) return; M.loggedFields = true;\n" +
      "  var extra = [], k, sec, secs = ['self', 'ball', 'meta', 'config'];\n" +
      "  for (k in s) if (Object.prototype.hasOwnProperty.call(s, k) && KNOWN.top.indexOf(k) < 0) extra.push(k + '=' + JSON.stringify(s[k]));\n" +
      "  for (var i = 0; i < secs.length; i++) { sec = secs[i]; if (s[sec]) for (k in s[sec]) if (Object.prototype.hasOwnProperty.call(s[sec], k) && KNOWN[sec].indexOf(k) < 0) extra.push(sec + '.' + k + '=' + JSON.stringify(s[sec][k])); }\n" +
      "  if (s.opp) for (k in s.opp) if (Object.prototype.hasOwnProperty.call(s.opp, k) && KNOWN.self.indexOf(k) < 0) extra.push('opp.' + k + '=' + JSON.stringify(s.opp[k]));\n" +
      "  console.log('[OurBot v4bc ' + s.side + '] 새 스냅샷 필드: ' + (extra.length ? extra.join(', ') : '없음'));\n" +
      "}\n",
    neu: "/* 새 스냅샷 필드 로그(당일 스킬 필드 확인용): 첫 틱에 요약 1줄, 그 뒤 새 필드마다 첫 등장·첫 non-null 값·타입 변화를 최대 3회(총 12줄).\n" +
      " *   처음 null 이던 객체(claw 등)가 나중에 채워질 때, 또는 활성 중에만 나타나는 키를 볼 수 있다. 매 틱 검사(키 ~25개, µs 단위), 예산 소진 뒤 중단. v12_1.md §2 */\n" +
      "var KNOWN = { top: ['tick', 'side', 'self', 'opp', 'ball', 'meta', 'config'],\n" +
      "  self: ['x', 'y', 'state', 'frameNumber', 'divingDirection'],\n" +
      "  ball: ['x', 'y', 'xVelocity', 'yVelocity', 'isPowerHit', 'expectedLandingPointX'],\n" +
      "  meta: ['score', 'isPlayer2Serve', 'rallyFrameCount'], config: ['tickFrameGroupSize'] };\n" +
      "function fieldType(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }\n" +
      "function fieldStr(v) { var t; try { t = JSON.stringify(v); } catch (e) { t = String(v); } return t && t.length > 160 ? t.slice(0, 160) + '…' : t; }\n" +
      "function newFieldPaths(s) {\n" +
      "  var out = [], k, sec, known, secs = ['self', 'opp', 'ball', 'meta', 'config'];\n" +
      "  for (k in s) if (Object.prototype.hasOwnProperty.call(s, k) && KNOWN.top.indexOf(k) < 0) out.push([k, s[k]]);\n" +
      "  for (var i = 0; i < secs.length; i++) {\n" +
      "    sec = secs[i]; known = KNOWN[sec === 'opp' ? 'self' : sec];\n" +
      "    if (s[sec]) for (k in s[sec]) if (Object.prototype.hasOwnProperty.call(s[sec], k) && known.indexOf(k) < 0) out.push([sec + '.' + k, s[sec][k]]);\n" +
      "  }\n" +
      "  return out;\n" +
      "}\n" +
      "function logNewFields(s) {\n" +
      "  if (M.fieldLogBudget <= 0) return;\n" +
      "  var paths = newFieldPaths(s), i, p, v, e, t, msg, first = !M.loggedFields;\n" +
      "  if (first) {\n" +
      "    M.loggedFields = true;\n" +
      "    var extra = [];\n" +
      "    for (i = 0; i < paths.length; i++) extra.push(paths[i][0] + '=' + fieldStr(paths[i][1]));\n" +
      "    console.log('[OurBot v4bc ' + s.side + '] 새 스냅샷 필드: ' + (extra.length ? extra.join(', ') : '없음'));\n" +
      "  }\n" +
      "  for (i = 0; i < paths.length; i++) {\n" +
      "    p = paths[i][0]; v = paths[i][1]; t = fieldType(v); e = M.fieldLog[p]; msg = null;\n" +
      "    if (!e) { e = M.fieldLog[p] = { n: 0, nonNull: v != null, type: t }; if (first) continue; msg = '첫 등장'; }\n" +
      "    else if (!e.nonNull && v != null) { e.nonNull = true; msg = '첫 non-null'; }\n" +
      "    else if (t !== e.type) msg = '타입 ' + e.type + '→' + t;\n" +
      "    e.type = t;\n" +
      "    if (msg === null || e.n >= 3) continue;\n" +
      "    e.n++; M.fieldLogBudget--;\n" +
      "    console.log('[OurBot v4bc ' + s.side + '] 새 필드 ' + p + ' ' + msg + ' tick=' + s.tick + ': ' + fieldStr(v));\n" +
      "    if (M.fieldLogBudget <= 0) return;\n" +
      "  }\n" +
      "}\n" },

  { name: 'A4 오케스트레이터',
    old: "  /* 스킬 적용 뒤 sanitize; SK.key 는 sanitize 가 버리므로 따로 복사(엔진은 추가 키를 무시) */\n" +
      "  var fin = pre;\n" +
      "  try { var skA = applySkill(s, { x: pre.x, y: pre.y, hit: pre.hit }) || pre; fin = sanitize(skA); if (SK.on && skA[SK.key]) fin[SK.key] = skA[SK.key]; } catch (e) { M.errors.skill++; fin = pre; }\n" +
      "  var external = owner !== 'AC' || fin.x !== pre.x || fin.y !== pre.y || fin.hit !== pre.hit;\n",
    neu: "  /* 스킬 어댑터 v2: 소유자를 넘겨 SK.owner('AC') 출력에만 합성. sanitize 가 SK.key 를 버리므로 따로 복사(엔진은 추가 키를 무시). 발동 로그 Worker 당 ≤5줄 */\n" +
      "  var fin = pre, fired = false;\n" +
      "  try {\n" +
      "    var skA = applySkill(s, { x: pre.x, y: pre.y, hit: pre.hit }, owner) || pre;\n" +
      "    fin = sanitize(skA);\n" +
      "    if (SK.on && skA[SK.key] !== undefined) { fin[SK.key] = skA[SK.key]; fired = true; }\n" +
      "  } catch (e) { M.errors.skill++; fin = pre; fired = false; }\n" +
      "  if (fired && DEBUG && M.skLogs < 5) { M.skLogs++; console.log('[OurBot v4bc ' + s.side + '] 스킬 발동 tick=' + s.tick + ' ' + SK.key + '=' + fieldStr(fin[SK.key]) + ' gauge=' + fieldStr(skPick(s, SK.gauge)) + ' state=' + s.self.state); }\n" +
      "  var external = (fired && SK.resync === 1) || owner !== 'AC' || fin.x !== pre.x || fin.y !== pre.y || fin.hit !== pre.hit;\n" },

  { name: 'A5 M.lastOwner',
    old: "  M.prev2Out = M.lastOut; M.lastOut = fin; M.lastSelfX = selfX; M.lastSelfY = s.self.y; M.lastState = s.self.state;\n",
    neu: "  M.prev2Out = M.lastOut; M.lastOut = fin; M.lastSelfX = selfX; M.lastSelfY = s.self.y; M.lastState = s.self.state; M.lastOwner = owner;\n" },

  { name: 'A6 검사 도구 노출',
    old: "decide.__sk = SK;",
    neu: "decide.__sk = SK;\ndecide.__skState = SK_ST;" },
];

const count = (t) => s.split(t).length - 1;
let bad = false;
for (const p of P) {
  const applied = count(p.neu) === 1 && count(p.old) === 0, pending = count(p.old) === 1;
  console.log(`${p.name}: ${applied ? 'already applied' : pending ? 'ready' : 'ANCHOR MISSING (old=' + count(p.old) + ', new=' + count(p.neu) + ')'}`);
  if (!applied && !pending) bad = true;
}
if (bad) process.exit(1);
if (check) process.exit(0);
let n = 0;
for (const p of P) if (count(p.old) === 1) { s = s.replace(p.old, p.neu); n++; }
/* 잔여 참조 검사: 옛 시그니처·옛 노브가 남아 있으면 실패 */
const leftovers = ['applySkill(s, { x: pre.x, y: pre.y, hit: pre.hit })', 'guard: 1\n'].filter((t) => s.includes(t));
if (leftovers.length) { console.error('잔여 참조:', leftovers); process.exit(1); }
fs.writeFileSync(outF, s);
console.log(`${outF}: ${n} patch(es) written from ${inF}`);
