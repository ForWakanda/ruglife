// Records bot games as fixtures: config + actions + digest. Run: npx tsx scripts/record-fixtures.ts
import { writeFileSync } from "node:fs";
import { configFor, runBotGame } from "../packages/engine/src/sim.js";
const specs = [
  { name: "standard-2", seats: 2, mode: "standard" as const, seed: "fixture-standard-2" },
  { name: "standard-4", seats: 4, mode: "standard" as const, seed: "fixture-standard-4" },
  { name: "standard-6", seats: 6, mode: "standard" as const, seed: "fixture-standard-6" },
  { name: "tournament-3", seats: 3, mode: "tournament" as const, seed: "fixture-tournament-3" },
  { name: "tournament-6", seats: 6, mode: "tournament" as const, seed: "fixture-tournament-6" },
];
for (const sp of specs) {
  const config = configFor({ seats: sp.seats, mode: sp.mode, seed: sp.seed });
  const r = runBotGame(config);
  const rugged = r.events.filter((e) => e.ev.t === "RugResolved").length;
  const torn = r.events.filter((e) => e.ev.t === "BagTorn").length;
  writeFileSync(`fixtures/${sp.name}.json`, JSON.stringify({ recorded: new Date().toISOString(), config, actions: r.actions, digest: r.digest, eventCount: r.events.length, winner: r.final.winner, moves: r.moves, turns: r.turns, rugged, torn }, null, 0));
  console.log(sp.name, "moves", r.moves, "turns", r.turns, "rugged", rugged, "torn", torn, "digest", r.digest.slice(0, 12));
}
