// A deterministic heuristic bot: picks among legalActions(state, seat). No I/O, no clock.
import type { Action, SeatId } from "@ruglife/protocol";
import { def, seatOf, type GameState } from "./state.js";
import { bagsOf, fightPower, legalActions, seatPower } from "./rules.js";

function hashPick(s: GameState, seat: SeatId, salt: number, n: number): number {
  let h = (s.seq * 2654435761 + seat * 40503 + salt * 97 + s.rng) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return h % n;
}

export function botAction(s: GameState, seat: SeatId): Action {
  const legal = legalActions(s, seat);
  if (legal.length === 0) throw new Error(`bot ${seat}: nothing legal in ${s.phase}`);
  const me = seatOf(s, seat);
  const by = (t: Action["type"]): Action[] => legal.filter((a) => a.type === t);
  const first = (t: Action["type"]): Action | undefined => by(t)[0];
  const f = s.fight;

  if (s.phase === "lobby") {
    return first("PICK_ROLE") ?? first("PICK_SKIN") ?? first("START_GAME") ?? legal[0]!;
  }
  if (s.prompt?.seats.includes(seat)) {
    switch (s.prompt.kind) {
      case "answerHelp": {
        const ask = f!.pendingAsk!;
        const fighter = seatOf(s, f!.fighter);
        const accept = ask.cut >= 1 || fighter.level <= 6;
        return { type: "ANSWER_HELP", seat, accept };
      }
      case "rug": {
        const d = def(s, f!.threat);
        const winLevel = seatOf(s, f!.fighter).level + (d.levelsWon ?? 1);
        const iAmFighter = f!.fighter === seat;
        // pull when the fighter would reach the top or when the pot is fat; otherwise mostly keep
        const greedy = (!iAmFighter && winLevel >= 9) || bagsOf(s, f!) >= 3 || me.level + (d.levelsWon ?? 1) >= 10;
        const pull = greedy || hashPick(s, seat, 1, 10) < 2;
        return { type: "RUG", seat, pull };
      }
      case "airdrop": {
        const score = (c: string): number => { const d = def(s, c); return d.type === "gear" ? 10 + (d.bonus ?? 0) : d.type === "levelup" ? 20 : d.type === "threat" ? 5 + (d.level ?? 0) / 4 : d.type === "key" ? 8 : 6; };
        const keep = [...me.hand].sort((a, b) => score(b) - score(a)).slice(0, 6);
        return { type: "AIRDROP_KEEP", seat, cards: keep };
      }
      case "tradeAnswer": return { type: "TRADE_ANSWER", seat, accept: false };
      default: return legal[0]!;
    }
  }
  if (s.phase === "turn.start" || s.phase === "turn.free") {
    const lvl = first("PLAY") && by("PLAY").find((a) => a.type === "PLAY" && def(s, a.card).type === "levelup");
    if (lvl) return lvl;
    const eq = first("EQUIP");
    if (eq) return eq;
    const sell = first("SELL");
    if (sell) return sell;
    const drawers = by("PLAY").filter((a) => a.type === "PLAY" && def(s, a.card).type === "oneshot");
    if (drawers[0]) return drawers[0];
    // a FUD on the leader, if the leader is not me and is close to the top
    const leader = [...s.seats].sort((a, b) => b.level - a.level)[0]!;
    if (leader.seat !== seat && leader.level >= 7) {
      const fuds = by("PLAY").filter((a) => a.type === "PLAY" && a.target === leader.seat && def(s, a.card).type === "fud");
      if (fuds[0]) return fuds[0];
    }
    if (s.phase === "turn.start") return first("START_TROUBLE")!;
    const looks = by("LOOK_FOR_TROUBLE");
    if (looks.length) {
      const myPow = seatPower(s, me);
      const beatable = looks.filter((a) => a.type === "LOOK_FOR_TROUBLE" && (def(s, a.card).level ?? 99) + ((def(s, a.card).lock?.length ?? 0) && !def(s, a.card).lock!.includes(me.playRole!) ? 5 : 0) < myPow);
      if (beatable.length) return beatable.sort((a, b) => (def(s, (b as { card: string }).card).level ?? 0) - (def(s, (a as { card: string }).card).level ?? 0))[0]!;
    }
    return first("GRAB_BAG") ?? first("END_TURN") ?? legal[0]!;
  }
  if (!f) return legal[0]!;
  const p = fightPower(s, f);
  const iAmIn = f.fighter === seat || f.helpers.some((h) => h.seat === seat);
  if (s.phase === "fight.setup") {
    if (f.fighter !== seat) return legal[0]!; // helper: stay
    if (p.fighter <= p.threat) {
      const keys = by("PLAY").filter((a) => a.type === "PLAY" && def(s, a.card).type === "key");
      if (keys[0] && !p.lockOpen) return keys[0];
      const perk = first("USE_PERK");
      if (perk) return perk;
      const asks = by("ASK_HELP") as Array<Extract<Action, { type: "ASK_HELP" }>>;
      if (asks.length) {
        const best = asks.map((a) => ({ a, pow: seatPower(s, seatOf(s, a.to)) })).sort((x, y) => y.pow - x.pow);
        const top = best[0]!;
        const cut = Math.min(1, bagsOf(s, f));
        const pick = asks.find((a) => a.to === top.a.to && a.cut === cut) ?? top.a;
        return pick;
      }
    }
    return { type: "PASS", seat };
  }
  if (s.phase === "fight.pileOn" && f.priority === seat) {
    const fighter = seatOf(s, f.fighter);
    const d = def(s, f.threat);
    const winLevel = fighter.level + (d.levelsWon ?? 1);
    const plays = by("PLAY") as Array<Extract<Action, { type: "PLAY" }>>;
    if (iAmIn) {
      if (p.fighter <= p.threat) {
        const boostMe = plays.filter((a) => a.side === "fighter" && (def(s, a.card).effects[0] as { n?: number }).n! > 0);
        if (boostMe[0]) return boostMe[0];
        const perk = first("USE_PERK");
        if (perk) return perk;
        const nerf = plays.filter((a) => def(s, a.card).type === "boost" && (def(s, a.card).effects[0] as { n?: number }).n! < 0);
        if (nerf[0]) return nerf[0];
        const cancel = plays.find((a) => def(s, a.card).effects[0]?.kind === "cancelLast");
        if (cancel && f.plays.some((x) => !x.cancelled && x.inst && x.side === "threat" && x.mod > 0)) return cancel;
      }
      return { type: "PASS", seat };
    }
    // not in the fight: spoil it if the fighter would win and get near the top
    if (p.fighter > p.threat && winLevel >= 8) {
      const against = plays.filter((a) => (a.side === "threat" && (def(s, a.card).effects[0] as { n?: number }).n! > 0) || (def(s, a.card).type === "boost" && (def(s, a.card).effects[0] as { n?: number }).n! > 0));
      if (against[0]) return against[0];
      const fud = plays.find((a) => def(s, a.card).type === "fud" && a.target === f.fighter);
      if (fud) return fud;
    }
    return { type: "PASS", seat };
  }
  return legal[0]!;
}
