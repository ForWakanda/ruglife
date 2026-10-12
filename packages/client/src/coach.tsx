// The coach on a live table (on by default, dismissible) and the one-screen rules.
import { useState } from "react";
import type { SeatView, View } from "@ruglife/protocol";
import { ROLE_INFO, roleLabel } from "./cards.js";

const nameOf = (view: View, seat: number): string => view.seats.find((s) => s.seat === seat)?.chog.name ?? `seat ${seat}`;
const KEY = "ruglife.coach";
export const coachWanted = (): boolean => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
const setCoach = (on: boolean): void => { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private window */ } };

/** What to do now, keyed on the live view. Says nothing when it is not your moment. */
export function LiveCoach({ view, me, actors }: { view: View; me: SeatView | null; actors: number[] }) {
  const [on, setOn] = useState(coachWanted);
  const [rules, setRules] = useState(false);
  if (!me) return null;
  const f = view.fight;
  const mine = actors.includes(me.seat);
  let title = "", body: React.ReactNode = null;
  if (view.phase === "over") { title = ""; }
  else if (view.prompt && mine) {
    const k = view.prompt.kind;
    if (k === "rug") { title = "Your Rug, once a game"; body = <>Keep it and the deal stands. Pull it and, if nobody else pulls, every bag and every level of this fight is yours. Two pulls tear the bag: nobody gets anything. A pulled Rug goes on your Chog's record for ever.</>; }
    else if (k === "answerHelp") { title = "Help, for a cut"; body = <>Say yes and you get the offered bags if the fight is won. If it is lost, you roll to jeet too (5+ on a die) and eat the Bad Stuff on a miss.</>; }
    else if (k === "airdrop") { title = "Hand limit: six"; body = <>Keep the six that win fights. The rest drop to the lowest-level player.</>; }
    else { title = "Your call"; body = <>Pick one.</>; }
  }
  else if (f && f.fighter === me.seat && view.phase === "fight.setup") {
    const lock = f.threat.def.lock ?? [];
    if (lock.length && !f.power.lockOpen) {
      const helper = view.seats.find((s) => s.seat !== me.seat && !s.rekt && s.playRole !== null && lock.includes(s.playRole));
      title = "LOCKED";
      body = <>This Threat gets <b>+{f.power.lockPenalty}</b> unless a <b>{lock.map(roleLabel).join(" + ")}</b> is on your side. {helper ? <><b>{helper.chog.name}</b> has the role: <b>Ask for help</b> and offer a cut of the bags (one is usually enough). The levels stay yours.</> : <>Nobody free has the role: a Key card opens it, or fight it as is.</>}</>;
    }
    else if (f.power.fighter > f.power.threat) { title = "You win on the numbers"; body = <>Your power <b>{f.power.fighter}</b> (level + kit 3 + gear) beats <b>{f.power.threat}</b>. Click <b>Fight!</b>, then watch the pile-on: the others may play cards against you.</>; }
    else { title = "Too strong alone"; body = <>Power {f.power.fighter} against {f.power.threat}. <b>Ask for help</b>, play a +N card from your hand, or fight anyway and roll to jeet if you lose (5+ on a die{me.playRole === "lookout" ? ", +2 for a Lookout" : ""}).</>; }
  }
  else if (f && view.phase === "fight.pileOn" && mine) {
    title = "Your priority";
    body = <>Anyone may pile on: a one-shot on either side, a Boost on the Threat, or <b>Pass</b>. {f.fighter === me.seat ? "Your fight: play for yourself or pass." : `${nameOf(view, f.fighter)} is fighting: help them, or make the Threat stronger.`} The fight resolves after everyone passes in a row.</>;
  }
  else if (f && !mine) { title = `${nameOf(view, f.fighter)} is fighting`; body = <>Watch the two numbers. If they ask you for help, you get a cut of the bags.</>; }
  else if (view.phase === "turn.start" && mine) { title = `You are a ${roleLabel(me.playRole)}`; body = <><div>{ROLE_INFO[me.playRole ?? "face"].perk}</div><div style={{ marginTop: 4 }}>Click <b>Start trouble</b>: a Threat means a fight, FUD hits you, anything else goes to your hand.</div></>; }
  else if (view.phase === "turn.free" && mine) { title = "Free play"; body = <>Click a glowing card to equip or play it. Sell 1,000 notes of gear for a level. <b>Look for trouble</b> with a Threat from your hand, or <b>Grab a bag</b> (a face-down Trouble card). Then <b>End turn</b>.</>; }
  else if (view.turn && view.turn.seat !== me.seat) { title = `${nameOf(view, view.turn.seat)}'s turn`; body = <>The headline above tells you what they do. You get a say in every fight.</>; }
  const modal = rules ? <HowToPlay onClose={() => setRules(false)} /> : null;
  if (!on) return <>{modal}<div className="row" style={{ gap: 8 }}><button className="btn small ghost" onClick={() => { setCoach(true); setOn(true); }}>Coach on</button><button className="btn small ghost" onClick={() => setRules(true)}>How to play</button></div></>;
  if (!title) return <>{modal}<div className="row" style={{ gap: 8 }}><button className="btn small ghost" onClick={() => setRules(true)}>How to play</button></div></>;
  return (
    <>
      {modal}
      <div className="coachbox">
        <div className="row" style={{ justifyContent: "space-between" }}><span className="lower3">COACH · {title}</span><span className="row" style={{ gap: 6 }}><button className="btn small ghost" onClick={() => setRules(true)}>How to play</button><button className="btn small ghost" onClick={() => { setCoach(false); setOn(false); }}>Hide</button></span></div>
        <div className="step">{body}</div>
      </div>
    </>
  );
}

/** The rules on one screen. */
export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal rules" onClick={(e) => e.stopPropagation()}>
        <h2>How to play RUG LIFE</h2>
        <p><b>The goal.</b> First Chog to <b>level 10</b> controls the world. The 10th level must come from a fight you win, or one you rug.</p>
        <p><b>Your turn.</b> <b>Start trouble</b>: flip the top Trouble card. A <b>Threat</b> means a fight. <b>FUD</b> hits you (lose a level, lose gear, skip a turn…). Anything else goes to your hand. If you did not fight: <b>look for trouble</b> with a Threat from your hand, or <b>grab a bag</b> (a face-down Trouble card). Over six cards in hand at the end: an <b>airdrop</b> to the lowest player.</p>
        <p><b>A fight.</b> Your <b>power</b> = level + kit (+3, always) + gear + cards played. Beat the Threat's power and you win the <b>levels</b> and the <b>bags</b> (Loot cards). A tie loses, unless a Muscle is on your side. A <b>LOCKED</b> Threat is +5 stronger unless your side has the role: ask a player with it for help, or play a Key.</p>
        <p><b>Help.</b> The fighter may ask one player (a Face, or anyone against a boss, may ask two) and offers each a <b>cut</b> of the bags. The levels stay with the fighter. Decline and the fighter looks elsewhere.</p>
        <p><b>The pile-on.</b> Once the fighter says <b>Fight!</b>, everyone in turn may play: a one-shot on either side, a Boost on the Threat, or pass. When everyone passes in a row, the fight resolves.</p>
        <p><b>Losing.</b> Roll to <b>jeet</b>: 5 or more on a die and you are gone (a Lookout gets +2). Miss and you eat the <b>Bad Stuff</b> on the card. <b>REKT</b> = hand and gear gone; level and role stay.</p>
        <p><b>The Rug.</b> Everyone in a won fight holds one <b>Rug</b> a game, sealed. Pull it alone and you take every level and every bag. Two pulls tear the bag: nobody gets anything. Pulled Rugs are written on the Chog's record for ever.</p>
        <p><b>Free play</b> (your own turn, outside a fight): equip gear (one per slot; Big gear needs a Muscle or a free slot), sell 1,000 notes of gear for a level, trade gear with a willing player.</p>
        <p><b>Your Chog is your character.</b> Its eyes are its role (Face, Safecracker, Muscle, Lookout, Sob Story, Hacker, Degen), its kit is +3 power, and its record follows the token.</p>
        <div className="choices"><button className="btn" onClick={onClose}>Got it</button><a className="btn ghost" href="#/practice">Practice table</a></div>
      </div>
    </div>
  );
}
