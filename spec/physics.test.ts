import { describe, expect, it } from "vitest";
import { reflectVelocity } from "../physics.ts";

describe("reflectVelocity", () => {
  it("reflects a downward-moving ball upward off a horizontal surface", () => {
    const result = reflectVelocity({ x: 0, y: 10 }, { x: 0, y: -1 }, 1);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(-10);
  });

  it("redirects a downward-moving ball sideways off a 45-degree surface", () => {
    const normal = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    const result = reflectVelocity({ x: 0, y: 10 }, normal, 1);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(0);
  });

  it("does not let a damped bounce come back faster than it went in", () => {
    const incoming = { x: 0, y: 10 };
    const result = reflectVelocity(incoming, { x: 0, y: -1 }, 0.5);
    const incomingSpeed = Math.hypot(incoming.x, incoming.y);
    const outgoingSpeed = Math.hypot(result.x, result.y);
    expect(outgoingSpeed).toBeLessThanOrEqual(incomingSpeed);
  });

  it("leaves velocity unchanged when already moving away from the surface", () => {
    const result = reflectVelocity({ x: 0, y: -10 }, { x: 0, y: -1 }, 1);
    expect(result).toEqual({ x: 0, y: -10 });
  });
});
