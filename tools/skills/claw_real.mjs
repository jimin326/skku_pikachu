/* skills/claw_real.mjs — 2026-09-05 공개된 새 레포(leonyi-volleyball-skill)의 skill/gauge.js·skill/claw.js 를 **그대로** sim_real 에 붙인 훅.
 * 가짜 규칙(today.mjs)이 아니라 실제 게이지·발톱 코드가 돈다. ENGINE_ROOT 가 새 레포여야 한다.
 * 실행: ENGINE_ROOT=<새레포> node --no-warnings tools/eval_skill_real.mjs ./skills/claw_real.mjs Lion_Eating_Bank_v14 skill-example_v1 3
 *
 * 실게임 배선(skill/setup.js)과 같은 순서로 재현한다:
 *   - 봇 응답의 skillX(숫자) → 응답당 1회 pending (botInput.js pendingSkillX / consumeSkillX)
 *   - 매 프레임 물리 스텝 뒤: gauge.observe → castForBots(pending 소모 → tryCast) → claw.observe(예고 카운트다운·타격)
 *   - 스냅샷: self/opp.gauge, self/opp.claw(시전자 기준), self/opp.lyingDownDurationLeft, config.gauge/claw (bot/botContract.js)
 * rally.js isRallyLive 는 pikaVolley.state === pikaVolley.round 등을 보므로 RealGame 의 문자열 상태를 같은 이름의 값으로 비춘다.
 * 집계(ctx.g): fires = 봇이 skillX 를 낸 응답 수, consumed = 실제 시전(게이지 지불) 수, hits = 기절 적중, wasted = 빗나감 */
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = (() => {
  const cands = [];
  if (process.env.ENGINE_ROOT) { const r = path.resolve(process.env.ENGINE_ROOT); cands.push(r, path.join(r, 'src')); }
  for (const c of cands) if (fs.existsSync(path.join(c, 'resources/js/skill/claw.js'))) return c;
  throw new Error('claw_real.mjs: ENGINE_ROOT 에 resources/js/skill/claw.js 가 없다(새 레포를 가리켜야 함): ' + cands.join(' | '));
})();
const eng = (p) => import(pathToFileURL(path.join(ROOT, 'resources/js', p)).href);
const { GaugeTracker, GAUGE_SNAPSHOT_CONFIG } = await eng('skill/gauge.js');
const { ClawTracker, CLAW_SNAPSHOT_CONFIG } = await eng('skill/claw.js');
const CONFIG = Object.freeze({ gauge: GAUGE_SNAPSHOT_CONFIG, claw: CLAW_SNAPSHOT_CONFIG });
export const CFG = { source: 'ENGINE_ROOT skill/gauge.js + skill/claw.js', claw: CLAW_SNAPSHOT_CONFIG, gauge: GAUGE_SNAPSHOT_CONFIG };
const idx = (side) => (side === 'LEFT' ? 0 : 1);
const view = (c) => (c ? { centerX: c.centerX, framesUntilStrike: c.framesUntilStrike, framesLeftActive: c.framesLeftActive } : null);
/* pikavolley.js 공개 필드 중 gauge.js·claw.js·rally.js 가 읽는 것만 */
function shim(game) {
  return {
    round: 'round', startOfNewGame: 'startOfNewGame',
    get state() { return game.state; },
    get roundEnded() { return game.roundEnded; },
    get gameEnded() { return game.gameEnded; },
    get physics() { return game.physics; },
  };
}
export default {
  init(ctx, game) {
    ctx.gauge = new GaugeTracker(); ctx.claw = new ClawTracker(ctx.gauge); ctx.shim = shim(game);
    ctx.pending = [null, null];
    ctx.g = { fires: 0, consumed: 0, hits: 0, wasted: 0, castsBy: [0, 0], hitsBy: [0, 0], wastedBy: [0, 0] };   // *By = 시전자(player index) 별
  },
  extend(snap, side, game, ctx) {
    const i = idx(side), pl = [game.physics.player1, game.physics.player2];
    snap.self.gauge = ctx.gauge.gauges[i]; snap.opp.gauge = ctx.gauge.gauges[1 - i];
    snap.self.claw = view(ctx.claw.claws[i]); snap.opp.claw = view(ctx.claw.claws[1 - i]);
    snap.self.lyingDownDurationLeft = pl[i].lyingDownDurationLeft; snap.opp.lyingDownDurationLeft = pl[1 - i].lyingDownDurationLeft;
    snap.config.gauge = CONFIG.gauge; snap.config.claw = CONFIG.claw;
  },
  filterInput(side, action, game, ctx) {
    /* botInput.js readBotSkillX: 숫자·유한이면 코트 안으로 클램프, 응답당 1회. 큐의 action 객체는 응답당 하나이므로 첫 프레임에 읽고 지운다 */
    const i = idx(side);
    if (action && typeof action.skillX === 'number' && Number.isFinite(action.skillX)) {
      ctx.pending[i] = Math.max(0, Math.min(432, action.skillX)); delete action.skillX; ctx.g.fires++;
    }
    return action;
  },
  observe(game, ctx) {
    const sh = ctx.shim;
    ctx.gauge.observe(sh);
    for (let i = 0; i < 2; i++) {
      if (ctx.pending[i] === null) continue;
      const x = ctx.pending[i]; ctx.pending[i] = null;
      if (ctx.claw.tryCast(i, sh, x)) { ctx.g.consumed++; ctx.g.castsBy[i]++; }
    }
    const striking = ctx.claw.claws.map((c) => !!c && c.framesUntilStrike === 1);
    ctx.claw.observe(sh);
    for (let i = 0; i < 2; i++) {
      if (!striking[i]) continue;
      const v = i === 0 ? game.physics.player2 : game.physics.player1;
      if (v.state === 4 && v.lyingDownDurationLeft === CLAW_SNAPSHOT_CONFIG.stunFrames - 2) { ctx.g.hits++; ctx.g.hitsBy[i]++; } else { ctx.g.wasted++; ctx.g.wastedBy[i]++; }
    }
    return null;
  },
};
