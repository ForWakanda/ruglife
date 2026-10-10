import type { Action, GameConfig, SeqEvent } from "@ruglife/protocol";
import { tokens } from "@ruglife/cards";
import { apply, createGame, DEFAULT_CARD_SET, type GameState } from "../src/index.js";

export const byRole = (role: string, skip = 0): number => tokens.tokens.filter((t) => t.role === role)[skip]!.tokenId;

export function table(roles: string[], mode: GameConfig["mode"] = "standard", seed = "fixture"): GameState {
  const used: Record<string, number> = {};
  const seats = roles.map((r, i) => { const k = used[r] ?? 0; used[r] = k + 1; return { seat: i, kind: "bot" as const, tokenId: byRole(r, k) }; });
  return createGame({ tableId: "t", mode, seed, cardSetId: DEFAULT_CARD_SET, seats });
}
/** Starts the game and returns the state at seat 0's turn start. */
export function started(roles: string[], mode: GameConfig["mode"] = "standard", seed = "fixture"): GameState {
  let s = table(roles, mode, seed);
  for (const x of s.seats) if (x.playRole === null) s = apply(s, { type: "PICK_ROLE", seat: x.seat, role: "face" }).state;
  for (const x of s.seats) if (x.skin === null) s = apply(s, { type: "PICK_SKIN", seat: x.seat, skin: "pink" }).state;
  return apply(s, { type: "START_GAME", seat: 0 }).state;
}
/** Moves the instance of a def into a seat's hand (keeps the card count conserved). Mutates. */
export function give(s: GameState, seat: number, defId: string): string {
  const inst = `${defId}#1`;
  for (const x of s.seats) { x.hand = x.hand.filter((c) => c !== inst); x.gear = x.gear.filter((c) => c !== inst); }
  for (const k of ["trouble", "loot", "troubleDiscard", "lootDiscard"] as const) s.decks[k] = s.decks[k].filter((c) => c !== inst);
  s.seats.find((x) => x.seat === seat)!.hand.push(inst);
  return inst;
}
/** Puts a def on top of a deck. Mutates. */
export function onTop(s: GameState, deck: "trouble" | "loot", defId: string): string {
  const inst = `${defId}#1`;
  for (const x of s.seats) { x.hand = x.hand.filter((c) => c !== inst); x.gear = x.gear.filter((c) => c !== inst); }
  for (const k of ["trouble", "loot", "troubleDiscard", "lootDiscard"] as const) s.decks[k] = s.decks[k].filter((c) => c !== inst);
  s.decks[deck].push(inst);
  return inst;
}
export function run(s: GameState, ...actions: Action[]): { s: GameState; ev: SeqEvent[] } {
  const ev: SeqEvent[] = [];
  for (const a of actions) { const r = apply(s, a); s = r.state; ev.push(...r.events); }
  return { s, ev };
}
export const evs = (ev: SeqEvent[], t: string) => ev.filter((e) => e.ev.t === t).map((e) => e.ev as Record<string, unknown>);
/** Everyone passes the pile-on. */
export function passAll(s: GameState): { s: GameState; ev: SeqEvent[] } {
  const ev: SeqEvent[] = [];
  while (s.phase === "fight.pileOn") { const r = apply(s, { type: "PASS", seat: s.fight!.priority! }); s = r.state; ev.push(...r.events); }
  return { s, ev };
}
