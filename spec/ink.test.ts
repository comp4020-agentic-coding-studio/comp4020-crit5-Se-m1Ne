import { describe, expect, it } from "vitest";
import { clampPointToInk, consumeInk } from "../physics.ts";

describe("consumeInk", () => {
  it("deducts drawn length from remaining ink", () => {
    expect(consumeInk(100, 20)).toBe(80);
  });

  it("clamps at zero instead of going negative", () => {
    expect(consumeInk(5, 20)).toBe(0);
  });
});

describe("clampPointToInk", () => {
  it("returns the full segment when enough ink remains", () => {
    expect(clampPointToInk({ x: 0, y: 0 }, { x: 100, y: 0 }, 200)).toEqual({ x: 100, y: 0 });
  });

  it("limits drawable stroke length to remaining ink", () => {
    expect(clampPointToInk({ x: 0, y: 0 }, { x: 100, y: 0 }, 30)).toEqual({ x: 30, y: 0 });
  });

  it("returns the start point once ink is exhausted", () => {
    expect(clampPointToInk({ x: 10, y: 10 }, { x: 100, y: 100 }, 0)).toEqual({ x: 10, y: 10 });
  });
});
