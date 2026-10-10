// The record (rules § 8): per Chog, rebuilt from the table logs. Display only in v1. Indexed by tokenId; the
// controlling wallet of the time is noted per game. Tutorial, loaner and bot-only tables write nothing;
// a cast-card appearance is an appearance, never a game played.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SeqEvent } from "@ruglife/protocol";

export interface GameRow { table: string; at: number; mode: string; seat: number; controller: string | null; won: boolean; levelFrom: number; levelTo: number; rugsPulled: number; rugsSuffered: number; beside: number[]; bounties: number }
export interface TokenRecord {
  tokenId: number;
  games: number; wins: number; levelsGained: number; rugsPulled: number; rugsSuffered: number; bountiesCollected: number; appearances: number;
  wonBeside: Record<string, number>; // tokenId → times it won at a table with that Chog seated
  history: GameRow[];
}
export type Records = Map<number, TokenRecord>;

const blank = (tokenId: number): TokenRecord => ({ tokenId, games: 0, wins: 0, levelsGained: 0, rugsPulled: 0, rugsSuffered: 0, bountiesCollected: 0, appearances: 0, wonBeside: {}, history: [] });

/** Reads every table log once and compiles the records. Pure over the files; safe to call again. */
export function rebuildRecords(dataDir: string): Records {
  const recs: Records = new Map();
  const get = (id: number): TokenRecord => { let r = recs.get(id); if (!r) { r = blank(id); recs.set(id, r); } return r; };
  const dir = join(dataDir, "tables");
  if (!existsSync(dir)) return recs;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    let rows: Array<Record<string, unknown>>;
    try { rows = readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { continue; }
    const created = rows.find((r) => r.t === "created") as { config: { tableId: string; mode: string; seats: Array<{ seat: number; kind: string; tokenId: number }> }; seats?: Array<{ seat: number; kind: string; tokenId: number; label?: string }>; tutorial?: boolean; controllers?: Record<string, string | null>; at: number } | undefined;
    const over = rows.find((r) => r.t === "over") as { winner: number } | undefined;
    if (!created || !over) continue; // unfinished tables write nothing
    if (created.tutorial) continue;
    const seats = created.config.seats;
    const chogs = seats.filter((s) => s.kind === "chog");
    const events: SeqEvent[] = rows.filter((r) => r.t === "act").flatMap((r) => (r.events as SeqEvent[]) ?? []);
    // appearances: every cast token at a table with at least one human (chog or loaner) seat
    const started = events.find((e) => e.ev.t === "GameStarted")?.ev as { casting?: Record<string, number> } | undefined;
    if (started?.casting && seats.some((s) => s.kind !== "bot")) for (const tokenId of new Set(Object.values(started.casting))) get(tokenId).appearances += 1;
    if (chogs.length === 0) continue; // bot-only and loaner-only tables leave no game record
    const settled = rows.filter((r) => r.t === "settled" && r.kind === "bounty" && (r.outcome as { status?: string })?.status === "paid") as Array<{ to: number }>;
    for (const s of chogs) {
      const rec = get(s.tokenId);
      const levels = events.filter((e) => e.ev.t === "LevelChanged" && e.ev.seat === s.seat).map((e) => e.ev as { from: number; to: number });
      const levelFrom = created.config.mode === "tournament" ? 6 : 1;
      const levelTo = levels.length ? levels[levels.length - 1]!.to : levelFrom;
      const pulled = events.filter((e) => (e.ev.t === "RugResolved" && e.ev.puller === s.seat) || (e.ev.t === "BagTorn" && e.ev.pullers.includes(s.seat))).length;
      const suffered = events.filter((e) => e.ev.t === "RugResolved" && e.ev.victims.includes(s.seat)).length;
      const won = over.winner === s.seat;
      const beside = chogs.filter((o) => o.seat !== s.seat).map((o) => o.tokenId);
      const bounties = settled.filter((x) => x.to === s.tokenId).length;
      rec.games += 1;
      if (won) { rec.wins += 1; for (const b of beside) rec.wonBeside[String(b)] = (rec.wonBeside[String(b)] ?? 0) + 1; }
      rec.levelsGained += Math.max(0, levelTo - levelFrom);
      rec.rugsPulled += pulled; rec.rugsSuffered += suffered; rec.bountiesCollected += bounties;
      rec.history.push({ table: created.config.tableId, at: created.at, mode: created.config.mode, seat: s.seat, controller: created.controllers?.[String(s.seat)] ?? null, won, levelFrom, levelTo, rugsPulled: pulled, rugsSuffered: suffered, beside, bounties });
    }
  }
  for (const r of recs.values()) r.history.sort((a, b) => a.at - b.at);
  return recs;
}
