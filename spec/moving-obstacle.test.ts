import { describe, expect, it } from "vitest";
import { movingObstaclePosition } from "../physics.ts";

describe("movingObstaclePosition", () => {
  const base = { x0: 100, y0: 50, amplitude: 20, period: 4, radius: 10 };

  it("starts at the configured centre when no time has elapsed", () => {
    const result = movingObstaclePosition({ ...base, axis: "x" }, 0);
    expect(result).toEqual({ x: 100, y: 50 });
  });

  it("oscillates along x only, reaching +amplitude a quarter-period in", () => {
    const result = movingObstaclePosition({ ...base, axis: "x" }, 1);
    expect(result.x).toBeCloseTo(120);
    expect(result.y).toBe(50);
  });

  it("oscillates along y only, reaching -amplitude three-quarters through", () => {
    const result = movingObstaclePosition({ ...base, axis: "y" }, 3);
    expect(result.x).toBe(100);
    expect(result.y).toBeCloseTo(30);
  });

  it("is a pure function of elapsed time: same elapsed always gives the same position", () => {
    const a = movingObstaclePosition({ ...base, axis: "x" }, 1.7);
    const b = movingObstaclePosition({ ...base, axis: "x" }, 1.7);
    expect(a).toEqual(b);
  });

  it("returns to the centre after a full period, as it would after a level restart", () => {
    const result = movingObstaclePosition({ ...base, axis: "y" }, 4);
    expect(result.x).toBe(100);
    expect(result.y).toBeCloseTo(50);
  });
});
