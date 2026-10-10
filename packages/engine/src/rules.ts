// The rules of RUG LIFE, v0.2 → code. Pure: apply(state, action) clones, mutates the clone, returns it with events.
import type { Action, CardDef, Deck, Effect, GameEvent, Role, SeatId, SeqEvent, Side, Skin, Slot } from "@ruglife/protocol";
import { ROLES, SKINS } from "@ruglife/protocol";
import { def, nextSeat, seatOf, type FightState, type GameState, type SeatState } from "./state.js";
import { Rng } from "./rng.js";
import { sha256Hex, stableStringify } from "./sha256.js";

export class IllegalAction extends Error {
  constructor(public readonly action: Action, reason: string) {
    super(`illegal ${action.type} by seat ${action.seat}: ${reason}`);
  }
}

export const HAND_LIMIT = 6; // ⚙
export const LOCK_PENALTY = 5; // ⚙ per unmet lock
export const KIT_POWER = 3; // ⚙
export const JEET_TARGET = 5; // ⚙ 5+ on a d6
export const SELL_PRICE = 1000; // ⚙ notes per level
export const OPENING_DEAL = 4; // ⚙ per deck

interface Ctx { s: GameState; events: GameEvent[]; rng: Rng }

const SLOT_CAP: Record<Slot, number> = { head: 1, body: 1, hands: 2, feet: 1, ride: 1, none: 99 };

// ---------- queries ----------
export function gearAllowed(seat: SeatState, d: CardDef): boolean {
  for (const e of d.effects) {
    if (e.kind === "onlyRole" && seat.playRole !== e.role) return false;
    if (e.kind === "notRole" && seat.playRole === e.role) return false;
  }
  return true;
}
export function gearBonus(s: GameState, seat: SeatState): number {
  let b = 0;
  for (const inst of seat.gear) {
    const d = def(s, inst);
    if (gearAllowed(seat, d)) b += d.bonus ?? 0;
  }
  return b;
}
export function seatPower(s: GameState, seat: SeatState): number {
  return seat.level + (seat.kitOff ? 0 : KIT_POWER) + gearBonus(s, seat);
}
export function participants(f: FightState): SeatId[] {
  return [f.fighter, ...f.helpers.map((h) => h.seat)];
}
export function sideHasRole(s: GameState, f: FightState, role: Role): boolean {
  return participants(f).some((id) => seatOf(s, id).playRole === role) || f.countAs.includes(role);
}
export function fightPower(s: GameState, f: FightState): { fighter: number; threat: number; lockPenalty: number; lockOpen: boolean } {
  const d = def(s, f.threat);
  let fighter = f.degenMod;
  for (const id of participants(f)) fighter += seatPower(s, seatOf(s, id));
  let threat = d.level ?? 0;
  for (const p of f.plays) if (!p.cancelled) (p.side === "fighter" ? (fighter += p.mod) : (threat += p.mod));
  const locks = d.lock ?? [];
  const unmet = f.ignoreLock ? 0 : locks.filter((r) => !sideHasRole(s, f, r)).length;
  const lockPenalty = unmet * LOCK_PENALTY;
  return { fighter, threat: threat + lockPenalty, lockPenalty, lockOpen: unmet === 0 };
}
export function maxHelpers(s: GameState, f: FightState): number {
  const d = def(s, f.threat);
  return seatOf(s, f.fighter).playRole === "face" || (d.levelsWon ?? 1) >= 2 ? 2 : 1;
}
export function bagsOf(s: GameState, f: FightState): number {
  return Math.max(0, (def(s, f.threat).bags ?? 0) + f.bagsMod);
}
export function canEquip(s: GameState, seat: SeatState, inst: string): string | null {
  const d = def(s, inst);
  if (d.type !== "gear" || !d.slot) return "not gear";
  if (!gearAllowed(seat, d)) return "role";
  const used = seat.gear.filter((g) => def(s, g).slot === d.slot).length;
  if (used >= SLOT_CAP[d.slot]) return "slot full";
  if (d.big && seat.playRole !== "muscle" && seat.gear.some((g) => def(s, g).big)) return "one Big unless Muscle";
  return null;
}
const isOwnTurnFree = (s: GameState, seat: SeatId): boolean => (s.phase === "turn.start" || s.phase === "turn.free") && s.turnSeat === seat && s.prompt === null;
const isPriority = (s: GameState, seat: SeatId): boolean => s.phase === "fight.pileOn" && s.fight?.priority === seat;
const isParticipant = (f: FightState | null, seat: SeatId): boolean => !!f && participants(f).includes(seat);
export function digest(s: GameState): string {
  return sha256Hex(stableStringify({ seats: s.seats, decks: s.decks, cards: s.cards, turnNo: s.turnNo, fightCount: s.fightCount, rng: s.rng, winner: s.winner }));
}

// ---------- legal actions (what a client may offer) ----------
export function legalActions(s: GameState, seat: SeatId): Action[] {
  const out: Action[] = [];
  if (s.phase === "over") return out;
  const me = seatOf(s, seat);
  if (s.phase === "lobby") {
    if (me.role === "legend" && me.playRole === null) for (const role of ROLES) out.push({ type: "PICK_ROLE", seat, role });
    if (me.skin === null) for (const skin of SKINS) out.push({ type: "PICK_SKIN", seat, skin });
    if (seat === s.seats[0]!.seat && s.prompt === null) out.push({ type: "START_GAME", seat });
    return out;
  }
  if (s.prompt) {
    if (!s.prompt.seats.includes(seat)) return out;
    switch (s.prompt.kind) {
      case "answerHelp": return [{ type: "ANSWER_HELP", seat, accept: true }, { type: "ANSWER_HELP", seat, accept: false }];
      case "rug": return [{ type: "RUG", seat, pull: false }, { type: "RUG", seat, pull: true }];
      case "tradeAnswer": return [{ type: "TRADE_ANSWER", seat, accept: false }, { type: "TRADE_ANSWER", seat, accept: true }];
      case "airdrop": return [{ type: "AIRDROP_KEEP", seat, cards: me.hand.slice(0, HAND_LIMIT) }];
      default: return out;
    }
  }
  const f = s.fight;
  if (isOwnTurnFree(s, seat)) {
    if (s.phase === "turn.start") out.push({ type: "START_TROUBLE", seat });
    if (s.phase === "turn.free") {
      if (!s.stepDone) {
        out.push({ type: "GRAB_BAG", seat });
        for (const c of me.hand) if (def(s, c).type === "threat") out.push({ type: "LOOK_FOR_TROUBLE", seat, card: c });
      } else out.push({ type: "END_TURN", seat });
    }
    for (const c of me.hand) {
      const d = def(s, c);
      if (d.type === "gear" && canEquip(s, me, c) === null) out.push({ type: "EQUIP", seat, card: c });
      if (d.type === "levelup" && me.level <= 8) out.push({ type: "PLAY", seat, card: c });
      if (d.type === "fud") for (const t of s.seats) out.push({ type: "PLAY", seat, card: c, target: t.seat });
      if (d.type === "oneshot" && d.effects.every((e) => e.kind === "draw" || e.kind === "peek")) out.push({ type: "PLAY", seat, card: c });
    }
    for (const c of me.gear) out.push({ type: "UNEQUIP", seat, card: c });
    const sellable = [...me.hand, ...me.gear].filter((c) => def(s, c).type === "gear");
    const total = sellable.reduce((a, c) => a + (def(s, c).value ?? 0), 0);
    if (total >= SELL_PRICE && me.level <= 8) out.push({ type: "SELL", seat, cards: sellable });
    for (const o of s.seats) if (o.seat !== seat) for (const give of [...me.hand, ...me.gear]) if (def(s, give).type === "gear") for (const take of [...o.hand, ...o.gear]) if (def(s, take).type === "gear") out.push({ type: "TRADE_OFFER", seat, to: o.seat, give, take });
    return out;
  }
  if (!f) return out;
  const inFight = isParticipant(f, seat);
  const playsInFight = (): void => {
    for (const c of me.hand) {
      const d = def(s, c);
      if (d.type === "boost") out.push({ type: "PLAY", seat, card: c });
      else if (d.type === "fud") for (const t of s.seats) out.push({ type: "PLAY", seat, card: c, target: t.seat });
      else if (d.type === "key" && inFight) out.push({ type: "PLAY", seat, card: c });
      else if (d.type === "oneshot") {
        const k = d.effects[0]?.kind;
        if (k === "power") { out.push({ type: "PLAY", seat, card: c, side: "fighter" }); out.push({ type: "PLAY", seat, card: c, side: "threat" }); }
        else if (k === "cancelLast" && f.plays.some((p) => !p.cancelled && p.inst !== null)) out.push({ type: "PLAY", seat, card: c });
        else if ((k === "jeet" || k === "noJeet") && inFight) out.push({ type: "PLAY", seat, card: c });
      }
    }
    if (inFight && me.playRole === "safecracker" && !me.perkUsed) for (const c of me.hand) out.push({ type: "USE_PERK", seat, discard: c });
  };
  if (s.phase === "fight.setup") {
    if (seat === f.fighter) {
      if (f.helpers.length < maxHelpers(s, f)) for (const o of s.seats) {
        if (o.seat === seat || f.helpers.some((h) => h.seat === o.seat) || o.rekt || f.asked.includes(o.seat)) continue;
        const remaining = bagsOf(s, f) - f.helpers.reduce((a, h) => a + h.cut, 0);
        for (let cut = 0; cut <= Math.max(0, remaining); cut++) out.push({ type: "ASK_HELP", seat, to: o.seat, cut });
      }
      for (const c of me.hand) {
        const d = def(s, c);
        if (d.type === "key") out.push({ type: "PLAY", seat, card: c });
        if (d.type === "oneshot" && (d.effects[0]?.kind === "jeet" || d.effects[0]?.kind === "noJeet")) out.push({ type: "PLAY", seat, card: c });
      }
      if (me.playRole === "safecracker" && !me.perkUsed) for (const c of me.hand) out.push({ type: "USE_PERK", seat, discard: c });
      out.push({ type: "PASS", seat });
    } else if (f.helpers.some((h) => h.seat === seat)) out.push({ type: "LEAVE_FIGHT", seat });
    return out;
  }
  if (isPriority(s, seat)) {
    playsInFight();
    if (f.helpers.some((h) => h.seat === seat)) out.push({ type: "LEAVE_FIGHT", seat });
    out.push({ type: "PASS", seat });
  }
  return out;
}

// ---------- apply ----------
export function apply(state: GameState, action: Action): { state: GameState; events: SeqEvent[] } {
  const s = structuredClone(state);
  const ctx: Ctx = { s, events: [], rng: new Rng(s.rng) };
  if (s.phase === "over") throw new IllegalAction(action, "game over");
  if (!s.seats.some((x) => x.seat === action.seat)) throw new IllegalAction(action, "no such seat");
  step(ctx, action);
  s.rng = ctx.rng.state;
  // the GameOver digest is the digest of the FINAL state, after every cleanup of the ending fight
  for (const ev of ctx.events) if (ev.t === "GameOver") ev.digest = digest(s);
  const events = ctx.events.map((ev) => ({ seq: ++s.seq, ev }));
  return { state: s, events };
}

function fail(a: Action, why: string): never {
  throw new IllegalAction(a, why);
}
function need(cond: unknown, a: Action, why: string): asserts cond {
  if (!cond) fail(a, why);
}

function step(ctx: Ctx, a: Action): void {
  const { s } = ctx;
  const me = seatOf(s, a.seat);
  switch (a.type) {
    case "AUTOPILOT":
      me.autopilot = a.on;
      ctx.events.push({ t: "Autopilot", seat: a.seat, on: a.on });
      return;
    case "TIMEOUT":
      return timeout(ctx, a);
    case "SIT":
      return fail(a, "seats are fixed when the table is created");
  }
  if (s.phase === "lobby") return lobby(ctx, a, me);
  if (s.prompt) {
    need(s.prompt.seats.includes(a.seat), a, "a prompt is pending for someone else");
    return answerPrompt(ctx, a, me);
  }
  switch (a.type) {
    case "START_TROUBLE": {
      need(s.phase === "turn.start" && s.turnSeat === a.seat, a, "not your turn start");
      const inst = drawOne(ctx, "trouble");
      if (!inst) { s.phase = "turn.free"; return; }
      const d = def(s, inst);
      ctx.events.push({ t: "CardFlipped", seat: a.seat, card: inst, def: d.id });
      if (d.type === "threat") { s.stepDone = true; return startFight(ctx, a.seat, inst, false); }
      if (d.type === "fud") { applyFud(ctx, a.seat, a.seat, inst); s.phase = "turn.free"; return; }
      me.hand.push(inst);
      s.phase = "turn.free";
      return;
    }
    case "LOOK_FOR_TROUBLE": {
      need(s.phase === "turn.free" && s.turnSeat === a.seat && !s.stepDone, a, "not now");
      need(me.hand.includes(a.card) && def(s, a.card).type === "threat", a, "not a threat in your hand");
      me.hand.splice(me.hand.indexOf(a.card), 1);
      s.stepDone = true;
      return startFight(ctx, a.seat, a.card, true);
    }
    case "GRAB_BAG": {
      need(s.phase === "turn.free" && s.turnSeat === a.seat && !s.stepDone, a, "not now");
      draw(ctx, a.seat, "trouble", 1);
      s.stepDone = true;
      return;
    }
    case "END_TURN": {
      need(s.phase === "turn.free" && s.turnSeat === a.seat && s.stepDone, a, "fight, look for trouble or grab a bag first");
      if (me.hand.length > HAND_LIMIT) { s.phase = "turn.airdrop"; s.prompt = { kind: "airdrop", seats: [a.seat] }; return; }
      ctx.events.push({ t: "TurnEnded", seat: a.seat });
      return nextTurn(ctx);
    }
    case "EQUIP": {
      need(isOwnTurnFree(s, a.seat) && me.hand.includes(a.card), a, "not now / not in hand");
      const why = canEquip(s, me, a.card);
      need(why === null, a, why ?? "");
      me.hand.splice(me.hand.indexOf(a.card), 1);
      me.gear.push(a.card);
      ctx.events.push({ t: "GearChanged", seat: a.seat });
      return;
    }
    case "UNEQUIP": {
      need(isOwnTurnFree(s, a.seat) && me.gear.includes(a.card), a, "not now / not equipped");
      me.gear.splice(me.gear.indexOf(a.card), 1);
      me.hand.push(a.card);
      ctx.events.push({ t: "GearChanged", seat: a.seat });
      return;
    }
    case "SELL": {
      need(isOwnTurnFree(s, a.seat) && me.level <= 8, a, "not now / level 9");
      need(a.cards.length > 0 && new Set(a.cards).size === a.cards.length, a, "cards");
      let total = 0;
      for (const c of a.cards) {
        need((me.hand.includes(c) || me.gear.includes(c)) && def(s, c).type === "gear", a, `${c} is not your gear`);
        total += def(s, c).value ?? 0;
      }
      need(total >= SELL_PRICE, a, "not worth 1,000");
      for (const c of a.cards) { removeFromSeat(me, c); discardInst(ctx, c); }
      ctx.events.push({ t: "Sold", seat: a.seat, cards: a.cards, value: total });
      setLevel(ctx, me, me.level + 1, "sold");
      ctx.events.push({ t: "GearChanged", seat: a.seat });
      return;
    }
    case "TRADE_OFFER": {
      need(isOwnTurnFree(s, a.seat) && a.to !== a.seat, a, "not now");
      const to = seatOf(s, a.to);
      need((me.hand.includes(a.give) || me.gear.includes(a.give)) && def(s, a.give).type === "gear", a, "give");
      need((to.hand.includes(a.take) || to.gear.includes(a.take)) && def(s, a.take).type === "gear", a, "take");
      s.pendingTrade = { from: a.seat, to: a.to, give: a.give, take: a.take };
      s.prompt = { kind: "tradeAnswer", seats: [a.to] };
      return;
    }
    case "PLAY":
      return play(ctx, a, me);
    case "USE_PERK":
      return usePerk(ctx, a, me);
    case "ASK_HELP": {
      const f = s.fight;
      need(s.phase === "fight.setup" && f && f.fighter === a.seat && !f.pendingAsk, a, "not now");
      need(f.helpers.length < maxHelpers(s, f), a, "no more helpers");
      const to = seatOf(s, a.to);
      need(a.to !== a.seat && !f.helpers.some((h) => h.seat === a.to) && !to.rekt && !f.asked.includes(a.to), a, "cannot ask that seat");
      const remaining = bagsOf(s, f) - f.helpers.reduce((x, h) => x + h.cut, 0);
      need(Number.isInteger(a.cut) && a.cut >= 0 && a.cut <= Math.max(0, remaining), a, "cut out of range");
      f.pendingAsk = { to: a.to, cut: a.cut };
      f.asked.push(a.to);
      s.prompt = { kind: "answerHelp", seats: [a.to] };
      ctx.events.push({ t: "HelpAsked", fighter: a.seat, to: a.to, cut: a.cut });
      return;
    }
    case "LEAVE_FIGHT": {
      const f = s.fight;
      need(f && (s.phase === "fight.setup" || isPriority(s, a.seat)) && f.helpers.some((h) => h.seat === a.seat), a, "not a helper / not now");
      f.helpers = f.helpers.filter((h) => h.seat !== a.seat);
      ctx.events.push({ t: "HelperLeft", helper: a.seat });
      emitPower(ctx);
      if (s.phase === "fight.pileOn") advancePriority(ctx, true);
      return;
    }
    case "PASS": {
      const f = s.fight;
      need(f, a, "no fight");
      if (s.phase === "fight.setup") { need(f.fighter === a.seat, a, "only the fighter closes the setup"); return startPileOn(ctx); }
      need(isPriority(s, a.seat), a, "not your priority");
      return advancePriority(ctx, false);
    }
    default:
      return fail(a, `not legal in ${s.phase}`);
  }
}

function lobby(ctx: Ctx, a: Action, me: SeatState): void {
  const { s } = ctx;
  switch (a.type) {
    case "PICK_ROLE":
      need(me.role === "legend" && me.playRole === null && ROLES.includes(a.role), a, "not a Legend without a role");
      me.playRole = a.role;
      break;
    case "PICK_SKIN":
      need(me.skin === null && SKINS.includes(a.skin), a, "skin already set");
      me.skin = a.skin;
      break;
    case "START_GAME": {
      need(a.seat === s.seats[0]!.seat, a, "only the host starts");
      need(s.seats.every((x) => x.playRole !== null && x.skin !== null), a, "picks pending");
      s.prompt = null;
      const casting: Record<string, number> = {};
      for (const c of Object.values(s.cards)) casting[c.inst] = c.cast;
      ctx.events.push({ t: "GameStarted", seedHash: s.seedHash, casting, mode: s.config.mode });
      for (const x of s.seats) { draw(ctx, x.seat, "trouble", OPENING_DEAL); draw(ctx, x.seat, "loot", OPENING_DEAL); }
      s.turnSeat = s.seats[s.seats.length - 1]!.seat;
      return nextTurn(ctx);
    }
    default:
      return fail(a, "lobby");
  }
  const roles = s.seats.filter((x) => x.playRole === null).map((x) => x.seat);
  const skins = s.seats.filter((x) => x.skin === null).map((x) => x.seat);
  s.prompt = roles.length ? { kind: "pickRole", seats: roles } : skins.length ? { kind: "pickSkin", seats: skins } : null;
}

function answerPrompt(ctx: Ctx, a: Action, me: SeatState): void {
  const { s } = ctx;
  const p = s.prompt!;
  switch (p.kind) {
    case "answerHelp": {
      need(a.type === "ANSWER_HELP", a, "answer the help request");
      const f = s.fight!;
      const ask = f.pendingAsk!;
      f.pendingAsk = null;
      s.prompt = null;
      if (a.accept) { f.helpers.push({ seat: a.seat, cut: ask.cut }); ctx.events.push({ t: "HelpAgreed", helper: a.seat, cut: ask.cut }); emitPower(ctx); }
      else ctx.events.push({ t: "HelpDeclined", helper: a.seat });
      return;
    }
    case "rug": {
      need(a.type === "RUG", a, "choose keep or pull");
      const f = s.fight!;
      need(!(a.seat in f.rugChoices), a, "already chosen");
      f.rugChoices[a.seat] = a.pull;
      p.seats = p.seats.filter((x) => x !== a.seat);
      if (p.seats.length === 0) revealRugs(ctx);
      return;
    }
    case "airdrop": {
      need(a.type === "AIRDROP_KEEP", a, "choose what to keep");
      need(a.cards.length === HAND_LIMIT && new Set(a.cards).size === HAND_LIMIT && a.cards.every((c) => me.hand.includes(c)), a, `keep exactly ${HAND_LIMIT} cards from your hand`);
      const excess = me.hand.filter((c) => !a.cards.includes(c));
      me.hand = [...a.cards];
      const others = s.seats.filter((x) => x.seat !== me.seat);
      const min = Math.min(...others.map((x) => x.level));
      let to: SeatState | null = null;
      if (me.level > min) {
        const lows = others.filter((x) => x.level === min);
        to = lows.find((x) => x.playRole === "sob") ?? null;
        if (!to) { let id = nextSeat(s, me.seat); while (!lows.some((x) => x.seat === id)) id = nextSeat(s, id); to = seatOf(s, id); }
      }
      for (const c of excess) { if (to) to.hand.push(c); else discardInst(ctx, c); }
      ctx.events.push({ t: "Airdropped", from: me.seat, to: to ? to.seat : null, cards: excess.length });
      s.prompt = null;
      ctx.events.push({ t: "TurnEnded", seat: me.seat });
      return nextTurn(ctx);
    }
    case "tradeAnswer": {
      need(a.type === "TRADE_ANSWER", a, "answer the trade");
      const t = s.pendingTrade!;
      s.pendingTrade = null;
      s.prompt = null;
      if (!a.accept) return;
      const from = seatOf(s, t.from);
      if (!(from.hand.includes(t.give) || from.gear.includes(t.give)) || !(me.hand.includes(t.take) || me.gear.includes(t.take))) return;
      removeFromSeat(from, t.give); removeFromSeat(me, t.take);
      me.hand.push(t.give); from.hand.push(t.take);
      ctx.events.push({ t: "Traded", a: t.from, b: t.to });
      ctx.events.push({ t: "GearChanged", seat: t.from }); ctx.events.push({ t: "GearChanged", seat: t.to });
      return;
    }
    default:
      return fail(a, "lobby prompt outside lobby");
  }
}

function timeout(ctx: Ctx, a: Extract<Action, { type: "TIMEOUT" }>): void {
  const { s } = ctx;
  const seat = a.seat;
  const me = seatOf(s, seat);
  const run = (d: Action): void => { ctx.events.push({ t: "Timeout", seat, defaulted: d.type }); step(ctx, d); };
  if (s.phase === "lobby") {
    if (me.role === "legend" && me.playRole === null) return run({ type: "PICK_ROLE", seat, role: "face" });
    if (me.skin === null) return run({ type: "PICK_SKIN", seat, skin: "pink" });
    return fail(a, "nothing pending");
  }
  if (s.prompt?.seats.includes(seat)) {
    switch (s.prompt.kind) {
      case "answerHelp": return run({ type: "ANSWER_HELP", seat, accept: false });
      case "rug": return run({ type: "RUG", seat, pull: false });
      case "airdrop": return run({ type: "AIRDROP_KEEP", seat, cards: me.hand.slice(0, HAND_LIMIT) });
      case "tradeAnswer": return run({ type: "TRADE_ANSWER", seat, accept: false });
      default: return fail(a, "prompt");
    }
  }
  if (s.prompt) return fail(a, "someone else is up");
  if (s.phase === "fight.setup" && s.fight?.fighter === seat) return run({ type: "PASS", seat });
  if (isPriority(s, seat)) return run({ type: "PASS", seat });
  if (s.phase === "turn.start" && s.turnSeat === seat) return run({ type: "START_TROUBLE", seat });
  if (s.phase === "turn.free" && s.turnSeat === seat) return run(s.stepDone ? { type: "END_TURN", seat } : { type: "GRAB_BAG", seat });
  return fail(a, "nothing to default");
}

// ---------- cards ----------
function play(ctx: Ctx, a: Extract<Action, { type: "PLAY" }>, me: SeatState): void {
  const { s } = ctx;
  need(me.hand.includes(a.card), a, "not in your hand");
  const d = def(s, a.card);
  const f = s.fight;
  const ownTurn = isOwnTurnFree(s, a.seat);
  const prio = isPriority(s, a.seat);
  const setupFighter = s.phase === "fight.setup" && f?.fighter === a.seat;
  const inFight = isParticipant(f, a.seat);
  const take = (): void => { me.hand.splice(me.hand.indexOf(a.card), 1); };
  const played = (extra: Partial<{ target: SeatId; side: Side }> = {}): void => {
    ctx.events.push({ t: "CardPlayed", by: a.seat, card: a.card, def: d.id, ...extra });
  };
  switch (d.type) {
    case "levelup": {
      need(ownTurn && me.level <= 8, a, "level-ups on your own turn, never the 10th");
      take(); played(); discardInst(ctx, a.card);
      setLevel(ctx, me, me.level + 1, d.id);
      return;
    }
    case "fud": {
      need(ownTurn || prio, a, "FUD on your turn or on your priority in a fight");
      need(a.target !== undefined && s.seats.some((x) => x.seat === a.target), a, "target");
      take(); played({ target: a.target });
      applyFud(ctx, a.seat, a.target, a.card);
      if (prio) advancePriority(ctx, true);
      return;
    }
    case "boost": {
      need(prio && f, a, "boosts go on the Threat during the pile-on");
      take(); played();
      let mod = 0;
      for (const e of d.effects) { if (e.kind === "power") mod += e.n; if (e.kind === "bags") f.bagsMod += e.n; }
      f.plays.push({ by: a.seat, inst: a.card, def: d.id, side: "threat", mod, cancelled: false });
      discardInst(ctx, a.card);
      emitPower(ctx);
      return advancePriority(ctx, true);
    }
    case "key": {
      need(f && inFight && (setupFighter || prio), a, "keys are for your side, during a fight");
      take(); played();
      for (const e of d.effects) { if (e.kind === "countAs") f.countAs.push(e.role); if (e.kind === "ignoreLock") f.ignoreLock = true; }
      discardInst(ctx, a.card);
      emitPower(ctx);
      if (prio) advancePriority(ctx, true);
      return;
    }
    case "oneshot": {
      const kinds = d.effects.map((e) => e.kind);
      if (kinds.every((k) => k === "draw" || k === "peek")) {
        need(ownTurn, a, "on your own turn, outside a fight");
        take(); played(); discardInst(ctx, a.card);
        for (const e of d.effects) {
          if (e.kind === "draw") draw(ctx, a.seat, e.deck, e.n);
          if (e.kind === "peek") s.peek = s.decks[e.deck].slice(-e.n).reverse();
        }
        return;
      }
      need(f && (prio || (setupFighter && kinds.every((k) => k === "jeet" || k === "noJeet"))), a, "fight one-shots need a fight and your priority");
      const e0 = d.effects[0]!;
      if (e0.kind === "power") {
        need(a.side === "fighter" || a.side === "threat", a, "side");
        take(); played({ side: a.side });
        f.plays.push({ by: a.seat, inst: a.card, def: d.id, side: a.side, mod: e0.n, cancelled: false });
      } else if (e0.kind === "cancelLast") {
        const last = [...f.plays].reverse().find((p) => !p.cancelled && p.inst !== null);
        need(last, a, "nothing to cancel");
        take(); played();
        last.cancelled = true;
      } else if (e0.kind === "jeet" || e0.kind === "noJeet") {
        need(inFight, a, "only a participant can prepare a jeet");
        take(); played();
        if (e0.kind === "jeet") me.jeetBonus += e0.n; else me.noJeet = true;
      } else return fail(a, `one-shot ${e0.kind} unsupported here`);
      discardInst(ctx, a.card);
      emitPower(ctx);
      if (prio) advancePriority(ctx, true);
      return;
    }
    default:
      return fail(a, `${d.type} is not played with PLAY`);
  }
}

function usePerk(ctx: Ctx, a: Extract<Action, { type: "USE_PERK" }>, me: SeatState): void {
  const { s } = ctx;
  const f = s.fight;
  need(f && isParticipant(f, a.seat) && me.playRole === "safecracker" && !me.perkUsed, a, "Safecracker perk: in a fight you are in, once a turn");
  need((s.phase === "fight.setup" && f.fighter === a.seat) || isPriority(s, a.seat), a, "not your moment");
  need(a.discard !== undefined && me.hand.includes(a.discard), a, "discard a card from your hand");
  me.hand.splice(me.hand.indexOf(a.discard), 1);
  discardInst(ctx, a.discard);
  me.perkUsed = true;
  f.plays.push({ by: a.seat, inst: null, def: null, side: "fighter", mod: 3, cancelled: false, perk: "safecracker" });
  ctx.events.push({ t: "PerkUsed", seat: a.seat, role: "safecracker", detail: a.discard });
  emitPower(ctx);
  if (s.phase === "fight.pileOn") advancePriority(ctx, true);
}

function applyFud(ctx: Ctx, actor: SeatId, target: SeatId, inst: string): void {
  const { s } = ctx;
  const d = def(s, inst);
  const t = seatOf(s, target);
  const before = t.level;
  let rekt = false;
  for (const e of d.effects) if (applyEffectOn(ctx, t, e, actor, d.id)) rekt = true;
  discardInst(ctx, inst);
  ctx.events.push({ t: "FudResolved", actor, target, card: inst, def: d.id, levelBefore: before, levelAfter: t.level, rekt });
  if (s.fight) emitPower(ctx);
}

/** Applies one effect to a seat. Returns true if it rekt them. */
function applyEffectOn(ctx: Ctx, t: SeatState, e: Effect, actor: SeatId | undefined, cause: string): boolean {
  const { s } = ctx;
  switch (e.kind) {
    case "levels": setLevel(ctx, t, t.level + e.n, cause, actor); return false;
    case "rekt": {
      for (const c of [...t.hand, ...t.gear]) discardInst(ctx, c);
      t.hand = []; t.gear = []; t.rekt = true;
      ctx.events.push({ t: "Rekt", seat: t.seat, ...(actor !== undefined ? { causedBy: actor } : {}) });
      ctx.events.push({ t: "GearChanged", seat: t.seat });
      return true;
    }
    case "discard": {
      const gearSlots: Slot[] = ["head", "body", "hands", "feet", "ride", "none"];
      let pool: string[];
      if (e.mode === "hand") pool = [...t.hand];
      else if (e.mode === "best") pool = [...t.gear].sort((x, y) => (def(s, y).bonus ?? 0) - (def(s, x).bonus ?? 0));
      else if (e.mode === "random") pool = [...t.gear];
      else if (gearSlots.includes(e.mode)) pool = t.gear.filter((g) => def(s, g).slot === e.mode);
      else pool = [];
      const n = Math.min(e.n, pool.length);
      for (let i = 0; i < n; i++) {
        const c = e.mode === "best" ? pool.shift()! : pool.splice(ctx.rng.int(pool.length), 1)[0]!;
        removeFromSeat(t, c); discardInst(ctx, c);
      }
      if (n > 0) ctx.events.push({ t: "GearChanged", seat: t.seat });
      return false;
    }
    case "kitOff": t.kitOff = true; return false;
    case "skipTurn": t.skipTurn = true; return false;
    case "stealGear": {
      if (actor === undefined || t.gear.length === 0) return false;
      const c = t.gear[ctx.rng.int(t.gear.length)]!;
      removeFromSeat(t, c);
      seatOf(s, actor).hand.push(c);
      ctx.events.push({ t: "GearChanged", seat: t.seat });
      return false;
    }
    default:
      return false;
  }
}

// ---------- fights ----------
function startFight(ctx: Ctx, fighter: SeatId, threat: string, fromHand: boolean): void {
  const { s } = ctx;
  for (const x of s.seats) { x.jeetBonus = 0; x.noJeet = false; }
  s.fightCount++;
  s.fight = { no: s.fightCount, fighter, threat, fromHand, helpers: [], pendingAsk: null, asked: [], plays: [], bagsMod: 0, degenMod: 0, ignoreLock: false, countAs: [], priority: null, passes: 0, rugEligible: [], rugChoices: {} };
  s.phase = "fight.setup";
  ctx.events.push({ t: "FightStarted", fighter, threat, def: def(s, threat).id, fromHand });
  const me = seatOf(s, fighter);
  if (me.playRole === "degen") {
    const roll = ctx.rng.d6();
    const mod = roll <= 2 ? -2 : roll >= 5 ? 4 : 0;
    s.fight.degenMod = mod;
    ctx.events.push({ t: "DegenRolled", seat: fighter, roll, mod });
  }
  emitPower(ctx);
}
function emitPower(ctx: Ctx): void {
  const f = ctx.s.fight;
  if (!f) return;
  const p = fightPower(ctx.s, f);
  ctx.events.push({ t: "PowerChanged", fighter: p.fighter, threat: p.threat });
}
function startPileOn(ctx: Ctx): void {
  const { s } = ctx;
  const f = s.fight!;
  s.phase = "fight.pileOn";
  f.priority = nextSeat(s, f.fighter);
  f.passes = 0;
}
function advancePriority(ctx: Ctx, changed: boolean): void {
  const { s } = ctx;
  const f = s.fight!;
  if (s.phase !== "fight.pileOn") return; // a FUD during setup etc.
  f.passes = changed ? 0 : f.passes + 1;
  if (f.passes >= s.seats.length) return resolveFight(ctx);
  f.priority = nextSeat(s, f.priority!);
}
function resolveFight(ctx: Ctx): void {
  const { s } = ctx;
  const f = s.fight!;
  f.priority = null;
  ctx.events.push({ t: "PileOnClosed" });
  const p = fightPower(s, f);
  ctx.events.push({ t: "PowerChanged", fighter: p.fighter, threat: p.threat });
  const won = p.fighter > p.threat || (p.fighter === p.threat && sideHasRole(s, f, "muscle"));
  if (!won) return loseFight(ctx);
  if (f.helpers.length > 0) {
    f.rugEligible = participants(f).filter((id) => seatOf(s, id).rug === "held");
    if (f.rugEligible.length > 0) {
      s.phase = "fight.rug";
      s.prompt = { kind: "rug", seats: [...f.rugEligible] };
      return;
    }
  }
  award(ctx, null, false);
}
function revealRugs(ctx: Ctx): void {
  const { s } = ctx;
  const f = s.fight!;
  s.prompt = null;
  const pulls = f.rugEligible.filter((id) => f.rugChoices[id] === true);
  const keeps = f.rugEligible.filter((id) => f.rugChoices[id] !== true);
  ctx.events.push({ t: "RugChoicesRevealed", pulls, keeps });
  for (const id of pulls) seatOf(s, id).rug = "pulled";
  if (pulls.length === 0) return award(ctx, null, false);
  if (pulls.length === 1) return award(ctx, pulls[0]!, false);
  ctx.events.push({ t: "BagTorn", fight: f.no, pullers: pulls });
  award(ctx, null, true);
}
function award(ctx: Ctx, puller: SeatId | null, torn: boolean): void {
  const { s } = ctx;
  const f = s.fight!;
  const d = def(s, f.threat);
  const levels = d.levelsWon ?? 1;
  const bags = bagsOf(s, f);
  if (torn) {
    ctx.events.push({ t: "FightWon", fighter: f.fighter, levelsTo: -1, levels: 0, bagsTo: [] });
  } else if (puller !== null) {
    ctx.events.push({ t: "RugResolved", fight: f.no, puller, victims: participants(f).filter((x) => x !== puller) });
    ctx.events.push({ t: "FightWon", fighter: f.fighter, levelsTo: puller, levels, bagsTo: [{ seat: puller, bags }] });
    draw(ctx, puller, "loot", bags);
    setLevel(ctx, seatOf(s, puller), seatOf(s, puller).level + levels, "rug", puller);
  } else {
    let remaining = bags;
    const bagsTo: Array<{ seat: SeatId; bags: number }> = [];
    for (const h of f.helpers) { const n = Math.min(h.cut, remaining); remaining -= n; if (n > 0) bagsTo.push({ seat: h.seat, bags: n }); }
    if (remaining > 0) bagsTo.push({ seat: f.fighter, bags: remaining });
    ctx.events.push({ t: "FightWon", fighter: f.fighter, levelsTo: f.fighter, levels, bagsTo });
    for (const b of bagsTo) draw(ctx, b.seat, "loot", b.bags);
    setLevel(ctx, seatOf(s, f.fighter), seatOf(s, f.fighter).level + levels, "fight");
  }
  endFight(ctx);
}
function loseFight(ctx: Ctx): void {
  const { s } = ctx;
  const f = s.fight!;
  const d = def(s, f.threat);
  ctx.events.push({ t: "FightLost", fighter: f.fighter });
  for (const id of participants(f)) {
    const t = seatOf(s, id);
    if (!jeet(ctx, t)) badStuff(ctx, t, d);
  }
  endFight(ctx);
}
function jeet(ctx: Ctx, t: SeatState): boolean {
  if (t.noJeet) { ctx.events.push({ t: "JeetRolled", seat: t.seat, roll: 0, mod: 0, escaped: true }); return true; }
  const mod = t.jeetBonus + (t.playRole === "lookout" ? 2 : 0);
  let roll = ctx.rng.d6();
  let escaped = roll + mod >= JEET_TARGET;
  if (!escaped && t.playRole === "hacker" && !t.perkUsed) {
    ctx.events.push({ t: "JeetRolled", seat: t.seat, roll, mod, escaped });
    t.perkUsed = true;
    ctx.events.push({ t: "PerkUsed", seat: t.seat, role: "hacker", detail: "reroll" });
    roll = ctx.rng.d6();
    escaped = roll + mod >= JEET_TARGET;
    ctx.events.push({ t: "JeetRolled", seat: t.seat, roll, mod, escaped, rerolled: true });
    return escaped;
  }
  ctx.events.push({ t: "JeetRolled", seat: t.seat, roll, mod, escaped });
  return escaped;
}
function badStuff(ctx: Ctx, t: SeatState, d: CardDef): void {
  if (t.playRole === "sob" && !t.sobUsed) {
    t.sobUsed = true;
    ctx.events.push({ t: "PerkUsed", seat: t.seat, role: "sob", detail: "ignored bad stuff" });
    ctx.events.push({ t: "BadStuffApplied", seat: t.seat, def: d.id, ignored: true });
    return;
  }
  ctx.events.push({ t: "BadStuffApplied", seat: t.seat, def: d.id });
  for (const e of d.badStuff ?? []) applyEffectOn(ctx, t, e, undefined, d.id);
}
function endFight(ctx: Ctx): void {
  const { s } = ctx;
  const f = s.fight!;
  discardInst(ctx, f.threat);
  s.fight = null;
  s.prompt = null;
  for (const x of s.seats) { x.jeetBonus = 0; x.noJeet = false; }
  s.fought = true;
  s.stepDone = true;
  if (s.winner !== null) return;
  s.phase = "turn.free";
}

// ---------- levels, turns, decks ----------
function setLevel(ctx: Ctx, t: SeatState, to: number, cause: string, causedBy?: SeatId): void {
  const { s } = ctx;
  const fromFight = cause === "fight" || cause === "rug";
  const cap = fromFight ? 10 : 9;
  const clamped = Math.max(1, Math.min(cap, to));
  if (clamped === t.level) return;
  const from = t.level;
  t.level = clamped;
  ctx.events.push({ t: "LevelChanged", seat: t.seat, from, to: clamped, cause, ...(causedBy !== undefined ? { causedBy } : {}) });
  if (clamped >= 10 && s.winner === null) {
    s.winner = t.seat;
    s.phase = "over";
    s.prompt = null;
    ctx.events.push({ t: "GameOver", winner: t.seat, seed: s.seed, digest: "" }); // stamped in apply()
  }
}
function nextTurn(ctx: Ctx): void {
  const { s } = ctx;
  if (s.winner !== null) return;
  for (let guard = 0; guard <= s.seats.length; guard++) {
    s.turnSeat = nextSeat(s, s.turnSeat);
    s.turnNo++;
    s.fought = false;
    s.stepDone = false;
    s.peek = [];
    for (const x of s.seats) x.perkUsed = false;
    const me = seatOf(s, s.turnSeat);
    me.kitOff = false;
    ctx.events.push({ t: "TurnStarted", seat: me.seat, turn: s.turnNo });
    if (me.rekt) { me.rekt = false; draw(ctx, me.seat, "trouble", OPENING_DEAL); draw(ctx, me.seat, "loot", OPENING_DEAL); }
    if (me.skipTurn && guard < s.seats.length) { me.skipTurn = false; ctx.events.push({ t: "TurnEnded", seat: me.seat }); continue; }
    me.skipTurn = false;
    if (me.playRole === "lookout" && s.decks.trouble.length) s.peek = [s.decks.trouble[s.decks.trouble.length - 1]!];
    s.phase = "turn.start";
    return;
  }
}
function drawOne(ctx: Ctx, deck: Deck): string | null {
  const { s } = ctx;
  const pile = s.decks[deck];
  if (pile.length === 0) {
    const disc = deck === "trouble" ? s.decks.troubleDiscard : s.decks.lootDiscard;
    if (disc.length === 0) return null;
    pile.push(...ctx.rng.shuffle(disc.splice(0)));
  }
  return pile.pop() ?? null;
}
function draw(ctx: Ctx, seat: SeatId, deck: Deck, n: number): void {
  const me = seatOf(ctx.s, seat);
  let got = 0;
  for (let i = 0; i < n; i++) { const c = drawOne(ctx, deck); if (!c) break; me.hand.push(c); got++; }
  if (got > 0) ctx.events.push({ t: "Drew", seat, deck, n: got });
}
function discardInst(ctx: Ctx, inst: string): void {
  const d = def(ctx.s, inst);
  (d.deck === "trouble" ? ctx.s.decks.troubleDiscard : ctx.s.decks.lootDiscard).push(inst);
}
function removeFromSeat(t: SeatState, inst: string): void {
  const h = t.hand.indexOf(inst);
  if (h >= 0) { t.hand.splice(h, 1); return; }
  const g = t.gear.indexOf(inst);
  if (g >= 0) t.gear.splice(g, 1);
}
