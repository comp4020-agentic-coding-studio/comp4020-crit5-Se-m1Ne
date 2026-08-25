import { describe, expect, it } from "vitest";
import { togglePausePhase } from "../physics.ts";

describe("togglePausePhase", () => {
  it("pauses from playing", () => {
    expect(togglePausePhase("playing")).toBe("paused");
  });

  it("resumes from paused back to playing", () => {
    expect(togglePausePhase("paused")).toBe("playing");
  });

  it("leaves success, failed, resetting, and finished untouched", () => {
    expect(togglePausePhase("success")).toBe("success");
    expect(togglePausePhase("failed")).toBe("failed");
    expect(togglePausePhase("resetting")).toBe("resetting");
    expect(togglePausePhase("finished")).toBe("finished");
  });
});
