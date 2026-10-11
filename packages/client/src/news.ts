// Events → the anchor's lines. The ticker is the game's memory for a spectator.
import type { SeqEvent, View } from "@ruglife/protocol";
import { cardSetV0 } from "@ruglife/cards";

export interface NewsLine { seq: number; kind: "breaking" | "alert" | "plain"; text: string }

const names = new Map(cardSetV0.cards.map((c) => [c.id, c.name]));
export const cardName = (defId: string): string => names.get(defId) ?? defId;

export function newsLines(view: View, events: SeqEvent[]): NewsLine[] {
  const who = (seat: number): string => view.seats.find((s) => s.seat === seat)?.chog.name ?? `seat ${seat}`;
  const out: NewsLine[] = [];
  const L = (seq: number, kind: NewsLine["kind"], text: string): void => { out.push({ seq, kind, text }); };
  for (const { seq, ev } of events) {
    switch (ev.t) {
      case "GameStarted": L(seq, "alert", `A ${ev.mode} table opens. Seed sealed: ${ev.seedHash.slice(0, 10)}…`); break;
      case "TurnStarted": L(seq, "plain", `Turn ${ev.turn}: ${who(ev.seat)} is up.`); break;
      case "CardFlipped": L(seq, "plain", `${who(ev.seat)} starts trouble: ${cardName(ev.def)}.`); break;
      case "FightStarted": L(seq, "breaking", `${who(ev.fighter)} ${ev.fromHand ? "picks a fight with" : "runs into"} ${cardName(ev.def)}.`); break;
      case "HelpAsked": L(seq, "plain", `${who(ev.fighter)} asks ${who(ev.to)} for help, offering ${ev.cut} bag${ev.cut === 1 ? "" : "s"}.`); break;
      case "HelpAgreed": L(seq, "plain", `${who(ev.helper)} is in for ${ev.cut} bag${ev.cut === 1 ? "" : "s"}.`); break;
      case "HelpDeclined": L(seq, "plain", `${who(ev.helper)} declines.`); break;
      case "HelperLeft": L(seq, "plain", `${who(ev.helper)} walks out of the fight.`); break;
      case "CardPlayed": L(seq, "plain", `${who(ev.by)} plays ${cardName(ev.def)}${ev.side ? ` on the ${ev.side}` : ""}${ev.target !== undefined ? ` at ${who(ev.target)}` : ""}.`); break;
      case "PerkUsed": L(seq, "plain", `${who(ev.seat)} uses the ${ev.role} perk${ev.detail ? ` (${ev.detail})` : ""}.`); break;
      case "DegenRolled": L(seq, "plain", `${who(ev.seat)} rolls the Degen die: ${ev.roll} → ${ev.mod >= 0 ? "+" : ""}${ev.mod}.`); break;
      case "PowerChanged": L(seq, "plain", `Power: fighter ${ev.fighter} vs threat ${ev.threat}.`); break;
      case "PileOnClosed": L(seq, "plain", "Everyone passed. The fight resolves."); break;
      case "RugChoicesRevealed": L(seq, "alert", ev.pulls.length ? `Rugs revealed: ${ev.pulls.map(who).join(", ")} pulled.` : "Rugs revealed: nobody pulled."); break;
      case "RugResolved": L(seq, "breaking", `RUG PULLED. ${who(ev.puller)} takes everything from ${ev.victims.map(who).join(", ")}.`); break;
      case "BagTorn": L(seq, "breaking", `THE BAG TEARS. ${ev.pullers.map(who).join(" and ")} both pulled: nobody gets anything.`); break;
      case "FightWon": L(seq, "alert", `${who(ev.fighter)} wins. ${who(ev.levelsTo)} takes ${ev.levels} level${ev.levels === 1 ? "" : "s"}${ev.bagsTo.length ? `; bags: ${ev.bagsTo.map((b) => `${who(b.seat)} ${b.bags}`).join(", ")}` : ""}.`); break;
      case "FightLost": L(seq, "alert", `${who(ev.fighter)} loses the fight.`); break;
      case "JeetRolled": L(seq, "plain", `${who(ev.seat)} rolls to jeet: ${ev.roll}${ev.mod ? ` ${ev.mod > 0 ? "+" : ""}${ev.mod}` : ""}${ev.rerolled ? " (rerolled)" : ""} → ${ev.escaped ? "gone" : "caught"}.`); break;
      case "BadStuffApplied": L(seq, ev.ignored ? "plain" : "breaking", ev.ignored ? `${who(ev.seat)} shrugs off the Bad Stuff (Sob Story).` : `${who(ev.seat)} eats the Bad Stuff from ${cardName(ev.def)}.`); break;
      case "FudResolved": L(seq, "alert", ev.actor === ev.target ? `${who(ev.target)} is hit by ${cardName(ev.def)}${ev.rekt ? " and is REKT" : ev.levelAfter < ev.levelBefore ? ` (level ${ev.levelBefore} → ${ev.levelAfter})` : ""}.` : `${who(ev.actor)} hits ${who(ev.target)} with ${cardName(ev.def)}${ev.rekt ? ": REKT" : ev.levelAfter < ev.levelBefore ? ` (level ${ev.levelBefore} → ${ev.levelAfter})` : ""}.`); break;
      case "LevelChanged": if (ev.cause !== "fight" && ev.cause !== "fud") L(seq, "plain", `${who(ev.seat)}: level ${ev.from} → ${ev.to} (${ev.cause}).`); break;
      case "Rekt": L(seq, "breaking", `${who(ev.seat)} is REKT: hand and gear gone.`); break;
      case "GearChanged": break;
      case "Airdropped": L(seq, "plain", ev.to === null ? `${who(ev.from)} discards ${ev.cards} card${ev.cards === 1 ? "" : "s"}.` : `Airdrop: ${ev.cards} card${ev.cards === 1 ? "" : "s"} from ${who(ev.from)} to ${who(ev.to)}.`); break;
      case "Sold": L(seq, "plain", `${who(ev.seat)} sells ${ev.cards.length} piece${ev.cards.length === 1 ? "" : "s"} of gear for ${ev.value} notes: a level.`); break;
      case "Traded": L(seq, "plain", `${who(ev.a)} and ${who(ev.b)} trade gear.`); break;
      case "Drew": L(seq, "plain", `${who(ev.seat)} draws ${ev.n} ${ev.deck}.`); break;
      case "Timeout": L(seq, "plain", `${who(ev.seat)} ran out the clock (${ev.defaulted}).`); break;
      case "Autopilot": L(seq, "plain", `${who(ev.seat)} ${ev.on ? "is on autopilot" : "is back"}.`); break;
      case "TurnEnded": break;
      case "GameOver": L(seq, "breaking", `GLOBAL ALERT: ${who(ev.winner)} controls the world. Seed ${ev.seed.slice(0, 8)}…, digest ${ev.digest.slice(0, 10)}….`); break;
      default: break;
    }
  }
  return out;
}
