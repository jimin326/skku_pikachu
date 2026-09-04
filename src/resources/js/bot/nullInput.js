/**
 * A no-op input source. Used for the "built-in AI" slot in the Bot Test
 * Setup panel (testSetup.js): when `player.isComputer === true`, the engine
 * overwrites whatever is in this tick's userInput with the built-in AI's
 * decision anyway (physics.js processPlayerMovementAndSetPlayerPosition),
 * so this side's keyboardArray slot just needs *something* with a
 * getInput() method -- it never needs to produce real values.
 */
'use strict';
import { PikaUserInput } from '../physics.js';

export class NullInput extends PikaUserInput {
  getInput() {
    // Intentionally does nothing; xDirection/yDirection/powerHit stay at
    // the neutral defaults set by the PikaUserInput constructor.
  }
}
