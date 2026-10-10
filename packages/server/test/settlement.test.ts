// End to end on a local anvil chain: deploy the mocks and the escrow, fund a pot, let the coordinator settle it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { SeqEvent } from "@ruglife/protocol";
import { RugLifeEscrowAbi } from "../src/abi-RugLifeEscrow.js";
import { activationSeq, hitClaimant, rugClaimant } from "../src/bounties.js";
import { bountyId, potId, Settlement } from "../src/settlement.js";
import { Store } from "../src/store.js";
import WebSocket from "ws";
import { createSiweMessage } from "viem/siwe";
import type { ClientMsg, ServerMsg } from "@ruglife/protocol";
import { _setOwnerForTest } from "../src/chain.js";
import { startServer } from "../src/index.js";

const OUT = join(import.meta.dirname, "../../../contracts/out");
const artifact = (file: string, name: string): { abi: readonly unknown[]; bytecode: Hex } => {
  const p = join(OUT, `${file}.sol`, `${name}.json`);
  if (!existsSync(p)) throw new Error(`missing ${p}: run 'forge build' in contracts/ first`);
  const j = JSON.parse(readFileSync(p, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
};
// anvil's well-known dev keys
const DEPLOYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const SIGNER = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const port = 18545 + Math.floor(Math.random() * 1000);
const rpc = `http://127.0.0.1:${port}`;
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
let anvil: ChildProcess;
const pub = createPublicClient({ chain, transport: http(rpc) });
const deployer = privateKeyToAccount(DEPLOYER);
const wallet = createWalletClient({ account: deployer, chain, transport: http(rpc) });
let chog: Address, nft: Address, registry: Address, escrow: Address;
const deploy = async (file: string, name: string, args: unknown[] = []): Promise<Address> => {
  const a = artifact(file, name);
  const hash = await wallet.deployContract({ abi: a.abi as never, bytecode: a.bytecode, args: args as never });
  const r = await pub.waitForTransactionReceipt({ hash });
  return r.contractAddress!;
};

beforeAll(async () => {
  anvil = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await pub.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  chog = await deploy("Mocks", "MockChog");
  nft = await deploy("Mocks", "MockNFT");
  registry = await deploy("Mocks", "MockRegistry");
  const signer = privateKeyToAccount(SIGNER);
  escrow = await deploy("RugLifeEscrow", "RugLifeEscrow", [chog, registry, "0x000000000000000000000000000000000000abcd", "0x000000000000000000000000000000000000beef", nft, signer.address, deployer.address, 10n ** 24n]);
  // the signer needs gas to submit
  await pub.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: signer.address, value: 10n ** 18n }) });
}, 60_000);
afterAll(() => { anvil?.kill(); });

const mocks = artifact("Mocks", "MockChog").abi as never;
const nftAbi = artifact("Mocks", "MockNFT").abi as never;
const tx = async (hash: Hex) => pub.waitForTransactionReceipt({ hash });

describe("settlement coordinator (anvil)", () => {
  it("funds a pot, settles it to the winner's chest, and never pays twice", async () => {
    const holder = "0x000000000000000000000000000000000000401d" as Address;
    await tx(await wallet.writeContract({ address: nft, abi: nftAbi, functionName: "setOwner", args: [287n, holder] }));
    await tx(await wallet.writeContract({ address: chog, abi: mocks, functionName: "mint", args: [deployer.address, 1000n * 10n ** 18n] }));
    await tx(await wallet.writeContract({ address: chog, abi: mocks, functionName: "approve", args: [escrow, 1000n * 10n ** 18n] }));
    const id = potId("table-xyz");
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    await tx(await wallet.writeContract({ address: escrow, abi: RugLifeEscrowAbi, functionName: "fund", args: [id, 0, 0n, 0, 100n * 10n ** 18n, expiry, false, `0x${"0".repeat(64)}`] }));
    const dataDir = mkdtempSync(join(tmpdir(), "ruglife-settle-"));
    const store = new Store(dataDir);
    const s = new Settlement({ rpc, chainId: 31337, escrow, signerKey: SIGNER, store });
    const chest = await s.chestOf(287);
    expect(await pub.getCode({ address: chest })).toBeUndefined();
    const req = { id, winnerTokenId: 287, eventDigest: keccak256(toBytes("events")), rulesVersion: "0.2.0", table: "table-xyz", kind: "pot" as const };
    const r1 = await s.settle(req);
    expect(r1.status).toBe("paid");
    expect((r1 as { txHash: Hex }).txHash).toMatch(/^0x/);
    expect(await pub.readContract({ address: chog, abi: mocks, functionName: "balanceOf", args: [chest] })).toBe(100n * 10n ** 18n);
    expect(await pub.getCode({ address: chest })).toBeDefined();
    // a retry reconciles from the chain and sends nothing
    const r2 = await s.settle(req);
    expect(r2).toEqual({ status: "paid", txHash: null, reconciled: true });
    // an unknown id is empty
    expect(await s.settle({ ...req, id: bountyId("table-xyz", 287, "hit") })).toEqual({ status: "empty" });
    // a wrong signer cannot settle (the escrow refuses; the record says failed)
    const bad = new Settlement({ rpc, chainId: 31337, escrow, signerKey: DEPLOYER, store });
    const id2 = potId("table-2");
    await tx(await wallet.writeContract({ address: escrow, abi: RugLifeEscrowAbi, functionName: "fund", args: [id2, 0, 0n, 0, 5n * 10n ** 18n, expiry, false, `0x${"0".repeat(64)}`] }));
    const r3 = await bad.settle({ ...req, id: id2, table: "table-2" });
    expect(r3.status).toBe("failed");
    const log = readFileSync(join(dataDir, "settlements.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.map((r) => r.status)).toEqual(["reserved", "paid", "paid", "empty", "reserved", "failed"]);
  }, 60_000);
});

describe("bounty triggers (pure)", () => {
  const ev = (seq: number, e: SeqEvent["ev"]): SeqEvent => ({ seq, ev: e });
  const events: SeqEvent[] = [
    ev(1, { t: "TurnStarted", seat: 0, turn: 1 }),
    ev(2, { t: "FudResolved", actor: 1, target: 0, card: "f01#1", def: "f01", levelBefore: 3, levelAfter: 2, rekt: false }), // before activation
    ev(3, { t: "TurnStarted", seat: 1, turn: 2 }),
    ev(4, { t: "TurnStarted", seat: 0, turn: 3 }), // bounty on seat 0 funded at seq 2 → active from 4
    ev(5, { t: "FudResolved", actor: 0, target: 0, card: "f02#1", def: "f02", levelBefore: 2, levelAfter: 1, rekt: false }), // self: no
    ev(6, { t: "FudResolved", actor: 2, target: 0, card: "f07#1", def: "f07", levelBefore: 1, levelAfter: 1, rekt: false }), // kitOff: no level change: no
    ev(7, { t: "FudResolved", actor: 1, target: 0, card: "f03#1", def: "f03", levelBefore: 1, levelAfter: 1, rekt: true }), // rekt: yes
    ev(8, { t: "FudResolved", actor: 2, target: 0, card: "f01#1", def: "f01", levelBefore: 4, levelAfter: 3, rekt: false }), // later: not first
    ev(9, { t: "RugResolved", fight: 3, puller: 2, victims: [0, 1] }),
    ev(10, { t: "RugResolved", fight: 4, puller: 1, victims: [0] }),
  ];
  it("activation is the target's next turn start after funding; HIT is the first qualifying FUD by another seat; RUG is the first rug on the target", () => {
    expect(activationSeq(events, 0, 2)).toBe(4);
    expect(activationSeq(events, 0, 9)).toBeNull();
    expect(hitClaimant(events, 0, 4)).toEqual({ seat: 1, seq: 7 });
    expect(hitClaimant(events, 0, 8)).toEqual({ seat: 2, seq: 8 });
    expect(hitClaimant(events, 1, 4)).toBeNull();
    expect(rugClaimant(events, 0, 4)).toEqual({ seat: 2, seq: 9 });
    expect(rugClaimant(events, 1, 4)).toEqual({ seat: 2, seq: 9 });
    expect(rugClaimant(events, 0, 10)).toEqual({ seat: 1, seq: 10 });
    expect(rugClaimant(events, 2, 4)).toBeNull();
  });
});

// ---- the whole chain through the server: two verified Chogs, a funded pot, the winner's chest is paid ----
class WsClient {
  ws!: WebSocket; inbox: ServerMsg[] = []; waiters: Array<{ pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }> = []; session: string | null = null;
  async open(port: number): Promise<void> {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on("message", (d) => { const m = JSON.parse(String(d)) as ServerMsg; const i = this.waiters.findIndex((w) => w.pred(m)); if (i >= 0) this.waiters.splice(i, 1)[0]!.res(m); else this.inbox.push(m); });
    await new Promise<void>((r, j) => { this.ws.once("open", () => r()); this.ws.once("error", j); });
  }
  send(m: ClientMsg): void { this.ws.send(JSON.stringify(m)); }
  wait<T extends ServerMsg["type"]>(type: T, pred: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true, ms = 20_000): Promise<Extract<ServerMsg, { type: T }>> {
    const i = this.inbox.findIndex((m) => m.type === type && pred(m as never));
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as never);
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), ms); this.waiters.push({ pred: (m) => m.type === type && pred(m as never), res: (m) => { clearTimeout(t); res(m as never); } }); });
  }
}
describe("table → escrow (anvil): a pot is paid to the winning Chog's chest after the game", () => {
  it("publishes ids, observes funding, settles the pot to a verified winner's chest", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ruglife-link-"));
    const srv = startServer({ port: 0, dataDir, domain: "ruglife.test", uri: "https://ruglife.test", ownerPoll: false, log: () => {}, escrow: { rpc, chainId: 31337, escrow, chog, signerKey: SIGNER } });
    const keyA = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex; // anvil #2
    const keyB = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex; // anvil #3
    const A = privateKeyToAccount(keyA), B = privateKeyToAccount(keyB);
    _setOwnerForTest(287, A.address); _setOwnerForTest(1659, B.address);
    const clients: WsClient[] = [];
    try {
      const signin = async (acct: typeof A): Promise<WsClient> => {
        const c = new WsClient(); await c.open(srv.port()); clients.push(c);
        c.send({ type: "hello", session: null }); c.session = (await c.wait("welcome")).session;
        c.send({ type: "nonce" }); const n = await c.wait("nonce");
        const message = createSiweMessage({ address: acct.address, chainId: 143, domain: n.domain, nonce: n.nonce, uri: n.uri, version: "1" });
        c.send({ type: "signin", message, signature: await acct.signMessage({ message }) });
        await c.wait("signedIn");
        return c;
      };
      const a = await signin(A); const b = await signin(B);
      a.send({ type: "create", mode: "tournament", timers: false });
      const id = (await a.wait("table")).table.id;
      a.send({ type: "sit", table: id, tokenId: 287 }); await a.wait("table", (m) => m.table.seats.length === 1);
      b.send({ type: "sit", table: id, tokenId: 1659 }); await b.wait("table", (m) => m.table.seats.length === 2);
      a.send({ type: "start", table: id });
      const ts = await a.wait("tables", (m) => m.tables.some((t) => t.id === id && !!t.escrow));
      const esc = ts.tables.find((t) => t.id === id)!.escrow!;
      expect(esc.eligible).toBe(true);
      expect(esc.potId).toBe(potId(id));
      expect(esc.bounties.map((x) => [x.seat, x.trigger])).toEqual([[0, "hit"], [0, "rug"], [1, "hit"], [1, "rug"]]);
      expect(esc.bounties[0]!.id).toBe(bountyId(id, 287, "hit"));
      // a spectator funds the pot from their own wallet with the published id and expiry
      const s = new Settlement({ rpc, chainId: 31337, escrow, signerKey: SIGNER, store: new Store(dataDir) });
      const chestBefore = { 287: await pub.readContract({ address: chog, abi: mocks, functionName: "balanceOf", args: [await s.chestOf(287)] }) as bigint, 1659: await pub.readContract({ address: chog, abi: mocks, functionName: "balanceOf", args: [await s.chestOf(1659)] }) as bigint };
      await tx(await wallet.writeContract({ address: chog, abi: mocks, functionName: "approve", args: [escrow, 1000n * 10n ** 18n] }));
      await tx(await wallet.writeContract({ address: escrow, abi: RugLifeEscrowAbi, functionName: "fund", args: [esc.potId, 0, 0n, 0, 42n * 10n ** 18n, BigInt(esc.expiry), false, `0x${"0".repeat(64)}`] }));
      // play it out on autopilot
      a.send({ type: "act", table: id, action: { type: "START_GAME", seat: 0 }, clientSeq: 1 });
      await a.wait("view", (m) => m.view.phase !== "lobby");
      a.send({ type: "act", table: id, action: { type: "AUTOPILOT", seat: 0, on: true }, clientSeq: 2 });
      b.send({ type: "act", table: id, action: { type: "AUTOPILOT", seat: 1, on: true }, clientSeq: 1 });
      const over = await b.wait("view", (m) => m.view.phase === "over", 60_000);
      const winnerToken = over.view.seats.find((x) => x.seat === over.view.winner)!.chog.tokenId;
      // settlement is asynchronous after the last event: wait for the log row
      let row: Record<string, unknown> | undefined;
      for (let i = 0; i < 100 && !row; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const log = readFileSync(join(dataDir, "tables", `${id}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
        row = log.find((r) => r.t === "settled" && r.kind === "pot");
      }
      expect(row).toBeDefined();
      expect(row!.to).toBe(winnerToken);
      expect((row!.outcome as { status: string }).status).toBe("paid");
      const chest = await s.chestOf(winnerToken);
      const after = await pub.readContract({ address: chog, abi: mocks, functionName: "balanceOf", args: [chest] }) as bigint;
      expect(after - chestBefore[winnerToken as 287 | 1659]).toBe(42n * 10n ** 18n);
    } finally {
      for (const c of clients) c.ws.close();
      await srv.close();
    }
  }, 120_000);
});
