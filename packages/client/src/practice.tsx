// Practice: the first three minutes (rules § 11). A real engine game in the browser against two bots, with a coach.
// Everything here is labelled practice: it writes no record and moves no money. Skippable, replayable.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Action, GameConfig, SeqEvent, View } from "@ruglife/protocol";
import { apply, botAction, createGame, DEFAULT_CARD_SET, viewFor, type GameState } from "@ruglife/engine";
import { cardSetV0, tokenById, tokens } from "@ruglife/cards";
const hasLock = (defId: string): boolean => (cardSetV0.cards.find((c) => c.id === defId)?.lock?.length ?? 0) > 0;
import { newsLines, type NewsLine } from "./news.js";
import { TablePane, whoActs } from "./table.js";
import { ROLE_INFO, roleLabel } from "./cards.js";
import { useNet } from "./net.js";

const ME = 0;
const BOT_DELAY = 650;

/** The locked Threat the learner will lack the role for, and the bot that has it. */
function plan(learnerRole: string): { helperRole: "hacker" | "face" | "sob"; locked: string } {
  if (learnerRole !== "hacker") return { helperRole: "hacker", locked: "t06" };
  return { helperRole: "face", locked: "t21" };
}
function pickToken(role: string, not: Set<number>): number {
  return tokens.tokens.find((t) => t.role === role && !not.has(t.tokenId))!.tokenId;
}
/** Stacks the deal so the script can happen: an easy Threat on top; the locked Threat, a boss, a +3, a level-up and a gear in the learner's hand. */
function stack(s: GameState, locked: string): GameState {
  const st = structuredClone(s);
  const me = st.seats.find((x) => x.seat === ME)!;
  const where = (inst: string): { arr: string[]; i: number } | null => {
    const piles: string[][] = [st.decks.trouble, st.decks.loot, st.decks.troubleDiscard, st.decks.lootDiscard, ...st.seats.map((x) => x.hand)];
    for (const arr of piles) { const i = arr.indexOf(inst); if (i >= 0) return { arr, i }; }
    return null;
  };
  const swapIntoHand = (inst: string, deck: "trouble" | "loot"): void => {
    if (me.hand.includes(inst)) return;
    const w = where(inst);
    if (!w) return;
    const mine = me.hand.findIndex((c) => (deck === "trouble" ? st.decks.trouble : st.decks.loot).includes(c) === false && st.cards[c]!.def !== locked && !["b01#1", "s01#1", "l01#1", "g07#1"].includes(c) && (st.cards[c]!.def.startsWith("t") || st.cards[c]!.def.startsWith("f") || st.cards[c]!.def.startsWith("bo")) === (deck === "trouble"));
    if (mine < 0) return;
    const out = me.hand[mine]!;
    me.hand[mine] = inst;
    w.arr[w.i] = out;
  };
  swapIntoHand(`${locked}#1`, "trouble");
  swapIntoHand("b01#1", "trouble");
  swapIntoHand("s01#1", "loot");
  swapIntoHand("l01#1", "loot");
  swapIntoHand("g07#1", "loot");
  // the easy Threat on top of Trouble (the top is the end of the array)
  const easy = where("t01#1");
  if (easy && easy.arr === st.decks.trouble) { easy.arr.splice(easy.i, 1); st.decks.trouble.push("t01#1"); }
  else if (easy) { const top = st.decks.trouble.pop(); if (top) { easy.arr[easy.i] = top; st.decks.trouble.push("t01#1"); } }
  return st;
}

interface Milestones { fought: boolean; locked: boolean; helped: boolean; rugSeen: boolean; jeet: boolean; free: boolean; over: boolean }

export function Practice() {
  const net = useNet();
  const picked = useMemo<number | null>(() => { try { const v = localStorage.getItem("ruglife.chog"); return v ? Number(v) : null; } catch { return null; } }, []);
  const [run, setRun] = useState(0);
  const learnerToken = picked !== null && tokenById(picked) ? picked : pickToken("face", new Set());
  const learner = tokenById(learnerToken)!;
  const learnerRole = learner.role === "legend" ? "face" : learner.role;
  const p = useMemo(() => plan(learnerRole), [learnerRole]);
  const config = useMemo<GameConfig>(() => {
    const not = new Set([learnerToken]);
    const bot1 = pickToken(p.helperRole, not); not.add(bot1);
    const bot2 = pickToken(learnerRole === "muscle" ? "lookout" : "muscle", not);
    return { tableId: `practice-${run}`, mode: "standard", seed: `practice-${learnerToken}-${run}-${Date.now()}`, cardSetId: DEFAULT_CARD_SET, seats: [{ seat: ME, kind: picked !== null ? "chog" : "loaner", tokenId: learnerToken, label: "you (practice)" }, { seat: 1, kind: "bot", tokenId: bot1, label: "bot" }, { seat: 2, kind: "bot", tokenId: bot2, label: "bot" }] };
  }, [learnerToken, run, p.helperRole, learnerRole, picked]);
  const [state, setState] = useState<GameState>(() => start(config, p.locked));
  const [news, setNews] = useState<NewsLine[]>([]);
  const [at, setAt] = useState(Date.now());
  const [ms, setMs] = useState<Milestones>({ fought: false, locked: false, helped: false, rugSeen: false, jeet: false, free: false, over: false });
  const lastEvents = useRef<SeqEvent[]>([]);
  useEffect(() => { setState(start(config, p.locked)); setNews([]); setMs({ fought: false, locked: false, helped: false, rugSeen: false, jeet: false, free: false, over: false }); lastEvents.current = []; }, [config, p.locked]);

  const view = useMemo(() => viewFor(state, ME), [state]);
  const step = (a: Action): void => {
    try {
      const r = apply(state, a);
      lastEvents.current = r.events;
      setState(r.state);
      setAt(Date.now());
      setNews((n) => [...n, ...newsLines(viewFor(r.state, ME), r.events)].slice(-120));
      setMs((m) => milestones(m, r.events, a, ME, p.locked));
    } catch (e) { alert((e as Error).message); }
  };
  // bots act after a beat, so the ticker reads like a broadcast
  useEffect(() => {
    if (state.phase === "over") return;
    const who = whoActs(view);
    const bot = who.find((s) => s !== ME);
    if (bot === undefined || who.includes(ME) && view.prompt === null) return;
    if (who.includes(ME) && view.prompt && view.prompt.seats.includes(ME)) return;
    const t = setTimeout(() => step(botAction(state, bot)), BOT_DELAY);
    return () => clearTimeout(t);
  }, [state]);

  const coach = <Coach view={view} ms={ms} learnerRole={learnerRole} helperRole={p.helperRole} locked={p.locked} onRestart={() => setRun((r) => r + 1)} />;
  return <TablePane view={view} info={{ id: config.tableId, name: "Practice table", mode: "standard", status: state.phase === "over" ? "over" : "playing", host: "", seats: [], maxSeats: 3, timers: false, createdAt: 0 }} news={news} at={at} onAct={step} address={net.address} practice coach={coach} />;
}

function start(config: GameConfig, locked: string): GameState {
  let s = createGame(config);
  const pr = s.prompt;
  if (pr) { // a Legend as a loaner would need a pick; practice picks for it
    for (const seat of pr.seats) { const a = (pr.kind === "pickRole" ? { type: "PICK_ROLE", seat, role: "face" } : { type: "PICK_SKIN", seat, skin: "pink" }) as Action; s = apply(s, a).state; }
  }
  s = apply(s, { type: "START_GAME", seat: ME }).state;
  return stack(s, locked);
}
function milestones(m: Milestones, events: SeqEvent[], a: Action, me: number, locked: string): Milestones {
  const n = { ...m };
  for (const { ev } of events) {
    if (ev.t === "FightStarted" && ev.fighter === me) { n.fought = true; if (ev.def === locked || hasLock(ev.def)) n.locked = true; }
    if (ev.t === "HelpAgreed") n.helped = true;
    if (ev.t === "RugResolved" || ev.t === "BagTorn") n.rugSeen = true;
    if (ev.t === "JeetRolled" && ev.seat === me) n.jeet = true;
    if (ev.t === "GameOver") n.over = true;
  }
  if (a.seat === me && (a.type === "EQUIP" || a.type === "SELL" || (a.type === "PLAY"))) n.free = true;
  return n;
}

function Coach({ view, ms, learnerRole, helperRole, locked, onRestart }: { view: View; ms: Milestones; learnerRole: string; helperRole: string; locked: string; onRestart: () => void }) {
  const me = view.seats.find((s) => s.seat === ME)!;
  const bot1 = view.seats.find((s) => s.seat === 1)!;
  const f = view.fight;
  const myHand = me.hand ?? [];
  const lockedInHand = myHand.find((c) => c.def.id === locked);
  const bossInHand = myHand.find((c) => c.def.id === "b01");
  let title = "", body: React.ReactNode = null;
  if (view.phase === "over") { title = ms.over && view.winner === ME ? "GLOBAL ALERT. That was you." : "Game over."; body = <>The real thing is the same game with a clock, a record and, at event tables, a pot. <a href="#/">Sit at a real table →</a></>; }
  else if (view.prompt && view.prompt.seats.includes(ME)) {
    if (view.prompt.kind === "rug") { title = "Your Rug"; body = <>You hold one Rug a game. Keep it and the deal stands. Pull it and, if nobody else does, every bag and every level of this fight is yours. Two pulls tear the bag. At a real table a pulled Rug is written on your Chog's record for ever.</>; }
    else if (view.prompt.kind === "answerHelp") { title = "A bot wants help"; body = <>Helping is a cut of the bags, now. Say yes if the cut is worth the risk: if the fight is lost you roll to jeet too.</>; }
    else if (view.prompt.kind === "airdrop") { title = "Airdrop"; body = <>Over 6 cards at the end of your turn, the extras drop to the lowest-level player. Keep the ones that win fights.</>; }
    else { title = "Your call"; body = <>Choose.</>; }
  }
  else if (f && f.fighter === ME && view.phase === "fight.setup") {
    const lockedNow = f.threat.def.lock?.length && !f.power.lockOpen;
    if (lockedNow) {
      const lock = f.threat.def.lock!;
      const candidate = view.seats.find((s) => s.seat !== ME && !s.rekt && s.playRole !== null && lock.includes(s.playRole));
      const key = myHand.find((c) => c.def.effects.some((e) => e.kind === "ignoreLock" || (e.kind === "countAs" && lock.includes(e.role))));
      title = "LOCKED";
      body = <>This Threat gets <b>+{f.power.lockPenalty}</b> unless a <b>{lock.map(roleLabel).join(" + ")}</b> is on your side. You are a {roleLabel(learnerRole as never)}.{" "}
        {candidate ? <><b>{candidate.chog.name}</b> is a {roleLabel(candidate.playRole)}. Click <b>Ask for help</b> and offer a cut: one bag is usually enough. Levels stay with you.</> : key ? <>Nobody free at this table has it, but <b>{key.def.name}</b> in your hand opens it: click the card.</> : <>Nobody free at this table has it and you hold no Key: the +{f.power.lockPenalty} stands. Fight anyway, or play safe.</>}</>;
    }
    else if (f.power.fighter > f.power.threat) { title = "You are the fighter"; body = <>Your power is <b>{f.power.fighter}</b> (level {me.level} + kit 3{me.gear.length ? " + gear" : ""}) against <b>{f.power.threat}</b>. You win on the numbers. Click <b>Fight!</b> and watch the others pile on.</>; }
    else { title = "Too strong for you alone"; body = <>Power {f.power.fighter} against {f.power.threat}. Ask for help, play a +N card, or fight and roll to jeet if you lose (5 or more on a d6{learnerRole === "lookout" ? ", +2 for a Lookout" : ""}).</>; }
  }
  else if (f && view.phase === "fight.pileOn") {
    title = f.priority === ME ? "Pile-on: your priority" : "Pile-on";
    body = f.priority === ME ? <>Everyone may pile on, for or against. Play a one-shot on either side, a Boost on the threat, or <b>Pass</b>. The fight resolves after everyone passes in a row.</> : <>The bots get their say. A Boost makes the Threat stronger; a one-shot can go on either side.</>;
  }
  else if (f && f.fighter !== ME && view.phase === "fight.setup") { title = `${view.seats.find((s) => s.seat === f.fighter)!.chog.name} is fighting`; body = <>Watch the numbers. If it asks you for help, you get a cut.</>; }
  else if (view.phase === "turn.start" && view.turn?.seat === ME) {
    if (!ms.fought) { title = `You are ${me.chog.name}, a ${roleLabel(me.playRole)}`; body = <><div>{ROLE_INFO[me.playRole ?? "face"].perk}</div><div style={{ marginTop: 6 }}>Your kit is worth +3 always. Level 1. Click <b>Start trouble</b> to flip the top Trouble card.</div></>; }
    else { title = "Your turn"; body = <>Start trouble: flip a card. A Threat means a fight; FUD hits you; anything else goes to your hand.</>; }
  }
  else if (view.phase === "turn.free" && view.turn?.seat === ME) {
    if (lockedInHand && !ms.locked) { title = "A Threat in your hand"; body = <><b>{lockedInHand.def.name}</b> is locked for a {roleLabel(lockedInHand.def.lock![0]!)}. Click it and <b>Look for trouble</b>: you will need {bot1.chog.name}.</>; }
    else if (bossInHand && ms.locked && !ms.jeet) { title = "A boss in your hand"; body = <><b>{bossInHand.def.name}</b> is a boss: two levels, but far too strong. Fight it to learn the jeet roll (nothing is recorded here), or play safe: equip gear, grab a bag, end the turn. Your choice.</>; }
    else { title = "Free play"; body = <>Equip gear from your hand, sell 1,000 notes of gear for a level, trade, look for trouble from your hand or grab a bag, then end the turn.</>; }
  }
  else if (view.turn && view.turn.seat !== ME) { title = `${view.seats.find((s) => s.seat === view.turn!.seat)!.chog.name}'s turn`; body = <>Bots play fast. Watch the news ticker on the right.</>; }
  const tick = (b: boolean, t: string) => <span style={{ marginRight: 8, opacity: b ? 1 : 0.45 }}>{b ? "☑" : "☐"} {t}</span>;
  return (
    <div className="coach">
      <div className="row" style={{ justifyContent: "space-between" }}><span className="stamp practice">PRACTICE</span><span className="row"><button className="btn small ghost" onClick={onRestart}>Restart</button><a className="btn small" href="#/">Skip to the tables</a></span></div>
      <h3 style={{ marginTop: 6 }}>{title}</h3>
      <div>{body}</div>
      <div className="step" style={{ marginTop: 8 }}>{tick(ms.fought, "a fight")}{tick(ms.locked, "a Lock")}{tick(ms.helped, "a helper")}{tick(ms.rugSeen, "a Rug")}{tick(ms.jeet, "a jeet")}{tick(ms.free, "a free choice")}</div>
      <div className="step">Helper bot: {bot1.chog.name} ({roleLabel(helperRole as never)}). Nothing here is recorded or paid.</div>
    </div>
  );
}
