// npm run sim -- [--seats 4] [--mode standard|tournament] [--seed x] [--games 20] [--verbose]
import { token } from "./index.js";
import { configFor, replay, runBotGame } from "./sim.js";

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };
const seats = Number(arg("seats", "4"));
const mode = arg("mode", "standard") as "standard" | "tournament";
const seed0 = arg("seed", "ruglife");
const games = Number(arg("games", "20"));
const verbose = process.argv.includes("--verbose");

const rows: Array<{ seed: string; moves: number; turns: number; winner: string; role: string; levels: number[]; rugs: number; fights: number; replayOk: boolean }> = [];
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const seed = games === 1 ? seed0 : `${seed0}-${g}`;
  const config = configFor({ seats, mode, seed });
  const r = runBotGame(config, verbose ? { onStep: (_s, a, ev) => { console.log(JSON.stringify(a)); for (const e of ev) console.log("   ", JSON.stringify(e.ev)); } } : {});
  const rp = replay(config, r.actions);
  const w = r.final.seats.find((x) => x.seat === r.final.winner)!;
  rows.push({ seed, moves: r.moves, turns: r.turns, winner: token(w.tokenId).name, role: w.playRole ?? "?", levels: r.final.seats.map((x) => x.level), rugs: r.final.seats.filter((x) => x.rug === "pulled").length, fights: r.final.fightCount, replayOk: rp.digest === r.digest });
}
const ms = Date.now() - t0;
const med = (xs: number[]): number => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]!; };
console.table(rows.map((r) => ({ ...r, levels: r.levels.join("/") })));
console.log(`${games} games · ${seats} seats · ${mode} · median moves ${med(rows.map((r) => r.moves))} · median turns ${med(rows.map((r) => r.turns))} · replay ok ${rows.filter((r) => r.replayOk).length}/${games} · ${ms} ms`);
const byRole: Record<string, number> = {};
for (const r of rows) byRole[r.role] = (byRole[r.role] ?? 0) + 1;
console.log("wins by role", byRole);
