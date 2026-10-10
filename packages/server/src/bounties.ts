// Bounty triggers (rules § 9), as pure functions over a table's event log. The only events a bounty may key on
// are FudResolved (HIT) and RugResolved (RUG).
import type { SeatId, SeqEvent } from "@ruglife/protocol";

/** A bounty becomes active at the start of the target's next turn after it was funded (observed at `fundedAtSeq`). */
export function activationSeq(events: SeqEvent[], targetSeat: SeatId, fundedAtSeq: number): number | null {
  for (const e of events) if (e.seq > fundedAtSeq && e.ev.t === "TurnStarted" && e.ev.seat === targetSeat) return e.seq;
  return null;
}

/** HIT: the first resolved FUD played by ANOTHER seated Chog directly on the target that lowers its Level or rekts it. */
export function hitClaimant(events: SeqEvent[], targetSeat: SeatId, activeFromSeq: number): { seat: SeatId; seq: number } | null {
  for (const e of events) {
    if (e.seq < activeFromSeq || e.ev.t !== "FudResolved") continue;
    const f = e.ev;
    if (f.target !== targetSeat || f.actor === targetSeat) continue;
    if (f.levelAfter < f.levelBefore || f.rekt) return { seat: f.actor, seq: e.seq };
  }
  return null;
}

/** RUG: the target was a participant in a won fight in which exactly one other participant pulled. The claimant is the rugger. */
export function rugClaimant(events: SeqEvent[], targetSeat: SeatId, activeFromSeq: number): { seat: SeatId; seq: number } | null {
  for (const e of events) {
    if (e.seq < activeFromSeq || e.ev.t !== "RugResolved") continue;
    if (e.ev.victims.includes(targetSeat)) return { seat: e.ev.puller, seq: e.seq };
  }
  return null;
}
