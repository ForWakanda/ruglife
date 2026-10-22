// Moments: the events that deserve a picture, not a line of text. A flipped Trouble card, a FUD landing, a Rug, a fight's verdict,
// a jeet roll — each becomes a card (or a slam) shown big on the floor for a beat. 2026-10-22, after the user's practice read:
// "I got a FUD on my first turn and the result is only in the game log, no card shown". The client still computes no rules:
// a moment is a rendering of what the engine already said.
import type { CardView, ChogRef, SeqEvent, View } from "@ruglife/protocol";
import { cardSetV0 } from "@ruglife/cards";

export type MomentKind = "flip" | "fud" | "play" | "rug" | "torn" | "won" | "lost" | "jeet" | "bad" | "rekt" | "levelup";
export interface Moment {
  key: number; // the seq of the event behind it
  kind: MomentKind;
  tone: "red" | "green" | "yellow" | "purple";
  title: string;
  sub: string;
  card: CardView | null;
  /** the seat it happens to (the one hit, the winner, the roller) */
  seat: number | null;
  /** the card leaves the game: FUD, bad stuff, one-shots. Shown as the last card out. */
  out: boolean;
  ms: number;
}

const defs = new Map(cardSetV0.cards.map((c) => [c.id, c]));
const NO_CAST: ChogRef = { tokenId: -1, file: 0, name: "" };
export type CastOf = (inst: string) => ChogRef | null;

function cardOf(inst: string, defId: string, castOf: CastOf): CardView | null {
  const def = defs.get(defId);
  if (!def) return null;
  return { inst, def, cast: castOf(inst) ?? NO_CAST };
}
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

/** One action's events → the moments worth a beat, in order. Events of one action are read together so a flip knows its outcome. */
export function momentsOf(view: View, events: SeqEvent[], castOf: CastOf): Moment[] {
  const who = (seat: number): string => view.seats.find((s) => s.seat === seat)?.chog.name ?? `seat ${seat}`;
  const you = (seat: number): boolean => view.viewer === seat;
  const out: Moment[] = [];
  const used = new Set<number>();
  const fudLine = (ev: Extract<SeqEvent["ev"], { t: "FudResolved" }>, card: CardView | null): string => {
    const t = ev.rekt ? "REKT: hand and gear gone" : ev.levelAfter < ev.levelBefore ? `level ${ev.levelBefore} → ${ev.levelAfter}` : card?.def.text ?? "";
    return t;
  };
  for (let i = 0; i < events.length; i++) {
    const { seq, ev } = events[i]!;
    if (used.has(seq)) continue;
    switch (ev.t) {
      case "CardFlipped": {
        const card = cardOf(ev.card, ev.def, castOf);
        const next = events.slice(i + 1, i + 4).map((e) => e);
        const fight = next.find((e) => e.ev.t === "FightStarted" && e.ev.threat === ev.card);
        const fud = next.find((e) => e.ev.t === "FudResolved" && e.ev.card === ev.card);
        if (fight) { out.push({ key: seq, kind: "flip", tone: "red", title: you(ev.seat) ? "TROUBLE!" : `${who(ev.seat)} STARTS TROUBLE`, sub: `${card?.def.name ?? ev.def}: a fight`, card, seat: ev.seat, out: false, ms: 1500 }); break; }
        if (fud && fud.ev.t === "FudResolved") {
          used.add(fud.seq);
          const rekt = next.find((e) => e.ev.t === "Rekt" && e.ev.seat === ev.seat); if (rekt) used.add(rekt.seq);
          out.push({ key: seq, kind: "fud", tone: "purple", title: you(ev.seat) ? "FUD! IT HITS YOU" : `FUD! ${who(ev.seat)} IS HIT`, sub: fudLine(fud.ev, card), card, seat: ev.seat, out: true, ms: 2800 });
          break;
        }
        out.push({ key: seq, kind: "flip", tone: "yellow", title: you(ev.seat) ? "INTO YOUR HAND" : `${who(ev.seat)} POCKETS A CARD`, sub: card?.def.name ?? ev.def, card: you(ev.seat) ? card : null, seat: ev.seat, out: false, ms: 1500 });
        break;
      }
      case "CardPlayed": {
        const card = cardOf(ev.card, ev.def, castOf);
        const fud = events.slice(i + 1, i + 4).find((e) => e.ev.t === "FudResolved" && e.ev.card === ev.card);
        if (fud && fud.ev.t === "FudResolved") {
          used.add(fud.seq);
          const target = fud.ev.target;
          const rekt = events.slice(i + 1, i + 5).find((e) => e.ev.t === "Rekt" && e.ev.seat === target); if (rekt) used.add(rekt.seq);
          out.push({ key: seq, kind: "fud", tone: "purple", title: you(target) ? `${who(ev.by)} HITS YOU` : you(ev.by) ? `YOU HIT ${who(target)}` : `${who(ev.by)} HITS ${who(target)}`, sub: `${card?.def.name ?? ev.def}: ${fudLine(fud.ev, card)}`, card, seat: target, out: true, ms: 2800 });
          break;
        }
        const where = ev.side ? ` on the ${ev.side}` : ev.target !== undefined ? ` at ${who(ev.target)}` : "";
        out.push({ key: seq, kind: "play", tone: ev.side === "threat" ? "red" : "yellow", title: you(ev.by) ? "YOU PLAY" : `${who(ev.by)} PLAYS`, sub: `${card?.def.name ?? ev.def}${where}`, card, seat: ev.by, out: card?.def.type === "oneshot" || card?.def.type === "boost", ms: 1800 });
        break;
      }
      case "FudResolved": { // a FUD without a flip or play before it (none today; kept so nothing lands silently)
        const card = cardOf(ev.card, ev.def, castOf);
        out.push({ key: seq, kind: "fud", tone: "purple", title: you(ev.target) ? "FUD! IT HITS YOU" : `FUD! ${who(ev.target)} IS HIT`, sub: fudLine(ev, card), card, seat: ev.target, out: true, ms: 2600 });
        break;
      }
      case "RugResolved": out.push({ key: seq, kind: "rug", tone: "red", title: "RUG PULLED", sub: `${who(ev.puller)} takes everything from ${ev.victims.map(who).join(", ")}`, card: null, seat: ev.puller, out: false, ms: 2800 }); break;
      case "BagTorn": out.push({ key: seq, kind: "torn", tone: "red", title: "THE BAG TEARS", sub: `${ev.pullers.map(who).join(" and ")} both pulled: nobody gets anything`, card: null, seat: null, out: false, ms: 2800 }); break;
      case "FightWon": out.push({ key: seq, kind: "won", tone: "green", title: you(ev.fighter) ? "YOU WIN" : `${who(ev.fighter)} WINS`, sub: `${plural(ev.levels, "level")} to ${who(ev.levelsTo)}${ev.bagsTo.length ? ` · bags: ${ev.bagsTo.map((b) => `${who(b.seat)} ${b.bags}`).join(", ")}` : ""}`, card: null, seat: ev.levelsTo, out: false, ms: 2000 }); break;
      case "FightLost": out.push({ key: seq, kind: "lost", tone: "red", title: you(ev.fighter) ? "YOU LOSE THE FIGHT" : `${who(ev.fighter)} LOSES`, sub: "roll to jeet: 5 or more gets away", card: null, seat: ev.fighter, out: false, ms: 1600 }); break;
      case "JeetRolled": out.push({ key: seq, kind: "jeet", tone: ev.escaped ? "green" : "red", title: `🎲 ${ev.roll}${ev.mod ? ` ${ev.mod > 0 ? "+" : ""}${ev.mod}` : ""}${ev.rerolled ? " (reroll)" : ""}`, sub: `${who(ev.seat)} ${ev.escaped ? "jeets: gone" : "is caught"}`, card: null, seat: ev.seat, out: false, ms: 1500 }); break;
      case "DegenRolled": out.push({ key: seq, kind: "jeet", tone: ev.mod >= 0 ? "green" : "red", title: `🎲 ${ev.roll}`, sub: `${who(ev.seat)}'s Degen die: ${ev.mod >= 0 ? "+" : ""}${ev.mod}`, card: null, seat: ev.seat, out: false, ms: 1300 }); break;
      case "BadStuffApplied": {
        const card = cardOf(`${ev.def}#1`, ev.def, castOf);
        const rekt = events.slice(i + 1, i + 4).find((e) => e.ev.t === "Rekt" && e.ev.seat === ev.seat); if (rekt) used.add(rekt.seq);
        out.push({ key: seq, kind: "bad", tone: ev.ignored ? "yellow" : "red", title: ev.ignored ? "SHRUGGED OFF" : "BAD STUFF", sub: ev.ignored ? `${who(ev.seat)}'s Sob Story: no Bad Stuff this time` : `${who(ev.seat)} eats it${rekt ? ": REKT" : ""}`, card, seat: ev.seat, out: false, ms: 2400 });
        break;
      }
      case "Rekt": out.push({ key: seq, kind: "rekt", tone: "red", title: "REKT", sub: `${who(ev.seat)}: hand and gear gone`, card: null, seat: ev.seat, out: false, ms: 2000 }); break;
      case "LevelChanged": if (ev.to > ev.from && ev.cause !== "fight" && ev.cause !== "fud") out.push({ key: seq, kind: "levelup", tone: "green", title: `LEVEL ${ev.to}`, sub: `${who(ev.seat)} (${ev.cause})`, card: null, seat: ev.seat, out: false, ms: 1300 }); break;
      default: break;
    }
  }
  return out;
}
