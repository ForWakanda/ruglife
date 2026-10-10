import type { Action, CardDef, CardSet, GameConfig, Phase, Role, RoleOrLegend, SeatId, SeatKind, Side, Skin, TokenRow } from "@ruglife/protocol";
import { RULES_VERSION } from "@ruglife/protocol";
import { Rng, seedToState } from "./rng.js";
import { sha256Hex } from "./sha256.js";

export interface CardInst { inst: string; def: string; cast: number }
export interface SeatState {
  seat: SeatId; kind: SeatKind; tokenId: number;
  role: RoleOrLegend; playRole: Role | null; skin: Skin | null;
  level: number; hand: string[]; gear: string[];
  kitOff: boolean; rug: "held" | "pulled"; rekt: boolean; sobUsed: boolean; perkUsed: boolean; skipTurn: boolean;
  autopilot: boolean; connected: boolean;
  jeetBonus: number; noJeet: boolean; // this fight only
}
export interface Play { by: SeatId; inst: string | null; def: string | null; side: Side; mod: number; cancelled: boolean; perk?: Role }
export interface FightState {
  no: number; fighter: SeatId; threat: string; fromHand: boolean;
  helpers: Array<{ seat: SeatId; cut: number }>;
  pendingAsk: { to: SeatId; cut: number } | null;
  asked: SeatId[]; // every seat asked this fight (each may be asked once)
  plays: Play[]; bagsMod: number; degenMod: number;
  ignoreLock: boolean; countAs: Role[];
  priority: SeatId | null; passes: number;
  rugEligible: SeatId[]; rugChoices: Record<number, boolean>;
}
export interface Prompt { kind: "pickRole" | "pickSkin" | "answerHelp" | "rug" | "airdrop" | "tradeAnswer"; seats: SeatId[] }
export interface GameState {
  config: GameConfig; rulesVersion: string; cardSetId: string;
  seed: string; seedHash: string; rng: number; seq: number;
  phase: Phase; turnNo: number; turnSeat: SeatId; fought: boolean; stepDone: boolean;
  seats: SeatState[];
  cards: Record<string, CardInst>;
  decks: { trouble: string[]; loot: string[]; troubleDiscard: string[]; lootDiscard: string[] };
  fight: FightState | null; fightCount: number;
  prompt: Prompt | null;
  pendingTrade: { from: SeatId; to: SeatId; give: string; take: string } | null;
  peek: string[]; // what the turn owner may look at (a Lookout's top card, an Alpha Leak)
  winner: SeatId | null;
}

// ---- registries: the engine resolves defs and tokens through these; apply() stays pure in data ----
const cardSets = new Map<string, CardSet>();
const defIndex = new Map<string, Map<string, CardDef>>();
let tokenTable: TokenRow[] = [];
let tokenMap = new Map<number, TokenRow>();
export function registerCardSet(set: CardSet): void {
  cardSets.set(set.id, set);
  defIndex.set(set.id, new Map(set.cards.map((c) => [c.id, c])));
}
export function registerTokens(rows: TokenRow[]): void {
  tokenTable = rows;
  tokenMap = new Map(rows.map((r) => [r.tokenId, r]));
}
export function cardSet(id: string): CardSet {
  const s = cardSets.get(id);
  if (!s) throw new Error(`card set ${id} not registered`);
  return s;
}
export function token(tokenId: number): TokenRow {
  const t = tokenMap.get(tokenId);
  if (!t) throw new Error(`unknown tokenId ${tokenId}`);
  return t;
}
export function def(state: GameState, inst: string): CardDef {
  const ci = state.cards[inst];
  if (!ci) throw new Error(`unknown card instance ${inst}`);
  const d = defIndex.get(state.cardSetId)?.get(ci.def);
  if (!d) throw new Error(`unknown def ${ci.def}`);
  return d;
}

export const SUPPORTED_EFFECTS: ReadonlySet<string> = new Set([
  "power", "bags", "levels", "lock", "ignoreLock", "countAs", "jeet", "noJeet", "peek", "draw", "discard", "stealGear", "kitOff", "rekt", "cancelLast", "value", "big", "slot", "onlyRole", "notRole", "skipTurn",
]);

function castCandidates(filter: CardDef["casting"]): TokenRow[] {
  return tokenTable.filter((t) => {
    if (filter.role && !filter.role.includes(t.role)) return false;
    if (filter.base && !filter.base.includes(t.base)) return false;
    if (filter.tier && !filter.tier.includes(t.tier)) return false;
    if (filter.trait) for (const [k, vals] of Object.entries(filter.trait)) {
      const v = t.traits[k as keyof TokenRow["traits"]];
      if (!vals || v === null || !vals.includes(v)) return false;
    }
    return true;
  });
}

export function createGame(config: GameConfig): GameState {
  const set = cardSet(config.cardSetId);
  if (config.seats.length < 2 || config.seats.length > 6) throw new Error("2–6 seats");
  const seatIds = config.seats.map((s) => s.seat);
  if (new Set(seatIds).size !== seatIds.length) throw new Error("duplicate seat");
  const tokenIds = config.seats.map((s) => s.tokenId);
  if (new Set(tokenIds).size !== tokenIds.length) throw new Error("one live game per Chog: duplicate tokenId at the table");
  const rng = new Rng(seedToState(config.seed));
  const cards: Record<string, CardInst> = {};
  const trouble: string[] = [];
  const loot: string[] = [];
  for (const c of set.cards) {
    const cands = castCandidates(c.casting);
    if (cands.length === 0) throw new Error(`card ${c.id}: casting filter matches no Chog`);
    const cast = rng.pick(cands).tokenId;
    const inst = `${c.id}#1`;
    cards[inst] = { inst, def: c.id, cast };
    (c.deck === "trouble" ? trouble : loot).push(inst);
  }
  rng.shuffle(trouble);
  rng.shuffle(loot);
  const startLevel = config.mode === "tournament" ? 6 : 1;
  const seats: SeatState[] = [...config.seats].sort((a, b) => a.seat - b.seat).map((s) => {
    const t = token(s.tokenId);
    return {
      seat: s.seat, kind: s.kind, tokenId: s.tokenId, role: t.role, playRole: t.role === "legend" ? null : t.role, skin: t.skin,
      level: startLevel, hand: [], gear: [], kitOff: false, rug: "held", rekt: false, sobUsed: false, perkUsed: false, skipTurn: false,
      autopilot: s.kind === "bot", connected: true, jeetBonus: 0, noJeet: false,
    };
  });
  const pending: SeatId[] = [];
  for (const s of seats) if (s.playRole === null) pending.push(s.seat);
  const skinPending = seats.filter((s) => s.skin === null).map((s) => s.seat);
  const prompt: Prompt | null = pending.length ? { kind: "pickRole", seats: pending } : skinPending.length ? { kind: "pickSkin", seats: skinPending } : null;
  return {
    config, rulesVersion: config.rulesVersion ?? RULES_VERSION, cardSetId: set.id,
    seed: config.seed, seedHash: sha256Hex(config.seed), rng: rng.state, seq: 0,
    phase: "lobby", turnNo: 0, turnSeat: seats[0]!.seat, fought: false, stepDone: false,
    seats, cards, decks: { trouble, loot, troubleDiscard: [], lootDiscard: [] },
    fight: null, fightCount: 0, prompt, pendingTrade: null, peek: [], winner: null,
  };
}

export const seatOf = (state: GameState, id: SeatId): SeatState => {
  const s = state.seats.find((x) => x.seat === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
};
export const nextSeat = (state: GameState, from: SeatId): SeatId => {
  const i = state.seats.findIndex((s) => s.seat === from);
  return state.seats[(i + 1) % state.seats.length]!.seat;
};
export type { Action };
