import {
  clampPointToInk,
  closestPointOnSegment,
  consumeInk,
  distance,
  movingObstaclePosition,
  reflectVelocity,
  togglePausePhase,
  type MovingObstacleConfig,
  type Phase,
  type Vec2,
} from "./physics.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const ctx = canvas.getContext("2d")!;
const restartBtn = document.querySelector<HTMLButtonElement>("#restart-btn")!;
const pauseBtn = document.querySelector<HTMLButtonElement>("#pause-btn")!;
const levelSelectBtn = document.querySelector<HTMLButtonElement>("#level-select-btn")!;
const controlsEl = document.querySelector<HTMLDivElement>(".controls")!;
const coverEl = document.querySelector<HTMLDivElement>("#cover")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start-btn")!;
const levelPanel = document.querySelector<HTMLDivElement>("#level-panel")!;
const levelPanelClose = document.querySelector<HTMLButtonElement>("#level-panel-close")!;
const levelGrid = document.querySelector<HTMLDivElement>("#level-grid")!;

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface Goal {
  x: number;
  y: number;
  radius: number;
}

interface Obstacle {
  x: number;
  y: number;
  radius: number;
}

interface LevelConfig {
  ball: Ball;
  goal: Goal;
  obstacles: Obstacle[];
  // Infinity means the level has no ink limit at all.
  inkCapacity: number;
  // Zero or more moving obstacles. Every entry is driven by the same shared
  // elapsed-playing-time clock (see movingObstacleElapsed), so a level with
  // several of them still has exactly one thing pause freezes and restart
  // resets, rather than needing separate bookkeeping per obstacle.
  movingObstacles?: MovingObstacleConfig[];
}

// Physics tuning, kept as named constants (not player-facing) so feel can be
// adjusted from playtesting without touching the simulation logic. Gravity
// and initial speed scale with the viewport's smaller dimension so the same
// relative challenge holds at 1920x1080 and at 390x844. Shared by every
// level so the ball itself always behaves the same way; only layout differs.
const GRAVITY_FACTOR = 0.16;
const INITIAL_VX_FACTOR = 0.6;
const BALL_RADIUS_FACTOR = 0.027;
const RESTITUTION = 0.9;
const MAX_FALL_SPEED_FACTOR = 0.576;
const LINE_HALF_THICKNESS = 6;
const MIN_DRAW_POINT_GAP = 4;

const MAX_DT = 1 / 30;
const SUBSTEPS = 6;
const FAIL_REACT_MS = 260;
const RESET_MS = 220;
const SUCCESS_SETTLE_MS = 500;
const FINISHED_GROW_MS = 900;

// Fixed CSS-px sizing so the ink meter reads as UI, not world geometry, and
// stays legible at both target viewports without competing with gameplay.
const INK_METER_WIDTH = 14;
const INK_METER_HEIGHT = 130;
const INK_METER_MARGIN = 16;

let width = window.innerWidth;
let height = window.innerHeight;

function unit(): number {
  return Math.min(width, height);
}

function ballAt(x: number, y: number, u: number): Ball {
  return { x, y, vx: u * INITIAL_VX_FACTOR, vy: 0, radius: u * BALL_RADIUS_FACTOR };
}

// Sixteen levels of the same mechanic (draw lines to redirect the ball into
// the goal), each a pure function of the live viewport so layout stays
// correct across resizes and both target screen sizes. Difficulty is
// introduced by spatial arrangement (angle, an obstacle, needing two
// redirects, limited ink, a moving obstacle, then combinations of those)
// rather than by changing the ball's physics, which stay identical to
// Level 1 throughout. Levels 13-16 (added after the first twelve were
// already shipped) drop ink limits entirely and lean on denser geometry,
// two independently-timed moving obstacles, and genuine route choice
// instead. Level 16 is the last playable level; reaching its goal moves the
// game into the finished/ending state instead of loading another level ---
// this falls out of the existing `levelIndex + 1 < LEVEL_DEFS.length` check
// in frame() needing no change, since it was always generic over the
// array's length.
const LEVEL_DEFS: Array<(w: number, h: number, u: number) => LevelConfig> = [
  // Level 1 --- basic bounce: one obvious, forgiving redirect.
  (w, h, u) => ({
    ball: ballAt(w * 0.2, h * 0.3, u),
    goal: { x: w * 0.55, y: h * 0.55, radius: u * 0.09 },
    obstacles: [],
    inkCapacity: Infinity,
  }),
  // Level 2 --- angle: goal sits above the ball's natural fall arc instead
  // of below it, so the same single-bounce rule needs a steeper, more
  // deliberate line angle than Level 1 did.
  (w, h, u) => ({
    ball: ballAt(w * 0.15, h * 0.62, u),
    goal: { x: w * 0.75, y: h * 0.22, radius: u * 0.085 },
    obstacles: [],
    inkCapacity: Infinity,
  }),
  // Level 3 --- fixed obstacle: one solid circle sits between the ball's
  // path and the goal, so a naive straight redirect runs into it.
  (w, h, u) => ({
    ball: ballAt(w * 0.15, h * 0.3, u),
    goal: { x: w * 0.8, y: h * 0.5, radius: u * 0.085 },
    obstacles: [{ x: w * 0.5, y: h * 0.42, radius: u * 0.09 }],
    inkCapacity: Infinity,
  }),
  // Level 4 --- two bounces: goal sits back near the ball's own starting
  // side, low down, so one line can only turn the ball part-way there.
  (w, h, u) => ({
    ball: ballAt(w * 0.12, h * 0.25, u),
    goal: { x: w * 0.15, y: h * 0.85, radius: u * 0.08 },
    obstacles: [],
    inkCapacity: Infinity,
  }),
  // Level 5 --- limited ink: capacity scales with the same unit() as every
  // other level measurement, so the ratio of ink needed to ink available
  // stays comparable on a small phone screen and a large desktop one.
  (w, h, u) => ({
    ball: ballAt(w * 0.15, h * 0.3, u),
    goal: { x: w * 0.75, y: h * 0.7, radius: u * 0.085 },
    obstacles: [],
    inkCapacity: u * 0.55,
  }),
  // Level 6 --- combination: obstacle, limited ink, and a goal placement
  // that needs more than one redirect, using only the earlier mechanics.
  (w, h, u) => ({
    ball: ballAt(w * 0.12, h * 0.25, u),
    goal: { x: w * 0.82, y: h * 0.78, radius: u * 0.08 },
    obstacles: [{ x: w * 0.5, y: h * 0.5, radius: u * 0.095 }],
    inkCapacity: u * 0.75,
  }),
  // Level 7 (A) --- double-obstacle route: two fixed obstacles rule out the
  // direct path, so reaching the goal takes roughly two deliberate
  // redirects. Unlimited ink; the challenge is entirely route-planning, not
  // resource restriction, and both redirects have a wide, forgiving angle
  // band rather than a precise shot.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.5, h * 0.08, u),
        goal: { x: w * 0.75, y: h * 0.85, radius: u * 0.09 },
        obstacles: [
          { x: w * 0.6, y: h * 0.388, radius: u * 0.075 },
          { x: w * 0.69, y: h * 0.66, radius: u * 0.075 },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.08, h * 0.15, u),
      goal: { x: w * 0.82, y: h * 0.86, radius: u * 0.09 },
      obstacles: [
        { x: w * 0.45, y: h * 0.505, radius: u * 0.075 },
        { x: w * 0.68, y: h * 0.725, radius: u * 0.075 },
      ],
      inkCapacity: Infinity,
    };
  },
  // Level 8 (B) --- moving obstacle: exactly one new mechanic, a single
  // obstacle in smooth, deterministic back-and-forth motion. Its position
  // is a pure function of elapsed *playing* time (see movingObstaclePosition
  // in physics.ts), so pausing freezes it exactly like the ball, and a
  // restart puts it back at its starting phase --- no separate bookkeeping
  // needed. Unlimited ink; one redirect, chosen well clear of the obstacle's
  // sweep, is enough to reach the goal.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.2, h * 0.08, u),
        goal: { x: w * 0.7, y: h * 0.85, radius: u * 0.12 },
        obstacles: [],
        movingObstacles: [
          {
            x0: w * 0.5,
            y0: h * 0.45,
            axis: "x",
            amplitude: w * 0.22,
            period: 2.4,
            radius: u * 0.06,
          },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.08, h * 0.15, u),
      goal: { x: w * 0.44, y: h * 0.74, radius: u * 0.11 },
      obstacles: [],
      movingObstacles: [
        {
          x0: w * 0.5,
          y0: h * 0.27,
          axis: "y",
          amplitude: h * 0.12,
          period: 2.4,
          radius: u * 0.06,
        },
      ],
      inkCapacity: Infinity,
    };
  },
  // Level 9 (C) --- first step toward denser route planning: the same ball,
  // goal and unlimited ink as before, but the two fixed obstacles move from
  // the wide margins into the middle of the fall corridor, so a redirect is
  // now actually required rather than merely available. Still no moving
  // obstacle (that stays introduced gradually, at Level 8/10/12) and still
  // spacious: a wide gap remains above, between and below both obstacles for
  // observation and a rescue line.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.5, h * 0.06, u),
        goal: { x: w * 0.58, y: h * 0.92, radius: u * 0.2 },
        obstacles: [
          { x: w * 0.62, y: h * 0.32, radius: u * 0.075 },
          { x: w * 0.4, y: h * 0.6, radius: u * 0.075 },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.06, h * 0.1, u),
      goal: { x: w * 0.911, y: h * 0.713, radius: u * 0.13 },
      obstacles: [
        { x: w * 0.35, y: h * 0.16, radius: u * 0.075 },
        { x: w * 0.62, y: h * 0.48, radius: u * 0.075 },
      ],
      inkCapacity: Infinity,
    };
  },
  // Level 10 --- moving obstacle timing, now with more geometry: the same
  // goal and the same single moving obstacle as before (still the level's
  // one timing challenge), plus two fixed obstacles added off to the sides
  // of its sweep rather than inside it, so they add route-planning without
  // competing with the timing decision itself. Unlimited ink.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.15, h * 0.08, u),
        goal: { x: w * 0.5, y: h * 0.9, radius: u * 0.13 },
        obstacles: [
          { x: w * 0.78, y: h * 0.3, radius: u * 0.07 },
          { x: w * 0.22, y: h * 0.65, radius: u * 0.065 },
        ],
        movingObstacles: [
          {
            x0: w * 0.5,
            y0: h * 0.5,
            axis: "y",
            amplitude: h * 0.14,
            period: 2.6,
            radius: u * 0.06,
          },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.1, h * 0.15, u),
      goal: { x: w * 0.5, y: h * 0.88, radius: u * 0.1 },
      obstacles: [
        { x: w * 0.8, y: h * 0.28, radius: u * 0.07 },
        { x: w * 0.2, y: h * 0.68, radius: u * 0.065 },
      ],
      movingObstacles: [
        {
          x0: w * 0.5,
          y0: h * 0.52,
          axis: "x",
          amplitude: w * 0.26,
          period: 2.6,
          radius: u * 0.055,
        },
      ],
      inkCapacity: Infinity,
    };
  },
  // Level 11 --- multi-stage route, redesigned so the goal sits at
  // half-height (y = 0.5 * stage height) rather than near the bottom, which
  // is what actually forces the multi-stage read: the ball's natural fall
  // still has plenty of screen left below the goal, so reaching it can't be
  // an accident of running out of room. Three fixed obstacles plus two
  // independently-phased moving obstacles (one per axis) sit in the band
  // between the ball's start and the goal, with open gaps around and between
  // them for a rescue line or an alternate route rather than one exact path.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.15, h * 0.06, u),
        goal: { x: w * 0.68, y: h * 0.5, radius: u * 0.13 },
        obstacles: [
          { x: w * 0.55, y: h * 0.18, radius: u * 0.07 },
          { x: w * 0.22, y: h * 0.36, radius: u * 0.07 },
          { x: w * 0.62, y: h * 0.4, radius: u * 0.07 },
        ],
        movingObstacles: [
          {
            x0: w * 0.38,
            y0: h * 0.28,
            axis: "x",
            amplitude: w * 0.16,
            period: 2.8,
            radius: u * 0.05,
          },
          {
            x0: w * 0.75,
            y0: h * 0.34,
            axis: "y",
            amplitude: h * 0.12,
            period: 3.2,
            radius: u * 0.05,
          },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.08, h * 0.12, u),
      goal: { x: w * 0.65, y: h * 0.5, radius: u * 0.1 },
      obstacles: [
        { x: w * 0.32, y: h * 0.22, radius: u * 0.07 },
        { x: w * 0.5, y: h * 0.38, radius: u * 0.07 },
        { x: w * 0.72, y: h * 0.28, radius: u * 0.07 },
      ],
      movingObstacles: [
        {
          x0: w * 0.45,
          y0: h * 0.3,
          axis: "y",
          amplitude: h * 0.14,
          period: 2.8,
          radius: u * 0.05,
        },
        {
          x0: w * 0.6,
          y0: h * 0.42,
          axis: "x",
          amplitude: w * 0.12,
          period: 3.2,
          radius: u * 0.05,
        },
      ],
      inkCapacity: Infinity,
    };
  },
  // Level 12 --- a large combined course built around an upper-right goal
  // (kept well clear of both edges) rather than the low-centre goal every
  // earlier level used, so reaching it takes real rightward travel across
  // the whole scene, not just a short fall. Four fixed obstacles and two
  // moving obstacles (different axes/phases, still simple oscillation) sit
  // across that span with a guarded corridor right in front of the goal,
  // while the lower half of the screen stays open as a recovery area for a
  // rescue line after a missed first redirect. No longer the final level ---
  // Levels 13-16 were added after this one shipped --- but left otherwise
  // unchanged.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.08, h * 0.05, u),
        goal: { x: w * 0.74, y: h * 0.22, radius: u * 0.15 },
        obstacles: [
          { x: w * 0.28, y: h * 0.14, radius: u * 0.06 },
          { x: w * 0.5, y: h * 0.3, radius: u * 0.065 },
          { x: w * 0.68, y: h * 0.42, radius: u * 0.065 },
          { x: w * 0.42, y: h * 0.55, radius: u * 0.06 },
        ],
        movingObstacles: [
          {
            x0: w * 0.6,
            y0: h * 0.2,
            axis: "x",
            amplitude: w * 0.14,
            period: 2.6,
            radius: u * 0.05,
          },
          {
            x0: w * 0.3,
            y0: h * 0.38,
            axis: "y",
            amplitude: h * 0.1,
            period: 3,
            radius: u * 0.045,
          },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.06, h * 0.08, u),
      goal: { x: w * 0.85, y: h * 0.24, radius: u * 0.11 },
      obstacles: [
        { x: w * 0.28, y: h * 0.18, radius: u * 0.055 },
        { x: w * 0.48, y: h * 0.35, radius: u * 0.06 },
        { x: w * 0.65, y: h * 0.45, radius: u * 0.06 },
        { x: w * 0.4, y: h * 0.6, radius: u * 0.055 },
      ],
      movingObstacles: [
        {
          x0: w * 0.58,
          y0: h * 0.22,
          axis: "x",
          amplitude: w * 0.12,
          period: 2.6,
          radius: u * 0.045,
        },
        {
          x0: w * 0.3,
          y0: h * 0.4,
          axis: "y",
          amplitude: h * 0.1,
          period: 3,
          radius: u * 0.04,
        },
      ],
      inkCapacity: Infinity,
    };
  },
  // Level 13 --- obstacle route: back to purely fixed geometry (no moving
  // obstacle at all), but denser than Level 9's --- four staggered obstacles
  // in a zigzag the ball must be redirected through. Ball starts top-left
  // drifting right/down as always; the goal sits low and back on the *left*
  // side, so the natural rightward drift never gets there on its own (same
  // trick as Level 4, just with obstacles now in the way of the route back).
  // Unlimited ink; gaps between obstacles stay wide enough that an imperfect
  // redirect is still recoverable with a second line rather than fatal.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.12, h * 0.05, u),
        goal: { x: w * 0.22, y: h * 0.92, radius: u * 0.13 },
        obstacles: [
          { x: w * 0.55, y: h * 0.22, radius: u * 0.07 },
          { x: w * 0.25, y: h * 0.42, radius: u * 0.07 },
          { x: w * 0.62, y: h * 0.58, radius: u * 0.07 },
          { x: w * 0.35, y: h * 0.75, radius: u * 0.07 },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.06, h * 0.08, u),
      goal: { x: w * 0.15, y: h * 0.85, radius: u * 0.1 },
      obstacles: [
        { x: w * 0.4, y: h * 0.22, radius: u * 0.065 },
        { x: w * 0.2, y: h * 0.42, radius: u * 0.065 },
        { x: w * 0.48, y: h * 0.6, radius: u * 0.065 },
        { x: w * 0.28, y: h * 0.78, radius: u * 0.065 },
      ],
      inkCapacity: Infinity,
    };
  },
  // Level 14 --- double moving obstacle: the level's one new mechanic is
  // timing against *two* independently-moving obstacles instead of one. They
  // use different periods (never the same fraction of Level 11's 2.8/3.2
  // pairing) so they drift out of phase with each other over time rather
  // than ever settling into one fixed simultaneous gap, and they sit at
  // different heights so the ball meets them one at a time, not both at
  // once. One small fixed obstacle adds a touch of geometry without
  // competing with the timing read. Unlimited ink.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.15, h * 0.06, u),
        goal: { x: w * 0.7, y: h * 0.88, radius: u * 0.12 },
        obstacles: [{ x: w * 0.3, y: h * 0.4, radius: u * 0.065 }],
        movingObstacles: [
          {
            x0: w * 0.55,
            y0: h * 0.35,
            axis: "x",
            amplitude: w * 0.2,
            period: 2.4,
            radius: u * 0.055,
          },
          {
            x0: w * 0.4,
            y0: h * 0.62,
            axis: "y",
            amplitude: h * 0.12,
            period: 3.1,
            radius: u * 0.055,
          },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.06, h * 0.1, u),
      goal: { x: w * 0.85, y: h * 0.82, radius: u * 0.1 },
      obstacles: [{ x: w * 0.18, y: h * 0.5, radius: u * 0.06 }],
      movingObstacles: [
        {
          x0: w * 0.4,
          y0: h * 0.3,
          axis: "y",
          amplitude: h * 0.16,
          period: 2.4,
          radius: u * 0.05,
        },
        {
          x0: w * 0.65,
          y0: h * 0.55,
          axis: "x",
          amplitude: w * 0.12,
          period: 3.1,
          radius: u * 0.05,
        },
      ],
      inkCapacity: Infinity,
    };
  },
  // Level 15 --- route choice: two staggered pairs of fixed obstacles form a
  // left lane and a right lane, both converging on one wide goal centred at
  // the bottom, so which lane to commit to is a real spatial choice read off
  // the ball's current drift rather than a hint or label. Neither lane is a
  // single exact shot --- each has an open gap between its own two obstacles
  // --- and a generous goal radius means either lane, even taken
  // imperfectly, still lands. One moving obstacle sits in the dead centre so
  // a naive straight fall between the lanes isn't the easy hidden answer;
  // it doesn't block either lane itself. Unlimited ink.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.5, h * 0.06, u),
        goal: { x: w * 0.5, y: h * 0.92, radius: u * 0.15 },
        obstacles: [
          { x: w * 0.28, y: h * 0.3, radius: u * 0.08 },
          { x: w * 0.35, y: h * 0.62, radius: u * 0.08 },
          { x: w * 0.72, y: h * 0.4, radius: u * 0.08 },
          { x: w * 0.65, y: h * 0.7, radius: u * 0.08 },
        ],
        movingObstacles: [
          {
            x0: w * 0.5,
            y0: h * 0.55,
            axis: "x",
            amplitude: w * 0.12,
            period: 2.6,
            radius: u * 0.06,
          },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.5, h * 0.08, u),
      goal: { x: w * 0.5, y: h * 0.88, radius: u * 0.13 },
      obstacles: [
        { x: w * 0.32, y: h * 0.32, radius: u * 0.07 },
        { x: w * 0.38, y: h * 0.6, radius: u * 0.07 },
        { x: w * 0.68, y: h * 0.4, radius: u * 0.07 },
        { x: w * 0.62, y: h * 0.66, radius: u * 0.07 },
      ],
      movingObstacles: [
        {
          x0: w * 0.5,
          y0: h * 0.52,
          axis: "x",
          amplitude: w * 0.1,
          period: 2.6,
          radius: u * 0.05,
        },
      ],
      inkCapacity: Infinity,
    };
  },
  // Level 16 (final) --- the true combined course: no new mechanic, just
  // every earlier one laid out as several readable sections back to back ---
  // an early fixed obstacle forcing a first redirect, a two-obstacle
  // gauntlet, a deliberately empty recovery gap, two moving obstacles timed
  // against each other, then a final pair of fixed obstacles offering one
  // last left/right choice before a wide goal. The goal now sits in the
  // lower-left of the screen (moved there after the level first shipped, and
  // before that briefly lived upper-right); one of the two route-decision
  // obstacles was nudged just enough to stop overlapping the relocated goal,
  // and every other coordinate below is unchanged from the original layout.
  // Unlimited ink throughout, and every radius stays generous --- this is
  // meant to read as "I understand the system now", not as a precision test.
  (w, h, u) => {
    if (h > w) {
      return {
        ball: ballAt(w * 0.08, h * 0.04, u),
        goal: { x: w * 0.2, y: h * 0.82, radius: u * 0.14 },
        obstacles: [
          { x: w * 0.42, y: h * 0.15, radius: u * 0.06 },
          { x: w * 0.65, y: h * 0.28, radius: u * 0.065 },
          { x: w * 0.32, y: h * 0.4, radius: u * 0.065 },
          { x: w * 0.28, y: h * 0.68, radius: u * 0.06 },
          { x: w * 0.65, y: h * 0.8, radius: u * 0.06 },
        ],
        movingObstacles: [
          {
            x0: w * 0.55,
            y0: h * 0.58,
            axis: "x",
            amplitude: w * 0.18,
            period: 2.6,
            radius: u * 0.055,
          },
          {
            x0: w * 0.4,
            y0: h * 0.68,
            axis: "y",
            amplitude: h * 0.09,
            period: 3.1,
            radius: u * 0.05,
          },
        ],
        inkCapacity: Infinity,
      };
    }
    return {
      ball: ballAt(w * 0.05, h * 0.06, u),
      goal: { x: w * 0.14, y: h * 0.8, radius: u * 0.12 },
      obstacles: [
        { x: w * 0.28, y: h * 0.2, radius: u * 0.055 },
        { x: w * 0.45, y: h * 0.35, radius: u * 0.06 },
        { x: w * 0.22, y: h * 0.48, radius: u * 0.06 },
        { x: w * 0.32, y: h * 0.75, radius: u * 0.055 },
        { x: w * 0.48, y: h * 0.78, radius: u * 0.055 },
      ],
      movingObstacles: [
        {
          x0: w * 0.4,
          y0: h * 0.6,
          axis: "x",
          amplitude: w * 0.14,
          period: 2.6,
          radius: u * 0.05,
        },
        {
          x0: w * 0.6,
          y0: h * 0.68,
          axis: "y",
          amplitude: h * 0.1,
          period: 3.1,
          radius: u * 0.045,
        },
      ],
      inkCapacity: Infinity,
    };
  },
];

let phase: Phase = "playing";
let levelIndex = 0;
let ball: Ball = ballAt(0, 0, 1);
let goal: Goal = { x: 0, y: 0, radius: 1 };
let obstacles: Obstacle[] = [];
let inkCapacity = Infinity;
let remainingInk = Infinity;
let lines: Vec2[][] = [];
let currentLine: Vec2[] | null = null;
let lastTime = 0;
let successT = 0;
let finishedT = 0;
let failTimeoutId: number | undefined;
let resetTimeoutId: number | undefined;
let movingObstacles: MovingObstacleConfig[] = [];
let movingObstacleElapsed = 0;
let movingObstaclePositions: Vec2[] = [];
let movingObstacleHit = false;
// Which moving obstacle caused the current failure, so only that one gets
// the "struck" flash while any others keep their normal colour.
let hitMovingObstacleIndex: number | null = null;
// Distinguishes the moving obstacle's failure from the generic
// leave-the-play-area failure so it can get its own visual cue instead of
// reusing the same flash for a different cause.
let failCause: "offscreen" | "obstacle" = "offscreen";
// True once the cover screen's start button has been pressed. The RAF loop
// itself doesn't start until then, so the game underneath the cover simply
// never advances --- no separate "cover phase" needed in the Phase state.
let started = false;

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  angularVelocity: number;
  color: string;
  width: number;
  height: number;
  age: number;
  lifespan: number;
  kind: "confetti" | "ribbon";
}

// Only ever populated once, when the final level's goal is reached (see
// triggerFinished), and always bounded in size --- there is no ongoing
// spawner, so the array only ever shrinks back to empty as particles expire.
let confetti: ConfettiParticle[] = [];
const CONFETTI_COLORS = ["#d8492b", "#2f6b52", "#4a5c73", "#c9a227", "#8a6d3b"];
const CONFETTI_COUNT = 70;
const CONFETTI_COUNT_REDUCED_MOTION = 14;

function clearPendingTimers(): void {
  if (failTimeoutId !== undefined) {
    window.clearTimeout(failTimeoutId);
    failTimeoutId = undefined;
  }
  if (resetTimeoutId !== undefined) {
    window.clearTimeout(resetTimeoutId);
    resetTimeoutId = undefined;
  }
}

// Loads `index` from LEVEL_DEFS against the live viewport, replacing all
// per-level state (ball, goal, obstacles, ink) and clearing drawn lines.
// Used for the initial load, a level restart, and advancing to the next
// level --- always the single source of truth for "what level N looks like".
function loadLevel(index: number): void {
  const config = LEVEL_DEFS[index](width, height, unit());
  ball = config.ball;
  goal = config.goal;
  obstacles = config.obstacles;
  inkCapacity = config.inkCapacity;
  remainingInk = config.inkCapacity;
  lines = [];
  currentLine = null;
  successT = 0;
  movingObstacles = config.movingObstacles ?? [];
  movingObstacleElapsed = 0;
  movingObstaclePositions = movingObstacles.map((m) => movingObstaclePosition(m, 0));
  movingObstacleHit = false;
  hitMovingObstacleIndex = null;
  confetti = [];
  phase = "playing";
}

// The restart button's action: cancel any pending failure/reset timers first,
// so a stray one firing later can't wipe out lines the player just drew.
// Restarts the level in progress; only jumps back to Level 1 if the whole
// run had already finished, since there is no "current level" to restart at
// that point.
function restartLevel(): void {
  clearPendingTimers();
  if (phase === "finished") {
    levelIndex = 0;
  }
  loadLevel(levelIndex);
}

function togglePause(): void {
  const next = togglePausePhase(phase);
  if (next === phase) return;
  phase = next;
  if (phase === "paused") {
    // Discard rather than commit an in-progress stroke so it can't finish
    // drawing while paused.
    currentLine = null;
  }
}

function updateControlsUI(): void {
  const panelOpen = !levelPanel.hidden;
  const canPause = (phase === "playing" || phase === "paused") && !panelOpen;
  pauseBtn.disabled = !canPause;
  pauseBtn.textContent = phase === "paused" ? "▶" : "Ⅱ";
  pauseBtn.setAttribute("aria-label", phase === "paused" ? "Resume" : "Pause");
  restartBtn.disabled = panelOpen;
  levelSelectBtn.setAttribute("aria-expanded", panelOpen ? "true" : "false");
}

restartBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
restartBtn.addEventListener("click", restartLevel);
pauseBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
pauseBtn.addEventListener("click", () => {
  togglePause();
  updateControlsUI();
});

// Opening the panel freezes the run: the RAF loop keeps rendering but skips
// every phase-progression branch entirely (see frame()), so the ball, moving
// obstacles, success/finished timers and confetti all stop exactly where
// they were --- no phase mutation needed for the common "playing" case, so
// closing without choosing a level resumes that exact state. The one
// exception is "failed"/"resetting": those are driven by real setTimeouts
// that run regardless of the RAF loop, so they're settled immediately
// instead of being allowed to fire invisibly behind the panel.
function openLevelPanel(): void {
  if (phase === "failed" || phase === "resetting") {
    clearPendingTimers();
    loadLevel(levelIndex);
  }
  currentLine = null;
  levelPanel.hidden = false;
  levelPanelClose.focus();
  updateControlsUI();
}

function closeLevelPanel(): void {
  levelPanel.hidden = true;
  levelSelectBtn.focus();
  updateControlsUI();
}

// Selecting a level reuses loadLevel() verbatim --- the single source of
// truth for "what level N looks like" --- so ball/lines/obstacles/moving
// obstacles/ink/confetti all reset and phase returns to "playing" with no
// separate logic needed, whether this is called from mid-play or from the
// finished/ending state.
function selectLevel(index: number): void {
  clearPendingTimers();
  levelIndex = index;
  loadLevel(index);
  levelPanel.hidden = true;
  levelSelectBtn.focus();
  updateControlsUI();
}

function buildLevelGrid(): void {
  for (let i = 0; i < LEVEL_DEFS.length; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "level-btn";
    button.textContent = String(i + 1);
    button.setAttribute("aria-label", `Level ${i + 1}`);
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", () => selectLevel(i));
    levelGrid.appendChild(button);
  }
}

levelSelectBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
levelSelectBtn.addEventListener("click", openLevelPanel);
levelPanelClose.addEventListener("pointerdown", (event) => event.stopPropagation());
levelPanelClose.addEventListener("click", closeLevelPanel);
// Closing on a backdrop tap: the card is a nested child, so a click that
// bubbles up with the panel itself as the target means it landed outside
// the card.
levelPanel.addEventListener("click", (event) => {
  if (event.target === levelPanel) closeLevelPanel();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !levelPanel.hidden) closeLevelPanel();
});
buildLevelGrid();

// The cover is a plain DOM overlay, not a Phase; the RAF loop (see the
// bottom of this file) simply doesn't start until this fires, so nothing
// behind it advances until the player deliberately begins.
function startGame(): void {
  if (started) return;
  started = true;
  coverEl.hidden = true;
  controlsEl.hidden = false;
  lastTime = 0;
  pauseBtn.focus();
  requestAnimationFrame(frame);
}

startBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
startBtn.addEventListener("click", startGame);
startBtn.focus();

updateControlsUI();

function resizeCanvas(): void {
  width = window.innerWidth;
  height = window.innerHeight;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // A resize invalidates drawn-line coordinates against the new geometry,
  // so start the current level over rather than leave stale lines in place.
  restartLevel();
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

function toLocal(event: PointerEvent): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function onPointerDown(event: PointerEvent): void {
  if (phase !== "playing") return;
  if (!levelPanel.hidden) return;
  if (remainingInk <= 0) return;
  canvas.setPointerCapture(event.pointerId);
  currentLine = [toLocal(event)];
  event.preventDefault();
}

// Ink is spent in logical (CSS-pixel) coordinates, the same space gameplay
// geometry lives in, so a stroke costs the same regardless of device pixel
// density. A stroke is clipped to exactly the ink remaining rather than
// rejected outright, so the player always gets to use every last bit of it.
function onPointerMove(event: PointerEvent): void {
  if (!currentLine) return;
  if (remainingInk <= 0) return;
  const point = toLocal(event);
  const last = currentLine[currentLine.length - 1];
  if (distance(last, point) < MIN_DRAW_POINT_GAP) return;
  const clamped = clampPointToInk(last, point, remainingInk);
  currentLine.push(clamped);
  remainingInk = consumeInk(remainingInk, distance(last, clamped));
}

function endStroke(event: PointerEvent): void {
  if (!currentLine) return;
  if (currentLine.length >= 2) {
    lines.push(currentLine);
  }
  currentLine = null;
  event.preventDefault();
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", endStroke);
window.addEventListener("pointercancel", endStroke);

// Treats every drawn line as a capsule (thickness = ball radius + half the
// stroke width) and pushes the ball back out to that capsule's surface the
// moment it's crossed, reflecting velocity off the push-out direction. Doing
// this every substep, rather than once per frame, is what keeps a fast ball
// from tunnelling through a thin line.
function applyLineCollisions(): void {
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const closest = closestPointOnSegment(ball, a, b);
      const d = distance(ball, closest);
      const minDist = ball.radius + LINE_HALF_THICKNESS;
      if (d >= minDist) continue;

      let nx: number;
      let ny: number;
      if (d === 0) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        nx = -dy / len;
        ny = dx / len;
      } else {
        nx = (ball.x - closest.x) / d;
        ny = (ball.y - closest.y) / d;
      }

      ball.x = closest.x + nx * minDist;
      ball.y = closest.y + ny * minDist;
      const reflected = reflectVelocity({ x: ball.vx, y: ball.vy }, { x: nx, y: ny }, RESTITUTION);
      ball.vx = reflected.x;
      ball.vy = reflected.y;
    }
  }
}

// A fixed obstacle is a solid circle the ball bounces off, using the exact
// same reflection rule as a drawn line (push out along the contact normal,
// reflect velocity through it) so its behaviour is predictable and
// consistent with everything else the ball can touch.
function applyObstacleCollisions(): void {
  for (const obstacle of obstacles) {
    const d = distance(ball, obstacle);
    const minDist = ball.radius + obstacle.radius;
    if (d >= minDist) continue;

    const nx = d === 0 ? 1 : (ball.x - obstacle.x) / d;
    const ny = d === 0 ? 0 : (ball.y - obstacle.y) / d;

    ball.x = obstacle.x + nx * minDist;
    ball.y = obstacle.y + ny * minDist;
    const reflected = reflectVelocity({ x: ball.vx, y: ball.vy }, { x: nx, y: ny }, RESTITUTION);
    ball.vx = reflected.x;
    ball.vy = reflected.y;
  }
}

// Every moving obstacle's position is a pure function of the same shared
// elapsed-playing-time clock (movingObstaclePosition in physics.ts), and
// that clock only advances inside this substep loop --- which only ever
// runs while phase === "playing" (see frame()). So pause freezing every
// obstacle's motion and restart resetting all of their phases both fall out
// of the existing architecture, with no per-obstacle bookkeeping needed.
function advanceMovingObstacles(subDt: number): void {
  if (movingObstacles.length === 0) return;
  movingObstacleElapsed += subDt;
  for (let i = 0; i < movingObstacles.length; i++) {
    const config = movingObstacles[i];
    const pos = movingObstaclePosition(config, movingObstacleElapsed);
    movingObstaclePositions[i] = pos;
    if (distance(ball, pos) < ball.radius + config.radius) {
      movingObstacleHit = true;
      hitMovingObstacleIndex = i;
    }
  }
}

function stepPhysics(dt: number): void {
  const gravity = unit() * GRAVITY_FACTOR;
  const maxFallSpeed = unit() * MAX_FALL_SPEED_FACTOR;
  const subDt = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) {
    ball.vy += gravity * subDt;
    if (ball.vy > maxFallSpeed) ball.vy = maxFallSpeed;
    ball.x += ball.vx * subDt;
    ball.y += ball.vy * subDt;
    applyLineCollisions();
    applyObstacleCollisions();
    advanceMovingObstacles(subDt);
  }
}

function reachedGoal(): boolean {
  return distance(ball, goal) < goal.radius - ball.radius * 0.2;
}

function leftPlayableArea(): boolean {
  const margin = ball.radius * 2;
  return (
    ball.y - margin > height ||
    ball.y + margin < 0 ||
    ball.x + margin < 0 ||
    ball.x - margin > width
  );
}

function triggerSuccess(): void {
  phase = "success";
  successT = 0;
  ball.vx = 0;
  ball.vy = 0;
}

function triggerFailure(cause: "offscreen" | "obstacle" = "offscreen"): void {
  failCause = cause;
  phase = "failed";
  failTimeoutId = window.setTimeout(() => {
    phase = "resetting";
    resetTimeoutId = window.setTimeout(() => loadLevel(levelIndex), RESET_MS);
  }, FAIL_REACT_MS);
}

// The one-time ending after the final level: the scene clears down to just
// the ball settled at the goal's centre, with a glow and a CONGRATULATIONS
// message that both bloom in (see finishedT in frame()) to read as a
// stronger arrival than a mid-run success --- which shrinks and fades
// instead of growing --- leaving a stable composition distinct from every
// earlier level transition. Confetti is spawned exactly once here, never
// re-topped-up, so it settles and stays settled rather than looping.
function triggerFinished(): void {
  phase = "finished";
  finishedT = 0;
  ball.vx = 0;
  ball.vy = 0;
  ball.x = goal.x;
  ball.y = goal.y;
  lines = [];
  obstacles = [];
  movingObstacles = [];
  movingObstaclePositions = [];
  currentLine = null;
  spawnConfetti();
}

// Bounded, one-shot burst of paper-confetti and ribbon shapes falling in
// from above the goal. Sizes and speeds scale with unit()/width/height so
// the celebration reads the same way at 1920x1080 and 390x844. Respects
// prefers-reduced-motion with a much smaller, nearly-static set of pieces
// instead of a full animated burst.
function spawnConfetti(): void {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const count = reducedMotion ? CONFETTI_COUNT_REDUCED_MOTION : CONFETTI_COUNT;
  const pieces: ConfettiParticle[] = [];
  for (let i = 0; i < count; i++) {
    const kind: ConfettiParticle["kind"] = i % 3 === 0 ? "ribbon" : "confetti";
    pieces.push({
      x: width * (0.5 + (Math.random() - 0.5) * 0.7),
      y: height * -0.08 - Math.random() * height * 0.18,
      vx: (Math.random() - 0.5) * unit() * (reducedMotion ? 0.01 : 0.14),
      vy: reducedMotion ? 0 : unit() * (0.08 + Math.random() * 0.12),
      rotation: Math.random() * Math.PI * 2,
      angularVelocity: reducedMotion ? 0 : (Math.random() - 0.5) * 4,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      width: kind === "ribbon" ? unit() * 0.012 : unit() * 0.018,
      height: kind === "ribbon" ? unit() * 0.06 : unit() * 0.028,
      age: 0,
      lifespan: reducedMotion ? 3 : 2.4 + Math.random() * 1.4,
      kind,
    });
  }
  confetti = pieces;
}

// Advances the one-shot confetti burst; pieces are dropped once they expire
// or fall below the visible area, so the array only ever shrinks and the
// celebration settles rather than running forever.
function updateConfetti(dt: number): void {
  for (const piece of confetti) {
    piece.age += dt;
    piece.x += piece.vx * dt;
    piece.y += piece.vy * dt;
    piece.vy += unit() * 0.06 * dt;
    piece.rotation += piece.angularVelocity * dt;
  }
  confetti = confetti.filter((piece) => piece.age < piece.lifespan && piece.y < height + unit() * 0.1);
}

function drawPaper(): void {
  const gradient = ctx.createRadialGradient(
    width * 0.5,
    height * 0.4,
    0,
    width * 0.5,
    height * 0.4,
    unit() * 1.1,
  );
  gradient.addColorStop(0, "#faf6ea");
  gradient.addColorStop(1, "#e9dfc8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawLine(points: Vec2[]): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "#2b2620";
  ctx.lineWidth = LINE_HALF_THICKNESS * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
}

function drawObstacle(obstacle: Obstacle): void {
  ctx.save();
  ctx.fillStyle = "#2b2620";
  ctx.beginPath();
  ctx.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Drawn in a distinct muted-blue tone (rather than the fixed obstacles'
// dark fill) so it visually reads as a different kind of thing before it
// even starts moving. On the frame it causes a failure, only the specific
// obstacle that was hit (hitMovingObstacleIndex) flashes the same warm-red
// tone as the ball; any others on screen keep their normal colour.
function drawMovingObstacles(): void {
  for (let i = 0; i < movingObstacles.length; i++) {
    const pos = movingObstaclePositions[i];
    if (!pos) continue;
    ctx.save();
    const struck =
      (phase === "failed" || phase === "resetting") && failCause === "obstacle" && hitMovingObstacleIndex === i;
    ctx.fillStyle = struck ? "#d8492b" : "#4a5c73";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, movingObstacles[i].radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawGoal(): void {
  ctx.save();
  const grow = phase === "success" ? successT * 0.3 : 0;
  ctx.globalAlpha = phase === "success" ? Math.max(0, 1 - successT * 0.7) : 0.85;
  ctx.strokeStyle = "#2f6b52";
  ctx.lineWidth = Math.max(3, goal.radius * 0.12);
  ctx.beginPath();
  ctx.arc(goal.x, goal.y, goal.radius * (1 + grow), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBall(): void {
  ctx.save();
  ctx.fillStyle = "#d8492b";
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFailFlash(): void {
  ctx.save();
  ctx.fillStyle = "rgba(43, 38, 32, 0.2)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// A simple non-verbal ink reservoir: an outlined bar that fills from the
// bottom. Fixed CSS-px size (not scaled by unit()) so it reads as UI rather
// than world geometry, and only drawn for levels that actually limit ink.
function drawInkMeter(): void {
  if (!Number.isFinite(inkCapacity) || inkCapacity <= 0) return;
  const barBottom = height - INK_METER_MARGIN;
  const barTop = barBottom - INK_METER_HEIGHT;
  const fillRatio = Math.max(0, Math.min(1, remainingInk / inkCapacity));
  const fillTop = barBottom - INK_METER_HEIGHT * fillRatio;

  ctx.save();
  ctx.strokeStyle = "rgba(43, 38, 32, 0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(INK_METER_MARGIN, barTop, INK_METER_WIDTH, INK_METER_HEIGHT);
  ctx.fillStyle = "rgba(43, 38, 32, 0.75)";
  ctx.fillRect(INK_METER_MARGIN, fillTop, INK_METER_WIDTH, barBottom - fillTop);
  ctx.restore();
}

// Blooms outward over FINISHED_GROW_MS (see finishedT in frame()) instead of
// appearing at full size immediately, so the true ending reads as a
// stronger, more settled arrival than a mid-run success --- entirely
// through motion and light, with no text.
function drawFinishedGlow(): void {
  ctx.save();
  const grow = 0.4 + 0.6 * finishedT;
  const radius = goal.radius * 2.2 * grow;
  const gradient = ctx.createRadialGradient(goal.x, goal.y, 0, goal.x, goal.y, radius);
  gradient.addColorStop(0, `rgba(47, 107, 82, ${0.35 * grow})`);
  gradient.addColorStop(1, "rgba(47, 107, 82, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(goal.x, goal.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Draws each confetti/ribbon piece rotated about its own centre, fading out
// over its lifespan rather than disappearing abruptly.
function drawConfetti(): void {
  for (const piece of confetti) {
    const alpha = Math.max(0, 1 - piece.age / piece.lifespan);
    if (alpha <= 0) continue;
    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.rotation);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = piece.color;
    if (piece.kind === "ribbon") {
      ctx.beginPath();
      ctx.moveTo(-piece.width / 2, -piece.height / 2);
      ctx.quadraticCurveTo(piece.width * 1.5, 0, -piece.width / 2, piece.height / 2);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
    }
    ctx.restore();
  }
}

// The only text the game ever shows: a short scale/fade-in tied to the same
// finishedT used for the goal's glow, so both arrive together. This is an
// ending message, not a tutorial hint, which is the one thing this project
// otherwise never puts on screen.
function drawCongratulations(): void {
  const scale = 0.7 + 0.3 * finishedT;
  const alpha = Math.min(1, finishedT * 1.4);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(width / 2, height * 0.32);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#2b2620";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(28, unit() * 0.09)}px system-ui, sans-serif`;
  ctx.fillText("CONGRATULATIONS", 0, 0);
  ctx.restore();
}

function render(): void {
  ctx.clearRect(0, 0, width, height);
  drawPaper();
  if (phase === "finished") {
    drawFinishedGlow();
    drawBall();
    drawConfetti();
    drawCongratulations();
    return;
  }
  drawGoal();
  for (const obstacle of obstacles) drawObstacle(obstacle);
  drawMovingObstacles();
  for (const line of lines) drawLine(line);
  if (currentLine) drawLine(currentLine);
  if (phase !== "failed" && phase !== "resetting") drawBall();
  if (phase === "failed" || phase === "resetting") drawFailFlash();
  drawInkMeter();
}

function frame(time: number): void {
  if (!lastTime) lastTime = time;
  const dt = Math.min((time - lastTime) / 1000, MAX_DT);
  lastTime = time;

  // While the level-select panel is open, skip every phase-progression
  // branch below entirely --- ball, moving obstacles, success/finished
  // timers and confetti all stay exactly where they were. render() still
  // runs so the frozen scene shows (dimmed) behind the panel.
  if (!levelPanel.hidden) {
    render();
    updateControlsUI();
    requestAnimationFrame(frame);
    return;
  }

  if (phase === "playing") {
    stepPhysics(dt);
    if (reachedGoal()) {
      triggerSuccess();
    } else if (movingObstacleHit) {
      triggerFailure("obstacle");
    } else if (leftPlayableArea()) {
      triggerFailure("offscreen");
    }
  } else if (phase === "success") {
    successT = Math.min(1, successT + dt / (SUCCESS_SETTLE_MS / 1000));
    if (successT >= 1) {
      if (levelIndex + 1 < LEVEL_DEFS.length) {
        levelIndex++;
        loadLevel(levelIndex);
      } else {
        triggerFinished();
      }
    }
  } else if (phase === "finished") {
    finishedT = Math.min(1, finishedT + dt / (FINISHED_GROW_MS / 1000));
    updateConfetti(dt);
  }

  render();
  updateControlsUI();
  requestAnimationFrame(frame);
}
