// Runs whole bot games through apply(). Used by the CLI and the tests.
import type { Action, GameConfig, SeqEvent } from "@ruglife/protocol";
import { tokens } from "@ruglife/cards";
import { apply, botAction, createGame, digest, legalActions, type GameState, DEFAULT_CARD_SET } from "./index.js";

export interface SimResult { config: GameConfig; actions: Action[]; events: SeqEvent[]; final: GameState; digest: string; moves: number; turns: number }

export function configFor(opts: { seats: number; mode: GameConfig["mode"]; seed: string; tokenIds?: number[] }): GameConfig {
  const n = opts.seats;
  // deterministic token choice from the seed: spread over the table so roles vary
  let h = 0;
  for (const ch of opts.seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ids = opts.tokenIds ?? Array.from({ length: n }, (_, i) => tokens.tokens[(h + i * 263) % tokens.tokens.length]!.tokenId);
  return { tableId: `sim-${opts.seed}`, mode: opts.mode, seed: opts.seed, cardSetId: DEFAULT_CARD_SET, seats: ids.map((tokenId, i) => ({ seat: i, kind: "bot", tokenId })) };
}

export function whoActs(s: GameState): number[] {
  if (s.phase === "over") return [];
  if (s.phase === "lobby") return s.seats.filter((x) => legalActions(s, x.seat).length > 0).map((x) => x.seat);
  if (s.prompt) return [...s.prompt.seats];
  if (s.fight) {
    if (s.phase === "fight.setup") return [s.fight.fighter];
    if (s.phase === "fight.pileOn" && s.fight.priority !== null) return [s.fight.priority];
  }
  return [s.turnSeat];
}

export function runBotGame(config: GameConfig, opts: { maxMoves?: number; onStep?: (s: GameState, a: Action, ev: SeqEvent[]) => void; checkLegalAll?: boolean } = {}): SimResult {
  let s = createGame(config);
  const actions: Action[] = [];
  const events: SeqEvent[] = [];
  const max = opts.maxMoves ?? 5000;
  while (s.phase !== "over") {
    if (actions.length >= max) throw new Error(`game did not finish in ${max} moves (phase ${s.phase}, turn ${s.turnNo})`);
    const who = whoActs(s);
    if (who.length === 0) throw new Error(`nobody can act in ${s.phase}`);
    const seat = who[0]!;
    if (opts.checkLegalAll) for (const a of legalActions(s, seat)) apply(s, a); // every offered action must apply
    const a = botAction(s, seat);
    const r = apply(s, a);
    opts.onStep?.(r.state, a, r.events);
    s = r.state;
    actions.push(a);
    events.push(...r.events);
  }
  return { config, actions, events, final: s, digest: digest(s), moves: actions.length, turns: s.turnNo };
}

export function replay(config: GameConfig, actions: Action[]): { final: GameState; events: SeqEvent[]; digest: string } {
  let s = createGame(config);
  const events: SeqEvent[] = [];
  for (const a of actions) { const r = apply(s, a); s = r.state; events.push(...r.events); }
  return { final: s, events, digest: digest(s) };
}
