export interface Vec2 {
  x: number;
  y: number;
}

export type Phase = "playing" | "paused" | "success" | "failed" | "resetting" | "finished";

// The only two phases pause/resume ever move between. Any other phase
// (success/failed/resetting/finished) is left as-is, since pausing
// mid-transition would create invalid combinations like "paused + resetting",
// and there is nothing left to pause once the run is finished.
export function togglePausePhase(phase: Phase): Phase {
  if (phase === "playing") return "paused";
  if (phase === "paused") return "playing";
  return phase;
}

// Reflects `velocity` off a surface whose outward-facing unit `normal`
// points from the surface toward whatever it hit. `restitution` of 1 is a
// perfectly elastic bounce; below 1 bleeds off some speed on every contact.
// If the velocity is already moving away from the surface, it's left alone
// so a ball that's already clear of a line never gets a second flip.
export function reflectVelocity(velocity: Vec2, normal: Vec2, restitution: number): Vec2 {
  const dot = velocity.x * normal.x + velocity.y * normal.y;
  if (dot >= 0) {
    return velocity;
  }
  const factor = (1 + restitution) * dot;
  return {
    x: velocity.x - factor * normal.x,
    y: velocity.y - factor * normal.y,
  };
}

// The nearest point to `point` lying on the segment a-b, clamped to the
// segment's ends. Used to treat a drawn line as a capsule for collision.
export function closestPointOnSegment(point: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) {
    return a;
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Deducts `length` from `remainingInk`, clamped so ink never goes negative.
export function consumeInk(remainingInk: number, length: number): number {
  return Math.max(0, remainingInk - length);
}

// Clips segment a-b to at most `remainingInk` long, measured from `a`. Used
// so a drawn stroke stops extending exactly when the ink runs out instead of
// overshooting past it.
export function clampPointToInk(a: Vec2, b: Vec2, remainingInk: number): Vec2 {
  if (remainingInk <= 0) {
    return a;
  }
  const segmentLength = distance(a, b);
  if (segmentLength <= remainingInk) {
    return b;
  }
  const t = remainingInk / segmentLength;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface MovingObstacleConfig {
  x0: number;
  y0: number;
  axis: "x" | "y";
  amplitude: number;
  period: number;
  radius: number;
}

// A moving obstacle's position is a pure function of how much *playing* time
// has elapsed, not wall-clock time, so it is exactly reproducible: pausing
// (elapsed stops advancing) and restarting (elapsed resets to 0) both fall
// out of how the caller accumulates `elapsed`, with no extra state here.
export function movingObstaclePosition(config: MovingObstacleConfig, elapsed: number): Vec2 {
  const offset = Math.sin((elapsed / config.period) * Math.PI * 2) * config.amplitude;
  return config.axis === "x"
    ? { x: config.x0 + offset, y: config.y0 }
    : { x: config.x0, y: config.y0 + offset };
}
