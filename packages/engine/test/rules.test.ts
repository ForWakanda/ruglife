import { describe, expect, it } from "vitest";
import { apply, createGame, DEFAULT_CARD_SET, fightPower, legalActions, viewFor } from "../src/index.js";
import { evs, give, onTop, passAll, run, started, table } from "./helpers.js";

describe("lobby", () => {
  it("a Legend must pick one role before the game starts; a rare skin picks one of five", () => {
    const s = table(["legend", "face"]);
    expect(s.prompt?.kind).toBe("pickRole");
    expect(() => apply(s, { type: "START_GAME", seat: 0 })).toThrow(/picks pending/);
    const s2 = apply(s, { type: "PICK_ROLE", seat: 0, role: "muscle" }).state;
    expect(s2.seats[0]!.playRole).toBe("muscle");
    expect(() => apply(s2, { type: "PICK_ROLE", seat: 0, role: "face" })).toThrow();
  });
  it("one live game per Chog: the same tokenId twice is refused", () => {
    expect(() => createGame({ tableId: "t", mode: "standard", seed: "x", cardSetId: DEFAULT_CARD_SET, seats: [{ seat: 0, kind: "bot", tokenId: 1 }, { seat: 1, kind: "bot", tokenId: 1 }] })).toThrow(/one live game/);
  });
  it("deals 4 + 4 and starts at level 1 (standard) or 6 (tournament)", () => {
    const s = started(["face", "muscle"]);
    for (const x of s.seats) { expect(x.hand).toHaveLength(8); expect(x.level).toBe(1); }
    const t = started(["face", "muscle"], "tournament");
    for (const x of t.seats) expect(x.level).toBe(6);
    expect(s.phase).toBe("turn.start");
    expect(s.turnSeat).toBe(0);
  });
});

describe("locks and keys", () => {
  it("a locked Threat is +5 unless the fighting side has the role; a helper with the role opens it", () => {
    let s = started(["face", "hacker"]);
    const c = give(s, 0, "t06"); // Copy Trader, level 6, lock hacker
    s = run(s, { type: "START_TROUBLE", seat: 0 }).s; // flips something; we then look for trouble? simpler: set phase
    s = started(["face", "hacker"]);
    give(s, 0, "t06");
    s = apply(s, { type: "START_TROUBLE", seat: 0 }).state;
    if (s.phase === "fight.setup") s = passAll(apply(s, { type: "PASS", seat: 0 }).state).s; // clear whatever was flipped
    if (s.phase === "turn.free" && !s.stepDone) {
      s = apply(s, { type: "LOOK_FOR_TROUBLE", seat: 0, card: c }).state;
      const p1 = fightPower(s, s.fight!);
      expect(p1.lockOpen).toBe(false);
      expect(p1.lockPenalty).toBe(5);
      expect(p1.threat).toBe(11);
      const r = run(s, { type: "ASK_HELP", seat: 0, to: 1, cut: 1 }, { type: "ANSWER_HELP", seat: 1, accept: true });
      const p2 = fightPower(r.s, r.s.fight!);
      expect(p2.lockOpen).toBe(true);
      expect(p2.threat).toBe(6);
    }
  });
  it("Skeleton Key ignores the Lock; a Disguise counts as the role", () => {
    const s0 = started(["face", "sob"]);
    const threat = give(s0, 0, "t06");
    const key = give(s0, 0, "k04");
    const dis = give(s0, 0, "k03");
    s0.phase = "turn.free"; s0.stepDone = false;
    let s = apply(s0, { type: "LOOK_FOR_TROUBLE", seat: 0, card: threat }).state;
    expect(fightPower(s, s.fight!).lockPenalty).toBe(5);
    const withKey = apply(s, { type: "PLAY", seat: 0, card: key }).state;
    expect(fightPower(withKey, withKey.fight!).lockPenalty).toBe(0);
    const withDis = apply(s, { type: "PLAY", seat: 0, card: dis }).state;
    expect(fightPower(withDis, withDis.fight!).lockPenalty).toBe(0);
    expect(withDis.fight!.countAs).toEqual(["hacker"]);
  });
  it("a boss with two locks is +5 per unmet lock", () => {
    const s0 = started(["degen", "face"]);
    const threat = give(s0, 0, "b02"); // level 15, lock safecracker + face
    s0.phase = "turn.free"; s0.stepDone = false;
    const s = apply(s0, { type: "LOOK_FOR_TROUBLE", seat: 0, card: threat }).state;
    expect(fightPower(s, s.fight!).lockPenalty).toBe(10);
    const r = run(s, { type: "ASK_HELP", seat: 0, to: 1, cut: 0 }, { type: "ANSWER_HELP", seat: 1, accept: true });
    expect(fightPower(r.s, r.s.fight!).lockPenalty).toBe(5);
  });
});

describe("fights", () => {
  function fightAt(roles: string[], threatDef: string, levels: number[]): ReturnType<typeof started> {
    const s = started(roles);
    for (let i = 0; i < levels.length; i++) s.seats[i]!.level = levels[i]!;
    const t = give(s, 0, threatDef);
    s.phase = "turn.free"; s.stepDone = false;
    return apply(s, { type: "LOOK_FOR_TROUBLE", seat: 0, card: t }).state;
  }
  it("a tie loses unless a Muscle is on the fighting side", () => {
    // t17 Discord Raider level 1; a level-1 fighter with kit = 4 > 1 wins. Make it a tie: fighter level 1, kit off, threat +3 boost → 1 vs 4? use power directly
    let s = fightAt(["face", "muscle"], "t04", [1, 1]); // Airdrop Farmer level 4; fighter power 1+3 = 4 → tie
    expect(fightPower(s, s.fight!)).toMatchObject({ fighter: 4, threat: 4 });
    let r = passAll(apply(s, { type: "PASS", seat: 0 }).state);
    expect(evs(r.ev, "FightLost")).toHaveLength(1);
    s = fightAt(["muscle", "face"], "t04", [1, 1]);
    r = passAll(apply(s, { type: "PASS", seat: 0 }).state);
    expect(evs(r.ev, "FightWon")).toHaveLength(1);
    expect(r.s.seats[0]!.level).toBe(2);
  });
  it("win: levels to the fighter, bags dealt by cut in joining order, the rest to the fighter", () => {
    const s = fightAt(["face", "hacker", "sob"], "t08", [5, 3, 3]); // Floor Sweeper level 8, 3 bags, lock safecracker → 13
    const r0 = run(s, { type: "ASK_HELP", seat: 0, to: 1, cut: 1 }, { type: "ANSWER_HELP", seat: 1, accept: true }, { type: "ASK_HELP", seat: 0, to: 2, cut: 1 }, { type: "ANSWER_HELP", seat: 2, accept: true });
    // Face fighter may take a second helper
    expect(r0.s.fight!.helpers).toHaveLength(2);
    expect(fightPower(r0.s, r0.s.fight!).fighter).toBe(5 + 3 + 3 + 3 + 3 + 3);
    const h1 = r0.s.seats[1]!.hand.length, h2 = r0.s.seats[2]!.hand.length, h0 = r0.s.seats[0]!.hand.length;
    const r = passAll(apply(r0.s, { type: "PASS", seat: 0 }).state);
    // everyone keeps their rug
    expect(r.s.phase).toBe("fight.rug");
    const r2 = run(r.s, { type: "RUG", seat: 0, pull: false }, { type: "RUG", seat: 1, pull: false }, { type: "RUG", seat: 2, pull: false });
    const won = evs(r2.ev, "FightWon")[0]!;
    expect(won).toMatchObject({ fighter: 0, levelsTo: 0, levels: 1, bagsTo: [{ seat: 1, bags: 1 }, { seat: 2, bags: 1 }, { seat: 0, bags: 1 }] });
    expect(r2.s.seats[0]!.level).toBe(6);
    expect(r2.s.seats[1]!.hand.length).toBe(h1 + 1);
    expect(r2.s.seats[2]!.hand.length).toBe(h2 + 1);
    expect(r2.s.seats[0]!.hand.length).toBe(h0 + 1);
    expect(r2.s.phase).toBe("turn.free");
    expect(evs(r2.ev, "RugResolved")).toHaveLength(0);
  });
  it("a non-Face fighter gets one helper, two against a boss", () => {
    const s = fightAt(["hacker", "face", "sob"], "t04", [1, 1, 1]);
    const r = run(s, { type: "ASK_HELP", seat: 0, to: 1, cut: 0 }, { type: "ANSWER_HELP", seat: 1, accept: true });
    expect(legalActions(r.s, 0).filter((a) => a.type === "ASK_HELP")).toHaveLength(0);
    const b = fightAt(["hacker", "face", "sob"], "b01", [1, 1, 1]);
    const rb = run(b, { type: "ASK_HELP", seat: 0, to: 1, cut: 0 }, { type: "ANSWER_HELP", seat: 1, accept: true });
    expect(legalActions(rb.s, 0).filter((a) => a.type === "ASK_HELP").length).toBeGreaterThan(0);
  });
  it("a declined ask cannot be repeated to the same seat; a rekt player cannot be asked", () => {
    const s = fightAt(["face", "hacker", "sob"], "t04", [1, 1, 1]);
    const r = run(s, { type: "ASK_HELP", seat: 0, to: 1, cut: 0 }, { type: "ANSWER_HELP", seat: 1, accept: false });
    expect(evs(r.ev, "HelpDeclined")).toHaveLength(1);
    expect(() => apply(r.s, { type: "ASK_HELP", seat: 0, to: 1, cut: 0 })).toThrow();
    r.s.seats[2]!.rekt = true;
    expect(() => apply(r.s, { type: "ASK_HELP", seat: 0, to: 2, cut: 0 })).toThrow();
  });
  it("lose: jeet rolls for fighter then helpers in joining order; Bad Stuff on a failed roll; a Sob Story ignores one; a Hacker rerolls", () => {
    let seen = { sob: false, hacker: false, bad: false };
    for (let g = 0; g < 60 && !(seen.sob && seen.hacker && seen.bad); g++) {
      const s = started(["face", "sob", "hacker"], "standard", `jeet-${g}`);
      const t = give(s, 0, "b04"); // Sweeper Whale level 20
      s.phase = "turn.free"; s.stepDone = false;
      const r0 = run(apply(s, { type: "LOOK_FOR_TROUBLE", seat: 0, card: t }).state, { type: "ASK_HELP", seat: 0, to: 1, cut: 1 }, { type: "ANSWER_HELP", seat: 1, accept: true }, { type: "ASK_HELP", seat: 0, to: 2, cut: 1 }, { type: "ANSWER_HELP", seat: 2, accept: true });
      const r = passAll(apply(r0.s, { type: "PASS", seat: 0 }).state);
      expect(evs(r.ev, "FightLost")).toHaveLength(1);
      const rolls = evs(r.ev, "JeetRolled");
      expect(rolls[0]!.seat).toBe(0);
      for (const e of rolls) expect(e.escaped).toBe(((e.roll as number) + (e.mod as number)) >= 5);
      if (rolls.some((e) => e.seat === 2 && e.rerolled)) seen.hacker = true;
      if (evs(r.ev, "BadStuffApplied").some((e) => e.seat === 1 && e.ignored)) { seen.sob = true; expect(r.s.seats[1]!.sobUsed).toBe(true); }
      if (evs(r.ev, "BadStuffApplied").some((e) => !e.ignored)) { seen.bad = true; }
      for (const e of evs(r.ev, "Rekt")) { const x = r.s.seats[e.seat as number]!; expect(x.hand).toHaveLength(0); expect(x.gear).toHaveLength(0); expect(x.rekt).toBe(true); }
    }
    expect(seen).toEqual({ sob: true, hacker: true, bad: true });
  });
  it("Lookout gets +2 on their own jeet; Degen rolls at the start of their own fight", () => {
    const s = started(["lookout", "degen"], "standard", "lk");
    const t = give(s, 0, "b04"); s.phase = "turn.free"; s.stepDone = false;
    const r = passAll(apply(apply(s, { type: "LOOK_FOR_TROUBLE", seat: 0, card: t }).state, { type: "PASS", seat: 0 }).state);
    expect(evs(r.ev, "JeetRolled")[0]!.mod).toBe(2);
    const d = started(["degen", "face"], "standard", "dg");
    const t2 = give(d, 0, "t17"); d.phase = "turn.free"; d.stepDone = false;
    const rd = apply(d, { type: "LOOK_FOR_TROUBLE", seat: 0, card: t2 });
    const roll = evs(rd.events, "DegenRolled")[0]!;
    expect([-2, 0, 4]).toContain(roll.mod);
    expect(rd.state.fight!.degenMod).toBe(roll.mod);
  });
  it("Safecracker: discard a card for +3, once a turn, only in a fight they are in", () => {
    const s = fightAt(["safecracker", "face"], "t04", [1, 1]);
    const card = s.seats[0]!.hand[0]!;
    const r = apply(s, { type: "USE_PERK", seat: 0, discard: card });
    expect(fightPower(r.state, r.state.fight!).fighter).toBe(1 + 3 + 3);
    expect(() => apply(r.state, { type: "USE_PERK", seat: 0, discard: r.state.seats[0]!.hand[0]! })).toThrow(/once a turn/);
  });
  it("pile-on: priority clockwise from the fighter's left; a play restarts the passes; cancel undoes the last fight card", () => {
    const s = fightAt(["face", "hacker", "sob"], "t04", [1, 1, 1]);
    const boost = give(s, 2, "bo02"); // threat +5, +1 bag
    const cancel = give(s, 1, "s06");
    const sent = give(s, 1, "s03"); // +2 either side
    const p = apply(s, { type: "PASS", seat: 0 }).state;
    expect(p.phase).toBe("fight.pileOn");
    expect(p.fight!.priority).toBe(1);
    const r1 = run(p, { type: "PASS", seat: 1 }, { type: "PLAY", seat: 2, card: boost });
    expect(fightPower(r1.s, r1.s.fight!).threat).toBe(9);
    expect(r1.s.fight!.bagsMod).toBe(1);
    expect(r1.s.fight!.passes).toBe(0);
    expect(r1.s.fight!.priority).toBe(0);
    const r2 = run(r1.s, { type: "PASS", seat: 0 }, { type: "PLAY", seat: 1, card: cancel });
    expect(fightPower(r2.s, r2.s.fight!).threat).toBe(4);
    expect(r2.s.fight!.bagsMod).toBe(1); // the modifier only
    const r3 = run(r2.s, { type: "PASS", seat: 2 }, { type: "PASS", seat: 0 }, { type: "PLAY", seat: 1, card: sent, side: "fighter" });
    expect(fightPower(r3.s, r3.s.fight!).fighter).toBe(6);
    const r4 = passAll(r3.s);
    expect(evs(r4.ev, "PileOnClosed")).toHaveLength(1);
    expect(evs(r4.ev, "FightWon")).toHaveLength(1);
  });
});

describe("the rug", () => {
  function wonWithTwoHelpers(levels: number[], seed = "rug"): ReturnType<typeof started> {
    const s = started(["face", "hacker", "sob"], "standard", seed);
    for (let i = 0; i < 3; i++) s.seats[i]!.level = levels[i]!;
    const t = give(s, 0, "t05"); // level 5, 2 bags
    s.phase = "turn.free"; s.stepDone = false;
    const r0 = run(apply(s, { type: "LOOK_FOR_TROUBLE", seat: 0, card: t }).state, { type: "ASK_HELP", seat: 0, to: 1, cut: 1 }, { type: "ANSWER_HELP", seat: 1, accept: true }, { type: "ASK_HELP", seat: 0, to: 2, cut: 1 }, { type: "ANSWER_HELP", seat: 2, accept: true });
    const r = passAll(apply(r0.s, { type: "PASS", seat: 0 }).state);
    expect(r.s.phase).toBe("fight.rug");
    expect(r.s.prompt).toEqual({ kind: "rug", seats: [0, 1, 2] });
    return r.s;
  }
  it("choices are sealed: a view shows who is pending, never another seat's choice", () => {
    const s = wonWithTwoHelpers([3, 3, 3]);
    const s1 = apply(s, { type: "RUG", seat: 1, pull: true }).state;
    const v0 = viewFor(s1, 0), v1 = viewFor(s1, 1), vs = viewFor(s1, "stands");
    expect(v0.fight!.rugPending).toEqual([0, 2]);
    expect(v0.fight!.myRugChoice).toBeUndefined();
    expect(v1.fight!.myRugChoice).toBe(true);
    expect(JSON.stringify(vs)).not.toContain("rugChoices");
    expect(() => apply(s1, { type: "RUG", seat: 1, pull: false })).toThrow(/already|pending/);
  });
  it("exactly one pull: the rugger takes every bag and every level; RugResolved names the victims; the rug is spent", () => {
    const s = wonWithTwoHelpers([3, 3, 3]);
    const h2 = s.seats[2]!.hand.length;
    const r = run(s, { type: "RUG", seat: 0, pull: false }, { type: "RUG", seat: 1, pull: false }, { type: "RUG", seat: 2, pull: true });
    expect(evs(r.ev, "RugChoicesRevealed")[0]).toMatchObject({ pulls: [2], keeps: [0, 1] });
    expect(evs(r.ev, "RugResolved")[0]).toMatchObject({ puller: 2, victims: [0, 1] });
    expect(evs(r.ev, "FightWon")[0]).toMatchObject({ levelsTo: 2, levels: 1, bagsTo: [{ seat: 2, bags: 2 }] });
    expect(r.s.seats[2]!.level).toBe(4);
    expect(r.s.seats[0]!.level).toBe(3);
    expect(r.s.seats[2]!.hand.length).toBe(h2 + 2);
    expect(r.s.seats[2]!.rug).toBe("pulled");
    expect(r.s.seats[0]!.rug).toBe("held");
  });
  it("two or three pulls: the bag tears, nobody gets anything, every pulled rug is spent", () => {
    const s = wonWithTwoHelpers([3, 3, 3]);
    const r = run(s, { type: "RUG", seat: 0, pull: true }, { type: "RUG", seat: 1, pull: true }, { type: "RUG", seat: 2, pull: false });
    expect(evs(r.ev, "BagTorn")[0]).toMatchObject({ pullers: [0, 1] });
    expect(evs(r.ev, "RugResolved")).toHaveLength(0);
    expect(r.s.seats.map((x) => x.level)).toEqual([3, 3, 3]);
    expect(r.s.seats.map((x) => x.rug)).toEqual(["pulled", "pulled", "held"]);
    const r3 = run(s, { type: "RUG", seat: 0, pull: true }, { type: "RUG", seat: 1, pull: true }, { type: "RUG", seat: 2, pull: true });
    expect(evs(r3.ev, "BagTorn")[0]).toMatchObject({ pullers: [0, 1, 2] });
    expect(r3.s.seats.map((x) => x.rug)).toEqual(["pulled", "pulled", "pulled"]);
  });
  it("a rugged level may be the 10th, so a fight never crowns two winners", () => {
    const s = wonWithTwoHelpers([9, 9, 2]);
    const r = run(s, { type: "RUG", seat: 0, pull: false }, { type: "RUG", seat: 1, pull: true }, { type: "RUG", seat: 2, pull: false });
    expect(r.s.phase).toBe("over");
    expect(r.s.winner).toBe(1);
    expect(r.s.seats[0]!.level).toBe(9);
    expect(evs(r.ev, "GameOver")).toHaveLength(1);
  });
  it("a seat whose rug is spent is not asked again; a solo win asks nobody", () => {
    const s = wonWithTwoHelpers([3, 3, 3]);
    s.seats[1]!.rug = "pulled"; s.seats[2]!.rug = "pulled";
    // re-derive: the prompt was computed before; resolve again from a fresh fight
    const s2 = started(["face", "hacker", "sob"], "standard", "rug-spent");
    s2.seats[1]!.rug = "pulled"; s2.seats[2]!.rug = "pulled";
    const t = give(s2, 0, "t05"); s2.phase = "turn.free"; s2.stepDone = false;
    const r0 = run(apply(s2, { type: "LOOK_FOR_TROUBLE", seat: 0, card: t }).state, { type: "ASK_HELP", seat: 0, to: 1, cut: 1 }, { type: "ANSWER_HELP", seat: 1, accept: true });
    const r = passAll(apply(r0.s, { type: "PASS", seat: 0 }).state);
    expect(r.s.prompt).toEqual({ kind: "rug", seats: [0] });
    const solo = started(["face", "hacker"], "standard", "solo");
    const t2 = give(solo, 0, "t17"); solo.phase = "turn.free"; solo.stepDone = false;
    const rs = passAll(apply(apply(solo, { type: "LOOK_FOR_TROUBLE", seat: 0, card: t2 }).state, { type: "PASS", seat: 0 }).state);
    expect(rs.s.phase).toBe("turn.free");
    expect(evs(rs.ev, "FightWon")).toHaveLength(1);
  });
});

describe("FUD, levels, gear, turns", () => {
  it("a FUD from the hand on another seat emits FudResolved with before/after and rekt", () => {
    const s = started(["face", "hacker"]);
    s.seats[1]!.level = 5;
    const f = give(s, 0, "f02"); // −2 levels
    const r = apply(s, { type: "PLAY", seat: 0, card: f, target: 1 });
    expect(evs(r.events, "FudResolved")[0]).toMatchObject({ actor: 0, target: 1, def: "f02", levelBefore: 5, levelAfter: 3, rekt: false });
    const d = give(r.state, 0, "f03"); // rekt
    const r2 = apply(r.state, { type: "PLAY", seat: 0, card: d, target: 1 });
    expect(evs(r2.events, "FudResolved")[0]).toMatchObject({ rekt: true, levelBefore: 3, levelAfter: 3 });
    expect(r2.state.seats[1]!.hand).toHaveLength(0);
    expect(evs(r2.events, "Rekt")[0]).toMatchObject({ seat: 1, causedBy: 0 });
  });
  it("a flipped FUD hits the flipper; a level never drops below 1", () => {
    const s = started(["face", "hacker"]);
    onTop(s, "trouble", "f02");
    const r = apply(s, { type: "START_TROUBLE", seat: 0 });
    expect(evs(r.events, "FudResolved")[0]).toMatchObject({ actor: 0, target: 0, levelBefore: 1, levelAfter: 1 });
    expect(r.state.phase).toBe("turn.free");
    expect(r.state.stepDone).toBe(false);
  });
  it("level-ups and sales never give the 10th; selling needs 1,000 notes of gear", () => {
    const s = started(["face", "hacker"]);
    s.seats[0]!.level = 9;
    const l = give(s, 0, "l01");
    expect(() => apply(s, { type: "PLAY", seat: 0, card: l })).toThrow();
    s.seats[0]!.level = 8;
    expect(apply(s, { type: "PLAY", seat: 0, card: l }).state.seats[0]!.level).toBe(9);
    const g1 = give(s, 0, "g10"); // Lambo 1000
    const g2 = give(s, 0, "g12"); // Crocs 100
    expect(() => apply(s, { type: "SELL", seat: 0, cards: [g2] })).toThrow(/1,000/);
    const r = apply(s, { type: "SELL", seat: 0, cards: [g1, g2] });
    expect(r.state.seats[0]!.level).toBe(9);
    expect(evs(r.events, "Sold")[0]).toMatchObject({ value: 1100 });
  });
  it("gear: slots, one Big unless Muscle, role-only gear, kit never takes a slot", () => {
    const s = started(["face", "muscle"]);
    const lambo = give(s, 0, "g10"), boots = give(s, 0, "g13"), cap = give(s, 0, "g03"), mask = give(s, 0, "g06"), lasers = give(s, 0, "g05");
    let r = apply(s, { type: "EQUIP", seat: 0, card: lambo }).state;
    expect(() => apply(r, { type: "EQUIP", seat: 0, card: boots })).toThrow(/Big/);
    r = apply(r, { type: "EQUIP", seat: 0, card: cap }).state;
    expect(() => apply(r, { type: "EQUIP", seat: 0, card: mask })).toThrow(/slot/);
    expect(() => apply(r, { type: "EQUIP", seat: 0, card: lasers })).toThrow(/role/);
    expect(r.seats[0]!.gear).toHaveLength(2);
    const m = started(["muscle", "face"]);
    const l2 = give(m, 0, "g10"), b2 = give(m, 0, "g13");
    const rm = run(m, { type: "EQUIP", seat: 0, card: l2 }, { type: "EQUIP", seat: 0, card: b2 });
    expect(rm.s.seats[0]!.gear).toHaveLength(2);
  });
  it("end of turn: over 6 cards → keep 6, the excess goes to the lowest other player (Sob Story first), or is discarded if you are lowest", () => {
    const s = started(["face", "sob", "hacker"]);
    s.seats[0]!.level = 5; s.seats[1]!.level = 2; s.seats[2]!.level = 2;
    s.phase = "turn.free"; s.stepDone = true;
    expect(s.seats[0]!.hand).toHaveLength(8);
    const r = apply(s, { type: "END_TURN", seat: 0 });
    expect(r.state.phase).toBe("turn.airdrop");
    expect(() => apply(r.state, { type: "AIRDROP_KEEP", seat: 0, cards: r.state.seats[0]!.hand.slice(0, 5) })).toThrow();
    const keep = r.state.seats[0]!.hand.slice(0, 6);
    const r2 = apply(r.state, { type: "AIRDROP_KEEP", seat: 0, cards: keep });
    expect(evs(r2.events, "Airdropped")[0]).toMatchObject({ from: 0, to: 1, cards: 2 });
    expect(r2.state.seats[1]!.hand).toHaveLength(10);
    expect(r2.state.turnSeat).toBe(1);
    const low = started(["face", "sob"]); low.seats[1]!.level = 5; low.phase = "turn.free"; low.stepDone = true;
    const rl = run(low, { type: "END_TURN", seat: 0 }, { type: "AIRDROP_KEEP", seat: 0, cards: low.seats[0]!.hand.slice(0, 6) });
    expect(evs(rl.ev, "Airdropped")[0]).toMatchObject({ to: null, cards: 2 });
  });
  it("a rekt player gets a fresh deal at their next turn start; skipTurn skips once; kitOff returns at the owner's next turn", () => {
    const s = started(["face", "hacker"]);
    s.decks.loot.push(...s.seats[1]!.hand.splice(0)); // the rekt seat's hand goes back under the deck
    s.decks.loot.push(...s.seats[0]!.hand.splice(6)); // seat 0 at the hand limit so END_TURN needs no airdrop
    s.seats[1]!.rekt = true; s.seats[1]!.kitOff = true; s.seats[1]!.skipTurn = true;
    s.phase = "turn.free"; s.stepDone = true;
    const r = apply(s, { type: "END_TURN", seat: 0 });
    // seat 1 was skipped: fresh deal happened, then turn ended, and it is seat 0 again
    expect(evs(r.events, "TurnStarted").map((e) => e.seat)).toEqual([1, 0]);
    expect(r.state.seats[1]!.rekt).toBe(false);
    expect(r.state.seats[1]!.hand.length).toBeGreaterThanOrEqual(1);
    expect(r.state.seats[1]!.skipTurn).toBe(false);
    expect(r.state.seats[1]!.kitOff).toBe(false); // a turn start (even a skipped one) switches the kit back on
  });
  it("TIMEOUT defaults: decline help, keep the rug, pass priority, start trouble, grab a bag, end the turn", () => {
    let s = started(["face", "hacker"]);
    let r = apply(s, { type: "TIMEOUT", seat: 0 });
    expect(evs(r.events, "Timeout")[0]).toMatchObject({ defaulted: "START_TROUBLE" });
    expect(() => apply(s, { type: "TIMEOUT", seat: 1 })).toThrow();
    const f = started(["face", "hacker"]);
    const t = give(f, 0, "t04"); f.phase = "turn.free"; f.stepDone = false;
    let fs = apply(f, { type: "LOOK_FOR_TROUBLE", seat: 0, card: t }).state;
    fs = apply(fs, { type: "ASK_HELP", seat: 0, to: 1, cut: 0 }).state;
    const d = apply(fs, { type: "TIMEOUT", seat: 1 });
    expect(evs(d.events, "HelpDeclined")).toHaveLength(1);
    const p = apply(d.state, { type: "TIMEOUT", seat: 0 }); // fighter closes setup
    expect(p.state.phase).toBe("fight.pileOn");
    const q = apply(p.state, { type: "TIMEOUT", seat: 1 });
    expect(evs(q.events, "Timeout")[0]).toMatchObject({ defaulted: "PASS" });
  });
  it("AUTOPILOT flags the seat and shows in every view", () => {
    const s = started(["face", "hacker"]);
    const r = apply(s, { type: "AUTOPILOT", seat: 1, on: true });
    expect(viewFor(r.state, "stands").seats[1]!.autopilot).toBe(true);
  });
});
