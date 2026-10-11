// Wallet flows. Playing needs only signatures: sign-in (EIP-4361) and pilot keys (EIP-712). Nothing here moves a Chog.
import { createPublicClient, createWalletClient, custom, http, parseAbi, type Address, type Hex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { CHAIN_ID, COLLECTION } from "@ruglife/protocol";
import { request } from "./net.js";

export const monad = {
  id: CHAIN_ID, name: "Monad", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monad Explorer", url: "https://monadexplorer.com" } },
} as const;

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (ev: string, cb: (...a: unknown[]) => void) => void };
const injected = (): Eip1193 | null => (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
export const hasWallet = (): boolean => injected() !== null;

export const publicClient = createPublicClient({ chain: monad, transport: http() });
const walletClient = () => {
  const p = injected();
  if (!p) throw new Error("no wallet found in this browser");
  return createWalletClient({ chain: monad, transport: custom(p) });
};

export async function connect(): Promise<Address> {
  const p = injected();
  if (!p) throw new Error("no wallet found in this browser (install one, or play a loaner)");
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as Address[];
  const a = accounts[0];
  if (!a) throw new Error("no account");
  await ensureChain(p);
  return a;
}
async function ensureChain(p: Eip1193): Promise<void> {
  const hex = `0x${CHAIN_ID.toString(16)}`;
  const current = (await p.request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() === hex) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 4902) throw e;
    await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: "Monad", nativeCurrency: monad.nativeCurrency, rpcUrls: [...monad.rpcUrls.default.http], blockExplorerUrls: [monad.blockExplorers.default.url] }] });
  }
}

/** EIP-4361 sign-in: the server's nonce, the user's signature, nothing else. */
export async function signIn(): Promise<Address> {
  const address = await connect();
  const n = await request({ type: "nonce" }, "nonce");
  const message = createSiweMessage({
    address, chainId: n.chainId, domain: n.domain, uri: n.uri, nonce: n.nonce, version: "1",
    statement: "Sign in to RUG LIFE. This is a signature, not a transaction: it moves nothing and approves nothing.",
    issuedAt: new Date(), expirationTime: new Date(Date.now() + 10 * 60_000),
  });
  const signature = await walletClient().signMessage({ account: address, message });
  const r = await request({ type: "signin", message, signature }, "signedIn");
  return r.address;
}

export const PILOT_DOMAIN = { name: "RUG LIFE", version: "1", chainId: CHAIN_ID } as const;
export const PILOT_TYPES = {
  Pilot: [
    { name: "collection", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "pilot", type: "address" },
    { name: "expires", type: "uint64" }, { name: "nonce", type: "uint64" },
  ],
} as const;
/** The OWNER signs a pilot key for one Chog: the pilot wallet may sit with it until `expires`. Grants nothing over the chest. */
export async function registerPilot(tokenId: number, pilot: Address, days: number): Promise<{ expires: number }> {
  const owner = await connect();
  const expires = Math.floor(Date.now() / 1000) + Math.min(30, Math.max(1, days)) * 86_400;
  const nonce = Math.floor(Date.now() / 1000);
  const signature = await walletClient().signTypedData({
    account: owner, domain: PILOT_DOMAIN, types: PILOT_TYPES, primaryType: "Pilot",
    message: { collection: COLLECTION, tokenId: BigInt(tokenId), pilot, expires: BigInt(expires), nonce: BigInt(nonce) },
  });
  await request({ type: "pilot", tokenId, pilot, expires, nonce, signature }, "pilotOk");
  return { expires };
}

const collectionAbi = parseAbi(["function tokensOfOwner(address) view returns (uint256[])", "function ownerOf(uint256) view returns (address)"]);
/** The Chogs in a wallet, read from the chain (the collection exposes tokensOfOwner). */
export async function chogsOf(address: Address): Promise<number[]> {
  const ids = await publicClient.readContract({ address: COLLECTION, abi: collectionAbi, functionName: "tokensOfOwner", args: [address] });
  return ids.map((x) => Number(x)).sort((a, b) => a - b);
}

// ---- $CHOG: funding a pot or a bounty is the spender's own transaction (permit = an allowance, labelled as one) ----
const erc20PermitAbi = parseAbi([
  "function nonces(address) view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function name() view returns (string)",
]);
const escrowAbi = parseAbi([
  "function fundWithPermit(bytes32 id, uint8 kind, uint256 targetTokenId, uint8 trigger, uint256 amount, uint64 expiry, bool toSeasonIfUnclaimed, bytes32 seasonId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function pools(bytes32 id) view returns (uint8 kind, uint8 trigger, uint256 targetTokenId, uint64 expiry, uint256 total, bool settled, uint256 paidTo, bytes32 eventDigest)",
]);
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
export const KIND = { pot: 0, bounty: 1 } as const;
export const TRIGGER = { hit: 0, rug: 1 } as const;
export async function chogBalance(chog: Address, holder: Address): Promise<bigint> {
  return publicClient.readContract({ address: chog, abi: erc20PermitAbi, functionName: "balanceOf", args: [holder] });
}
/** One permit signature (an allowance for exactly `amount`), then one transaction that deposits into the published id. */
export async function fund(opts: { escrow: Address; chog: Address; id: Hex; kind: number; targetTokenId: number; trigger: number; amount: bigint; expiry: number; toSeason: boolean }): Promise<Hex> {
  const owner = await connect();
  const wc = walletClient();
  const nonce = await publicClient.readContract({ address: opts.chog, abi: erc20PermitAbi, functionName: "nonces", args: [owner] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await wc.signTypedData({
    account: owner,
    domain: { name: "Chog", version: "1", chainId: CHAIN_ID, verifyingContract: opts.chog },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner, spender: opts.escrow, value: opts.amount, nonce, deadline },
  });
  const r = `0x${sig.slice(2, 66)}` as Hex, s = `0x${sig.slice(66, 130)}` as Hex, v = Number(`0x${sig.slice(130, 132)}`);
  const args = [opts.id, opts.kind, BigInt(opts.targetTokenId), opts.trigger, opts.amount, BigInt(opts.expiry), opts.toSeason, ZERO32, deadline, v, r, s] as const;
  // Monad charges the gas LIMIT: estimate, then a small margin — never a wallet's round default.
  const gas = await publicClient.estimateContractGas({ address: opts.escrow, abi: escrowAbi, functionName: "fundWithPermit", args, account: owner });
  return wc.writeContract({ address: opts.escrow, abi: escrowAbi, functionName: "fundWithPermit", args, account: owner, gas: (gas * 125n) / 100n });
}
export const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;
