// One WebSocket to the RUG LIFE server. The client never computes rules: it renders View and offers view.legal.
import { useSyncExternalStore } from "react";
import type { Action, ClientMsg, SeqEvent, ServerMsg, TableInfo, View } from "@ruglife/protocol";
import { newsLines, type NewsLine } from "./news.js";

export interface NetError { id: number; code: string; detail?: string; at: number }
export interface NetState {
  status: "connecting" | "open" | "closed";
  session: string | null;
  address: `0x${string}` | null;
  tables: TableInfo[];
  views: Record<string, View>;
  news: Record<string, NewsLine[]>;
  viewAt: Record<string, number>; // when the latest view of a table arrived (for the client's clock)
  errors: NetError[];
  /** An action sent and not yet answered by a view: the buttons show it. Cleared by the next view or the resync. */
  pending: { table: string; type: string; at: number } | null;
}

const SESSION_KEY = "ruglife.session";
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};
const DEV_SERVER = "localhost:8795";
const here = typeof location !== "undefined" ? location : { port: "", origin: "http://localhost:8795" };
export const SERVER_HTTP: string = env.VITE_SERVER ?? (here.port === "5173" ? `http://${DEV_SERVER}` : here.origin);
const SERVER_WS = SERVER_HTTP.replace(/^http/, "ws");

let state: NetState = { status: "connecting", session: null, address: null, tables: [], views: {}, news: {}, viewAt: {}, errors: [], pending: null };
/** ⚙ An act with no view back inside this window re-reads the table (a lost click, a stale view after a reconnect). */
const ACT_RESYNC_MS = 3_000;
let pendingTimer: number | null = null;
const listeners = new Set<() => void>();
function set(patch: Partial<NetState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
let ws: WebSocket | null = null;
let retry = 0;
let errId = 0;
let clientSeq = 0;
type Waiter = { match: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void; reject: (e: Error) => void; timer: number };
const waiters = new Set<Waiter>();

export function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  set({ status: "connecting" });
  ws = new WebSocket(SERVER_WS);
  ws.onopen = () => {
    retry = 0;
    set({ status: "open" });
    let session: string | null = null;
    try { session = localStorage.getItem(SESSION_KEY); } catch { /* private mode */ }
    send({ type: "hello", session });
  };
  ws.onmessage = (e) => {
    let msg: ServerMsg;
    try { msg = JSON.parse(String(e.data)) as ServerMsg; } catch { return; }
    onMessage(msg);
  };
  ws.onclose = () => {
    set({ status: "closed" });
    ws = null;
    const delay = Math.min(15_000, 500 * 2 ** retry++);
    setTimeout(connect, delay);
  };
  ws.onerror = () => { /* onclose follows */ };
}

export function send(msg: ClientMsg): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) { pushError("offline", "not connected to the server"); return; }
  ws.send(JSON.stringify(msg));
}
/** Sends and waits for the first matching reply (or an error from the server). */
export function request<T extends ServerMsg["type"]>(msg: ClientMsg, type: T, timeoutMs = 20_000): Promise<Extract<ServerMsg, { type: T }>> {
  return new Promise((resolve, reject) => {
    const w: Waiter = {
      match: (m) => m.type === type || m.type === "error",
      resolve: (m) => (m.type === "error" ? reject(new Error(`${m.code}${m.detail ? `: ${m.detail}` : ""}`)) : resolve(m as Extract<ServerMsg, { type: T }>)),
      reject,
      timer: window.setTimeout(() => { waiters.delete(w); reject(new Error("timeout")); }, timeoutMs),
    };
    waiters.add(w);
    send(msg);
  });
}
export function act(table: string, action: Action): void {
  if (state.pending && state.pending.table === table && Date.now() - state.pending.at < ACT_RESYNC_MS) return; // one click at a time: the first is in flight
  set({ pending: { table, type: action.type, at: Date.now() } });
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => { pendingTimer = null; if (state.pending?.table === table) { set({ pending: null }); resync(table); } }, ACT_RESYNC_MS);
  send({ type: "act", table, action, clientSeq: ++clientSeq });
}
/** Asks the server for the table again: the current view comes back for this socket. */
export function resync(table: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) send({ type: "watch", table });
}
function pushError(code: string, detail?: string): void {
  const e: NetError = { id: ++errId, code, at: Date.now(), ...(detail ? { detail } : {}) };
  set({ errors: [...state.errors.slice(-4), e] });
  setTimeout(() => set({ errors: state.errors.filter((x) => x.id !== e.id) }), 6000);
}
export function dismissError(id: number): void { set({ errors: state.errors.filter((x) => x.id !== id) }); }

function onMessage(msg: ServerMsg): void {
  for (const w of [...waiters]) if (w.match(msg)) { waiters.delete(w); clearTimeout(w.timer); w.resolve(msg); if (msg.type === "error") return; }
  switch (msg.type) {
    case "welcome":
      try { localStorage.setItem(SESSION_KEY, msg.session); } catch { /* ignore */ }
      set({ session: msg.session, address: msg.address, pending: null });
      // a reconnect: every table on screen is re-read so no click lands on a view from before the drop
      for (const id of Object.keys(state.views)) resync(id);
      break;
    case "signedIn": set({ address: msg.address }); break;
    case "tables": set({ tables: msg.tables }); break;
    case "table": {
      const tables = state.tables.some((t) => t.id === msg.table.id) ? state.tables.map((t) => (t.id === msg.table.id ? msg.table : t)) : [...state.tables, msg.table];
      set({ tables });
      break;
    }
    case "view": {
      const prev = state.news[msg.table] ?? [];
      const lines = msg.events.length ? [...prev, ...newsLines(msg.view, msg.events as SeqEvent[])].slice(-120) : prev;
      const pending = state.pending?.table === msg.table ? null : state.pending;
      if (pending === null && pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      set({ views: { ...state.views, [msg.table]: msg.view }, news: { ...state.news, [msg.table]: lines }, viewAt: { ...state.viewAt, [msg.table]: Date.now() }, pending });
      break;
    }
    case "error":
      if ((msg.code === "illegal" || msg.code === "act") && state.pending) { const t = state.pending.table; set({ pending: null }); if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; } resync(t); pushError("refused", `${msg.detail ?? msg.code} — the table was re-read; look again`); break; }
      pushError(msg.code, msg.detail); break;
    default: break;
  }
}

export function useNet(): NetState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
}
export function getState(): NetState { return state; }
