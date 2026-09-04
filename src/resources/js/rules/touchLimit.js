/**
 * Touch limit -- a side loses the point if it keeps the ball on its own half
 * for too many contacts in a row.
 *
 * The original game puts no cap on this: a player can bump the ball to
 * themselves indefinitely, and two well-written bots can stall a rally for a
 * very long time that way. Capping the touches forces the ball back over the
 * net and keeps matches to a watchable length.
 *
 * Like skill/gauge.js this is a pure observer -- it reads physics state that
 * already exists and never writes to the engine. Awarding the point goes
 * through the operator console's awardPoint(), so the manual referee action
 * and this automatic rule end a rally by exactly the same path.
 */
'use strict';
import { GROUND_HALF_WIDTH } from '../physics.js';

/**
 * How many contacts one side may make before the ball has to cross the net.
 * Reached (not exceeded) is what triggers the loss, so 5 means the fifth
 * contact gives the point away. Real volleyball allows three; five is
 * deliberately loose because a bot that mishandles a receive still deserves a
 * chance to recover.
 * @constant @type {number}
 */
export const MAX_TOUCHES_PER_SIDE = 5;

/**
 * Counts consecutive contacts made on one side of the net.
 */
export class TouchLimitTracker {
  /**
   * @param {function(number): void} awardPoint called with the index of the
   *   side that should receive the point
   */
  constructor(awardPoint) {
    this.awardPoint = awardPoint;

    /** @type {number} contacts since the ball last crossed the net */
    this.touchCount = 0;
    /** @type {number|null} who made those contacts */
    this.lastToucherIndex = null;
    /** @type {boolean[]} previous tick's collision flags, for edge detection */
    this.previousCollisionFlags = [false, false];
    /**
     * Which half the ball was on last tick, or null when no rally is running.
     * @type {boolean|null}
     */
    this.previousBallIsOnLeft = null;
  }

  /** Start counting again, as if the ball had just arrived on a fresh half. */
  resetPossession() {
    this.touchCount = 0;
    this.lastToucherIndex = null;
    this.previousCollisionFlags = [false, false];
  }

  /**
   * Apply one ball contact.
   * @param {number} playerIndex 0 (left) or 1 (right)
   */
  registerTouch(playerIndex) {
    // Players cannot reach across the net (physics.js keeps each inside its
    // own half and the collision box is narrower than that gap), so this only
    // fires if the ball changed hands without the crossing being observed.
    // Treating it as a fresh possession is the safe reading.
    if (
      this.lastToucherIndex !== null &&
      this.lastToucherIndex !== playerIndex
    ) {
      this.touchCount = 0;
    }
    this.lastToucherIndex = playerIndex;
    this.touchCount += 1;

    if (this.touchCount >= MAX_TOUCHES_PER_SIDE) {
      const opponent = playerIndex === 0 ? 1 : 0;
      this.resetPossession();
      this.awardPoint(opponent);
    }
  }

  /**
   * Observe one tick. Must run after pikaVolley.gameLoop() so the collision
   * flags and ball position describe the frame that was just simulated.
   *
   * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
   */
  observe(pikaVolley) {
    // The engine only advances during round(), so nothing can be touched or
    // crossed outside it. Clearing the remembered half as well means the
    // first tick of the next rally re-establishes it instead of reading a
    // crossing that never happened.
    if (pikaVolley.state !== pikaVolley.round) {
      this.resetPossession();
      this.previousBallIsOnLeft = null;
      return;
    }

    const isOnLeft = pikaVolley.physics.ball.x < GROUND_HALF_WIDTH;
    if (
      this.previousBallIsOnLeft !== null &&
      isOnLeft !== this.previousBallIsOnLeft
    ) {
      // The ball changed halves, which is exactly what the rule asks for.
      // Counting "touches by the same player" instead would miss a ball that
      // rebounds off the net back to the side that just hit it.
      this.resetPossession();
    }
    this.previousBallIsOnLeft = isOnLeft;

    const players = [pikaVolley.physics.player1, pikaVolley.physics.player2];
    for (let i = 0; i < 2; i++) {
      const isColliding = players[i].isCollisionWithBallHappened;
      // The engine holds this flag true for as long as the ball overlaps the
      // player, so only the false -> true edge is one contact.
      if (isColliding && !this.previousCollisionFlags[i]) {
        this.registerTouch(i);
      }
      this.previousCollisionFlags[i] = isColliding;
    }
  }
}

/**
 * Wire the touch limit into the running game.
 *
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {import('@pixi/ticker').Ticker} ticker
 * @param {{awardPoint: function(number): void}} operator the operator console
 *   API, reused so an automatic point and a referee's point take the same path
 * @return {TouchLimitTracker}
 */
export function setUpTouchLimit(pikaVolley, ticker, operator) {
  const tracker = new TouchLimitTracker((side) => operator.awardPoint(side));
  // Must be wired after start() so this callback runs after the one that
  // calls pikaVolley.gameLoop(): ticker callbacks fire in registration order,
  // and the collision flags are only current once the frame has been
  // simulated.
  ticker.add(() => tracker.observe(pikaVolley));
  return tracker;
}
