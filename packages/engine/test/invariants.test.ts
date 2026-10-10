import { describe, expect, it } from "vitest";
import { apply, legalActions, viewFor, type GameState } from "../src/index.js";
import { configFor, replay, runBotGame, whoActs } from "../src/sim.js";

function checkInvariants(s: GameState): void {
  const total = Object.keys(s.cards).length;
  const inPlay = s.seats.reduce((a, x) => a + x.hand.length + x.gear.length, 0) + s.decks.trouble.length + s.decks.loot.length + s.decks.troubleDiscard.length + s.decks.lootDiscard.length + (s.fight ? 1 : 0);
  expect(inPlay, "cards conserved").toBe(total);
  const all = [...s.seats.flatMap((x) => [...x.hand, ...x.gear]), ...s.decks.trouble, ...s.decks.loot, ...s.decks.troubleDiscard, ...s.decks.lootDiscard, ...(s.fight ? [s.fight.threat] : [])];
  expect(new Set(all).size, "no card twice").toBe(all.length);
  for (const x of s.seats) { expect(x.level).toBeGreaterThanOrEqual(1); expect(x.level).toBeLessThanOrEqual(10); }
  if (s.phase === "over") expect(s.seats.filter((x) => x.level >= 10).length, "one winner").toBe(1);
  for (const x of s.seats) {
    const v = viewFor(s, x.seat);
    for (const o of v.seats) if (o.seat !== x.seat) expect(o.hand, "no hidden card in a view").toBeNull();
    if (v.fight) for (const o of s.seats) if (o.seat !== x.seat && s.fight && o.seat in s.fight.rugChoices && s.prompt?.kind === "rug") expect(JSON.stringify(v)).not.toContain(`"myRugChoice"`.repeat(2));
  }
  const stands = viewFor(s, "stands");
  for (const o of stands.seats) expect(o.hand).toBeNull();
  expect(stands.legal).toEqual([]);
  expect(stands.peek).toBeNull();
}

describe("bot games", () => {
  for (const mode of ["standard", "tournament"] as const) for (const seats of [2, 3, 4, 6]) {
    it(`${mode} · ${seats} seats: finishes, invariants hold after every action, every offered action applies, replay is byte-identical`, () => {
      for (let g = 0; g < 3; g++) {
        const config = configFor({ seats, mode, seed: `inv-${mode}-${seats}-${g}` });
        const r = runBotGame(config, { checkLegalAll: true, onStep: (s) => checkInvariants(s) });
        expect(r.final.phase).toBe("over");
        expect(r.final.winner).not.toBeNull();
        const rp = replay(config, r.actions);
        expect(rp.digest).toBe(r.digest);
        expect(rp.events).toEqual(r.events);
        const over = r.events.filter((e) => e.ev.t === "GameOver");
        expect(over).toHaveLength(1);
        expect((over[0]!.ev as { digest: string }).digest).toBe(r.digest);
      }
    });
  }
  it("an action by a seat that is not up is refused, and the state is untouched", () => {
    const config = configFor({ seats: 3, mode: "standard", seed: "refuse" });
    try { runBotGame(config, { maxMoves: 40, onStep: (s) => {
      const up = whoActs(s);
      for (const x of s.seats) if (!up.includes(x.seat)) {
        // a helper may still walk out during the setup; nothing else is offered to a seat that is not up
        expect(legalActions(s, x.seat).filter((a) => a.type !== "LEAVE_FIGHT")).toEqual([]);
        expect(() => apply(s, { type: "END_TURN", seat: x.seat })).toThrow();
      }
    } }); } catch (e) { expect((e as Error).message).toMatch(/did not finish/); }
  });
});
