import type { Action, CardView, SeatId, View } from "@ruglife/protocol";
import { def, token, type GameState } from "./state.js";
import { fightPower, legalActions } from "./rules.js";

function cardView(s: GameState, inst: string): CardView {
  const ci = s.cards[inst]!;
  const t = token(ci.cast);
  return { inst, def: def(s, inst), cast: { tokenId: t.tokenId, file: t.file, name: t.name } };
}

/** Hidden information is removed here and nowhere else. */
export function viewFor(s: GameState, viewer: SeatId | "stands"): View {
  const f = s.fight;
  const mine = (id: SeatId): boolean => viewer === id;
  return {
    tableId: s.config.tableId,
    viewer,
    phase: s.phase,
    mode: s.config.mode,
    turn: s.phase === "lobby" ? null : { seat: s.turnSeat, no: s.turnNo, fought: s.fought },
    seats: s.seats.map((x) => {
      const t = token(x.tokenId);
      return {
        seat: x.seat, kind: x.kind, chog: { tokenId: t.tokenId, file: t.file, name: t.name },
        role: x.role, playRole: x.playRole, skin: x.skin, level: x.level,
        handCount: x.hand.length, hand: mine(x.seat) ? x.hand.map((c) => cardView(s, c)) : null,
        gear: x.gear.map((c) => cardView(s, c)), kitOn: !x.kitOff, rug: x.rug, rekt: x.rekt, sobUsed: x.sobUsed,
        autopilot: x.autopilot, connected: x.connected,
      };
    }),
    fight: f ? {
      no: f.no, fighter: f.fighter, threat: cardView(s, f.threat), helpers: f.helpers.map((h) => ({ ...h })),
      plays: f.plays.map((p) => ({ by: p.by, card: p.inst ? cardView(s, p.inst) : ({ inst: "perk", def: { id: "perk", type: "oneshot", deck: "loot", name: `${p.perk} perk`, flavour: "", text: "+3", effects: [], casting: {} }, cast: { tokenId: -1, file: -1, name: "" } } as CardView), side: p.side, mod: p.mod, cancelled: p.cancelled })),
      power: fightPower(s, f), priority: f.priority, pendingAsk: f.pendingAsk,
      rugPending: s.prompt?.kind === "rug" ? [...s.prompt.seats] : [],
      ...(viewer !== "stands" && viewer in f.rugChoices ? { myRugChoice: f.rugChoices[viewer]! } : {}),
    } : null,
    prompt: s.prompt ? { kind: s.prompt.kind, seats: [...s.prompt.seats] } : null,
    decks: { trouble: s.decks.trouble.length, loot: s.decks.loot.length, troubleDiscard: s.decks.troubleDiscard.length, lootDiscard: s.decks.lootDiscard.length },
    peek: viewer !== "stands" && viewer === s.turnSeat && s.peek.length ? cardView(s, s.peek[0]!) : null,
    legal: viewer === "stands" ? [] : (legalActions(s, viewer) as Action[]),
    winner: s.winner,
    seedHash: s.seedHash,
    seq: s.seq,
  };
}
