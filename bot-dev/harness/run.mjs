// 실제 대회 게임(webpack 빌드)을 헤드리스 크롬에서 자동 진행하는 검증 하네스.
// 사용: node run.mjs '<json config>'   또는   node run.mjs preset
//   config: { matches: [{ label, left:{mode,bot}, right:{mode,bot}, speed }], parallel, maxMinutes }
import { createRequire } from 'module';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); }
  catch (e) { return require('playwright-core'); }
})();
import fs from 'fs';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8765/ko/index.html';

async function runMatch(browser, m, maxMs) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();
  // 느린 대회 머신 모사: CPU_THROTTLE=4 이면 DevTools CPU 스로틀 4배(렌더러 프로세스 전체, Worker 포함)
  if (Number(process.env.CPU_THROTTLE) > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE) });
  }
  const logs = [];
  const openedAt = Date.now();
  page.on('console', (msg) => {
    const t = msg.text();
    if (/\[OurBot|\[PROBE|\[ThunderRecovery|\[HARNESS|\[bot |Error|error/.test(t)) {
      logs.push(`${Date.now() - openedAt}ms ${t}`);
    }
  });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    const overlay = document.getElementById('webpack-dev-server-client-overlay');
    if (overlay) overlay.remove();
  });
  // 첫 화면의 '게임 시작' 버튼을 눌러야 로더가 돌고 setup()이 실행됨
  await page.click('#close-about-btn', { force: true });
  try {
    await page.waitForSelector('#bot-setup-btn:not([disabled])', { timeout: 30000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      readyState: document.readyState,
      botSetupDisabled: document.getElementById('bot-setup-btn')?.disabled,
      body: document.body?.innerText?.slice(0, 2000),
    }));
    console.error(JSON.stringify({ browserInitFailure: diagnostic, logs }, null, 2));
    throw error;
  }
  // 속도 옵션(medium=25fps 기본, fast=30fps)
  if (m.speed) await page.evaluate((sp) => document.getElementById(`${sp}-speed-btn`).click(), m.speed);
  // 봇 설정 패널
  await page.click('#bot-setup-btn');
  for (const side of ['left', 'right']) {
    const cfg = m[side];
    await page.click(`#bot-setup-${side}-mode [data-mode="${cfg.mode}"]`);
    if (cfg.mode === 'bot') await page.selectOption(`#bot-setup-${side}-bot`, cfg.bot);
  }
  await page.click('#bot-setup-apply-btn');
  await page.waitForFunction(() => document.getElementById('bot-loading-box').classList.contains('hidden'), null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const statuses = await page.evaluate(() => [document.getElementById('bot-setup-left-status').textContent, document.getElementById('bot-setup-right-status').textContent]);
  await page.click('#bot-setup-close-btn');
  // timing: 봇 워커 요청→응답 왕복시간(=BOT_RESPONSE_TIMEOUT_MS 타이머가 재는 값)·타임아웃·무효응답·재시작 집계
  if (m.timing === true) {
    await page.evaluate(() => {
      window.__botTiming = {};
      const valid = (a) => !!a && (a.x === -1 || a.x === 0 || a.x === 1) && (a.y === -1 || a.y === 0 || a.y === 1) && (a.hit === 0 || a.hit === 1);
      const hooked = [false, false];
      const startedAt = Date.now();
      window.__botTimingTimer = setInterval(() => {
        const game = window.__pikaVolley;
        ['left', 'right'].forEach((side, index) => {
          if (hooked[index]) return;
          const input = game?.keyboardArray?.[index];
          if (!input || typeof input.spawnWorker !== 'function') return;
          hooked[index] = true;
          const stats = { durs: [], timeouts: 0, bad: 0, restarts: 0, errors: [] };
          window.__botTiming[side] = stats;
          const hookWorker = () => {
            const worker = input.worker; if (!worker || worker.__timed) return;
            worker.__timed = true;
            const sent = new Map();
            const post = worker.postMessage.bind(worker);
            worker.postMessage = (msg, tr) => { if (msg && msg.type === 'tick') sent.set(msg.requestId, performance.now()); return tr === undefined ? post(msg) : post(msg, tr); };
            const onmsg = worker.onmessage;
            worker.onmessage = (ev) => {
              const d = ev.data;
              if (d && d.type === 'result') {
                const t = sent.get(d.requestId);
                if (t !== undefined) { stats.durs.push(performance.now() - t); sent.delete(d.requestId); }
                if (!valid(d.action)) { stats.bad++; if (stats.errors.length < 3) stats.errors.push(String(d.error || JSON.stringify(d.action))); }
              }
              return onmsg(ev);
            };
          };
          hookWorker();
          const origSpawn = input.spawnWorker.bind(input);
          input.spawnWorker = () => { stats.restarts++; origSpawn(); hookWorker(); };
          const origTimeout = input.handleTimeout.bind(input);
          input.handleTimeout = (id) => { if (id === input.pendingRequestId) stats.timeouts++; return origTimeout(id); };
        });
        if ((hooked[0] && hooked[1]) || Date.now() - startedAt > 60000) clearInterval(window.__botTimingTimer);
      }, 0);
    });
  }
  if (m.serveSide === 'left' || m.serveSide === 'right') {
    await page.evaluate((side) => {
      window.__pikaVolley.decideNextServe = () => side === 'right';
    }, m.serveSide);
  }
  if (Number.isInteger(m.winningScore) && m.winningScore > 0) {
    await page.evaluate((score) => {
      window.__pikaVolley.winningScore = score;
    }, m.winningScore);
  }
  if (m.traceTouches === true) {
    await page.evaluate(() => {
      const game = window.__pikaVolley;
      const physics = game.physics;
      const run = physics.runEngineForNextFrame.bind(physics);
      let frame = 0;
      let previous = [false, false];
      physics.runEngineForNextFrame = (inputs) => {
        const landed = run(inputs);
        frame++;
        const players = [physics.player1, physics.player2];
        players.forEach((player, index) => {
          const current = player.isCollisionWithBallHappened === true;
          if (current && !previous[index]) {
            console.log(`[HARNESS] touch side=${index === 0 ? 'left' : 'right'} frame=${frame} power=${physics.ball.isPowerHit ? 1 : 0} x=${physics.ball.x} y=${physics.ball.y}`);
          }
          previous[index] = current;
        });
        if (landed) {
          console.log(`[HARNESS] landed frame=${frame} x=${physics.ball.x}`);
          frame = 0;
          previous = [false, false];
        }
        return landed;
      };
    });
  }
  if (m.forceOpeningPhase === 0 || m.forceOpeningPhase === 1 || m.forceOpeningPhase === 2) {
    const forceSide = m.forceOpeningSide || (m.left.mode === 'bot' ? 'left' : 'right');
    await page.evaluate(({ side, phase }) => {
      const index = side === 'right' ? 1 : 0;
      const desiredTick = phase === 0 ? 2 : (phase === 1 ? 0 : 1);
      window.__forceOpeningPhaseTimer = setInterval(() => {
        const game = window.__pikaVolley;
        const input = game?.keyboardArray?.[index];
        if (!input || typeof input.spawnWorker !== 'function' || input.__openingPhaseForced) return;
        console.log(`[HARNESS] forcing phase=${phase} beforeTick=${input.tick}`);
        input.__openingPhaseForced = true;
        game.paused = true;
        input.spawnWorker();
        input.tick = desiredTick;
        input.rallyFrameCount = 0;
        input.previousScoreTotal = 0;
        input.latestAction = { x: 0, y: 0, hit: 0 };
        console.log(`[HARNESS] forced tick=${input.tick}`);
        game.scores[0] = 0;
        game.scores[1] = 0;
        game.roundEnded = false;
        game.gameEnded = false;
        game.slowMotionFramesLeft = 0;
        game.slowMotionNumOfSkippedFrames = 0;
        game.isPlayer2Serve = index === 1;
        game.physics.player1.initializeForNewRound();
        game.physics.player2.initializeForNewRound();
        game.physics.ball.initializeForNewRound(game.isPlayer2Serve);
        game.state = game.round;
        clearInterval(window.__forceOpeningPhaseTimer);
        window.__forceOpeningPhaseReadyTimer = setInterval(() => {
          if (!input.workerReady) return;
          clearInterval(window.__forceOpeningPhaseReadyTimer);
          const worker = input.worker;
          const postMessage = worker.postMessage.bind(worker);
          let tracedSnapshots = 0;
          worker.postMessage = (message, transfer) => {
            if (message?.type === 'tick' && tracedSnapshots < 12) {
              const ball = message.snapshot.ball;
              console.log(`[HARNESS] snapshot tick=${message.snapshot.tick} x=${ball.x} y=${ball.y} vx=${ball.xVelocity} vy=${ball.yVelocity}`);
              tracedSnapshots++;
            }
            return transfer === undefined ? postMessage(message) : postMessage(message, transfer);
          };
          console.log(`[HARNESS] worker ready tick=${input.tick}`);
          game.paused = false;
        }, 0);
      }, 0);
    }, { side: forceSide, phase: m.forceOpeningPhase });
  }
  if (Number.isInteger(m.tickOffset) && m.tickOffset !== 0) {
    const tickOffsetSide = m.tickOffsetSide || (m.left.mode === 'bot' ? 'left' : 'right');
    await page.evaluate(({ side, offset }) => {
      const index = side === 'right' ? 1 : 0;
      window.__botTickOffsetTimer = setInterval(() => {
        const input = window.__pikaVolley?.keyboardArray?.[index];
        if (!input || typeof input.tick !== 'number' || input.__harnessTickOffsetApplied) return;
        input.tick += offset;
        input.__harnessTickOffsetApplied = true;
        clearInterval(window.__botTickOffsetTimer);
      }, 0);
    }, { side: tickOffsetSide, offset: m.tickOffset });
  }
  // 인트로 → 메뉴 → 게임 (P1 파워히트 키 Z)
  // 키는 한 프레임(40ms) 이상 눌러야 인식됨(getInput이 프레임마다 keydown 상태를 샘플링)
  const pressZ = async () => { await page.keyboard.down('z'); await page.waitForTimeout(150); await page.keyboard.up('z'); };
  // 팀 라벨이 뜨면(=경기 시작) 멈추고, 아니면 1초 간격으로 최대 6번 Z
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    const started = await page.evaluate(() => document.getElementById('team-label-left').textContent !== '');
    if (started) break;
    await pressZ();
  }
  const t0 = Date.now(); let last = ''; const timeline = [];
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(1000);
    const text = (await page.textContent('#operator-status')) || '';
    if (text !== last) { last = text; timeline.push(`${((Date.now() - t0) / 1000) | 0}s ${text}`); }
    if (text.includes('경기 종료')) break;
  }
  let timing = null;
  if (m.timing === true) {
    timing = await page.evaluate(() => {
      const out = {};
      for (const side of Object.keys(window.__botTiming || {})) {
        const s = window.__botTiming[side]; const d = s.durs.slice().sort((a, b) => a - b);
        const q = (p) => (d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(2) : null);
        out[side] = { calls: d.length, p50: q(0.5), p99: q(0.99), max: d.length ? +d[d.length - 1].toFixed(2) : null, over120: d.filter((x) => x > 120).length, over360: d.filter((x) => x > 360).length, timeouts: s.timeouts, bad: s.bad, restarts: s.restarts, errors: s.errors };
      }
      return out;
    });
  }
  await ctx.close();
  const mm = last.match(/(\d+)\s*:\s*(\d+)/);
  return { label: m.label, left: m.left, right: m.right, speed: m.speed || 'medium', score: mm ? [Number(mm[1]), Number(mm[2])] : null, finished: last.includes('경기 종료'), timing, seconds: ((Date.now() - t0) / 1000) | 0, statuses, timeline, logs };
}

const PRESETS = {
  v9: { parallel: 4, maxMinutes: 14, matches: [
    { label: 'v9L-vs-AI-a', left: { mode: 'bot', bot: 'OurBot_v9.js' }, right: { mode: 'ai' } },
    { label: 'v9L-vs-AI-b', left: { mode: 'bot', bot: 'OurBot_v9.js' }, right: { mode: 'ai' } },
    { label: 'AI-vs-v9R-a', left: { mode: 'ai' }, right: { mode: 'bot', bot: 'OurBot_v9.js' } },
    { label: 'AI-vs-v9R-b', left: { mode: 'ai' }, right: { mode: 'bot', bot: 'OurBot_v9.js' } } ] },
  v8: { parallel: 4, maxMinutes: 14, matches: [
    { label: 'v8L-vs-AI-a', left: { mode: 'bot', bot: 'OurBot_v8.js' }, right: { mode: 'ai' } },
    { label: 'v8L-vs-AI-b', left: { mode: 'bot', bot: 'OurBot_v8.js' }, right: { mode: 'ai' } },
    { label: 'AI-vs-v8R-a', left: { mode: 'ai' }, right: { mode: 'bot', bot: 'OurBot_v8.js' } },
    { label: 'AI-vs-v8R-b', left: { mode: 'ai' }, right: { mode: 'bot', bot: 'OurBot_v8.js' } } ] },
  smoke: { matches: [{ label: 'v9L-vs-AI', left: { mode: 'bot', bot: 'OurBot_v9.js' }, right: { mode: 'ai' } }], parallel: 1, maxMinutes: 12 },
  probe: { matches: [{ label: 'probeL-vs-AI', left: { mode: 'bot', bot: 'Probe_v1.js' }, right: { mode: 'ai' } }], parallel: 1, maxMinutes: 6 },
};
const arg = process.env.HARNESS_CONFIG || process.argv[2] || 'smoke';
const cfg = PRESETS[arg] || JSON.parse(arg);
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const results = [];
const queue = [...cfg.matches];
const workers = Array.from({ length: cfg.parallel || 1 }, async () => {
  while (queue.length) { const m = queue.shift(); const r = await runMatch(browser, m, (cfg.maxMinutes || 12) * 60000); results.push(r); console.log(JSON.stringify({ label: r.label, score: r.score, finished: r.finished, seconds: r.seconds, statuses: r.statuses, nlogs: r.logs.length })); }
});
await Promise.all(workers);
await browser.close();
const out = process.env.OUT || `results_${Date.now()}.json`;
fs.writeFileSync(out, JSON.stringify(results, null, 1));
console.log('saved', out);
