// Chain reads and signature checks. Read-only; the server never holds a key that moves anything.
import { createPublicClient, defineChain, http, verifyMessage, verifyTypedData, type Address, type Hex, type PublicClient } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { CHAIN_ID, COLLECTION } from "@ruglife/protocol";

export const monad = defineChain({
  id: CHAIN_ID, name: "Monad", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC ?? "https://rpc.monad.xyz"] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});
export const client: PublicClient = createPublicClient({ chain: monad, transport: http(undefined, { timeout: 8_000, retryCount: 1 }) });

const ERC721_OWNER_OF = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const;

const ownerCache = new Map<number, { owner: Address; at: number }>();
const forcedOwners = new Map<number, Address>(); // tests only
export const OWNER_TTL_MS = 30_000; // ⚙ tech-design § 4

/** Current owner of a Chog. Throws on RPC failure — callers pause authorizations rather than guess. */
export async function ownerOf(tokenId: number, opts: { fresh?: boolean } = {}): Promise<Address> {
  const forced = forcedOwners.get(tokenId);
  if (forced) return forced;
  const c = ownerCache.get(tokenId);
  if (c && !opts.fresh && Date.now() - c.at < OWNER_TTL_MS) return c.owner;
  const owner = await client.readContract({ address: COLLECTION, abi: ERC721_OWNER_OF, functionName: "ownerOf", args: [BigInt(tokenId)] });
  ownerCache.set(tokenId, { owner, at: Date.now() });
  return owner;
}
/** Test seam: pretend ownership without an RPC. */
export function _setOwnerForTest(tokenId: number, owner: Address): void {
  forcedOwners.set(tokenId, owner);
}

/** EOA signatures (incl. EIP-7702 wallets) verify offline; contract wallets fall back to the chain (ERC-1271/6492). */
async function verifyAny(address: Address, check: () => Promise<boolean>, chainCheck: () => Promise<boolean>): Promise<boolean> {
  try { if (await check()) return true; } catch { /* fall through */ }
  try { return await chainCheck(); } catch { return false; }
}

export interface SiweExpect { domain: string; nonce: string; now?: Date }
/** Verifies an EIP-4361 message for this server. Returns the address or the reason it was refused. */
export async function verifySiwe(message: string, signature: Hex, expect: SiweExpect): Promise<{ ok: true; address: Address } | { ok: false; reason: string }> {
  const parsed = parseSiweMessage(message);
  if (!parsed.address) return { ok: false, reason: "no address" };
  if (parsed.chainId !== CHAIN_ID) return { ok: false, reason: "chain" };
  if (!validateSiweMessage({ message: parsed, domain: expect.domain, nonce: expect.nonce, time: expect.now ?? new Date() })) return { ok: false, reason: "message fields (domain, nonce, time)" };
  const address = parsed.address;
  const ok = await verifyAny(address, () => verifyMessage({ address, message, signature }), () => client.verifyMessage({ address, message, signature }));
  return ok ? { ok: true, address } : { ok: false, reason: "signature" };
}

// Pilot keys: typed data signed by the Chog's owner, authorizing one wallet to play that one Chog until a date.
export const PILOT_DOMAIN = { name: "RUG LIFE", version: "1", chainId: CHAIN_ID } as const;
export const PILOT_TYPES = {
  Pilot: [
    { name: "collection", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "pilot", type: "address" },
    { name: "expires", type: "uint64" }, { name: "nonce", type: "uint64" },
  ],
} as const;
export interface PilotKey { tokenId: number; pilot: Address; expires: number; nonce: number; signature: Hex }
export const PILOT_MAX_DAYS = 30; // ⚙ tech-design § 4

export async function verifyPilot(key: PilotKey, owner: Address, now = Date.now()): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (key.expires * 1000 <= now) return { ok: false, reason: "expired" };
  if (key.expires * 1000 > now + PILOT_MAX_DAYS * 24 * 3600_000) return { ok: false, reason: `expiry over ${PILOT_MAX_DAYS} days` };
  const message = { collection: COLLECTION, tokenId: BigInt(key.tokenId), pilot: key.pilot, expires: BigInt(key.expires), nonce: BigInt(key.nonce) };
  const args = { address: owner, domain: PILOT_DOMAIN, types: PILOT_TYPES, primaryType: "Pilot" as const, message, signature: key.signature };
  const ok = await verifyAny(owner, () => verifyTypedData(args), () => client.verifyTypedData(args));
  return ok ? { ok: true } : { ok: false, reason: "signature" };
}
