/**
 * The View part in the MVC pattern
 *
 * Some codes in this module were gained by reverse engineering the original machine code.
 * The codes gained by reverse engineering are commented by the address of the function referred to in the machine code.
 * ex) FUN_00405d50 means the function at the address 00405d50 in the machine code.
 */
'use strict';
import { AnimatedSprite } from '@pixi/sprite-animated';
import { Sprite } from '@pixi/sprite';
import { Container } from '@pixi/display';
import { Texture } from '@pixi/core';
import { Cloud, Wave, cloudAndWaveEngine } from './cloud_and_wave.js';
import { ASSETS_PATH } from './assets_path.js';

/** @typedef {import('@pixi/loaders').LoaderResource} LoaderResource */
/** @typedef {import('@pixi/core').Texture} Texture */

const TEXTURES = ASSETS_PATH.TEXTURES;

/**
 * @constant @type {number}
 * Ratio between the physics coordinate system (the original 432x304 integer
 * pixel space, see docs/agent-dev/CONTRACTS.md 1.2) and the view coordinate
 * system. The physics engine is never scaled -- only what gets drawn is.
 *
 * Hybrid scaling policy (adopted from the pengsoo reference source-map):
 *   - Character/ball/number/message assets are authored at RATIO scale, so
 *     `new Sprite(texture)` renders at the intended on-screen size directly.
 *   - Background tiles (sky/ground/net/shadow) and the menu backdrop are
 *     shipped at 1x, so each Sprite gets `.scale.x = .scale.y = RATIO`
 *     applied at construction to bring them up to the same visual scale.
 * Hard-coded layout numbers and values coming out of the physics/cloud models
 * are always multiplied by RATIO.
 */
const RATIO = ASSETS_PATH.RATIO;

/** @constant @type {number} number of clouds to be rendered */
const NUM_OF_CLOUDS = 10;

/**
 * Class representing intro view where the man with a briefcase mark appears
 */
export class IntroView {
  /**
   * Create an IntroView object
   * @param {Object.<string,LoaderResource>} resources loader.resources
   */
  constructor(resources) {
    const textures = resources[ASSETS_PATH.SPRITE_SHEET].textures;

    this.mark = makeSpriteWithAnchorXY(textures, TEXTURES.MARK, 0.5, 0.5);
    this.mark.x = (RATIO * 432) / 2;
    this.mark.y = (RATIO * 304) / 2;

    this.container = new Container();
    this.container.addChild(this.mark);
  }

  /** @return {boolean} Is visible? */
  get visible() {
    return this.container.visible;
  }

  /** @param {boolean} bool Is visible? */
  set visible(bool) {
    this.container.visible = bool;
  }

  /**
   * draw "a man with a briefcase" mark
   * @param {number} frameCounter
   */
  drawMark(frameCounter) {
    const mark = this.mark;
    if (frameCounter === 0) {
      mark.alpha = 0;
      return;
    }
    if (frameCounter < 100) {
      mark.alpha = Math.min(1, mark.alpha + 1 / 25);
    } else if (frameCounter >= 100) {
      mark.alpha = Math.max(0, mark.alpha - 1 / 25);
    }
  }
}

/**
 * Class representing the menu view. Originally exposed two options
 * ("play with computer" / "play with friend"); now only one button is shown
 * and it always starts a two-player match. The button image is expected to
 * be swapped later for a "press Enter to start" prompt.
 */
export class MenuView {
  /**
   * Create a MenuView object
   * @param {Object.<string,LoaderResource>} resources loader.resources
   */
  constructor(resources) {
    const textures = resources[ASSETS_PATH.SPRITE_SHEET].textures;
    const playerLeftTextures =
      resources[ASSETS_PATH.SPRITE_SHEET_PLAYER_LEFT].textures;

    this.messages = {
      pokemon: makeSpriteWithAnchorXY(textures, TEXTURES.POKEMON, 0, 0),
      pikachuVolleyball: makeSpriteWithAnchorXY(
        textures,
        TEXTURES.PIKACHU_VOLLEYBALL,
        0,
        0
      ),
      withWho: [makeSpriteWithAnchorXY(textures, TEXTURES.WITH_FRIEND, 0, 0)],
      fight: makeSpriteWithAnchorXY(textures, TEXTURES.FIGHT, 0, 0),
    };

    // Pengsoo replaces the original sitting-pikachu scrolling tile backdrop
    // with a single static menu_background + one sitting pengsoo sprite.
    // Both source textures are shipped at 1x, so scaling is applied inside
    // the helper.
    this.pengsooMenuBackgroundContainer = makePengsooMenuBackgroundContainer(
      textures,
      playerLeftTextures
    );

    // referred to FUN_00405b70
    this.messages.pikachuVolleyball.x = titleRestingX(
      this.messages.pikachuVolleyball
    );
    this.messages.pikachuVolleyball.y = RATIO * 80;
    this.messages.pokemon.x = RATIO * 170;
    this.messages.pokemon.y = RATIO * 40;

    this.container = new Container();
    this.container.addChild(this.pengsooMenuBackgroundContainer);
    this.container.addChild(this.messages.pokemon);
    this.container.addChild(this.messages.pikachuVolleyball);
    this.container.addChild(this.messages.withWho[0]);
    this.container.addChild(this.messages.fight);
    this.initializeVisibles();

    this.selectedWithWhoMessageSizeIncrement = 2;
  }

  /** @return {boolean} Is visible? */
  get visible() {
    return this.container.visible;
  }

  /** @param {boolean} bool Is visible? */
  set visible(bool) {
    this.container.visible = bool;

    // when turn off view, initialize visibilities of sprites in this view
    if (bool === false) {
      this.initializeVisibles();
    }
  }

  initializeVisibles() {
    for (const prop in this.messages) {
      this.messages[prop].visible = false;
    }
  }

  /**
   * referred to FUN_00405d50
   * Draw "fight!" message which get bigger and smaller as frame goes
   * @param {number} frameCounter
   */
  drawFightMessage(frameCounter) {
    const sizeArray = [20, 22, 25, 27, 30, 27, 25, 22, 20];
    const fightMessage = this.messages.fight;
    const w = fightMessage.texture.width;
    const h = fightMessage.texture.height;

    if (frameCounter === 0) {
      fightMessage.visible = true;
    }

    if (frameCounter < 30) {
      const halfWidth = Math.floor(Math.floor((frameCounter * w) / 30) / 2);
      const halfHeight = Math.floor(Math.floor((frameCounter * h) / 30) / 2);
      fightMessage.width = halfWidth * 2; // width
      fightMessage.height = halfHeight * 2; // height
      fightMessage.x = RATIO * 100 - halfWidth; // x coord
      fightMessage.y = RATIO * 70 - halfHeight; // y coord
    } else {
      const index = (frameCounter + 1) % 9;
      // code ...
      const halfWidth = Math.floor(Math.floor((sizeArray[index] * w) / 30) / 2);
      const halfHeight = Math.floor(
        Math.floor((sizeArray[index] * h) / 30) / 2
      );
      fightMessage.width = halfWidth * 2; // width
      fightMessage.height = halfHeight * 2; // height
      fightMessage.y = RATIO * 70 - halfHeight; // y coord
      fightMessage.x = RATIO * 100 - halfWidth; // x coord
    }
  }

  /**
   * Fade the pengsoo menu backdrop in as the frame counter grows.
   * Replaces the original scrolling sittingPikachu tiles; there is no scroll
   * movement here because the pengsoo backdrop is a single static composition.
   * @param {number} frameCounter
   */
  drawPengsooMenuBackground(frameCounter) {
    if (frameCounter === 0) {
      this.pengsooMenuBackgroundContainer.visible = true;
      this.pengsooMenuBackgroundContainer.alpha = 0;
    }

    if (frameCounter > 30) {
      this.pengsooMenuBackgroundContainer.alpha = Math.min(
        1,
        this.pengsooMenuBackgroundContainer.alpha + 0.04
      );
    }

    if (frameCounter > 70) {
      this.pengsooMenuBackgroundContainer.alpha = 1;
    }
  }

  /**
   * referred to FUN_00405b70
   * Draw pikachu volleyball message as frame goes
   * @param {number} frameCounter
   */
  drawPikachuVolleyballMessage(frameCounter) {
    if (frameCounter === 0) {
      this.messages.pikachuVolleyball.visible = false;
      return;
    }

    if (frameCounter > 30) {
      this.messages.pikachuVolleyball.visible = true;
    }

    const restX = titleRestingX(this.messages.pikachuVolleyball);

    if (frameCounter > 30 && frameCounter <= 44) {
      const xDiff = 195 - 15 * (frameCounter - 30);
      this.messages.pikachuVolleyball.x = restX + RATIO * xDiff;
    } else if (frameCounter > 44 && frameCounter <= 55) {
      this.messages.pikachuVolleyball.x = restX;
      this.messages.pikachuVolleyball.width =
        RATIO * (200 - 15 * (frameCounter - 44));
    } else if (frameCounter > 55 && frameCounter <= 71) {
      this.messages.pikachuVolleyball.x = restX;
      this.messages.pikachuVolleyball.width =
        RATIO * (40 + 15 * (frameCounter - 55));
    } else if (frameCounter > 71) {
      this.messages.pikachuVolleyball.x = restX;
      this.messages.pikachuVolleyball.width =
        this.messages.pikachuVolleyball.texture.width;
    }
  }

  /**
   * referred to FUN_00405b70
   * Draw pokemon message as frame goes
   * @param {number} frameCounter
   */
  drawPokemonMessage(frameCounter) {
    if (frameCounter === 0) {
      this.messages.pokemon.visible = false;
      return;
    }

    if (frameCounter > 71) {
      this.messages.pokemon.visible = true;
    }
  }

  /**
   * referred to FUN_00405ec0
   * Draw the single start button. It is always in the "selected" state so the
   * grow-in-place animation from the original two-option menu still runs.
   * The button is centered vertically between where the two original options
   * used to sit (y=184 and y=214) so the layout stays balanced with just one
   * button.
   * @param {number} frameCounter
   */
  drawWithWhoMessages(frameCounter) {
    const withWho = this.messages.withWho;
    const w = withWho[0].texture.width;
    const h = withWho[0].texture.height;

    if (frameCounter === 0) {
      withWho[0].visible = false;
      return;
    }

    if (frameCounter > 70) {
      if (this.selectedWithWhoMessageSizeIncrement < 10) {
        this.selectedWithWhoMessageSizeIncrement += 1;
      }
      const halfWidthIncrement = this.selectedWithWhoMessageSizeIncrement + 2;
      const halfHeightIncrement = this.selectedWithWhoMessageSizeIncrement;

      withWho[0].visible = true;
      withWho[0].x = RATIO * 216 - w / 2 - RATIO * halfWidthIncrement;
      withWho[0].y = RATIO * (199 - halfHeightIncrement);
      withWho[0].width = w + RATIO * 2 * halfWidthIncrement;
      withWho[0].height = h + RATIO * 2 * halfHeightIncrement;
    }
  }

  /**
   * Reset the button's grow-in-place animation so the next menu entry starts
   * from the small size. Kept as a method (rather than inlined into `menu()`
   * in pikavolley.js) so the internal animation state stays encapsulated
   * inside MenuView.
   */
  selectWithWho() {
    this.selectedWithWhoMessageSizeIncrement = 2;
  }
}

/**
 * Class represent a game view where pikachus, ball, clouds, waves, and backgrounds are
 */
export class GameView {
  /**
   * Create a GameView object
   * @param {Object.<string,LoaderResource>} resources
   */
  constructor(resources) {
    const textures = resources[ASSETS_PATH.SPRITE_SHEET].textures;
    const playerLeftTextures =
      resources[ASSETS_PATH.SPRITE_SHEET_PLAYER_LEFT].textures;
    const playerRightTextures =
      resources[ASSETS_PATH.SPRITE_SHEET_PLAYER_RIGHT].textures;

    // Display objects below
    this.bgContainer = makeBGContainer(textures);
    const playerSprites = makePlayerAnimatedSprites(
      playerLeftTextures,
      playerRightTextures
    );
    this.player1 = playerSprites[0];
    this.player2 = playerSprites[1];
    this.ball = makeBallAnimatedSprites(textures);
    this.ballHyper = makeSpriteWithAnchorXY(
      textures,
      TEXTURES.BALL_HYPER,
      0.5,
      0.5
    );
    this.ballTrail = makeSpriteWithAnchorXY(
      textures,
      TEXTURES.BALL_TRAIL,
      0.5,
      0.5
    );
    this.punch = makeSpriteWithAnchorXY(
      textures,
      TEXTURES.BALL_PUNCH,
      0.5,
      0.5
    );

    // this.scoreBoards[0] for player1, this.scoreBoards[1] for player2
    this.scoreBoards = [
      makeScoreBoardSprite(textures),
      makeScoreBoardSprite(textures),
    ];

    this.shadows = {
      forPlayer1: makeSpriteWithAnchorXY(textures, TEXTURES.SHADOW, 0.5, 0.5),
      forPlayer2: makeSpriteWithAnchorXY(textures, TEXTURES.SHADOW, 0.5, 0.5),
      forBall: makeSpriteWithAnchorXY(textures, TEXTURES.SHADOW, 0.5, 0.5),
    };

    this.messages = {
      gameStart: makeSpriteWithAnchorXY(textures, TEXTURES.GAME_START, 0, 0),
      ready: makeSpriteWithAnchorXY(textures, TEXTURES.READY, 0, 0),
      gameEnd: makeSpriteWithAnchorXY(textures, TEXTURES.GAME_END, 0, 0),
    };

    this.cloudContainer = makeCloudContainer(textures);
    this.waveContainer = makeWaveContainer(textures);

    // container which include whole display objects
    // Should be careful on addChild order
    // The later added, the more front(z-index) on screen
    this.container = new Container();
    this.container.addChild(this.bgContainer);
    this.container.addChild(this.cloudContainer);
    this.container.addChild(this.waveContainer);
    this.container.addChild(this.shadows.forPlayer1);
    this.container.addChild(this.shadows.forPlayer2);
    this.container.addChild(this.shadows.forBall);
    this.container.addChild(this.player1);
    this.container.addChild(this.player2);
    this.container.addChild(this.ballTrail);
    this.container.addChild(this.ballHyper);
    this.container.addChild(this.ball);
    this.container.addChild(this.punch);
    this.container.addChild(this.scoreBoards[0]);
    this.container.addChild(this.scoreBoards[1]);
    this.container.addChild(this.messages.gameStart);
    this.container.addChild(this.messages.ready);
    this.container.addChild(this.messages.gameEnd);

    // location and visibility setting
    this.bgContainer.x = 0;
    this.bgContainer.y = 0;
    this.cloudContainer.x = 0;
    this.cloudContainer.y = 0;
    this.waveContainer.x = 0;
    this.waveContainer.y = 0;

    this.messages.ready.x = RATIO * 176;
    this.messages.ready.y = RATIO * 38;
    this.scoreBoards[0].x = RATIO * 14; // score board is 14 pixel distant from boundary
    this.scoreBoards[0].y = RATIO * 10;
    this.scoreBoards[1].x = RATIO * (432 - 32 - 32 - 14); // 32 pixel is for number (32x32px) width; one score board has two numbers
    this.scoreBoards[1].y = RATIO * 10;

    this.shadows.forPlayer1.y = RATIO * 273;
    this.shadows.forPlayer2.y = RATIO * 273;
    this.shadows.forBall.y = RATIO * 273;

    // shadow.png ships at 1x (32x8) so scale it up to visual size at construct
    // time. Anchor is (0.5, 0.5) so this scale keeps center-alignment intact.
    this.shadows.forPlayer1.scale.x = RATIO;
    this.shadows.forPlayer2.scale.x = RATIO;
    this.shadows.forBall.scale.x = RATIO;
    this.shadows.forPlayer1.scale.y = RATIO;
    this.shadows.forPlayer2.scale.y = RATIO;
    this.shadows.forBall.scale.y = RATIO;

    this.initializeVisibles();

    // clouds and wave model.
    // This model is included in this view object, not on controller object
    // since it is not dependent on user input, and only used for rendering.
    this.cloudArray = [];
    for (let i = 0; i < NUM_OF_CLOUDS; i++) {
      this.cloudArray.push(new Cloud());
    }
    this.wave = new Wave();
  }

  /** @return {boolean} Is visible? */
  get visible() {
    return this.container.visible;
  }

  /** @param {boolean} bool Is visible? */
  set visible(bool) {
    this.container.visible = bool;

    // when turn off view
    if (bool === false) {
      this.initializeVisibles();
    }
  }

  initializeVisibles() {
    for (const prop in this.messages) {
      this.messages[prop].visible = false;
    }
  }

  /** @typedef {import("./physics").PikaPhysics} PikaPhysics */
  /**
   * Draw players and ball in the given physics object
   * @param {PikaPhysics} physics PikaPhysics object to draw
   */
  drawPlayersAndBall(physics) {
    const player1 = physics.player1;
    const player2 = physics.player2;
    const ball = physics.ball;

    this.player1.x = RATIO * player1.x;
    this.player1.y = RATIO * player1.y;
    // scale.x here is a horizontal flip (+1/-1), not a size -- never scale it.
    //
    // The pengsoo sheets are pre-oriented per side, so both players default to
    // scale.x = +1 (no baseline flip). The diving-state flip fires when the
    // divingDirection points AWAY from the sprite's baseline facing:
    //   - player 1 baseline faces right (+x) -> flip when divingDirection = -1
    //   - player 2 baseline faces left  (-x) -> flip when divingDirection = +1
    if (player1.state === 3 || player1.state === 4) {
      this.player1.scale.x = player1.divingDirection === -1 ? -1 : 1;
    } else {
      this.player1.scale.x = 1;
    }
    this.shadows.forPlayer1.x = RATIO * player1.x;

    this.player2.x = RATIO * player2.x;
    this.player2.y = RATIO * player2.y;
    if (player2.state === 3 || player2.state === 4) {
      this.player2.scale.x = player2.divingDirection === 1 ? -1 : 1;
    } else {
      this.player2.scale.x = 1;
    }
    this.shadows.forPlayer2.x = RATIO * player2.x;

    const frameNumber1 = getFrameNumberForPlayerAnimatedSprite(
      player1.state,
      player1.frameNumber
    );
    const frameNumber2 = getFrameNumberForPlayerAnimatedSprite(
      player2.state,
      player2.frameNumber
    );
    this.player1.gotoAndStop(frameNumber1);
    this.player2.gotoAndStop(frameNumber2);

    this.ball.x = RATIO * ball.x;
    this.ball.y = RATIO * ball.y;
    this.shadows.forBall.x = RATIO * ball.x;
    this.ball.gotoAndStop(ball.rotation);

    // For punch effect, refer to FUN_00402ee0
    if (ball.punchEffectRadius > 0) {
      ball.punchEffectRadius -= 2;
      this.punch.width = RATIO * 2 * ball.punchEffectRadius;
      this.punch.height = RATIO * 2 * ball.punchEffectRadius;
      this.punch.x = RATIO * ball.punchEffectX;
      this.punch.y = RATIO * ball.punchEffectY;
      this.punch.visible = true;
    } else {
      this.punch.visible = false;
    }

    if (ball.isPowerHit === true) {
      this.ballHyper.x = RATIO * ball.previousX;
      this.ballHyper.y = RATIO * ball.previousY;
      this.ballTrail.x = RATIO * ball.previousPreviousX;
      this.ballTrail.y = RATIO * ball.previousPreviousY;

      this.ballHyper.visible = true;
      this.ballTrail.visible = true;
    } else {
      this.ballHyper.visible = false;
      this.ballTrail.visible = false;
    }
  }

  /**
   * Draw scores to each score board
   * @param {number[]} scores [0] for player1 score, [1] for player2 score
   */
  drawScoresToScoreBoards(scores) {
    for (let i = 0; i < 2; i++) {
      const scoreBoard = this.scoreBoards[i];
      const score = scores[i];
      const unitsAnimatedSprite = scoreBoard.getChildAt(0);
      const tensAnimatedSprite = scoreBoard.getChildAt(1);
      // @ts-ignore
      unitsAnimatedSprite.gotoAndStop(score % 10);
      // @ts-ignore
      tensAnimatedSprite.gotoAndStop(Math.floor(score / 10) % 10);
      if (score >= 10) {
        tensAnimatedSprite.visible = true;
      } else {
        tensAnimatedSprite.visible = false;
      }
    }
  }

  /**
   * Draw clouds and wave
   */
  drawCloudsAndWave() {
    const cloudArray = this.cloudArray;
    const wave = this.wave;

    cloudAndWaveEngine(cloudArray, wave);

    for (let i = 0; i < NUM_OF_CLOUDS; i++) {
      const cloud = cloudArray[i];
      const cloudSprite = this.cloudContainer.getChildAt(i);
      cloudSprite.x = RATIO * cloud.spriteTopLeftPointX;
      cloudSprite.y = RATIO * cloud.spriteTopLeftPointY;
      // @ts-ignore
      cloudSprite.width = RATIO * cloud.spriteWidth;
      // @ts-ignore
      cloudSprite.height = RATIO * cloud.spriteHeight;
    }

    for (let i = 0; i < 432 / 16; i++) {
      const waveSprite = this.waveContainer.getChildAt(i);
      waveSprite.y = RATIO * wave.yCoords[i];
    }
  }

  /**
   * referred to FUN_00403f20
   * Draw game start message as frame goes
   * @param {number} frameCounter current frame number
   * @param {number} frameTotal total frame number for game start message
   */
  drawGameStartMessage(frameCounter, frameTotal) {
    if (frameCounter === 0) {
      this.messages.gameStart.visible = true;
    } else if (frameCounter >= frameTotal - 1) {
      this.messages.gameStart.visible = false;
      return;
    }

    const gameStartMessage = this.messages.gameStart;
    // game start message rendering
    const w = gameStartMessage.texture.width; // game start message texture width
    const h = gameStartMessage.texture.height; // game start message texture height
    const halfWidth = Math.floor((w * frameCounter) / 50);
    const halfHeight = Math.floor((h * frameCounter) / 50);
    gameStartMessage.x = RATIO * 216 - halfWidth;
    gameStartMessage.y = RATIO * 50 + 2 * halfHeight;
    gameStartMessage.width = 2 * halfWidth;
    gameStartMessage.height = 2 * halfHeight;
  }

  /**
   * Draw ready message
   * @param {boolean} bool turn on?
   */
  drawReadyMessage(bool) {
    this.messages.ready.visible = bool;
  }

  /**
   * Togle ready message.
   * Turn off if it's on, turn on if it's off.
   */
  toggleReadyMessage() {
    this.messages.ready.visible = !this.messages.ready.visible;
  }

  /**
   * refered FUN_00404070
   * Draw game end message as frame goes
   * @param {number} frameCounter
   */
  drawGameEndMessage(frameCounter) {
    const gameEndMessage = this.messages.gameEnd;
    const w = gameEndMessage.texture.width; // game end message texture width;
    const h = gameEndMessage.texture.height; // game end message texture height;

    if (frameCounter === 0) {
      gameEndMessage.visible = true;
    }
    if (frameCounter < 50) {
      const halfWidthIncrement = 2 * Math.floor(((50 - frameCounter) * w) / 50);
      const halfHeightIncrement =
        2 * Math.floor(((50 - frameCounter) * h) / 50);

      gameEndMessage.x = RATIO * 216 - w / 2 - halfWidthIncrement;
      gameEndMessage.y = RATIO * 50 - halfHeightIncrement;
      gameEndMessage.width = w + 2 * halfWidthIncrement;
      gameEndMessage.height = h + 2 * halfHeightIncrement;
    } else {
      gameEndMessage.x = RATIO * 216 - w / 2;
      gameEndMessage.y = RATIO * 50;
      gameEndMessage.width = w;
      gameEndMessage.height = h;
    }
  }
}

/**
 * Class representing fade in out effect
 */
export class FadeInOut {
  constructor() {
    // Pengsoo's reference uses @pixi/graphics's Graphics().drawRect() here, but
    // this project intentionally removed that dependency (commit b05d204). We
    // get the same solid-black overlay by stretching Pixi's built-in 1x1 white
    // Texture and applying a black tint (multiply).
    //
    // Note: never set both `.width` and `.scale.x` on a Sprite -- the .width
    // setter internally writes scale.x = width / texture.width, so a follow-up
    // scale assignment silently overrides the intended size. Texture.WHITE is
    // 1x1, which makes the mistake especially loud (final render becomes 1 * scale
    // px). Set the final on-screen size directly via .width / .height.
    this.black = new Sprite(Texture.WHITE);
    this.black.tint = 0x000000;
    this.black.anchor.x = 0;
    this.black.anchor.y = 0;
    this.black.x = 0;
    this.black.y = 0;
    this.black.width = RATIO * 432;
    this.black.height = RATIO * 304;
    this.black.alpha = 1;
  }

  /** @return {boolean} Is visible? */
  get visible() {
    return this.black.visible;
  }

  /** @param {boolean} bool Is visible? */
  set visible(bool) {
    this.black.visible = bool;
  }

  /**
   * Set black alpha for fade in out
   * @param {number} alpha number in [0, 1]
   */
  setBlackAlphaTo(alpha) {
    this.black.alpha = alpha;
    if (this.black.alpha === 0) {
      this.black.visible = false;
    } else {
      this.black.visible = true;
    }
  }

  /**
   * Increase black alpha for fade in out
   * @param {number} alphaIncrement if alphaIncrement > 0: fade out, else fade in
   */
  changeBlackAlphaBy(alphaIncrement) {
    if (alphaIncrement >= 0) {
      this.black.alpha = Math.min(1, this.black.alpha + alphaIncrement);
    } else {
      this.black.alpha = Math.max(0, this.black.alpha + alphaIncrement);
    }
    if (this.black.alpha === 0) {
      this.black.visible = false;
    } else {
      this.black.visible = true;
    }
  }
}

/**
 * Horizontally centered x for the title message.
 *
 * The original hard-coded `RATIO * 140`, which only fits the title art it was
 * drawn for -- a wider title runs off the right edge of the 432*RATIO canvas.
 * Deriving x from the texture keeps the title centered however the art is
 * redrawn, so the atlas can hold it at its native size instead of the art
 * having to be shrunk into a fixed frame (which costs resolution every time
 * the sheet is regenerated).
 * @param {Sprite} sprite title sprite
 * @return {number}
 */
function titleRestingX(sprite) {
  return (RATIO * 432 - sprite.texture.width) / 2;
}

/**
 * Compose the pengsoo menu backdrop: a full-screen `menu_background.png` with
 * a single sitting-pengsoo sprite laid on top at a fixed offset.
 *
 * Scaling is asymmetric: `menu_background.png` is shipped at 1x (432x304 in
 * sprite_sheet.json) so it gets `.scale = RATIO`, but `sitting_pengsoo.png`
 * lives in the pengsoo_left sheet which is authored at RATIO scale already
 * (the frame is 313x416), so it renders at its natural texture size with no
 * extra scaling. Matches the pengsoo reference source-map.
 * @param {Object.<string,Texture>} textures  common sheet textures
 * @param {Object.<string,Texture>} textures2 player-left sheet textures (holds sitting_pengsoo)
 * @return {Container}
 */
function makePengsooMenuBackgroundContainer(textures, textures2) {
  const container = new Container();
  const menuBackgroundSprite = new Sprite(textures[TEXTURES.MENU_BACKGROUND]);
  menuBackgroundSprite.scale.x = RATIO;
  menuBackgroundSprite.scale.y = RATIO;

  const pengsooSprite = new Sprite(textures2[TEXTURES.SITTING_PIKACHU]);

  addChildToParentAndSetLocalPosition(container, menuBackgroundSprite, 0, 0);
  addChildToParentAndSetLocalPosition(
    container,
    pengsooSprite,
    40 * RATIO,
    150 * RATIO
  );

  return container;
}

/**
 * Make background
 * @param {Object.<string,Texture>} textures
 * @return {Container}
 */
function makeBGContainer(textures) {
  const bgContainer = new Container();

  // sky - 16 rows (pengsoo raised the sky area from the original 12 rows so
  // that the taller mountain silhouette does not leave a strip of black above)
  let tile;
  let texture = textures[TEXTURES.SKY_BLUE];
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 432 / 16; i++) {
      tile = new Sprite(texture);
      tile.scale.x = RATIO;
      tile.scale.y = RATIO;
      addChildToParentAndSetLocalPosition(
        bgContainer,
        tile,
        RATIO * 16 * i,
        RATIO * 16 * j
      );
    }
  }

  // mountain - anchor y raised from 188 to 214 to sit lower on the sky band
  texture = textures[TEXTURES.MOUNTAIN];
  tile = new Sprite(texture);
  addChildToParentAndSetLocalPosition(bgContainer, tile, 0, RATIO * 214);

  // ground_red - pengsoo doubled the red band from 1 row to 2 rows
  texture = textures[TEXTURES.GROUND_RED];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 432 / 16; i++) {
      tile = new Sprite(texture);
      tile.scale.x = RATIO;
      tile.scale.y = RATIO;
      addChildToParentAndSetLocalPosition(
        bgContainer,
        tile,
        RATIO * 16 * i,
        RATIO * (248 + 16 * j)
      );
    }
  }

  // ground_line
  texture = textures[TEXTURES.GROUND_LINE];
  for (let i = 1; i < 432 / 16 - 1; i++) {
    tile = new Sprite(texture);
    tile.scale.x = RATIO;
    tile.scale.y = RATIO;
    addChildToParentAndSetLocalPosition(
      bgContainer,
      tile,
      RATIO * 16 * i,
      RATIO * 264
    );
  }
  texture = textures[TEXTURES.GROUND_LINE_LEFT_MOST];
  tile = new Sprite(texture);
  tile.scale.x = RATIO;
  tile.scale.y = RATIO;
  addChildToParentAndSetLocalPosition(bgContainer, tile, 0, RATIO * 264);
  texture = textures[TEXTURES.GROUND_LINE_RIGHT_MOST];
  tile = new Sprite(texture);
  tile.scale.x = RATIO;
  tile.scale.y = RATIO;
  addChildToParentAndSetLocalPosition(
    bgContainer,
    tile,
    RATIO * (432 - 16),
    RATIO * 264
  );

  // ground_yellow
  texture = textures[TEXTURES.GROUND_YELLOW];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 432 / 16; i++) {
      tile = new Sprite(texture);
      tile.scale.x = RATIO;
      tile.scale.y = RATIO;
      addChildToParentAndSetLocalPosition(
        bgContainer,
        tile,
        RATIO * 16 * i,
        RATIO * (280 + 16 * j)
      );
    }
  }

  // net pillar
  texture = textures[TEXTURES.NET_PILLAR_TOP];
  tile = new Sprite(texture);
  tile.scale.x = RATIO;
  tile.scale.y = RATIO;
  addChildToParentAndSetLocalPosition(
    bgContainer,
    tile,
    RATIO * 213,
    RATIO * 176
  );
  texture = textures[TEXTURES.NET_PILLAR];
  for (let j = 0; j < 12; j++) {
    tile = new Sprite(texture);
    tile.scale.x = RATIO;
    tile.scale.y = RATIO;
    addChildToParentAndSetLocalPosition(
      bgContainer,
      tile,
      RATIO * 213,
      RATIO * (184 + 8 * j)
    );
  }

  return bgContainer;
}

/**
 * Make animated sprites for both players
 *
 * The original single-sheet layout stored one right-facing pikachu; player 2
 * was drawn by flipping it horizontally at render time (scale.x = -1). The
 * pengsoo assets ship two dedicated sheets pre-oriented for their side
 * (pengsoo_left/* faces right toward the net, pengsoo_right/* faces left), so
 * each AnimatedSprite is built from its own sheet's texture array; the flip
 * policy in drawPlayersAndBall has been updated to match.
 *
 * Note: for state 3 (diving), player 1's frames are appended in reverse order
 * (1, 0) while player 2 uses natural order (0, 1). This mirrors the pengsoo
 * reference source-map -- the two sheets author their state-3 diving poses
 * with opposite frame-index conventions, so the playback order compensates.
 * @param {Object.<string,Texture>} textures1 player-left sheet textures
 * @param {Object.<string,Texture>} textures2 player-right sheet textures
 * @return {AnimatedSprite[]} [0] for player 1, [1] for player2
 */
function makePlayerAnimatedSprites(textures1, textures2) {
  const getPlayer1Texture = (i, j) => textures1[TEXTURES.PIKACHU1(i, j)];
  const getPlayer2Texture = (i, j) => textures2[TEXTURES.PIKACHU2(i, j)];
  const player1TextureArray = [];
  const player2TextureArray = [];
  for (let i = 0; i < 7; i++) {
    if (i === 3) {
      player1TextureArray.push(getPlayer1Texture(i, 1));
      player1TextureArray.push(getPlayer1Texture(i, 0));
      player2TextureArray.push(getPlayer2Texture(i, 0));
      player2TextureArray.push(getPlayer2Texture(i, 1));
    } else if (i === 4) {
      player1TextureArray.push(getPlayer1Texture(i, 0));
      player2TextureArray.push(getPlayer2Texture(i, 0));
    } else {
      for (let j = 0; j < 5; j++) {
        player1TextureArray.push(getPlayer1Texture(i, j));
        player2TextureArray.push(getPlayer2Texture(i, j));
      }
    }
  }
  const player1AnimatedSprite = new AnimatedSprite(player1TextureArray, false);
  const player2AnimatedSprite = new AnimatedSprite(player2TextureArray, false);

  player1AnimatedSprite.anchor.x = 0.5;
  player1AnimatedSprite.anchor.y = 0.5;
  player2AnimatedSprite.anchor.x = 0.5;
  player2AnimatedSprite.anchor.y = 0.5;

  return [player1AnimatedSprite, player2AnimatedSprite];
}

/**
 * Make animated sprite of ball
 * @param {Object.<string,Texture>} textures
 * @return {AnimatedSprite}
 */
function makeBallAnimatedSprites(textures) {
  const getBallTexture = (s) => textures[TEXTURES.BALL(s)];
  const ballTextureArray = [
    getBallTexture(0),
    getBallTexture(1),
    getBallTexture(2),
    getBallTexture(3),
    getBallTexture(4),
    getBallTexture('hyper'),
  ];
  const ballAnimatedSprite = new AnimatedSprite(ballTextureArray, false);

  ballAnimatedSprite.anchor.x = 0.5;
  ballAnimatedSprite.anchor.y = 0.5;

  return ballAnimatedSprite;
}

/**
 * Make sprite with the texture on the path and with the given anchor x, y
 * @param {Object.<string,Texture>} textures
 * @param {string} path
 * @param {number} anchorX anchor.x, number in [0, 1]
 * @param {number} anchorY anchor.y, number in [0, 1]
 * @return {Sprite}
 */
function makeSpriteWithAnchorXY(textures, path, anchorX, anchorY) {
  const sprite = new Sprite(textures[path]);
  sprite.anchor.x = anchorX;
  sprite.anchor.y = anchorY;
  return sprite;
}

/**
 * Make score boards
 * @param {Object.<string,Texture>} textures
 * @return {Container} child with index 0 for player 1 score board, child with index 1 for player2 score board
 */
function makeScoreBoardSprite(textures) {
  const getNumberTexture = (n) => textures[TEXTURES.NUMBER(n)];
  const numberTextureArray = [];
  for (let i = 0; i < 10; i++) {
    numberTextureArray.push(getNumberTexture(i));
  }
  const numberAnimatedSprites = [null, null];
  numberAnimatedSprites[0] = new AnimatedSprite(numberTextureArray, false);
  numberAnimatedSprites[1] = new AnimatedSprite(numberTextureArray, false);

  const scoreBoard = new Container();
  addChildToParentAndSetLocalPosition(
    scoreBoard,
    numberAnimatedSprites[0],
    RATIO * 32,
    0
  ); // for units
  addChildToParentAndSetLocalPosition(
    scoreBoard,
    numberAnimatedSprites[1],
    0,
    0
  ); // for tens

  scoreBoard.setChildIndex(numberAnimatedSprites[0], 0); // for units
  scoreBoard.setChildIndex(numberAnimatedSprites[1], 1); // for tens

  return scoreBoard;
}

/**
 * Make a container with cloud sprites
 * @param {Object.<string,Texture>} textures
 * @return {Container}
 */
function makeCloudContainer(textures) {
  const cloudContainer = new Container();
  const texture = textures[TEXTURES.CLOUD];
  for (let i = 0; i < NUM_OF_CLOUDS; i++) {
    const cloud = new Sprite(texture);
    cloud.anchor.x = 0;
    cloud.anchor.y = 0;
    cloudContainer.addChild(cloud);
  }

  return cloudContainer;
}

/**
 * Make a container with wave sprites
 * @param {Object.<string,Texture>} textures
 * @return {Container}
 */
function makeWaveContainer(textures) {
  const waveContainer = new Container();
  const texture = textures[TEXTURES.WAVE];
  // Wave tiles are stepped every RATIO*20 logical px (pengsoo widened this
  // from the original 16 to match the new wave asset's natural repeat width).
  for (let i = 0; i < 432 / 16; i++) {
    const tile = new Sprite(texture);
    addChildToParentAndSetLocalPosition(waveContainer, tile, RATIO * 20 * i, 0);
  }

  return waveContainer;
}

/**
 * Add child to parent and set local position
 * @param {Container} parent
 * @param {Sprite} child
 * @param {number} x local x
 * @param {number} y local y
 */
function addChildToParentAndSetLocalPosition(parent, child, x, y) {
  parent.addChild(child);
  child.anchor.x = 0;
  child.anchor.y = 0;
  child.x = x;
  child.y = y;
}

/**
 * Get frame number for player animated sprite corresponds to the player state
 *
 * number of frames for state 0, state 1 and state 2 is 5 for each.
 * number of frames for state 3 is 2.
 * number of frames for state 4 is 1.
 * number of frames for state 5, state 6 is 5 for each.
 * @param {number} state player state
 * @param {number} frameNumber
 */
function getFrameNumberForPlayerAnimatedSprite(state, frameNumber) {
  if (state < 4) {
    return 5 * state + frameNumber;
  } else if (state === 4) {
    return 17 + frameNumber;
  } else if (state > 4) {
    return 18 + 5 * (state - 5) + frameNumber;
  }
}
