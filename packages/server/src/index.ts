// RUG LIFE server: one WebSocket, tables, sign-in, ownership checks. Run: npx tsx packages/server/src/index.ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMsg, ServerMsg, SeatId } from "@ruglife/protocol";
import { CHAIN_ID } from "@ruglife/protocol";
import { IllegalAction, token } from "@ruglife/engine";
import { generateSiweNonce } from "viem/siwe";
import type { Address, Hex } from "viem";
import { ownerOf, OWNER_TTL_MS, verifyPilot, verifySiwe, type PilotKey } from "./chain.js";
import { Store } from "./store.js";
import { Table } from "./tables.js";
import { Settlement } from "./settlement.js";
import { EscrowLink } from "./escrow-link.js";
import { rebuildRecords, type Records } from "./record.js";

export interface Session { id: string; address: Address | null; nonce: string | null; nonceAt: number; createdAt: number; lastSeen: number }
export interface EscrowOpts { rpc: string; chainId: number; escrow: Address; chog: Address; signerKey: Hex; submitterKey?: Hex }
export interface ServerOpts { port?: number; dataDir?: string; domain?: string; uri?: string; staticDir?: string; ownerPoll?: boolean; log?: (line: string) => void; escrow?: EscrowOpts | null }

export function startServer(opts: ServerOpts = {}) {
  const store = new Store(opts.dataDir ?? join(process.cwd(), "data"));
  const domain = opts.domain ?? process.env.RUGLIFE_DOMAIN ?? "localhost";
  const uri = opts.uri ?? process.env.RUGLIFE_URI ?? `http://${domain}`;
  const log = opts.log ?? ((l: string) => console.log(new Date().toISOString(), l));
  const sessions = new Map<string, Session>(Object.entries(store.readJson<Record<string, Session>>("sessions.json", {})));
  const pilots = new Map<string, PilotKey & { owner: Address }>(Object.entries(store.readJson<Record<string, PilotKey & { owner: Address }>>("pilots.json", {})));
  const tables = new Map<string, Table>();
  let records: Records | null = null;
  const dataDir = opts.dataDir ?? join(process.cwd(), "data");
  const recordsNow = (): Records => { if (!records) records = rebuildRecords(dataDir); return records; };
  const escrowOpts = opts.escrow === undefined ? escrowFromEnv() : opts.escrow;
  const settlement = escrowOpts ? new Settlement({ rpc: escrowOpts.rpc, chainId: escrowOpts.chainId, escrow: escrowOpts.escrow, signerKey: escrowOpts.signerKey, ...(escrowOpts.submitterKey ? { submitterKey: escrowOpts.submitterKey } : {}), store, log }) : null;
  if (settlement) log(`escrow ${escrowOpts!.escrow} on chain ${escrowOpts!.chainId}; result signer ${settlement.signer.address}; submitter ${settlement.submitter.address}`);
  else log("no escrow configured (RUGLIFE_ESCROW / RUGLIFE_SIGNER_KEY unset): pots and bounties are off");
  const sockets = new Map<WebSocket, { session: Session | null; watching: Set<string> }>();
  const persistSessions = (): void => store.writeJson("sessions.json", Object.fromEntries(sessions));
  const persistPilots = (): void => store.writeJson("pilots.json", Object.fromEntries(pilots));

  const http = createServer((req, res) => serveStatic(req, res));
  const wss = new WebSocketServer({ server: http });
  http.on("error", (e) => log(`http error ${String(e)}`));
  wss.on("error", (e) => log(`wss error ${String(e)}`));

  function send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
  function err(ws: WebSocket, code: string, detail?: string): void {
    send(ws, { type: "error", code, ...(detail ? { detail } : {}) });
  }
  function tableList(forSession?: string): ServerMsg {
    return { type: "tables", tables: [...tables.values()].filter((t) => t.status !== "over" || Date.now() - t.createdAt < 3600_000).map((t) => t.info(forSession)) };
  }
  function broadcastTables(): void {
    for (const [ws, c] of sockets) send(ws, tableList(c.session?.id));
  }
  /** Is this token seated at any live table as a verified Chog? (one live game per Chog) */
  function liveElsewhere(tokenId: number, except: string): boolean {
    for (const t of tables.values()) if (t.id !== except && t.status !== "over" && t.seats.some((s) => s.kind === "chog" && s.tokenId === tokenId)) return true;
    return false;
  }
  async function authorizeChog(session: Session, tokenId: number): Promise<{ ok: true; owner: Address; via: "owner" | "pilot" } | { ok: false; code: string; detail?: string }> {
    if (!session.address) return { ok: false, code: "signin", detail: "sign in to play a Chog" };
    if (!token(tokenId)) return { ok: false, code: "token" };
    let owner: Address;
    try { owner = await ownerOf(tokenId, { fresh: true }); } catch (e) { return { ok: false, code: "rpc", detail: "could not read the owner; try again" }; }
    if (owner.toLowerCase() === session.address.toLowerCase()) return { ok: true, owner, via: "owner" };
    const pk = pilots.get(String(tokenId));
    if (pk && pk.pilot.toLowerCase() === session.address.toLowerCase()) {
      const v = await verifyPilot(pk, owner);
      if (v.ok) return { ok: true, owner, via: "pilot" };
      pilots.delete(String(tokenId)); persistPilots();
      return { ok: false, code: "pilot", detail: v.reason };
    }
    return { ok: false, code: "notOwner", detail: `${token(tokenId).name} is not in your wallet` };
  }

  async function handle(ws: WebSocket, msg: ClientMsg): Promise<void> {
    const c = sockets.get(ws)!;
    if (msg.type === "hello") {
      let s = msg.session ? sessions.get(msg.session) ?? null : null;
      if (!s) { s = { id: randomUUID(), address: null, nonce: null, nonceAt: 0, createdAt: Date.now(), lastSeen: Date.now() }; sessions.set(s.id, s); }
      s.lastSeen = Date.now();
      persistSessions();
      c.session = s;
      send(ws, { type: "welcome", session: s.id, address: s.address });
      send(ws, tableList(s.id));
      // re-attach to tables this session sits at
      for (const t of tables.values()) if (t.seatOfSession(s.id) !== null && t.status !== "over") attach(ws, t);
      return;
    }
    const s = c.session;
    if (!s) return err(ws, "hello", "say hello first");
    switch (msg.type) {
      case "nonce": {
        s.nonce = generateSiweNonce(); s.nonceAt = Date.now(); persistSessions();
        return send(ws, { type: "nonce", nonce: s.nonce, domain, uri, chainId: CHAIN_ID });
      }
      case "signin": {
        if (!s.nonce || Date.now() - s.nonceAt > 10 * 60_000) return err(ws, "nonce", "ask for a nonce first");
        const v = await verifySiwe(msg.message, msg.signature, { domain, nonce: s.nonce });
        if (!v.ok) return err(ws, "signin", v.reason);
        s.address = v.address; s.nonce = null; persistSessions();
        log(`signin ${v.address} session ${s.id.slice(0, 8)}`);
        return send(ws, { type: "signedIn", address: v.address });
      }
      case "pilot": {
        // the OWNER registers a pilot key for one Chog (signed typed data); the pilot wallet then sits with it
        if (!s.address) return err(ws, "signin");
        let owner: Address;
        try { owner = await ownerOf(msg.tokenId, { fresh: true }); } catch { return err(ws, "rpc"); }
        if (owner.toLowerCase() !== s.address.toLowerCase()) return err(ws, "notOwner");
        const key: PilotKey = { tokenId: msg.tokenId, pilot: msg.pilot, expires: msg.expires, nonce: msg.nonce, signature: msg.signature as Hex };
        const prev = pilots.get(String(msg.tokenId));
        if (prev && prev.nonce >= key.nonce) return err(ws, "pilot", "nonce must increase");
        const v = await verifyPilot(key, owner);
        if (!v.ok) return err(ws, "pilot", v.reason);
        pilots.set(String(msg.tokenId), { ...key, owner }); persistPilots();
        return send(ws, { type: "pilotOk", tokenId: msg.tokenId, pilot: msg.pilot, expires: msg.expires });
      }
      case "list":
        return send(ws, tableList(s.id));
      case "create": {
        const t = new Table({ host: s.id, mode: msg.mode, store, ...(msg.name ? { name: msg.name.slice(0, 40) } : {}), ...(msg.timers !== undefined ? { timers: msg.timers } : {}) });
        t.onChange = () => { if (t.status === "over") records = null; broadcastTables(); };
        tables.set(t.id, t);
        attach(ws, t);
        send(ws, { type: "table", table: t.info(s.id) });
        return broadcastTables();
      }
      case "sit": {
        const t = tables.get(msg.table);
        if (!t) return err(ws, "table");
        try {
          if (msg.tokenId !== undefined && !msg.loaner) {
            const a = await authorizeChog(s, msg.tokenId);
            if (!a.ok) return err(ws, a.code, a.detail);
            if (liveElsewhere(msg.tokenId, t.id)) return err(ws, "live", "that Chog is already at a live table");
            t.sit({ session: s.id, kind: "chog", tokenId: msg.tokenId, label: `${short(s.address!)}${a.via === "pilot" ? " (pilot)" : ""}`, ...(msg.seat !== undefined ? { seat: msg.seat } : {}) });
          } else {
            t.sit({ session: s.id, kind: "loaner", label: s.address ? short(s.address) : `guest ${s.id.slice(0, 4)}`, ...(msg.seat !== undefined ? { seat: msg.seat } : {}) });
          }
        } catch (e) { return err(ws, "sit", (e as Error).message); }
        attach(ws, t);
        return send(ws, { type: "table", table: t.info(s.id) });
      }
      case "addBot": {
        const t = tables.get(msg.table);
        if (!t) return err(ws, "table");
        if (t.host !== s.id) return err(ws, "host", "only the host adds bots");
        try { t.addBot(); } catch (e) { return err(ws, "sit", (e as Error).message); }
        return send(ws, { type: "table", table: t.info(s.id) });
      }
      case "leave": {
        const t = tables.get(msg.table);
        if (!t) return err(ws, "table");
        t.leave(s.id);
        return send(ws, { type: "table", table: t.info(s.id) });
      }
      case "start": {
        const t = tables.get(msg.table);
        if (!t) return err(ws, "table");
        try {
          t.start(s.id, settlement ? (tb) => {
            const rows = tb.seats.map((x) => ({ seat: x.seat, kind: x.kind, tokenId: x.tokenId, address: x.session ? sessions.get(x.session)?.address ?? null : null }));
            const link = new EscrowLink(settlement, escrowOpts!.chog, tb.id, rows, tb.tutorial, log);
            link.start(() => tb.state?.seq ?? 0, () => tb.allEvents, () => broadcastTables());
            return link;
          } : null, Object.fromEntries(t.seats.map((x) => [String(x.seat), x.session ? sessions.get(x.session)?.address ?? null : null])));
          records = null; // rebuilt lazily on the next read
        } catch (e) { return err(ws, "start", (e as Error).message); }
        log(`table ${t.id} started: ${t.seats.map((x) => `${x.kind}:${token(x.tokenId).name}`).join(" ")}`);
        return broadcastTables();
      }
      case "watch": {
        const t = tables.get(msg.table);
        if (!t) return err(ws, "table");
        attach(ws, t);
        if (t.state) t.broadcast([]);
        return send(ws, { type: "table", table: t.info(s.id) });
      }
      case "act": {
        const t = tables.get(msg.table);
        if (!t) return err(ws, "table");
        try { t.act(msg.action, s.id); } catch (e) {
          if (e instanceof IllegalAction) return err(ws, "illegal", e.message);
          return err(ws, "act", (e as Error).message);
        }
        return;
      }
      default:
        return err(ws, "unknown");
    }
  }
  function attach(ws: WebSocket, t: Table): void {
    const c = sockets.get(ws)!;
    if (!c.session) return;
    c.watching.add(t.id);
    t.watchers.set(c.session.id, { session: c.session.id, seat: t.seatOfSession(c.session.id), send: (m) => send(ws, m) });
  }

  wss.on("connection", (ws) => {
    sockets.set(ws, { session: null, watching: new Set() });
    ws.on("error", (e) => log(`ws error ${String(e)}`));
    ws.on("message", (data) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(String(data)) as ClientMsg; } catch { return err(ws, "json"); }
      if (!msg || typeof msg.type !== "string") return err(ws, "json");
      handle(ws, msg).catch((e) => { log(`handle ${msg.type}: ${String(e)}`); err(ws, "server", String((e as Error).message ?? e)); });
    });
    ws.on("close", () => {
      const c = sockets.get(ws);
      sockets.delete(ws);
      if (!c?.session) return;
      for (const id of c.watching) tables.get(id)?.watchers.delete(c.session.id);
    });
  });

  // ownership re-check for seated verified Chogs (tech-design § 4): a change hands the seat to autopilot
  const poll = opts.ownerPoll === false ? null : setInterval(async () => {
    for (const t of tables.values()) {
      if (t.status !== "playing") continue;
      for (const seat of t.seats) {
        if (seat.kind !== "chog" || !seat.session) continue;
        const s = sessions.get(seat.session);
        if (!s?.address) continue;
        try {
          const owner = await ownerOf(seat.tokenId, { fresh: true });
          const pk = pilots.get(String(seat.tokenId));
          const stillAllowed = owner.toLowerCase() === s.address.toLowerCase() || (pk?.pilot.toLowerCase() === s.address.toLowerCase() && (await verifyPilot(pk, owner)).ok);
          if (!stillAllowed) { log(`table ${t.id} seat ${seat.seat}: ${token(seat.tokenId).name} changed hands → autopilot`); t.detach(seat.seat, "owner changed"); }
        } catch { /* RPC failure: pause, never guess */ }
      }
    }
  }, OWNER_TTL_MS);
  poll?.unref?.();

  // static client (packages/client/dist) if present
  const staticDir = opts.staticDir ?? join(process.cwd(), "packages/client/dist");
  const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  function serveStatic(req: IncomingMessage, res: ServerResponse): void {
    const url = (req.url ?? "/").split("?")[0]!;
    if (url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, tables: tables.size, sessions: sessions.size, sockets: sockets.size })); return; }
    if (url === "/api/tables") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify((tableList() as { tables: unknown }).tables)); return; }
    const rec = /^\/api\/record\/(\d+)$/.exec(url);
    if (rec) {
      if ([...tables.values()].some((t) => t.status === "over" && t.state && Date.now() - t.createdAt < 5000)) records = null;
      const r = recordsNow().get(Number(rec[1]));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(r ?? { tokenId: Number(rec[1]), games: 0, wins: 0, levelsGained: 0, rugsPulled: 0, rugsSuffered: 0, bountiesCollected: 0, appearances: 0, wonBeside: {}, history: [] }));
      return;
    }
    if (url === "/api/records") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify([...recordsNow().values()].filter((r) => r.games > 0).sort((a, b) => b.wins - a.wins || b.levelsGained - a.levelsGained).slice(0, 100))); return; }
    if (!existsSync(staticDir)) { res.writeHead(200, { "content-type": "text/plain" }); res.end("RUG LIFE server. No client built yet."); return; }
    let p = normalize(join(staticDir, url === "/" ? "index.html" : url));
    if (!p.startsWith(staticDir)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(staticDir, "index.html");
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(readFileSync(p));
  }

  const port = opts.port ?? Number(process.env.PORT ?? 8795);
  http.listen(port, () => log(`RUG LIFE server on :${(http.address() as { port: number }).port} domain ${domain}`));
  return {
    http, wss, tables, sessions,
    port: () => (http.address() as { port: number }).port,
    close: async () => { if (poll) clearInterval(poll); for (const t of tables.values()) t.stop(); for (const ws of sockets.keys()) ws.terminate(); await new Promise<void>((r) => wss.close(() => r())); await new Promise<void>((r) => http.close(() => r())); },
  };
}

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;
function escrowFromEnv(): EscrowOpts | null {
  const escrow = process.env.RUGLIFE_ESCROW as Address | undefined;
  const signerKey = process.env.RUGLIFE_SIGNER_KEY as Hex | undefined;
  const chog = (process.env.RUGLIFE_CHOG ?? "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777") as Address;
  if (!escrow || !signerKey) return null;
  const submitterKey = process.env.RUGLIFE_SUBMITTER_KEY as Hex | undefined;
  return { rpc: process.env.MONAD_RPC ?? "https://rpc.monad.xyz", chainId: Number(process.env.RUGLIFE_CHAIN_ID ?? CHAIN_ID), escrow, chog, signerKey, ...(submitterKey ? { submitterKey } : {}) };
}

if (process.argv[1] && /packages\/server\/src\/index\.ts$/.test(process.argv[1])) startServer();
export type { SeatId };
