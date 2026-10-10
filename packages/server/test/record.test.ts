import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFor, runBotGame } from "@ruglife/engine/sim";
import { rebuildRecords } from "../src/record.js";
import { Store } from "../src/store.js";

function writeGame(store: Store, id: string, kinds: Array<"chog" | "loaner" | "bot">, seed: string, extra: Record<string, unknown> = {}) {
  const config = { ...configFor({ seats: kinds.length, mode: "tournament", seed }), tableId: id };
  config.seats = config.seats.map((s, i) => ({ ...s, kind: kinds[i]! }));
  const r = runBotGame(config);
  store.tableLog(id, { t: "created", at: Date.now(), config: { ...config, seed: undefined }, seedHash: "x", controllers: { "0": "0xAAAA", "1": "0xBBBB" }, ...extra });
  for (const a of r.actions) store.tableLog(id, { t: "act", at: Date.now(), action: a, events: [] });
  // events are stored per action in production; one row with all of them is equivalent for the rebuild
  store.tableLog(id, { t: "act", at: Date.now(), action: { type: "PASS", seat: 0 }, events: r.events });
  store.tableLog(id, { t: "over", at: Date.now(), winner: r.final.winner, seed: config.seed, digest: r.digest });
  return { config, r };
}

describe("the record follows the token", () => {
  it("counts games, wins, levels, rugs and appearances for verified Chogs only; bot, loaner-only and tutorial tables write nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ruglife-rec-"));
    const store = new Store(dir);
    const g1 = writeGame(store, "t1", ["chog", "chog", "bot"], "rec-1");
    const g2 = writeGame(store, "t2", ["chog", "bot"], "rec-2");
    writeGame(store, "t3", ["bot", "bot"], "rec-3");
    writeGame(store, "t4", ["loaner", "bot"], "rec-4");
    writeGame(store, "t5", ["chog", "chog"], "rec-5", { tutorial: true });
    store.tableLog("t6", { t: "created", at: Date.now(), config: { ...g1.config, seed: undefined } }); // unfinished: nothing
    const recs = rebuildRecords(dir);
    const [a, b] = g1.config.seats.map((s) => s.tokenId);
    const ra = recs.get(a!)!;
    expect(ra.games).toBe(1 + (g2.config.seats[0]!.tokenId === a ? 1 : 0));
    const winnerSeat = g1.r.final.winner!;
    const winnerToken = g1.config.seats[winnerSeat]!.tokenId;
    if (winnerSeat <= 1) {
      expect(recs.get(winnerToken)!.wins).toBeGreaterThanOrEqual(1);
      expect(recs.get(winnerToken)!.history.find((h) => h.table === "t1")!.won).toBe(true);
    }
    const h = ra.history.find((x) => x.table === "t1")!;
    expect(h.controller).toBe("0xAAAA");
    expect(h.beside).toEqual([b]);
    expect(h.levelFrom).toBe(6);
    expect(h.levelTo).toBe(g1.r.final.seats[0]!.level);
    const pulled = g1.r.events.filter((e) => (e.ev.t === "RugResolved" && e.ev.puller === 0) || (e.ev.t === "BagTorn" && e.ev.pullers.includes(0))).length;
    expect(h.rugsPulled).toBe(pulled);
    // the bot's token has no games; the bot-only and loaner tables wrote nothing; the tutorial wrote nothing
    const botToken = g1.config.seats[2]!.tokenId;
    expect(recs.get(botToken)?.games ?? 0).toBe(0);
    for (const t of ["t3", "t4", "t5"]) for (const r of recs.values()) expect(r.history.some((x) => x.table === t)).toBe(false);
    // appearances: cast tokens at tables with a human seat
    const casting = (g1.r.events.find((e) => e.ev.t === "GameStarted")!.ev as { casting: Record<string, number> }).casting;
    const someCast = Object.values(casting)[0]!;
    expect(recs.get(someCast)!.appearances).toBeGreaterThanOrEqual(1);
    const total = [...recs.values()].reduce((n, r) => n + r.games, 0);
    expect(total).toBe(2 + 1); // t1: two chogs, t2: one chog
  });
});
