// RUG LIFE card set v0 — 106 cards (55 Trouble, 51 Loot), copy pass 2026-10-12.
// Existing IDs and mechanics are stable; new cards use only implemented effects.
// Casting filters pick which real Chogs may be the card's picture.
import type { CardDef, CardSet, Effect, Role, Slot } from "@ruglife/protocol";

type T = { id: string; name: string; flavour: string; text: string; level: number; levelsWon?: number; bags: number; lock?: Role[]; bad: Effect[]; casting?: CardDef["casting"]; effects?: Effect[] };
const roleName: Record<Role, string> = { face: "Face", safecracker: "Safecracker", muscle: "Muscle", lookout: "Lookout", sob: "Sob Story", hacker: "Hacker", degen: "Degen" };
const threat = (t: T): CardDef => {
  const levels = t.levelsWon ?? 1;
  const lock = t.lock?.length ? ` Locks: ${t.lock.map((r) => roleName[r]).join(" + ")}. +5 Threat Power per missing role.` : "";
  return { type: "threat", deck: "trouble", effects: t.effects ?? [], casting: t.casting ?? {}, id: t.id, name: t.name, flavour: t.flavour,
    text: `Win: ${levels} level${levels === 1 ? "" : "s"}, ${t.bags} bag${t.bags === 1 ? "" : "s"}.${lock} Bad Stuff: ${t.text}`,
    level: t.level, levelsWon: levels, bags: t.bags, ...(t.lock ? { lock: t.lock } : {}), badStuff: t.bad };
};
const fud = (id: string, name: string, flavour: string, text: string, effects: Effect[], casting: CardDef["casting"] = {}): CardDef => ({ id, type: "fud", deck: "trouble", name, flavour, text, effects, casting });
const boost = (id: string, name: string, flavour: string, text: string, effects: Effect[]): CardDef => ({ id, type: "boost", deck: "trouble", name, flavour, text, effects, casting: {} });
const tOne = (id: string, name: string, flavour: string, text: string, effects: Effect[]): CardDef => ({ id, type: "oneshot", deck: "trouble", name, flavour, text, effects, casting: {} });
const gear = (id: string, name: string, flavour: string, slot: Slot, bonus: number, value: number, opts: { big?: boolean; only?: Role; not?: Role; casting?: CardDef["casting"] } = {}): CardDef => ({
  id, type: "gear", deck: "loot", name, flavour,
  text: `+${bonus} Power. ${slot === "none" ? "No slot" : slot === "hands" ? "1 hand slot" : `${slot[0]!.toUpperCase()}${slot.slice(1)} slot`}.${opts.big ? " Big." : ""}${opts.only ? ` ${roleName[opts.only]} only.` : ""}${opts.not ? ` Cannot be used by ${roleName[opts.not]}.` : ""} ${value.toLocaleString("en-US")} notes.`,
  effects: [...(opts.only ? [{ kind: "onlyRole", role: opts.only } as Effect] : []), ...(opts.not ? [{ kind: "notRole", role: opts.not } as Effect] : []), ...(opts.big ? [{ kind: "big" } as Effect] : [])],
  casting: opts.casting ?? {}, slot, bonus, value, big: opts.big ?? false,
});
const one = (id: string, name: string, flavour: string, text: string, effects: Effect[]): CardDef => ({ id, type: "oneshot", deck: "loot", name, flavour, text, effects, casting: {} });
const lvl = (id: string, name: string, flavour: string): CardDef => ({ id, type: "levelup", deck: "loot", name, flavour, text: "On your turn, outside a fight: gain 1 level, up to Level 9.", effects: [{ kind: "levels", n: 1 }], casting: {} });
const key = (id: string, name: string, flavour: string, text: string, effects: Effect[]): CardDef => ({ id, type: "key", deck: "loot", name, flavour, text, effects, casting: {} });

const cards: CardDef[] = [
  // ---- Threats (Trouble) ----
  threat({ id: "t01", name: "Gas Station Goblin", flavour: "Charges a convenience fee for the inconvenience.", text: "discard 1 random card from your hand.", level: 1, bags: 1, bad: [{ kind: "discard", n: 1, mode: "hand" }], casting: { trait: { mouth: ["Drooling"] } } }),
  threat({ id: "t02", name: "Panic-Sell Intern", flavour: "First day. Last candle.", text: "lose 1 level.", level: 2, bags: 1, bad: [{ kind: "levels", n: -1 }], casting: { trait: { eyes: ["Round Crying", "Round Tear", "Teary"] } } }),
  threat({ id: "t03", name: "Discord Landlord", flavour: "Rent is due. Payment is agreeing with him.", text: "discard your equipped gear with the highest Power bonus.", level: 3, bags: 1, bad: [{ kind: "discard", n: 1, mode: "best" }], casting: { trait: { head: ["Crown"] } } }),
  threat({ id: "t04", name: "Airdrop Scarecrow", flavour: "Four hundred wallets. Nothing between the ears.", text: "lose 1 level.", level: 4, bags: 2, bad: [{ kind: "levels", n: -1 }], casting: { trait: { body: ["Farmer Shirt"] } } }),
  threat({ id: "t05", name: "Seed Phrase Support", flavour: "For your security, please become less secure.", text: "discard 2 random cards from your hand.", level: 5, bags: 2, bad: [{ kind: "discard", n: 2, mode: "hand" }] }),
  threat({ id: "t06", name: "Copy-Paste Cartel", flavour: "Stole the code. Kept the fucking bugs.", text: "lose 2 levels.", level: 6, bags: 2, lock: ["hacker"], bad: [{ kind: "levels", n: -2 }] }),
  threat({ id: "t07", name: "Exit Liquidity Coach", flavour: "The course is free. Being the lesson costs extra.", text: "lose 2 levels.", level: 7, bags: 2, bad: [{ kind: "levels", n: -2 }], casting: { trait: { head: ["Horny Cap", "Balls Cap"] } } }),
  threat({ id: "t08", name: "Floor Gobbler", flavour: "Every listing is a bargain when the money is stolen.", text: "discard all equipped hand-slot gear.", level: 8, bags: 3, lock: ["safecracker"], bad: [{ kind: "discard", n: 2, mode: "hands" }] }),
  threat({ id: "t09", name: "Leverage Larry", flavour: "125x long. Liquidated by a fart.", text: "lose 2 levels; your kit is off until your next turn starts.", level: 9, bags: 3, bad: [{ kind: "levels", n: -2 }, { kind: "kitOff" }] }),
  threat({ id: "t10", name: "Honeypot Helpdesk", flavour: "Your sell request is very important to us.", text: "REKT: discard your hand and all equipped gear.", level: 10, bags: 3, lock: ["lookout"], bad: [{ kind: "rekt" }], casting: { trait: { body: ["Gangster suit"] } } }),
  threat({ id: "t11", name: "Jeet Parade", flavour: "Everybody out. Please panic in single file.", text: "lose 3 levels.", level: 11, bags: 3, bad: [{ kind: "levels", n: -3 }], casting: { trait: { head: ["JEET Cap"] } } }),
  threat({ id: "t12", name: "Definitely Not an Insider", flavour: "Bought three seconds early. A gifted researcher.", text: "lose 2 levels.", level: 12, bags: 3, lock: ["degen"], bad: [{ kind: "levels", n: -2 }] }),
  threat({ id: "t13", name: "Serial Founder", flavour: "New logo. Same missing funds.", text: "discard your entire hand.", level: 13, bags: 4, bad: [{ kind: "discard", n: 99, mode: "hand" }] }),
  threat({ id: "t14", name: "Withdrawal Department", flavour: "Open whenever you stop asking.", text: "REKT: discard your hand and all equipped gear.", level: 14, bags: 4, lock: ["muscle"], bad: [{ kind: "rekt" }] }),
  threat({ id: "t15", name: "Shill Battalion", flavour: "One hundred soldiers. One charging cable.", text: "lose 3 levels.", level: 15, bags: 4, bad: [{ kind: "levels", n: -3 }] }),
  threat({ id: "t16", name: "Decentralized Off Switch", flavour: "The unstoppable future is restarting.", text: "lose 2 levels and skip your next turn.", level: 16, bags: 4, lock: ["hacker"], bad: [{ kind: "levels", n: -2 }, { kind: "skipTurn" }] }),
  threat({ id: "t17", name: "Reply Goblin", flavour: "gchog. gchog. gchog. Please notice the link.", text: "discard 1 random card from your hand.", level: 1, bags: 1, bad: [{ kind: "discard", n: 1, mode: "hand" }] }),
  threat({ id: "t18", name: "Bot With Feelings", flavour: "Failed CAPTCHA. Passed through all five stages of grief.", text: "lose 1 level.", level: 2, bags: 1, lock: ["sob"], bad: [{ kind: "levels", n: -1 }] }),
  threat({ id: "t19", name: "Mempool Sandwich", flavour: "The filling is your entire fucking order.", text: "lose 1 level.", level: 3, bags: 1, bad: [{ kind: "levels", n: -1 }] }),
  threat({ id: "t20", name: "Unsolicited Admin", flavour: "Official support has terrible spelling and incredible urgency.", text: "discard your equipped gear with the highest Power bonus.", level: 4, bags: 2, bad: [{ kind: "discard", n: 1, mode: "best" }] }),
  threat({ id: "t21", name: "Wen Moon Correspondent", flavour: "Reporting live from the same question.", text: "discard 1 random card from your hand.", level: 5, bags: 2, lock: ["face"], bad: [{ kind: "discard", n: 1, mode: "hand" }] }),
  threat({ id: "t22", name: "Roadmap Archaeologist", flavour: "Q4 is down there somewhere.", text: "lose 1 level.", level: 6, bags: 2, bad: [{ kind: "levels", n: -1 }] }),
  threat({ id: "t23", name: "Shorts on Fire", flavour: "The market can stay stupid longer than your pants survive.", text: "lose 2 levels.", level: 8, bags: 3, lock: ["degen"], bad: [{ kind: "levels", n: -2 }] }),
  threat({ id: "t24", name: "Bear With Receipts", flavour: "Brought screenshots. And claws.", text: "lose 2 levels.", level: 10, bags: 3, bad: [{ kind: "levels", n: -2 }] }),
  threat({ id: "t25", name: "Banana Republic Auditor", flavour: "The books are cooked. The banana is still green.", text: "discard your equipped body-slot gear.", level: 7, bags: 2, bad: [{ kind: "discard", n: 1, mode: "body" }], casting: { role: ["face"] } }),
  threat({ id: "t26", name: "Ministry of Cope", flavour: "The losses have been reclassified as national character.", text: "lose 2 levels and discard 1 random card from your hand.", level: 9, bags: 3, bad: [{ kind: "levels", n: -2 }, { kind: "discard", n: 1, mode: "hand" }], casting: { role: ["sob"] } }),
  // bosses: 2 levels, cast from the Skulls, Radioactives and the 1/1s
  threat({ id: "b01", name: "Chairman of the Dead", flavour: "The board has no pulse. Guidance remains bullish.", text: "REKT: discard your hand and all equipped gear.", level: 12, levelsWon: 2, bags: 3, lock: ["muscle"], bad: [{ kind: "rekt" }], casting: { base: ["Skull"] } }),
  threat({ id: "b02", name: "Nuclear Bagholder", flavour: "The position is decaying. So is the building.", text: "REKT: discard your hand and all equipped gear.", level: 15, levelsWon: 2, bags: 4, lock: ["safecracker", "face"], bad: [{ kind: "rekt" }], casting: { base: ["Radioactive"] } }),
  threat({ id: "b03", name: "One-of-One Problem", flavour: "A crisis this rare deserves its own committee.", text: "REKT: discard your hand and all equipped gear.", level: 18, levelsWon: 2, bags: 4, lock: ["sob", "hacker"], bad: [{ kind: "rekt" }], casting: { base: ["1:1"] } }),
  threat({ id: "b04", name: "The Entire Fucking Floor", flavour: "Management has acquired the building you are standing in.", text: "REKT: discard your hand and all equipped gear; lose 3 levels.", level: 20, levelsWon: 2, bags: 4, bad: [{ kind: "rekt" }, { kind: "levels", n: -3 }], casting: { base: ["Skull"] } }),
  threat({ id: "b05", name: "Emergency Broadcast Cult", flavour: "This is not a test. The test joined the cult.", text: "lose 3 levels and discard your equipped gear with the highest Power bonus.", level: 14, levelsWon: 2, bags: 4, bad: [{ kind: "levels", n: -3 }, { kind: "discard", n: 1, mode: "best" }], casting: { base: ["Radioactive"] } }),
  threat({ id: "b06", name: "Final Boss of Finance", flavour: "The economy is three bad decisions in a trench coat.", text: "REKT: discard your hand and all equipped gear; lose 2 levels.", level: 19, levelsWon: 2, bags: 4, bad: [{ kind: "rekt" }, { kind: "levels", n: -2 }], casting: { base: ["1:1"] } }),
  // ---- FUD (Trouble) ----
  fud("f01", "Liquidity Evaporated", "The pool was mostly spit.", "Target loses 1 level.", [{ kind: "levels", n: -1 }]),
  fud("f02", "Margin Called", "It knew your number. It knows where you live.", "Target loses 2 levels.", [{ kind: "levels", n: -2 }]),
  fud("f03", "Clicked the Free Mint", "The mint was free. The lesson was everything.", "Target is REKT: discard their hand and all equipped gear.", [{ kind: "rekt" }]),
  fud("f04", "Extra Zero", "The decimal point has left the chat.", "Target discards 1 random card from their hand.", [{ kind: "discard", n: 1, mode: "hand" }]),
  fud("f05", "Verified by a Checkmark", "A tiny blue tick did all your due diligence.", "Target discards their equipped gear with the highest Power bonus.", [{ kind: "discard", n: 1, mode: "best" }]),
  fud("f06", "Seed Phrase Laundry", "Twelve words. One hot wash.", "Target discards 2 random cards from their hand.", [{ kind: "discard", n: 2, mode: "hand" }]),
  fud("f07", "Doxxed in 4K", "The anonymous mastermind has a name tag.", "Target's kit is off until their next turn starts.", [{ kind: "kitOff" }]),
  fud("f08", "Admin Account Compromised", "The announcement channel is under new mismanagement.", "Move 1 random piece of the target's equipped gear into your hand. If flipped, move your own gear instead.", [{ kind: "stealGear" }]),
  fud("f09", "Pending Since Tuesday", "The spinner has achieved seniority.", "Target skips their next turn.", [{ kind: "skipTurn" }]),
  fud("f10", "Dust in the Wallet", "Congratulations. You own a problem.", "Target loses 1 level.", [{ kind: "levels", n: -1 }]),
  fud("f11", "Team Went Hiking", "The roadmap ends at an airport.", "Target loses 2 levels.", [{ kind: "levels", n: -2 }]),
  fud("f12", "Liquidation Speedrun", "Personal best. Personal bankruptcy.", "Target is REKT: discard their hand and all equipped gear.", [{ kind: "rekt" }]),
  // ---- Boosts (Trouble): modify the Threat ----
  boost("bo01", "Green Candle Cult", "The congregation has discovered leverage.", "+3 Power to the Threat this fight.", [{ kind: "power", n: 3, side: "threat" }]),
  boost("bo02", "Whale in the Group Chat", "The typing indicator weighs six tons.", "+5 Power to the Threat and +1 bag this fight.", [{ kind: "power", n: 5, side: "threat" }, { kind: "bags", n: 1 }]),
  boost("bo03", "Proof of Bullshit", "Nine burners have independently confirmed this.", "+2 Power to the Threat this fight.", [{ kind: "power", n: 2, side: "threat" }]),
  boost("bo04", "Weaponized Shitposting", "The raid leader has pinned the spelling.", "+4 Power to the Threat and +1 bag this fight.", [{ kind: "power", n: 4, side: "threat" }, { kind: "bags", n: 1 }]),
  boost("bo05", "Community Notes", "The evidence was visible in the screenshot.", "−2 Power to the Threat this fight.", [{ kind: "power", n: -2, side: "threat" }]),
  boost("bo06", "Founder Forgot to Mute", "The mic picked up the exit strategy.", "−4 Power to the Threat this fight.", [{ kind: "power", n: -4, side: "threat" }]),
  // ---- other Trouble one-shots (own turn, outside a fight) ----
  tOne("tr01", "Screenshot of a Screenshot", "Deep-fried intelligence. Still technically legible.", "On your turn, outside a fight: look at the top 3 Trouble cards without changing their order.", [{ kind: "peek", deck: "trouble", n: 3 }]),
  tOne("tr02", "Trust Me, Dipshit", "The source requested anonymity and a referral bonus.", "On your turn, outside a fight: draw 2 Trouble cards into your hand.", [{ kind: "draw", deck: "trouble", n: 2 }]),
  tOne("tr03", "CWO Group Chat", "Two unread messages. Both somehow your problem.", "On your turn, outside a fight: draw 1 Trouble card and 1 Loot card into your hand.", [{ kind: "draw", deck: "trouble", n: 1 }, { kind: "draw", deck: "loot", n: 1 }]),
  tOne("tr04", "Leaked Meeting Minutes", "The official version contains fewer screams.", "On your turn, outside a fight: look at the top 2 Trouble cards without changing their order.", [{ kind: "peek", deck: "trouble", n: 2 }]),
  tOne("tr05", "Mandatory Due Diligence", "Management insists you personally hold the problem.", "On your turn, outside a fight: draw 1 Trouble card into your hand.", [{ kind: "draw", deck: "trouble", n: 1 }]),
  // ---- Gear (Loot) ----
  gear("g01", "Cold Wallet, Hot Mess", "The money is offline. The panic is everywhere.", "hands", 1, 200),
  gear("g02", "Burner Wallet Bandolier", "Twelve escape plans, all linked to the same email.", "body", 2, 400),
  gear("g03", "Tinfoil Crown", "His Majesty suspects the microwave.", "head", 1, 100),
  gear("g04", "Bullish Goggles", "Red is just green with commitment issues.", "head", 2, 300, { only: "degen" }),
  gear("g05", "Industrial Laser Contacts", "Read the fine print straight through the safe.", "head", 3, 600, { only: "safecracker" }),
  gear("g06", "Bullshit Respirator", "Rated for three consecutive founder interviews.", "head", 2, 400),
  gear("g07", "Indictment Hoodie", "For when the roadmap includes an arraignment.", "body", 3, 600),
  gear("g08", "Summit Tuxedo", "Dress for the government you plan to replace.", "body", 2, 400, { only: "face", casting: { trait: { body: ["Tuxedo"] } } }),
  gear("g09", "Caps Lock Cannon", "All caps. No facts. Heavy recoil.", "hands", 3, 500, { big: true }),
  gear("g10", "Repossessed Lambo", "The repo man is riding shotgun.", "ride", 4, 1000, { big: true }),
  gear("g11", "Exit Scooter", "The getaway budget has been revised.", "ride", 1, 200),
  gear("g12", "Panic Clogs", "Sport mode is a risk-management framework.", "feet", 1, 100),
  gear("g13", "Moon-or-Bust Boots", "Heavy enough to make the moon somebody else's problem.", "feet", 3, 600, { big: true }),
  gear("g14", "Counterfeit Conviction", "A watch that is right twice per rug.", "none", 1, 300),
  gear("g15", "Burner Brick", "Fourteen SIMs. Nobody worth calling.", "hands", 2, 300, { only: "hacker" }),
  gear("g16", "Manual Dispute Resolver", "Customer service. In person.", "hands", 2, 300, { only: "muscle" }),
  gear("g17", "Industrial Cope Rag", "For tears, spilled coffee and the quarterly report.", "none", 2, 300, { only: "sob" }),
  gear("g18", "Exit-Watching Binoculars", "Keep one eye on the dev and one on the door.", "hands", 2, 300, { only: "lookout" }),
  gear("g19", "Shopping Cart of State", "The motorcade has one bad wheel.", "ride", 2, 400),
  gear("g20", "Bag of Conviction", "Heavy with other people's exits.", "none", 1, 500),
  gear("g21", "Diplomatic Banana Suit", "Recognized by all governments currently wearing fruit.", "body", 2, 400, { casting: { trait: { body: ["Banana suit"] } } }),
  gear("g22", "Bullshit Megaphone", "Turns an opinion into a public nuisance.", "hands", 2, 400),
  gear("g23", "CWO Press Pass", "Access to everywhere the evacuation has finished.", "none", 1, 200),
  gear("g24", "Getaway Slippers", "For emergencies during working-from-bed hours.", "feet", 2, 400),
  // ---- One-shots (Loot) ----
  one("s01", "Buy the Fucking Dip", "The dip has requested reinforcements.", "+3 Power to either side this fight.", [{ kind: "power", n: 3 }]),
  one("s02", "CWO Broadcast Override", "We interrupt this programme to make things worse.", "+5 Power to either side this fight.", [{ kind: "power", n: 5 }]),
  one("s03", "Send It, Coward", "Risk committee: absent. Vibes committee: unanimous.", "+2 Power to either side this fight.", [{ kind: "power", n: 2 }]),
  one("s04", "Emergency Cope", "Fear is temporary. Bad screenshots are forever.", "+2 to your jeet roll if your side loses this fight. Play before the roll.", [{ kind: "jeet", n: 2 }]),
  one("s05", "Irish Exit Liquidity", "The account has been deleted for personal growth.", "If your side loses this fight, you jeet automatically. Play before the roll.", [{ kind: "noJeet" }]),
  one("s06", "Delete the Evidence", "The internet remembers. The Power total does not.", "Cancel the latest uncancelled Power card in this fight. Its bag bonus, if any, stays.", [{ kind: "cancelLast" }]),
  one("s07", "Paid Alpha Leak", "The private group has been forwarded to everyone.", "On your turn, outside a fight: draw 2 Loot cards into your hand.", [{ kind: "draw", deck: "loot", n: 2 }]),
  one("s08", "Unlabelled Care Package", "One blessing. One administrative incident.", "On your turn, outside a fight: draw 1 Loot card and 1 Trouble card into your hand.", [{ kind: "draw", deck: "loot", n: 1 }, { kind: "draw", deck: "trouble", n: 1 }]),
  one("s09", "Market Dump", "A sell order with structural consequences.", "−3 Power to either side this fight.", [{ kind: "power", n: -3 }]),
  one("s10", "Fat-Finger Buy", "The zero was a typo. The candle is permanent.", "+4 Power to either side this fight.", [{ kind: "power", n: 4 }]),
  one("s11", "Banana for Scale", "The situation is much bigger than the fruit suggests.", "+1 Power to either side this fight.", [{ kind: "power", n: 1 }]),
  one("s12", "Holy Shit", "The congregation has found something worth yelling about.", "+3 Power to either side this fight.", [{ kind: "power", n: 3 }]),
  one("s13", "Liquidity Hangover", "Yesterday's conviction is today's bucket.", "−2 Power to either side this fight.", [{ kind: "power", n: -2 }]),
  one("s14", "Tactical Toilet Break", "The minutes will record a sudden vacancy.", "+1 to your jeet roll if your side loses this fight. Play before the roll.", [{ kind: "jeet", n: 1 }]),
  one("s15", "Press Office Retraction", "Please delete the previous reality.", "Cancel the latest uncancelled Power card in this fight. Its bag bonus, if any, stays.", [{ kind: "cancelLast" }]),
  one("s16", "Chogtober Stimulus", "The budget committee found a bag behind the sofa.", "On your turn, outside a fight: draw 1 Loot card into your hand.", [{ kind: "draw", deck: "loot", n: 1 }]),
  // ---- Level-ups (Loot) ----
  lvl("l01", "Number Went Up", "The nation observed twelve seconds of prosperity."),
  lvl("l02", "Airdrop Actually Landed", "The group chat briefly ran out of complaints."),
  lvl("l03", "Banana at the Summit", "Security checked the guest list. It just said banana."),
  lvl("l04", "Early, for Once", "A clerical error has worked in your favour."),
  lvl("l05", "Accidentally Sold the Top", "Now you must spend the rest of your life pretending you knew."),
  lvl("l06", "Promoted by the CWO", "Your new title is longer. Your desk is the same box."),
  // ---- Keys (Loot) ----
  key("k01", "Stick-On Laser Eyes", "The safe is too embarrassed to question it.", "Your side counts as having a Safecracker for Locks this fight. No role perk.", [{ kind: "countAs", role: "safecracker" }]),
  key("k02", "Rent-a-Goon", "References available from previous disagreements.", "Your side counts as having a Muscle this fight: open Muscle Locks and win ties. No other role perk.", [{ kind: "countAs", role: "muscle" }]),
  key("k03", "Borrowed Admin Visor", "The password was on the visor.", "Your side counts as having a Hacker for Locks this fight. No role perk.", [{ kind: "countAs", role: "hacker" }]),
  key("k04", "Backdoor Banana", "Security had prepared for every other fruit.", "Ignore all Locks on this Threat for this fight.", [{ kind: "ignoreLock" }]),
  key("k05", "CWO Search Warrant", "Signed in crayon. Enforced in person.", "Ignore all Locks on this Threat for this fight.", [{ kind: "ignoreLock" }]),
];

export const cardSetV0: CardSet = { id: "ruglife-v0", version: "0.2.0", cards };
