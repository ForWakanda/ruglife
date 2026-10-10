// Settlement coordinator: signs the result signer's attestation and submits it to the escrow.
// Records funded / reserved / paid / refunded with transaction hashes; a retry first reconciles the chain.
import { createPublicClient, createWalletClient, defineChain, http, keccak256, recoverAddress, toBytes, type Address, type Chain, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { RugLifeEscrowAbi } from "./abi-RugLifeEscrow.js";
import type { Store } from "./store.js";

export const SETTLEMENT_TYPES = {
  Settlement: [
    { name: "id", type: "bytes32" }, { name: "winnerTokenId", type: "uint256" }, { name: "eventDigest", type: "bytes32" }, { name: "rulesVersion", type: "string" },
  ],
} as const;

export interface SettlementOpts { rpc: string; chainId: number; escrow: Address; signerKey: Hex; submitterKey?: Hex; store: Store; log?: (l: string) => void; gasMargin?: number }
export interface SettleRequest { id: Hex; winnerTokenId: number; eventDigest: Hex; rulesVersion: string; table: string; kind: "pot" | "bounty" }
export type SettleOutcome = { status: "paid"; txHash: Hex | null; reconciled: boolean } | { status: "empty" } | { status: "failed"; error: string };

export const potId = (tableId: string): Hex => keccak256(toBytes(`RUG LIFE pot ${tableId}`));
export const bountyId = (tableId: string, targetTokenId: number, trigger: "hit" | "rug"): Hex => keccak256(toBytes(`RUG LIFE bounty ${tableId} ${targetTokenId} ${trigger}`));

export class Settlement {
  readonly chain: Chain;
  readonly pub: PublicClient;
  readonly wallet: WalletClient;
  readonly signer: PrivateKeyAccount;
  readonly submitter: PrivateKeyAccount;
  private readonly log: (l: string) => void;
  private readonly gasMargin: number;
  constructor(readonly opts: SettlementOpts) {
    this.chain = defineChain({ id: opts.chainId, name: `chain-${opts.chainId}`, nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [opts.rpc] } } });
    this.pub = createPublicClient({ chain: this.chain, transport: http(opts.rpc, { timeout: 15_000 }) });
    this.signer = privateKeyToAccount(opts.signerKey);
    this.submitter = privateKeyToAccount(opts.submitterKey ?? opts.signerKey);
    this.wallet = createWalletClient({ account: this.submitter, chain: this.chain, transport: http(opts.rpc, { timeout: 15_000 }) });
    this.log = opts.log ?? (() => {});
    this.gasMargin = opts.gasMargin ?? 1.25; // Monad charges the gas LIMIT: estimate + a small margin, never a wallet default
  }
  private record(row: Record<string, unknown>): void {
    this.opts.store.appendRow("settlements.jsonl", { t: "settlement", at: Date.now(), ...row });
  }
  async pool(id: Hex): Promise<{ kind: number; trigger: number; targetTokenId: bigint; expiry: bigint; total: bigint; settled: boolean; paidTo: bigint; eventDigest: Hex }> {
    const r = await this.pub.readContract({ address: this.opts.escrow, abi: RugLifeEscrowAbi, functionName: "pools", args: [id] });
    const [kind, trigger, targetTokenId, expiry, total, settled, paidTo, eventDigest] = r;
    return { kind, trigger, targetTokenId, expiry, total, settled, paidTo, eventDigest };
  }
  async chestOf(tokenId: number): Promise<Address> {
    return this.pub.readContract({ address: this.opts.escrow, abi: RugLifeEscrowAbi, functionName: "chestOf", args: [BigInt(tokenId)] });
  }
  async sign(req: SettleRequest): Promise<Hex> {
    return this.signer.signTypedData({
      domain: { name: "RUG LIFE Escrow", version: "1", chainId: this.opts.chainId, verifyingContract: this.opts.escrow },
      types: SETTLEMENT_TYPES, primaryType: "Settlement",
      message: { id: req.id, winnerTokenId: BigInt(req.winnerTokenId), eventDigest: req.eventDigest, rulesVersion: req.rulesVersion },
    });
  }
  /** Settles one id once. Reads the chain first; never resubmits a paid id. */
  async settle(req: SettleRequest): Promise<SettleOutcome> {
    const base = { id: req.id, table: req.table, kind: req.kind, winnerTokenId: req.winnerTokenId, eventDigest: req.eventDigest };
    const p = await this.pool(req.id);
    if (p.settled) {
      this.record({ ...base, status: "paid", reconciled: true, paidTo: Number(p.paidTo) });
      return { status: "paid", txHash: null, reconciled: true };
    }
    if (p.total === 0n) { this.record({ ...base, status: "empty" }); return { status: "empty" }; }
    this.record({ ...base, status: "reserved", amount: p.total.toString() });
    try {
      const signature = await this.sign(req);
      // self-check against the contract's own hashing before spending gas
      const digest = await this.pub.readContract({ address: this.opts.escrow, abi: RugLifeEscrowAbi, functionName: "settlementDigest", args: [req.id, BigInt(req.winnerTokenId), req.eventDigest, req.rulesVersion] });
      const recovered = await recoverAddress({ hash: digest, signature });
      if (recovered.toLowerCase() !== this.signer.address.toLowerCase()) throw new Error("typed-data encoding mismatch with the contract");
      const args = [req.id, BigInt(req.winnerTokenId), req.eventDigest, req.rulesVersion, signature] as const;
      const gas = await this.pub.estimateContractGas({ address: this.opts.escrow, abi: RugLifeEscrowAbi, functionName: "settle", args, account: this.submitter });
      const txHash = await this.wallet.writeContract({ address: this.opts.escrow, abi: RugLifeEscrowAbi, functionName: "settle", args, account: this.submitter, chain: this.chain, gas: (gas * BigInt(Math.round(this.gasMargin * 100))) / 100n });
      const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error(`settle reverted in ${txHash}`);
      this.record({ ...base, status: "paid", txHash, amount: p.total.toString(), gasUsed: receipt.gasUsed.toString() });
      this.log(`settled ${req.kind} ${req.id.slice(0, 10)} → token ${req.winnerTokenId} (${p.total} wei) in ${txHash}`);
      return { status: "paid", txHash, reconciled: false };
    } catch (e) {
      const error = (e as Error).message.slice(0, 300);
      this.record({ ...base, status: "failed", error });
      this.log(`settle failed ${req.id.slice(0, 10)}: ${error}`);
      return { status: "failed", error };
    }
  }
}
