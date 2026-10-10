// @ruglife/protocol — the types everything else imports. FROZEN once agreed (tech-design § 2–3).
// Written 2026-10-10 for Chogathon 2026, from game-rules-spec v0.2.

export const RULES_VERSION = "0.2.0";
export const CHAIN_ID = 143;
export const COLLECTION = "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763" as const;

export type SeatId = number; // 0..5, clockwise

export type Role = "face" | "safecracker" | "muscle" | "lookout" | "sob" | "hacker" | "degen";
export const ROLES: readonly Role[] = ["face", "safecracker", "muscle", "lookout", "sob", "hacker", "degen"];
export type RoleOrLegend = Role | "legend";
export type Skin = "pink" | "origin" | "red" | "black" | "yellow";
export const SKINS: readonly Skin[] = ["pink", "origin", "red", "black", "yellow"];

export type Deck = "trouble" | "loot";
export type CardType = "threat" | "fud" | "boost" | "gear" | "oneshot" | "levelup" | "key";
export type Slot = "head" | "body" | "hands" | "feet" | "ride" | "none";
export type Side = "fighter" | "threat";
export type DiscardMode = "hand" | "best" | "random" | Slot;

/** The effect vocabulary of rules § 14. The engine implements exactly these; propose additions, never improvise. */
export type Effect =
  | { kind: "power"; n: number; side?: Side; ifRole?: Role; ifNotRole?: Role }
  | { kind: "bags"; n: number }
  | { kind: "levels"; n: number }
  | { kind: "lock"; role: Role }
  | { kind: "ignoreLock" }
  | { kind: "countAs"; role: Role }
  | { kind: "jeet"; n: number }
  | { kind: "noJeet" }
  | { kind: "rerollOwn" }
  | { kind: "peek"; deck: Deck; n: number }
  | { kind: "draw"; deck: Deck; n: number }
  | { kind: "discard"; n: number; mode: DiscardMode }
  | { kind: "stealGear" }
  | { kind: "swapGear" }
  | { kind: "kitOff" }
  | { kind: "rekt" }
  | { kind: "cancelLast" }
  | { kind: "value"; n: number }
  | { kind: "big" }
  | { kind: "slot"; slot: Slot }
  | { kind: "onlyRole"; role: Role }
  | { kind: "notRole"; role: Role }
  | { kind: "skipTurn" }
  | { kind: "extraFight" };

/** Which real Chogs may be cast as this card's picture. Empty = any. */
export interface CastingFilter {
  role?: RoleOrLegend[];
  base?: string[]; // "Origin" | "Skull" | "Radioactive" | "1:1"
  tier?: string[];
  trait?: Partial<Record<"eyes" | "head" | "body" | "accessory" | "mouth" | "aura" | "background" | "side", string[]>>;
}

/** One row of the card set (cards/). */
export interface CardDef {
  id: string;
  type: CardType;
  deck: Deck;
  name: string;
  flavour: string;
  text: string; // the plain rules line under the joke
  effects: Effect[];
  casting: CastingFilter;
  // threat only
  level?: number;
  levelsWon?: number;
  bags?: number;
  lock?: Role[];
  badStuff?: Effect[];
  // gear only
  slot?: Slot;
  bonus?: number;
  value?: number;
  big?: boolean;
}

export interface CardSet {
  id: string;
  version: string;
  cards: CardDef[];
}

/** A Chog as the engine sees it. tokenId is the chain id; file is the marketplace number people say. */
export interface ChogRef {
  tokenId: number;
  file: number;
  name: string;
}
export interface TokenRow extends ChogRef {
  role: RoleOrLegend;
  skin: Skin | null; // null = a rare skin: picks one at sit-down
  rareSkin: string | null;
  tier: string;
  base: string;
  form: string;
  traits: { eyes: string | null; head: string | null; body: string | null; accessory: string | null; mouth: string | null; aura: string | null; background: string | null; side: string | null; naked: string | null };
}

export type SeatKind = "chog" | "loaner" | "bot";

export interface SeatConfig {
  seat: SeatId;
  kind: SeatKind;
  tokenId: number; // a loaner/bot still plays a real token's role and kit, marked
  label?: string; // display name (wallet short / discord), never trusted by the engine
}

export interface GameConfig {
  tableId: string;
  mode: "standard" | "tournament";
  seed: string; // hex; the server publishes sha256(seed) at start and the seed at the end
  cardSetId: string;
  seats: SeatConfig[];
  rulesVersion?: string;
}

export type Phase =
  | "lobby"
  | "turn.start"
  | "fight.setup"
  | "fight.pileOn"
  | "fight.rug"
  | "fight.jeet"
  | "turn.free"
  | "turn.airdrop"
  | "over";

export type Action =
  | { type: "SIT"; seat: SeatId }
  | { type: "PICK_ROLE"; seat: SeatId; role: Role }
  | { type: "PICK_SKIN"; seat: SeatId; skin: Skin }
  | { type: "START_GAME"; seat: SeatId }
  | { type: "START_TROUBLE"; seat: SeatId }
  | { type: "LOOK_FOR_TROUBLE"; seat: SeatId; card: string }
  | { type: "GRAB_BAG"; seat: SeatId }
  | { type: "ASK_HELP"; seat: SeatId; to: SeatId; cut: number }
  | { type: "ANSWER_HELP"; seat: SeatId; accept: boolean }
  | { type: "LEAVE_FIGHT"; seat: SeatId }
  | { type: "PLAY"; seat: SeatId; card: string; target?: SeatId; side?: Side }
  | { type: "USE_PERK"; seat: SeatId; discard?: string }
  | { type: "PASS"; seat: SeatId }
  | { type: "RUG"; seat: SeatId; pull: boolean }
  | { type: "EQUIP"; seat: SeatId; card: string }
  | { type: "UNEQUIP"; seat: SeatId; card: string }
  | { type: "SELL"; seat: SeatId; cards: string[] }
  | { type: "TRADE_OFFER"; seat: SeatId; to: SeatId; give: string; take: string }
  | { type: "TRADE_ANSWER"; seat: SeatId; accept: boolean }
  | { type: "AIRDROP_KEEP"; seat: SeatId; cards: string[] }
  | { type: "END_TURN"; seat: SeatId }
  // server-only
  | { type: "TIMEOUT"; seat: SeatId }
  | { type: "AUTOPILOT"; seat: SeatId; on: boolean };

export type ActionType = Action["type"];

export type GameEvent =
  | { t: "GameStarted"; seedHash: string; casting: Record<string, number>; mode: GameConfig["mode"] }
  | { t: "TurnStarted"; seat: SeatId; turn: number }
  | { t: "CardFlipped"; seat: SeatId; card: string; def: string }
  | { t: "FightStarted"; fighter: SeatId; threat: string; def: string; fromHand: boolean }
  | { t: "HelpAsked"; fighter: SeatId; to: SeatId; cut: number }
  | { t: "HelpAgreed"; helper: SeatId; cut: number }
  | { t: "HelpDeclined"; helper: SeatId }
  | { t: "HelperLeft"; helper: SeatId }
  | { t: "CardPlayed"; by: SeatId; card: string; def: string; target?: SeatId; side?: Side }
  | { t: "PerkUsed"; seat: SeatId; role: Role; detail?: string }
  | { t: "DegenRolled"; seat: SeatId; roll: number; mod: number }
  | { t: "PowerChanged"; fighter: number; threat: number }
  | { t: "PileOnClosed" }
  | { t: "RugChoicesRevealed"; pulls: SeatId[]; keeps: SeatId[] }
  | { t: "RugResolved"; fight: number; puller: SeatId; victims: SeatId[] }
  | { t: "BagTorn"; fight: number; pullers: SeatId[] }
  | { t: "FightWon"; fighter: SeatId; levelsTo: SeatId; levels: number; bagsTo: Array<{ seat: SeatId; bags: number }> }
  | { t: "FightLost"; fighter: SeatId }
  | { t: "JeetRolled"; seat: SeatId; roll: number; mod: number; escaped: boolean; rerolled?: boolean }
  | { t: "BadStuffApplied"; seat: SeatId; def: string; ignored?: boolean }
  | { t: "FudResolved"; actor: SeatId; target: SeatId; card: string; def: string; levelBefore: number; levelAfter: number; rekt: boolean }
  | { t: "LevelChanged"; seat: SeatId; from: number; to: number; cause: string; causedBy?: SeatId }
  | { t: "Rekt"; seat: SeatId; causedBy?: SeatId }
  | { t: "GearChanged"; seat: SeatId }
  | { t: "Airdropped"; from: SeatId; to: SeatId | null; cards: number }
  | { t: "Sold"; seat: SeatId; cards: string[]; value: number }
  | { t: "Traded"; a: SeatId; b: SeatId }
  | { t: "Drew"; seat: SeatId; deck: Deck; n: number }
  | { t: "Timeout"; seat: SeatId; defaulted: ActionType }
  | { t: "Autopilot"; seat: SeatId; on: boolean }
  | { t: "TurnEnded"; seat: SeatId }
  | { t: "GameOver"; winner: SeatId; seed: string; digest: string };

export interface SeqEvent {
  seq: number;
  ev: GameEvent;
}

/** What a viewer may see. Hidden information is removed in viewFor and nowhere else. */
export interface CardView {
  inst: string;
  def: CardDef;
  cast: ChogRef;
}
export interface SeatView {
  seat: SeatId;
  kind: SeatKind;
  chog: ChogRef;
  role: RoleOrLegend;
  playRole: Role | null; // the role in play (a Legend's pick)
  skin: Skin | null;
  level: number;
  handCount: number;
  hand: CardView[] | null; // null unless it is yours
  gear: CardView[];
  kitOn: boolean;
  rug: "held" | "pulled";
  rekt: boolean;
  sobUsed: boolean;
  autopilot: boolean;
  connected: boolean;
}
export interface FightView {
  no: number;
  fighter: SeatId;
  threat: CardView;
  helpers: Array<{ seat: SeatId; cut: number }>;
  plays: Array<{ by: SeatId; card: CardView; side: Side; mod: number; cancelled: boolean }>;
  power: { fighter: number; threat: number; lockPenalty: number; lockOpen: boolean };
  priority: SeatId | null;
  pendingAsk: { to: SeatId; cut: number } | null;
  rugPending: SeatId[]; // who still has to choose (never their choice)
  myRugChoice?: boolean; // only in your own view
}
export interface PromptView {
  kind: "pickRole" | "pickSkin" | "answerHelp" | "rug" | "airdrop" | "tradeAnswer";
  seats: SeatId[];
}
export interface View {
  tableId: string;
  viewer: SeatId | "stands";
  phase: Phase;
  mode: GameConfig["mode"];
  turn: { seat: SeatId; no: number; fought: boolean } | null;
  seats: SeatView[];
  fight: FightView | null;
  prompt: PromptView | null;
  decks: { trouble: number; loot: number; troubleDiscard: number; lootDiscard: number };
  peek: CardView | null; // a Lookout's look at the top Trouble card on their turn start
  legal: Action[]; // for the viewer's seat; empty for the stands
  winner: SeatId | null;
  seedHash: string;
  seq: number;
}

// ---- wire protocol (tech-design § 3; lobby/sign-in messages added 2026-10-10 by Claude, additive) ----
export interface TableInfo {
  id: string;
  name: string;
  mode: GameConfig["mode"];
  status: "open" | "playing" | "over";
  host: string; // session id of the creator
  seats: Array<{ seat: SeatId; kind: SeatKind; tokenId: number; name: string; label: string; you?: boolean }>;
  maxSeats: number;
  timers: boolean;
  createdAt: number;
}
export type ClientMsg =
  | { type: "hello"; session: string | null }
  | { type: "nonce" }
  | { type: "signin"; message: string; signature: `0x${string}` }
  | { type: "pilot"; tokenId: number; pilot: `0x${string}`; expires: number; nonce: number; signature: `0x${string}` }
  | { type: "list" }
  | { type: "create"; mode: GameConfig["mode"]; name?: string; timers?: boolean }
  | { type: "sit"; table: string; seat?: SeatId; tokenId?: number; loaner?: boolean }
  | { type: "addBot"; table: string }
  | { type: "leave"; table: string }
  | { type: "start"; table: string }
  | { type: "watch"; table: string }
  | { type: "act"; table: string; action: Action; clientSeq: number };
export type ServerMsg =
  | { type: "welcome"; session: string; address: `0x${string}` | null }
  | { type: "nonce"; nonce: string; domain: string; uri: string; chainId: number }
  | { type: "signedIn"; address: `0x${string}` }
  | { type: "pilotOk"; tokenId: number; pilot: `0x${string}`; expires: number }
  | { type: "tables"; tables: TableInfo[] }
  | { type: "table"; table: TableInfo }
  | { type: "view"; table: string; view: View; events: SeqEvent[] }
  | { type: "error"; code: string; detail?: string };
