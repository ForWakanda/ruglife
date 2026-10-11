import { describe, expect, it } from "vitest";
import { apply, createGame } from "../src/index.js";
import { configFor } from "../src/sim.js";

describe("TIMEOUT defaults", () => {
  it("a host who sits on the deal gets the table dealt, not autopilot", () => {
    const s = createGame(configFor({ mode: "standard", seats: 3, seed: "timeout-deal" }));
    expect(s.phase).toBe("lobby");
    const r = apply(s, { type: "TIMEOUT", seat: s.seats[0]!.seat });
    expect(r.events.map((e) => e.ev.t)).toContain("Timeout");
    expect(r.events.map((e) => e.ev.t)).toContain("GameStarted");
    expect(r.state.phase).toBe("turn.start");
  });
  it("a non-host seat has nothing to default in the lobby", () => {
    const s = createGame(configFor({ mode: "standard", seats: 3, seed: "timeout-deal" }));
    expect(() => apply(s, { type: "TIMEOUT", seat: s.seats[1]!.seat })).toThrow(/nothing pending/);
  });
});
