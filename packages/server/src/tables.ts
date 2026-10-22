// A table: an open lobby, then an engine game driven by humans, bots and deadlines.
import { randomBytes } from "node:crypto";
import type { Action, GameConfig, SeatId, SeatKind, SeqEvent, TableInfo, View, ServerMsg } from "@ruglife/protocol";
import { apply, botAction, createGame, DEFAULT_CARD_SET, IllegalAction, legalActions, viewFor, type GameState, token } from "@ruglife/engine";
import { tokens } from "@ruglife/cards";
import type { Store } from "./store.js";
import { eventDigestOf, type EscrowLink } from "./escrow-link.js";

export const MAX_SEATS = 6;
export const DEADLINES = { priority: 30_000, prompt: 30_000, airdrop: 60_000, turn: 60_000, lobby: 120_000 } as const; // ⚙ rules § 5–6; priority 20 s → 30 s 2026-10-12 (the first human table timed out twice while reading); airdrop 60 s 2026-10-22 (the user was still choosing what to keep at 30 s — table f1b74cc6)
/** ⚙ Bots act one move per beat on clocked tables so humans can follow; a pass is quicker. Instant on `timers:false` tables and in tests. */
export const BOT_PACE = { move: 1_400, pass: 600 } as const;

export interface LobbySeat { seat: SeatId; kind: SeatKind; tokenId: number; session: string | null; label: string }
export interface Watcher { session: string; seat: SeatId | null; send: (msg: { type: "view"; table: string; view: View; events: SeqEvent[] }) => void }

const LOANER_ROLES = ["face", "muscle", "safecracker", "lookout", "sob", "hacker", "degen"] as const;

/** Picks a loaner/bot token: rotates through roles, never one already at this table. The marked kind is what matters. */
export function pickLoanerToken(taken: Set<number>, roleIndex: number): number {
  for (let i = 0; i < LOANER_ROLES.length; i++) {
    const role = LOANER_ROLES[(roleIndex + i) % LOANER_ROLES.length]!;
    const t = tokens.tokens.find((x) => x.role === role && !taken.has(x.tokenId));
    if (t) return t.tokenId;
  }
  throw new Error("no loaner token free");
}

export class Table {
  readonly id: string;
  readonly name: string;
  readonly mode: GameConfig["mode"];
  readonly host: string;
  readonly timers: boolean;
  readonly createdAt = Date.now();
  seats: LobbySeat[] = [];
  state: GameState | null = null;
  watchers = new Map<string, Watcher>(); // by session
  private timer: NodeJS.Timeout | null = null;
  private deadlineSeat: SeatId | null = null;
  private pumping = false;
  onChange: ((t: Table) => void) | null = null;
  escrow: EscrowLink | null = null; // set by the server at start when an escrow is configured
  tutorial = false;
  allEvents: SeqEvent[] = [];

  constructor(opts: { host: string; mode: GameConfig["mode"]; name?: string; timers?: boolean; store: Store; id?: string }) {
    this.id = opts.id ?? randomBytes(4).toString("hex");
    this.name = opts.name ?? `Table ${this.id}`;
    this.mode = opts.mode;
    this.host = opts.host;
    this.timers = opts.timers ?? true;
    this.store = opts.store;
  }
  private store: Store;

  get status(): TableInfo["status"] { return !this.state ? "open" : this.state.phase === "over" ? "over" : "playing"; }
  info(forSession?: string): TableInfo {
    return {
      id: this.id, name: this.name, mode: this.mode, status: this.status, host: this.host, maxSeats: MAX_SEATS, timers: this.timers, createdAt: this.createdAt,
      seats: this.seats.map((s) => ({ seat: s.seat, kind: s.kind, tokenId: s.tokenId, name: token(s.tokenId).name, label: s.label, ...(forSession && s.session === forSession ? { you: true } : {}) })),
      ...(this.escrow ? { escrow: this.escrow.info() } : {}),
    };
  }
  seatOfSession(session: string): SeatId | null {
    return this.seats.find((s) => s.session === session)?.seat ?? null;
  }
  takenTokens(): Set<number> { return new Set(this.seats.map((s) => s.tokenId)); }

  // ---- lobby ----
  sit(opts: { session: string; kind: SeatKind; tokenId?: number; label: string; seat?: SeatId }): LobbySeat {
    if (this.state) throw new Error("table already started");
    if (this.seats.some((s) => s.session === opts.session)) throw new Error("already seated");
    if (this.seats.length >= MAX_SEATS) throw new Error("table full");
    const free = Array.from({ length: MAX_SEATS }, (_, i) => i).filter((i) => !this.seats.some((s) => s.seat === i));
    const seat = opts.seat !== undefined ? opts.seat : free[0]!;
    if (!free.includes(seat)) throw new Error("seat taken");
    const tokenId = opts.tokenId ?? pickLoanerToken(this.takenTokens(), this.seats.length);
    if (this.takenTokens().has(tokenId)) throw new Error("that Chog is already at this table");
    const row: LobbySeat = { seat, kind: opts.kind, tokenId, session: opts.kind === "bot" ? null : opts.session, label: opts.label };
    this.seats.push(row);
    this.seats.sort((a, b) => a.seat - b.seat);
    this.onChange?.(this);
    return row;
  }
  addBot(): LobbySeat {
    if (this.state) throw new Error("table already started");
    if (this.seats.length >= MAX_SEATS) throw new Error("table full");
    const free = Array.from({ length: MAX_SEATS }, (_, i) => i).filter((i) => !this.seats.some((s) => s.seat === i));
    const tokenId = pickLoanerToken(this.takenTokens(), this.seats.length + 3);
    const row: LobbySeat = { seat: free[0]!, kind: "bot", tokenId, session: null, label: `bot ${token(tokenId).name}` };
    this.seats.push(row);
    this.seats.sort((a, b) => a.seat - b.seat);
    this.onChange?.(this);
    return row;
  }
  leave(session: string): void {
    const row = this.seats.find((s) => s.session === session);
    if (!row) return;
    if (!this.state) { this.seats = this.seats.filter((s) => s !== row); this.onChange?.(this); return; }
    // mid-game: the seat goes to autopilot; the Chog stays (its prize still goes to its chest)
    this.detach(row.seat, "left");
  }
  /** Hands a seat to autopilot and drops its session (owner changed, left, or disconnected past the deadline). */
  detach(seat: SeatId, why: string): void {
    const row = this.seats.find((s) => s.seat === seat);
    if (!row) return;
    row.session = null;
    row.label = `${row.label} (autopilot: ${why})`;
    if (this.state && this.state.phase !== "over" && !this.state.seats.find((x) => x.seat === seat)!.autopilot) this.act({ type: "AUTOPILOT", seat, on: true }, null);
    else this.onChange?.(this);
  }

  start(session: string, escrowFactory: ((t: Table) => EscrowLink) | null = null, controllers: Record<string, string | null> = {}): void {
    if (this.state) throw new Error("already started");
    if (session !== this.host) throw new Error("only the host starts");
    if (this.seats.length < 2) throw new Error("two seats at least");
    const seed = randomBytes(16).toString("hex");
    const config: GameConfig = {
      tableId: this.id, mode: this.mode, seed, cardSetId: DEFAULT_CARD_SET,
      seats: this.seats.map((s) => ({ seat: s.seat, kind: s.kind, tokenId: s.tokenId, label: s.label })),
    };
    this.state = createGame(config);
    this.allEvents = [];
    this.store.tableLog(this.id, { t: "created", at: Date.now(), config: { ...config, seed: undefined }, seedHash: this.state.seedHash, seats: this.seats.map((s) => ({ ...s, session: undefined })), controllers, tutorial: this.tutorial });
    if (escrowFactory) this.escrow = escrowFactory(this);
    this.broadcast([]);
    this.pump();
  }

  // ---- play ----
  /** Applies an action from a session (null = the server itself). Throws IllegalAction for the client to show. */
  act(action: Action, session: string | null): SeqEvent[] {
    if (!this.state) throw new Error("not started");
    if (session !== null) {
      const row = this.seats.find((s) => s.session === session);
      if (!row || row.seat !== action.seat) throw new Error("not your seat");
      if (action.type === "TIMEOUT") throw new Error("server-only action");
      if (action.type === "AUTOPILOT" && action.seat !== row.seat) throw new Error("not your seat");
    }
    const r = apply(this.state, action);
    this.state = r.state;
    this.store.tableLog(this.id, { t: "act", at: Date.now(), action, events: r.events });
    this.afterEvents(r.events);
    this.pump();
    return r.events;
  }

  private afterEvents(events: SeqEvent[]): void {
    this.allEvents.push(...events);
    this.escrow?.onEvents(this.allEvents);
    this.broadcast(events);
    if (this.state!.phase === "over") {
      const digest = (events.find((e) => e.ev.t === "GameOver")?.ev as { digest?: string })?.digest ?? "";
      this.store.tableLog(this.id, { t: "over", at: Date.now(), winner: this.state!.winner, seed: this.state!.seed, digest });
      if (this.escrow) {
        const link = this.escrow;
        void link.settleAll(this.state!.winner!, this.allEvents, eventDigestOf(digest)).then((results) => {
          for (const r of results) this.store.tableLog(this.id, { t: "settled", at: Date.now(), ...r });
          this.onChange?.(this);
        }).catch((e) => this.store.tableLog(this.id, { t: "settleError", at: Date.now(), error: String((e as Error).message) }));
      }
    }
  }
  /** Who must act now (seats). */
  actors(): SeatId[] {
    const s = this.state!;
    if (s.phase === "over") return [];
    if (s.phase === "lobby") {
      const picks = s.seats.filter((x) => legalActions(s, x.seat).some((a) => a.type === "PICK_ROLE" || a.type === "PICK_SKIN")).map((x) => x.seat);
      return picks.length ? picks : [s.seats[0]!.seat];
    }
    if (s.prompt) return [...s.prompt.seats];
    if (s.fight) {
      if (s.phase === "fight.setup") return [s.fight.fighter];
      if (s.phase === "fight.pileOn" && s.fight.priority !== null) return [s.fight.priority];
    }
    return [s.turnSeat];
  }
  private isAuto(seat: SeatId): boolean {
    const x = this.state!.seats.find((y) => y.seat === seat)!;
    return x.kind === "bot" || x.autopilot;
  }
  /** Runs bots/autopilot seats until a human must act, then arms that human's deadline. On clocked tables each bot move lands one beat
   *  apart (BOT_PACE) and the table is published after every move, so the humans see the game happen; otherwise it runs instantly. */
  pump(): void {
    if (this.pumpTimer) return; // a beat is already scheduled; it continues from the new state
    this.step();
  }
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private step(): void {
    if (this.pumping || !this.state) return;
    this.pumping = true;
    try {
      for (let i = 0; i < 2000 && this.state.phase !== "over"; i++) {
        const who = this.actors();
        const auto = who.find((seat) => this.isAuto(seat));
        if (auto === undefined) break;
        const a = botAction(this.state, auto);
        const r = apply(this.state, a);
        this.state = r.state;
        this.store.tableLog(this.id, { t: "act", at: Date.now(), action: a, events: r.events, auto: true });
        this.afterEvents(r.events);
        if (this.timers && this.state.phase !== "over") {
          const pace = a.type === "PASS" || a.type === "TIMEOUT" ? BOT_PACE.pass : BOT_PACE.move;
          this.pumpTimer = setTimeout(() => { this.pumpTimer = null; this.step(); }, pace);
          this.pumpTimer.unref?.();
          break;
        }
      }
    } finally {
      this.pumping = false;
    }
    this.armDeadline();
    this.onChange?.(this);
  }
  private armDeadline(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.deadlineSeat = null;
    const s = this.state;
    if (!s || s.phase === "over" || !this.timers) return;
    const who = this.actors().filter((seat) => !this.isAuto(seat));
    const seat = who[0];
    if (seat === undefined) return;
    const ms = s.phase === "lobby" ? DEADLINES.lobby : s.prompt ? (s.prompt.kind === "airdrop" ? DEADLINES.airdrop : DEADLINES.prompt) : s.phase === "fight.pileOn" ? DEADLINES.priority : DEADLINES.turn;
    this.deadlineSeat = seat;
    this.timer = setTimeout(() => this.onDeadline(seat), ms);
    this.timer.unref?.();
  }
  private onDeadline(seat: SeatId): void {
    this.timer = null;
    if (!this.state || this.state.phase === "over") return;
    if (!this.actors().includes(seat)) { this.armDeadline(); return; }
    const row = this.seats.find((x) => x.seat === seat);
    const connected = row?.session ? this.watchers.has(row.session) : false;
    try {
      if (!connected) this.act({ type: "AUTOPILOT", seat, on: true }, null);
      else this.act({ type: "TIMEOUT", seat }, null);
    } catch (e) {
      if (!(e instanceof IllegalAction)) throw e;
      this.act({ type: "AUTOPILOT", seat, on: true }, null);
    }
  }
  /** A human's deadline, for the client's clock. */
  deadline(): { seat: SeatId; at: number } | null {
    return this.deadlineSeat === null ? null : { seat: this.deadlineSeat, at: Date.now() };
  }

  /** The current view for one session (a reconnecting socket, a fresh watcher). */
  viewMsg(session: string): ServerMsg {
    return { type: "view", table: this.id, view: viewFor(this.state!, this.seatOfSession(session) ?? "stands"), events: [] };
  }
  broadcast(events: SeqEvent[]): void {
    if (!this.state) return;
    for (const w of this.watchers.values()) {
      const seat = this.seatOfSession(w.session);
      try { w.send({ type: "view", table: this.id, view: viewFor(this.state, seat ?? "stands"), events }); } catch { /* a dead socket is dropped by the server */ }
    }
  }
  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; if (this.pumpTimer) clearTimeout(this.pumpTimer); this.pumpTimer = null; this.escrow?.stop(); }
}
