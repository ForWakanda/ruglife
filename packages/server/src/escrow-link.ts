// Links a table to the escrow: ids, funding observed by polling, bounty activation, settlement at the end.
// The server never moves $CHOG in; funders do, from their own wallets. It only attests results (tech-design § 6).
import type { SeatId, SeqEvent, TableInfo } from "@ruglife/protocol";
import { CHAIN_ID, RULES_VERSION } from "@ruglife/protocol";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { activationSeq, hitClaimant, rugClaimant } from "./bounties.js";
import { bountyId, potId, Settlement, type SettleOutcome } from "./settlement.js";

export const TABLE_EXPIRY_S = 24 * 3600; // ⚙ an id can be settled for a day after the table starts; then funders reclaim
export const POLL_MS = 15_000; // ⚙

export interface SeatRow { seat: SeatId; kind: "chog" | "loaner" | "bot"; tokenId: number; address: Address | null }
interface BountyState { seat: SeatId; tokenId: number; trigger: "hit" | "rug"; id: Hex; funded: bigint; fundedAtSeq: number | null; activeFromSeq: number | null }

export class EscrowLink {
  readonly potId: Hex;
  readonly expiry: number;
  readonly eligible: boolean;
  bounties: BountyState[] = [];
  potFunded = 0n;
  private timer: NodeJS.Timeout | null = null;
  private settledAt: number | null = null;
  constructor(readonly settlement: Settlement, readonly chog: Address, readonly tableId: string, readonly seats: SeatRow[], readonly tutorial: boolean, private readonly log: (l: string) => void) {
    this.potId = potId(tableId);
    this.expiry = Math.floor(Date.now() / 1000) + TABLE_EXPIRY_S;
    this.eligible = !tutorial && seats.some((s) => s.kind === "chog");
    for (const s of seats) if (s.kind === "chog") for (const trigger of ["hit", "rug"] as const) this.bounties.push({ seat: s.seat, tokenId: s.tokenId, trigger, id: bountyId(tableId, s.tokenId, trigger), funded: 0n, fundedAtSeq: null, activeFromSeq: null });
  }
  info(): NonNullable<TableInfo["escrow"]> {
    return {
      address: this.settlement.opts.escrow, chainId: CHAIN_ID, chog: this.chog, potId: this.potId, expiry: this.expiry, eligible: this.eligible,
      bounties: this.bounties.map((b) => ({ seat: b.seat, tokenId: b.tokenId, trigger: b.trigger, id: b.id, funded: b.funded.toString(), active: b.activeFromSeq !== null })),
      pot: { funded: this.potFunded.toString() },
    };
  }
  /** Polls the escrow for deposits. `seqNow` is the table's current event seq: a bounty funded now activates at the target's next turn start. */
  start(seqNow: () => number, events: () => SeqEvent[], onChange: () => void): void {
    const tick = async (): Promise<void> => {
      let changed = false;
      try {
        const pot = await this.settlement.pool(this.potId);
        if (pot.total !== this.potFunded) { this.potFunded = pot.total; changed = true; }
        for (const b of this.bounties) {
          const p = await this.settlement.pool(b.id);
          if (p.total !== b.funded) {
            if (b.fundedAtSeq === null && p.total > 0n) b.fundedAtSeq = seqNow();
            b.funded = p.total; changed = true;
          }
          if (b.fundedAtSeq !== null && b.activeFromSeq === null) {
            const a = activationSeq(events(), b.seat, b.fundedAtSeq);
            if (a !== null) { b.activeFromSeq = a; changed = true; this.log(`table ${this.tableId}: ${b.trigger} bounty on seat ${b.seat} active from seq ${a}`); }
          }
        }
      } catch (e) { this.log(`escrow poll ${this.tableId}: ${(e as Error).message.slice(0, 120)}`); }
      if (changed) onChange();
    };
    void tick();
    this.timer = setInterval(() => void tick(), POLL_MS);
    this.timer.unref?.();
  }
  /** Re-checks activation on every new event (so a bounty funded mid-turn is active exactly at the next turn start). */
  onEvents(events: SeqEvent[]): void {
    for (const b of this.bounties) if (b.fundedAtSeq !== null && b.activeFromSeq === null) {
      const a = activationSeq(events, b.seat, b.fundedAtSeq);
      if (a !== null) b.activeFromSeq = a;
    }
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** At game over: the pot to the winner's chest, each active bounty to its claimant's chest — only for verified Chogs, never to a seat sharing a wallet with the target. */
  async settleAll(winner: SeatId, events: SeqEvent[], eventDigest: Hex): Promise<Array<{ id: Hex; kind: "pot" | "bounty"; to: number | null; outcome: SettleOutcome | { status: "skipped"; why: string } }>> {
    this.stop();
    this.settledAt = Date.now();
    const out: Array<{ id: Hex; kind: "pot" | "bounty"; to: number | null; outcome: SettleOutcome | { status: "skipped"; why: string } }> = [];
    const seatRow = (seat: SeatId): SeatRow | undefined => this.seats.find((s) => s.seat === seat);
    if (!this.eligible) { this.log(`table ${this.tableId}: not eligible for settlement`); return out; }
    // one last read so a deposit in the final seconds is not missed
    try { this.potFunded = (await this.settlement.pool(this.potId)).total; for (const b of this.bounties) b.funded = (await this.settlement.pool(b.id)).total; } catch { /* settle() reads again anyway */ }
    const w = seatRow(winner);
    if (this.potFunded > 0n) {
      if (!w || w.kind !== "chog") out.push({ id: this.potId, kind: "pot", to: null, outcome: { status: "skipped", why: "winner is not a verified Chog; funders reclaim after expiry" } });
      else out.push({ id: this.potId, kind: "pot", to: w.tokenId, outcome: await this.settlement.settle({ id: this.potId, winnerTokenId: w.tokenId, eventDigest, rulesVersion: RULES_VERSION, table: this.tableId, kind: "pot" }) });
    }
    for (const b of this.bounties) {
      if (b.funded === 0n) continue;
      if (b.activeFromSeq === null) { out.push({ id: b.id, kind: "bounty", to: null, outcome: { status: "skipped", why: "never became active" } }); continue; }
      const claim = b.trigger === "hit" ? hitClaimant(events, b.seat, b.activeFromSeq) : rugClaimant(events, b.seat, b.activeFromSeq);
      if (!claim) { out.push({ id: b.id, kind: "bounty", to: null, outcome: { status: "skipped", why: "no qualifying event" } }); continue; }
      const c = seatRow(claim.seat); const t = seatRow(b.seat);
      if (!c || c.kind !== "chog") { out.push({ id: b.id, kind: "bounty", to: null, outcome: { status: "skipped", why: "claimant is not a verified Chog" } }); continue; }
      if (t?.address && c.address && t.address.toLowerCase() === c.address.toLowerCase()) { out.push({ id: b.id, kind: "bounty", to: null, outcome: { status: "skipped", why: "claimant shares a wallet with the target" } }); continue; }
      out.push({ id: b.id, kind: "bounty", to: c.tokenId, outcome: await this.settlement.settle({ id: b.id, winnerTokenId: c.tokenId, eventDigest, rulesVersion: RULES_VERSION, table: this.tableId, kind: "bounty" }) });
    }
    return out;
  }
}

/** The digest a settlement is keyed on: sha256 of the table's event log is already in GameOver; this hashes it into bytes32 for the chain. */
export const eventDigestOf = (gameOverDigest: string): Hex => keccak256(toBytes(gameOverDigest));
