// RUG LIFE card set v0 — the engine's working deck. Every effect family of rules § 14 appears at least once.
// Names and flavour are first drafts (the content lane may rewrite them; ids stay stable).
// Casting filters pick which real Chogs may be the card's picture.
import type { CardDef, CardSet, Effect, Role, Slot } from "@ruglife/protocol";

type T = { id: string; name: string; flavour: string; text: string; level: number; levelsWon?: number; bags: number; lock?: Role[]; bad: Effect[]; casting?: CardDef["casting"]; effects?: Effect[] };
const threat = (t: T): CardDef => ({ type: "threat", deck: "trouble", effects: t.effects ?? [], casting: t.casting ?? {}, id: t.id, name: t.name, flavour: t.flavour, text: t.text, level: t.level, levelsWon: t.levelsWon ?? 1, bags: t.bags, ...(t.lock ? { lock: t.lock } : {}), badStuff: t.bad });
const fud = (id: string, name: string, flavour: string, text: string, effects: Effect[], casting: CardDef["casting"] = {}): CardDef => ({ id, type: "fud", deck: "trouble", name, flavour, text, effects, casting });
const boost = (id: string, name: string, flavour: string, text: string, effects: Effect[]): CardDef => ({ id, type: "boost", deck: "trouble", name, flavour, text, effects, casting: {} });
const tOne = (id: string, name: string, flavour: string, text: string, effects: Effect[]): CardDef => ({ id, type: "oneshot", deck: "trouble", name, flavour, text, effects, casting: {} });
const gear = (id: string, name: string, flavour: string, slot: Slot, bonus: number, value: number, opts: { big?: boolean; only?: Role; not?: Role; casting?: CardDef["casting"] } = {}): CardDef => ({
  id, type: "gear", deck: "loot", name, flavour,
  text: `+${bonus} ${slot === "none" ? "(no slot)" : slot}${opts.big ? ", Big" : ""}${opts.only ? `, ${opts.only} only` : ""}${opts.not ? `, not ${opts.not}` : ""}. Worth ${value}.`,
  effects: [...(opts.only ? [{ kind: "onlyRole", role: opts.only } as Effect] : []), ...(opts.not ? [{ kind: "notRole", role: opts.not } as Effect] : []), ...(opts.big ? [{ kind: "big" } as Effect] : [])],
  casting: opts.casting ?? {}, slot, bonus, value, big: opts.big ?? false,
});
const one = (id: string, name: string, flavour: string, text: string, effects: Effect[]): CardDef => ({ id, type: "oneshot", deck: "loot", name, flavour, text, effects, casting: {} });
const lvl = (id: string, name: string, flavour: string): CardDef => ({ id, type: "levelup", deck: "loot", name, flavour, text: "Go up a level. Never the 10th.", effects: [{ kind: "levels", n: 1 }], casting: {} });
const key = (id: string, name: string, flavour: string, text: string, effects: Effect[]): CardDef => ({ id, type: "key", deck: "loot", name, flavour, text, effects, casting: {} });

const cards: CardDef[] = [
  // ---- Threats (Trouble) ----
  threat({ id: "t01", name: "Gas Fee Goblin", flavour: "Charges you to lose.", text: "Level 1. Bad Stuff: discard a random card.", level: 1, bags: 1, bad: [{ kind: "discard", n: 1, mode: "hand" }], casting: { trait: { mouth: ["Drooling"] } } }),
  threat({ id: "t02", name: "Paper-Handed Intern", flavour: "Sold the bottom. Again.", text: "Level 2. Bad Stuff: lose a level.", level: 2, bags: 1, bad: [{ kind: "levels", n: -1 }], casting: { trait: { eyes: ["Round Crying", "Round Tear", "Teary"] } } }),
  threat({ id: "t03", name: "Mod With a God Complex", flavour: "Timed you out for breathing.", text: "Level 3. Bad Stuff: discard your best gear.", level: 3, bags: 1, bad: [{ kind: "discard", n: 1, mode: "best" }], casting: { trait: { head: ["Crown"] } } }),
  threat({ id: "t04", name: "The Airdrop Farmer", flavour: "Four hundred wallets, one brain cell.", text: "Level 4. Bad Stuff: lose a level.", level: 4, bags: 2, bad: [{ kind: "levels", n: -1 }], casting: { trait: { body: ["Farmer Shirt"] } } }),
  threat({ id: "t05", name: "Two-Factor Karen", flavour: "Wants to speak to the blockchain's manager.", text: "Level 5. Bad Stuff: discard 2 random cards.", level: 5, bags: 2, bad: [{ kind: "discard", n: 2, mode: "hand" }] }),
  threat({ id: "t06", name: "Copy Trader", flavour: "Mirrors every bad call you make, one block late.", text: "Level 6. Lock: Hacker (+5 unless a Hacker is on your side). Bad Stuff: lose 2 levels.", level: 6, bags: 2, lock: ["hacker"], bad: [{ kind: "levels", n: -2 }] }),
  threat({ id: "t07", name: "Influencer With a Course", flavour: "$999. Module 1: how to find people like you.", text: "Level 7. Bad Stuff: lose 2 levels.", level: 7, bags: 2, bad: [{ kind: "levels", n: -2 }], casting: { trait: { head: ["Horny Cap", "Balls Cap"] } } }),
  threat({ id: "t08", name: "The Floor Sweeper", flavour: "Bought every listing. Owns nothing.", text: "Level 8. Lock: Safecracker. Bad Stuff: discard what is in your hands.", level: 8, bags: 3, lock: ["safecracker"], bad: [{ kind: "discard", n: 2, mode: "hands" }] }),
  threat({ id: "t09", name: "Leverage Larry", flavour: "125x. Liquidated by a fart.", text: "Level 9. Bad Stuff: lose 2 levels and your kit is switched off until your next turn.", level: 9, bags: 3, bad: [{ kind: "levels", n: -2 }, { kind: "kitOff" }] }),
  threat({ id: "t10", name: "Honeypot Dev", flavour: "You can buy. You cannot sell.", text: "Level 10. Lock: Lookout. Bad Stuff: rekt.", level: 10, bags: 3, lock: ["lookout"], bad: [{ kind: "rekt" }], casting: { trait: { body: ["Gangster suit"] } } }),
  threat({ id: "t11", name: "The Jeet Swarm", flavour: "A thousand tiny sells.", text: "Level 11. Bad Stuff: lose 3 levels.", level: 11, bags: 3, bad: [{ kind: "levels", n: -3 }], casting: { trait: { head: ["JEET Cap"] } } }),
  threat({ id: "t12", name: "Insider Wallet", flavour: "Bought 3 seconds before the announcement.", text: "Level 12. Lock: Degen. Bad Stuff: lose 2 levels.", level: 12, bags: 3, lock: ["degen"], bad: [{ kind: "levels", n: -2 }] }),
  threat({ id: "t13", name: "Rug Puller Emeritus", flavour: "Retired. Unretired. Retired.", text: "Level 13. Bad Stuff: discard your whole hand.", level: 13, bags: 4, bad: [{ kind: "discard", n: 99, mode: "hand" }] }),
  threat({ id: "t14", name: "Withdrawal Freeze", flavour: "Your funds are safu. Somewhere.", text: "Level 14. Lock: Muscle. Bad Stuff: rekt.", level: 14, bags: 4, lock: ["muscle"], bad: [{ kind: "rekt" }] }),
  threat({ id: "t15", name: "The Shill Army", flavour: "Nine accounts. One guy.", text: "Level 15. Bad Stuff: lose 3 levels.", level: 15, bags: 4, bad: [{ kind: "levels", n: -3 }] }),
  threat({ id: "t16", name: "Chain Halt", flavour: "Blocks stopped. Vibes continued.", text: "Level 16. Lock: Hacker. Bad Stuff: lose 2 levels and skip your next turn.", level: 16, bags: 4, lock: ["hacker"], bad: [{ kind: "levels", n: -2 }, { kind: "skipTurn" }] }),
  threat({ id: "t17", name: "Discord Raider", flavour: "gm gm gm gm gm gm gm", text: "Level 1. Bad Stuff: discard a random card.", level: 1, bags: 1, bad: [{ kind: "discard", n: 1, mode: "hand" }] }),
  threat({ id: "t18", name: "Bot Wallet #4421", flavour: "Cries in hex.", text: "Level 2. Lock: Sob Story. Bad Stuff: lose a level.", level: 2, bags: 1, lock: ["sob"], bad: [{ kind: "levels", n: -1 }] }),
  threat({ id: "t19", name: "Sandwich Attack", flavour: "Bread, you, bread.", text: "Level 3. Bad Stuff: lose a level.", level: 3, bags: 1, bad: [{ kind: "levels", n: -1 }] }),
  threat({ id: "t20", name: "The DM Scammer", flavour: "hey bro quick question", text: "Level 4. Bad Stuff: discard your best gear.", level: 4, bags: 2, bad: [{ kind: "discard", n: 1, mode: "best" }] }),
  threat({ id: "t21", name: "Wen Moon Guy", flavour: "Has asked every day since 2021.", text: "Level 5. Lock: Face. Bad Stuff: discard a random card.", level: 5, bags: 2, lock: ["face"], bad: [{ kind: "discard", n: 1, mode: "hand" }] }),
  threat({ id: "t22", name: "Failed Dev", flavour: "Roadmap: Q1 cope, Q2 seethe.", text: "Level 6. Bad Stuff: lose a level.", level: 6, bags: 2, bad: [{ kind: "levels", n: -1 }] }),
  threat({ id: "t23", name: "Short Squeeze", flavour: "Up only, against you.", text: "Level 8. Lock: Degen. Bad Stuff: lose 2 levels.", level: 8, bags: 3, lock: ["degen"], bad: [{ kind: "levels", n: -2 }] }),
  threat({ id: "t24", name: "The Bear", flavour: "Not a metaphor.", text: "Level 10. Bad Stuff: lose 2 levels.", level: 10, bags: 3, bad: [{ kind: "levels", n: -2 }] }),
  // bosses: 2 levels, cast from the Skulls, Radioactives and the 1/1s
  threat({ id: "b01", name: "Skull Chog", flavour: "What is left after the dump.", text: "Boss, level 12. Lock: Muscle. Worth 2 levels. Bad Stuff: rekt.", level: 12, levelsWon: 2, bags: 3, lock: ["muscle"], bad: [{ kind: "rekt" }], casting: { base: ["Skull"] } }),
  threat({ id: "b02", name: "Radioactive Chog", flavour: "Glows. Do not touch. Touched.", text: "Boss, level 15. Lock: Safecracker and Face. Worth 2 levels. Bad Stuff: rekt.", level: 15, levelsWon: 2, bags: 4, lock: ["safecracker", "face"], bad: [{ kind: "rekt" }], casting: { base: ["Radioactive"] } }),
  threat({ id: "b03", name: "The One of One", flavour: "There is no second best.", text: "Boss, level 18. Lock: Sob Story and Hacker. Worth 2 levels. Bad Stuff: rekt.", level: 18, levelsWon: 2, bags: 4, lock: ["sob", "hacker"], bad: [{ kind: "rekt" }], casting: { base: ["1:1"] } }),
  threat({ id: "b04", name: "The Sweeper Whale", flavour: "Owns 68. Wants 69.", text: "Boss, level 20. Worth 2 levels. Bad Stuff: rekt and lose 3 levels.", level: 20, levelsWon: 2, bags: 4, bad: [{ kind: "rekt" }, { kind: "levels", n: -3 }], casting: { base: ["Skull"] } }),
  // ---- FUD (Trouble) ----
  fud("f01", "Rugged", "The chart went vertical. Down.", "Target loses a level.", [{ kind: "levels", n: -1 }]),
  fud("f02", "Liquidated", "Margin call at 3 a.m.", "Target loses 2 levels.", [{ kind: "levels", n: -2 }]),
  fud("f03", "Wallet Drained", "You clicked the link.", "Target is rekt: loses hand and gear.", [{ kind: "rekt" }]),
  fud("f04", "Fat Finger", "0 instead of 0.0.", "Target discards a random card.", [{ kind: "discard", n: 1, mode: "hand" }]),
  fud("f05", "Phished", "Official-looking. Was not.", "Target discards their best gear.", [{ kind: "discard", n: 1, mode: "best" }]),
  fud("f06", "Lost Seed Phrase", "It was on a napkin.", "Target discards 2 random cards.", [{ kind: "discard", n: 2, mode: "hand" }]),
  fud("f07", "Doxxed", "Everyone knows what you look like now.", "Target's kit is switched off until their next turn.", [{ kind: "kitOff" }]),
  fud("f08", "Hacked Discord", "Admin posted a mint link.", "Steal a random piece of the target's gear into your hand.", [{ kind: "stealGear" }]),
  fud("f09", "Chain Congestion", "Pending. Pending. Pending.", "Target skips their next turn.", [{ kind: "skipTurn" }]),
  fud("f10", "Dust Attack", "0.000001 of something.", "Target loses a level.", [{ kind: "levels", n: -1 }]),
  fud("f11", "Exit Scam", "The team's socials are gone.", "Target loses 2 levels.", [{ kind: "levels", n: -2 }]),
  fud("f12", "Rekt by Leverage", "The candle had your name on it.", "Target is rekt.", [{ kind: "rekt" }]),
  // ---- Boosts (Trouble): modify the Threat ----
  boost("bo01", "Pumped", "Someone bought.", "Threat +3.", [{ kind: "power", n: 3, side: "threat" }]),
  boost("bo02", "Whale Backing", "A wallet with a name.", "Threat +5, +1 bag.", [{ kind: "power", n: 5, side: "threat" }, { kind: "bags", n: 1 }]),
  boost("bo03", "Shilled", "Nine replies, all the same.", "Threat +2.", [{ kind: "power", n: 2, side: "threat" }]),
  boost("bo04", "Coordinated Raid", "They had a Telegram.", "Threat +4, +1 bag.", [{ kind: "power", n: 4, side: "threat" }, { kind: "bags", n: 1 }]),
  boost("bo05", "Nerfed", "Patch notes dropped.", "Threat −2.", [{ kind: "power", n: -2, side: "threat" }]),
  boost("bo06", "Dev Got Doxxed", "Turns out it was Steve.", "Threat −4.", [{ kind: "power", n: -4, side: "threat" }]),
  // ---- other Trouble one-shots (own turn, outside a fight) ----
  tOne("tr01", "Alpha Leak", "Screenshot of a screenshot.", "Look at the top 3 Trouble cards.", [{ kind: "peek", deck: "trouble", n: 3 }]),
  tOne("tr02", "Insider Tip", "Trust me.", "Draw 2 Trouble cards.", [{ kind: "draw", deck: "trouble", n: 2 }]),
  tOne("tr03", "Group Buy", "Everyone in.", "Draw 1 Trouble and 1 Loot card.", [{ kind: "draw", deck: "trouble", n: 1 }, { kind: "draw", deck: "loot", n: 1 }]),
  // ---- Gear (Loot) ----
  gear("g01", "Ledger Nano", "Lost in a drawer since 2022.", "hands", 1, 200),
  gear("g02", "Hardware Wallet Belt", "Twelve of them. All empty.", "body", 2, 400),
  gear("g03", "Tinfoil Cap", "Blocks the feds, not the losses.", "head", 1, 100),
  gear("g04", "Degen Goggles", "Every chart looks bullish.", "head", 2, 300, { only: "degen" }),
  gear("g05", "Laser Contacts", "For when the eyes are not enough.", "head", 3, 600, { only: "safecracker" }),
  gear("g06", "Gas Mask", "Mandatory on Monad.", "head", 2, 400),
  gear("g07", "Bulletproof Hoodie", "Standard dev uniform.", "body", 3, 600),
  gear("g08", "Tuxedo of Tuxedos", "Eight of them, stacked.", "body", 2, 400, { only: "face", casting: { trait: { body: ["Tuxedo"] } } }),
  gear("g09", "Keyboard of Doom", "Mechanical. Loud. Illegal in three states.", "hands", 3, 500, { big: true }),
  gear("g10", "Lambo", "Leased.", "ride", 4, 1000, { big: true }),
  gear("g11", "Scooter", "Rented by the minute.", "ride", 1, 200),
  gear("g12", "Crocs", "Sport mode.", "feet", 1, 100),
  gear("g13", "Moon Boots", "Never been.", "feet", 3, 600, { big: true }),
  gear("g14", "Fake Rolex", "Ticks loudly.", "none", 1, 300),
  gear("g15", "Burner Phone", "Fourteen SIMs.", "hands", 2, 300, { only: "hacker" }),
  gear("g16", "Brass Knuckles", "For negotiations.", "hands", 2, 300, { only: "muscle" }),
  gear("g17", "Crying Towel", "Absorbent. Needed.", "none", 2, 300, { only: "sob" }),
  gear("g18", "Binoculars", "Watching the mempool.", "hands", 2, 300, { only: "lookout" }),
  gear("g19", "Shopping Cart", "The original ride.", "ride", 2, 400),
  gear("g20", "The Bag", "You are holding it.", "none", 1, 500),
  // ---- One-shots (Loot) ----
  one("s01", "Buy the Dip", "It kept dipping.", "+3 to either side of a fight.", [{ kind: "power", n: 3 }]),
  one("s02", "Pump It", "Louder.", "+5 to either side of a fight.", [{ kind: "power", n: 5 }]),
  one("s03", "Send It", "No hands.", "+2 to either side of a fight.", [{ kind: "power", n: 2 }]),
  one("s04", "Cope", "It is just a dip.", "+2 to your jeet roll this fight.", [{ kind: "jeet", n: 2 }]),
  one("s05", "Vanish", "Deleted the account.", "You jeet automatically this fight.", [{ kind: "noJeet" }]),
  one("s06", "Delete Tweet", "Never happened.", "Cancel the last fight card played.", [{ kind: "cancelLast" }]),
  one("s07", "Alpha Group", "Invite only.", "Draw 2 Loot cards.", [{ kind: "draw", deck: "loot", n: 2 }]),
  one("s08", "Loot Box", "Contents may vary.", "Draw 1 Loot and 1 Trouble card.", [{ kind: "draw", deck: "loot", n: 1 }, { kind: "draw", deck: "trouble", n: 1 }]),
  one("s09", "Dump It", "Market sell. Everything.", "−3 to either side of a fight.", [{ kind: "power", n: -3 }]),
  one("s10", "Market Order", "Slippage: yes.", "+4 to either side of a fight.", [{ kind: "power", n: 4 }]),
  // ---- Level-ups (Loot) ----
  lvl("l01", "Number Go Up", "Briefly."),
  lvl("l02", "Airdrop Landed", "Unverified."),
  lvl("l03", "Mooned", "On paper."),
  lvl("l04", "Got In Early", "Three minutes before you."),
  lvl("l05", "Sold the Top", "By accident."),
  lvl("l06", "Staking Rewards", "4.2 % of nothing."),
  // ---- Keys (Loot) ----
  key("k01", "Fake Lasers", "Stickers.", "Your side counts as having a Safecracker this fight.", [{ kind: "countAs", role: "safecracker" }]),
  key("k02", "Rented Muscle", "Paid in exposure.", "Your side counts as having a Muscle this fight.", [{ kind: "countAs", role: "muscle" }]),
  key("k03", "Borrowed Visor", "Still logged into his account.", "Your side counts as having a Hacker this fight.", [{ kind: "countAs", role: "hacker" }]),
  key("k04", "Skeleton Key", "Opens anything.", "Ignore the Lock on this Threat.", [{ kind: "ignoreLock" }]),
  key("k05", "Master Key", "Admin.", "Ignore the Lock on this Threat.", [{ kind: "ignoreLock" }]),
];

export const cardSetV0: CardSet = { id: "ruglife-v0", version: "0.1.0", cards };
