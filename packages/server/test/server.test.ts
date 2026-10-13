import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import type { ClientMsg, ServerMsg, View } from "@ruglife/protocol";
import { replay } from "@ruglife/engine/sim";
import { _setOwnerForTest } from "../src/chain.js";
import { startServer } from "../src/index.js";

class Client {
  ws!: WebSocket;
  inbox: ServerMsg[] = [];
  waiters: Array<{ pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }> = [];
  session: string | null = null;
  async open(port: number): Promise<void> {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) { const w = this.waiters.splice(i, 1)[0]!; w.res(m); } else this.inbox.push(m);
    });
    await new Promise<void>((r, j) => { this.ws.once("open", () => r()); this.ws.once("error", j); });
  }
  send(m: ClientMsg): void { this.ws.send(JSON.stringify(m)); }
  wait<T extends ServerMsg["type"]>(type: T, pred: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true, ms = 10_000): Promise<Extract<ServerMsg, { type: T }>> {
    const i = this.inbox.findIndex((m) => m.type === type && pred(m as Extract<ServerMsg, { type: T }>));
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { type: T }>);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), ms);
      this.waiters.push({ pred: (m) => m.type === type && pred(m as Extract<ServerMsg, { type: T }>), res: (m) => { clearTimeout(t); res(m as Extract<ServerMsg, { type: T }>); } });
    });
  }
  async hello(session: string | null = null): Promise<void> {
    this.send({ type: "hello", session });
    const w = await this.wait("welcome");
    this.session = w.session;
  }
  close(): void { this.ws.close(); }
}

const dataDir = mkdtempSync(join(tmpdir(), "ruglife-"));
let srv: ReturnType<typeof startServer>;
const clients: Client[] = [];
const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

beforeAll(() => { srv = startServer({ port: 0, dataDir, domain: "ruglife.test", uri: "https://ruglife.test", ownerPoll: false, log: () => {} }); });
afterAll(async () => { for (const c of clients) c.close(); await srv.close(); });
const connect = async (): Promise<Client> => { const c = new Client(); await c.open(srv.port()); clients.push(c); await c.hello(); return c; };

describe("server", () => {
  it("two guests on loaners and two bots play a whole table through the socket; the log replays to the same digest", async () => {
    const a = await connect();
    const b = await connect();
    a.send({ type: "create", mode: "tournament", name: "test", timers: false });
    const created = await a.wait("table");
    const id = created.table.id;
    a.send({ type: "sit", table: id, loaner: true });
    await a.wait("table", (m) => m.table.seats.length === 1);
    b.send({ type: "sit", table: id, loaner: true });
    await b.wait("table", (m) => m.table.seats.length === 2);
    a.send({ type: "addBot", table: id }); await a.wait("table", (m) => m.table.seats.length === 3);
    a.send({ type: "addBot", table: id }); await a.wait("table", (m) => m.table.seats.length === 4);
    // only the host starts
    b.send({ type: "start", table: id });
    expect((await b.wait("error")).code).toBe("start");
    a.send({ type: "start", table: id });
    const v0 = await a.wait("view", (m) => m.view.phase === "lobby");
    expect(v0.view.viewer).toBe(0);
    expect(v0.view.seats.map((s) => s.kind)).toEqual(["loaner", "loaner", "bot", "bot"]);
    expect(v0.view.seats[1]!.hand).toBeNull(); // b's hand hidden from a
    // a seat cannot act for another seat, and the engine refuses an illegal action
    a.send({ type: "act", table: id, action: { type: "START_GAME", seat: 1 }, clientSeq: 1 });
    expect((await a.wait("error")).code).toBe("act");
    a.send({ type: "act", table: id, action: { type: "END_TURN", seat: 0 }, clientSeq: 2 });
    expect((await a.wait("error")).code).toBe("illegal");
    // host starts the engine game; both humans go autopilot; the server pumps the bots to the end
    a.send({ type: "act", table: id, action: { type: "START_GAME", seat: 0 }, clientSeq: 3 });
    await a.wait("view", (m) => m.view.phase !== "lobby");
    a.send({ type: "act", table: id, action: { type: "AUTOPILOT", seat: 0, on: true }, clientSeq: 4 });
    b.send({ type: "act", table: id, action: { type: "AUTOPILOT", seat: 1, on: true }, clientSeq: 1 });
    const over = await b.wait("view", (m) => m.view.phase === "over", 30_000);
    expect(over.view.winner).not.toBeNull();
    const stands = await connect();
    stands.send({ type: "watch", table: id });
    const sv = await stands.wait("view");
    expect(sv.view.viewer).toBe("stands");
    expect(sv.view.legal).toEqual([]);
    // the append-only log replays to the recorded digest
    const log = readFileSync(join(dataDir, "tables", `${id}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log[0].t).toBe("created");
    const last = log[log.length - 1];
    expect(last.t).toBe("over");
    const config = { ...log[0].config, seed: last.seed };
    const actions = log.filter((r) => r.t === "act").map((r) => r.action);
    expect(replay(config, actions).digest).toBe(last.digest);
    expect(readdirSync(join(dataDir, "tables"))).toContain(`${id}.jsonl`);
  });

  it("sign-in with a wallet signature, then sit with a Chog the wallet owns (owner read mocked); a Chog not owned is refused", async () => {
    const c = await connect();
    c.send({ type: "sit", table: "nope", tokenId: 287 });
    expect((await c.wait("error")).code).toBe("table");
    c.send({ type: "nonce" });
    const n = await c.wait("nonce");
    expect(n.chainId).toBe(143);
    const message = createSiweMessage({ address: owner.address, chainId: 143, domain: n.domain, nonce: n.nonce, uri: n.uri, version: "1" });
    c.send({ type: "signin", message, signature: await owner.signMessage({ message }) });
    expect((await c.wait("signedIn")).address).toBe(owner.address);
    // session survives a reconnect
    const d = new Client(); await d.open(srv.port()); clients.push(d); await d.hello(c.session);
    expect(d.session).toBe(c.session);
    d.send({ type: "create", mode: "standard", timers: false });
    const t = await d.wait("table");
    _setOwnerForTest(287, owner.address);
    _setOwnerForTest(1659, "0x000000000000000000000000000000000000dEaD");
    d.send({ type: "sit", table: t.table.id, tokenId: 1659 });
    expect((await d.wait("error")).code).toBe("notOwner");
    d.send({ type: "sit", table: t.table.id, tokenId: 287 });
    const sat = await d.wait("table", (m) => m.table.seats.length === 1);
    expect(sat.table.seats[0]).toMatchObject({ kind: "chog", tokenId: 287, name: "CHOG #1748", you: true });
    // one live game per Chog: the same Chog cannot sit at a second live table
    d.send({ type: "addBot", table: t.table.id }); await d.wait("table", (m) => m.table.seats.length === 2);
    d.send({ type: "start", table: t.table.id });
    await d.wait("view");
    const e = new Client(); await e.open(srv.port()); clients.push(e); await e.hello(c.session);
    e.send({ type: "create", mode: "standard", timers: false });
    const t2 = await e.wait("table");
    e.send({ type: "sit", table: t2.table.id, tokenId: 287 });
    expect((await e.wait("error")).code).toBe("live");
  });

  it("a reconnecting session gets the current view of its live table without asking (a stale view made the user's clicks illegal, 2026-10-13)", async () => {
    const a = await connect();
    a.send({ type: "create", mode: "standard", timers: false });
    const id = (await a.wait("table")).table.id;
    a.send({ type: "sit", table: id, loaner: true }); await a.wait("table", (m) => m.table.seats.length === 1);
    a.send({ type: "addBot", table: id }); await a.wait("table", (m) => m.table.seats.length === 2);
    a.send({ type: "start", table: id });
    const first = await a.wait("view", (m) => m.table === id);
    // the same session on a fresh socket: hello alone brings the table's current view, as the seat (not the stands)
    const b = new Client(); await b.open(srv.port()); clients.push(b); await b.hello(a.session);
    const again = await b.wait("view", (m) => m.table === id, 3_000);
    expect(again.view.viewer).toBe(first.view.viewer);
    expect(again.view.seq).toBeGreaterThanOrEqual(first.view.seq);
    expect(again.events).toEqual([]);
  });

  it("a guest without sign-in cannot sit with a Chog", async () => {
    const g = await connect();
    g.send({ type: "create", mode: "standard", timers: false });
    const t = await g.wait("table");
    g.send({ type: "sit", table: t.table.id, tokenId: 5 });
    expect((await g.wait("error")).code).toBe("signin");
  });
});
