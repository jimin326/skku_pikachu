/**
 * Operator console -- the tournament staff's manual override panel.
 *
 * A match can go wrong in ways the game has no concept of: the page is
 * reloaded mid-match and the score has to be rebuilt, a foul is called, a bot
 * wedges the rally. The referee needs to put the game back where it belongs
 * without restarting the whole match.
 *
 * Score editing and rally advancing are deliberately separate buttons.
 * Rebuilding a 7:5 scoreline means pressing "+1" twelve times, and ending
 * twelve rallies along the way would be nonsense; conversely a foul call
 * ("point to the left, play on") needs both. So the two primitives stay apart
 * and {@link awardPoint} composes them for callers that want both at once --
 * which is what the touch-limit rule will use.
 *
 * Like bot/testSetup.js and skill/setup.js, this is assembly-layer code: it
 * drives PikachuVolleyball through its own public fields and never reaches
 * into the physics engine.
 */
'use strict';

/** @typedef {import('../pikavolley.js').PikachuVolleyball} PikachuVolleyball */

/** @constant @type {number} left player's index in scores/keyboardArray */
export const LEFT = 0;
/** @constant @type {number} right player's index in scores/keyboardArray */
export const RIGHT = 1;

/**
 * Is a match actually in progress?
 *
 * A match runs round <-> afterEndOfRound <-> beforeStartOfNextRound; anything
 * else is intro/menu, where there is no rally to advance. Same predicate
 * bot/testSetup.js uses to decide when bots may hold the keyboard slots.
 *
 * @param {PikachuVolleyball} pikaVolley
 * @return {boolean}
 */
function isDuringMatch(pikaVolley) {
  return (
    pikaVolley.state === pikaVolley.round ||
    pikaVolley.state === pikaVolley.afterEndOfRound ||
    pikaVolley.state === pikaVolley.beforeStartOfNextRound
  );
}

/**
 * Bring the game-over flags in line with whatever the scores now say.
 *
 * Called after every score edit so that "+1 onto match point" finishes the
 * match with the proper winner motion, and "-1" taken back off match point
 * returns to a live match instead of leaving the game stuck on the end
 * screen. The engine only promotes a player into the win/lose state
 * (physics.js, state 5/6) and never demotes them, so undoing has to reset
 * those states here.
 *
 * @param {PikachuVolleyball} pikaVolley
 */
function syncGameEndState(pikaVolley) {
  const player1 = pikaVolley.physics.player1;
  const player2 = pikaVolley.physics.player2;
  const player1Won = pikaVolley.scores[LEFT] >= pikaVolley.winningScore;
  const player2Won = pikaVolley.scores[RIGHT] >= pikaVolley.winningScore;
  const ended = player1Won || player2Won;

  if (ended === pikaVolley.gameEnded) {
    return;
  }

  pikaVolley.gameEnded = ended;
  player1.gameEnded = ended;
  player2.gameEnded = ended;
  player1.isWinner = ended && player1Won;
  player2.isWinner = ended && player2Won;

  if (!ended) {
    // Drop the victory/defeat animation the engine already started.
    if (player1.state === 5 || player1.state === 6) {
      player1.state = 0;
      player1.frameNumber = 0;
    }
    if (player2.state === 5 || player2.state === 6) {
      player2.state = 0;
      player2.frameNumber = 0;
    }
    // drawGameEndMessage turns the "GAME END" sprite on at frameCounter 0 and
    // never turns it off; the engine only clears it by hiding the whole
    // GameView (initializeVisibles) on the way back to the intro. Undoing the
    // game end skips that path, so the sprite has to be cleared here or it
    // stays burned into the middle of the next match.
    pikaVolley.view.game.messages.gameEnd.visible = false;
  }
  // round() counts this up while showing the game-end message, so it has to
  // start from zero in both directions.
  pikaVolley.frameCounter = 0;
}

/**
 * Add to (or subtract from) one side's score without touching the rally.
 *
 * Clamped to 0..winningScore, which is the range the game itself can produce:
 * a rally that reaches the winning score ends the match, so there is no such
 * thing as a score above it. Without the upper clamp, holding "+1" past match
 * point keeps counting into numbers the two-digit scoreboard cannot show while
 * the match is already over.
 *
 * @param {PikachuVolleyball} pikaVolley
 * @param {number} side {@link LEFT} or {@link RIGHT}
 * @param {number} delta usually +1 or -1
 */
export function adjustScore(pikaVolley, side, delta) {
  const next = pikaVolley.scores[side] + delta;
  pikaVolley.scores[side] = Math.min(
    pikaVolley.winningScore,
    Math.max(0, next)
  );
  pikaVolley.view.game.drawScoresToScoreBoards(pikaVolley.scores);
  syncGameEndState(pikaVolley);
}

/**
 * Cut the current rally short and move on to the next one, with the referee
 * naming who serves it.
 *
 * Mirrors what round() does once the ball hits the ground: set the server,
 * mark the round ended, skip the slow-motion replay, and hand over to
 * afterEndOfRound, which fades out and sets up the serve. Outside a match
 * (intro/menu) and after game over there is no rally to end, so this does
 * nothing.
 *
 * Setting the server is not optional. round() re-decides it on every point, so
 * a rally ended here instead would otherwise leave the serve wherever it last
 * landed -- pressing "next rally" repeatedly keeps handing the serve back to
 * the same side. There are two entry points on the panel for exactly this
 * choice: two buttons name the server directly (for judgement calls where the
 * referee has already decided who gets the ball) and a third defers to
 * {@link PikachuVolleyball#decideNextServe} so the serve is drawn under the
 * match's own serve rule -- meant for restarts where a coin flip is fairer
 * than a call.
 *
 * @param {PikachuVolleyball} pikaVolley
 * @param {boolean} nextServeIsPlayer2 true to give the serve to the right side
 * @return {boolean} whether a rally was actually ended
 */
export function forceNextRound(pikaVolley, nextServeIsPlayer2) {
  if (!isDuringMatch(pikaVolley) || pikaVolley.gameEnded === true) {
    return false;
  }
  pikaVolley.isPlayer2Serve = nextServeIsPlayer2;
  pikaVolley.roundEnded = true;
  pikaVolley.slowMotionFramesLeft = 0;
  pikaVolley.slowMotionNumOfSkippedFrames = 0;
  pikaVolley.frameCounter = 0;
  pikaVolley.state = pikaVolley.afterEndOfRound;
  return true;
}

/**
 * Give one side a point and end the rally -- the entry point the touch-limit
 * rule calls.
 *
 * Picks the server through {@link PikachuVolleyball#decideNextServe}, exactly
 * as round() does when a ball hits the ground: a point won by a rule is a
 * normal point, so it must follow the match's serve rule rather than being
 * decided by hand. (The referee's "random serve" button goes the same route,
 * but the two left/right buttons name it directly.)
 *
 * @param {PikachuVolleyball} pikaVolley
 * @param {number} side {@link LEFT} or {@link RIGHT}
 */
export function awardPoint(pikaVolley, side) {
  adjustScore(pikaVolley, side, 1);
  forceNextRound(pikaVolley, pikaVolley.decideNextServe(side === RIGHT));
}

/**
 * Put both scores back to 0:0, leaving the rally alone.
 * @param {PikachuVolleyball} pikaVolley
 */
export function resetScores(pikaVolley) {
  pikaVolley.scores[LEFT] = 0;
  pikaVolley.scores[RIGHT] = 0;
  pikaVolley.view.game.drawScoresToScoreBoards(pikaVolley.scores);
  syncGameEndState(pikaVolley);
}

/**
 * @return {{
 *   openBtn: Element, box: Element, closeBtn: Element, status: Element,
 *   leftPlusBtn: Element, leftMinusBtn: Element,
 *   rightPlusBtn: Element, rightMinusBtn: Element,
 *   nextRoundLeftBtn: Element, nextRoundRightBtn: Element,
 *   nextRoundRandomBtn: Element, resetBtn: Element,
 * }|null} null when this locale's HTML has no operator console markup
 */
function collectElements() {
  const openBtn = document.getElementById('operator-btn');
  const box = document.getElementById('operator-box');
  if (!openBtn || !box) {
    return null;
  }
  return {
    openBtn,
    box,
    closeBtn: document.getElementById('operator-close-btn'),
    status: document.getElementById('operator-status'),
    leftPlusBtn: document.getElementById('operator-left-plus-btn'),
    leftMinusBtn: document.getElementById('operator-left-minus-btn'),
    rightPlusBtn: document.getElementById('operator-right-plus-btn'),
    rightMinusBtn: document.getElementById('operator-right-minus-btn'),
    nextRoundLeftBtn: document.getElementById('operator-next-round-left-btn'),
    nextRoundRightBtn: document.getElementById('operator-next-round-right-btn'),
    nextRoundRandomBtn: document.getElementById(
      'operator-next-round-random-btn'
    ),
    resetBtn: document.getElementById('operator-reset-btn'),
  };
}

/**
 * Wire up the operator console panel.
 *
 * @param {PikachuVolleyball} pikaVolley
 * @param {import('@pixi/ticker').Ticker} ticker
 * @return {{
 *   adjustScore: function(number, number): void,
 *   forceNextRound: function(boolean): boolean,
 *   awardPoint: function(number): void,
 *   resetScores: function(): void,
 * }} bound helpers, so game rules implemented elsewhere can award points
 *   without knowing about the panel
 */
export function setUpOperatorConsole(pikaVolley, ticker) {
  const api = {
    adjustScore: (side, delta) => adjustScore(pikaVolley, side, delta),
    forceNextRound: (nextServeIsPlayer2) =>
      forceNextRound(pikaVolley, nextServeIsPlayer2),
    awardPoint: (side) => awardPoint(pikaVolley, side),
    resetScores: () => resetScores(pikaVolley),
  };

  const els = collectElements();
  if (!els) {
    // Markup not present in this locale's HTML -- the helpers above still
    // work, there is just no panel to drive them by hand.
    return api;
  }
  // @ts-ignore -- matches how main.js enables the other menu-bar buttons
  els.openBtn.disabled = false;

  els.openBtn.addEventListener('click', () => {
    els.box.classList.remove('hidden');
  });
  els.closeBtn.addEventListener('click', () => {
    els.box.classList.add('hidden');
  });

  els.leftPlusBtn.addEventListener('click', () => api.adjustScore(LEFT, 1));
  els.leftMinusBtn.addEventListener('click', () => api.adjustScore(LEFT, -1));
  els.rightPlusBtn.addEventListener('click', () => api.adjustScore(RIGHT, 1));
  els.rightMinusBtn.addEventListener('click', () => api.adjustScore(RIGHT, -1));
  els.nextRoundLeftBtn.addEventListener('click', () =>
    api.forceNextRound(false)
  );
  els.nextRoundRightBtn.addEventListener('click', () =>
    api.forceNextRound(true)
  );
  // Defers to the match's own serve rule so under RANDOM (the tournament
  // default) this is a coin flip, but under WINNER/LOSER it still follows that
  // rule -- otherwise the button would silently break whichever policy the
  // match was configured with. The `false` placeholder mirrors the initial
  // serve call in round(): it is only read under WINNER/LOSER, and there is
  // no "previous winner" to consult here.
  els.nextRoundRandomBtn.addEventListener('click', () =>
    api.forceNextRound(pikaVolley.decideNextServe(false))
  );
  els.resetBtn.addEventListener('click', () => api.resetScores());

  // The score can change without the operator touching anything (a rally
  // ends), so the readout and the button states are refreshed from the game
  // rather than written at click time. Greying a button out is how the
  // operator sees that "+1" is capped at match point and that there is no
  // rally to skip on the intro/menu screen -- otherwise a dead click looks
  // like the console is broken.
  let previousText = '';
  ticker.add(() => {
    const text =
      `${pikaVolley.scores[LEFT]} : ${pikaVolley.scores[RIGHT]}` +
      (pikaVolley.gameEnded ? ' (경기 종료)' : '');
    if (text !== previousText) {
      els.status.textContent = text;
      previousText = text;
    }
    const atMax = (side) => pikaVolley.scores[side] >= pikaVolley.winningScore;
    // @ts-ignore -- these are buttons
    els.leftPlusBtn.disabled = atMax(LEFT);
    // @ts-ignore
    els.rightPlusBtn.disabled = atMax(RIGHT);
    // @ts-ignore
    const noRallyToEnd =
      !isDuringMatch(pikaVolley) || pikaVolley.gameEnded === true;
    // @ts-ignore
    els.nextRoundLeftBtn.disabled = noRallyToEnd;
    // @ts-ignore
    els.nextRoundRightBtn.disabled = noRallyToEnd;
    // @ts-ignore
    els.nextRoundRandomBtn.disabled = noRallyToEnd;
  });

  return api;
}
