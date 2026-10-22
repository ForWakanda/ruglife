// The table: seats, the floor (fight panel), your hand and the actions the engine offers, the stands and the ticker.
// The client never computes rules. Everything clickable comes from view.legal.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Action, CardView, SeatId, SeatView, TableInfo, View } from "@ruglife/protocol";
import { formatUnits, parseUnits } from "viem";
import { act, request, useNet, type NetState } from "./net.js";
import { Card, ChogFace, imageUrl, powerParts, powerTitle, ROLE_INFO, roleLabel } from "./cards.js";
import { GlobalAlert } from "./alert.js";
import type { NewsLine } from "./news.js";
import { Track, Headline, matchPoint } from "./track.js";
import { LiveCoach } from "./coach.js";
import { fund, KIND, TRIGGER } from "./wallet.js";
import { tokenById } from "@ruglife/cards";
import { useMyChogs } from "./chogs.js";
import { sitWithChog } from "./lobby.js";
import type { Moment } from "./moments.js";

export const PHASE_LABEL: Record<View["phase"], string> = {
  lobby: "Dealing", "turn.start": "Start trouble", "fight.setup": "Fight: set-up", "fight.pileOn": "Fight: pile-on", "fight.rug": "Sealed Rug choices", "fight.jeet": "Jeet",
  "turn.free": "Free play", "turn.airdrop": "Airdrop", over: "GLOBAL ALERT",
};
const DEADLINE_MS: Record<string, number> = { lobby: 120_000, prompt: 30_000, airdrop: 60_000, "fight.pileOn": 30_000, turn: 60_000 }; // mirrors the server's ⚙ DEADLINES (priority 30 s since 2026-10-12; airdrop 60 s since 2026-10-22)

export function TableScreen({ id }: { id: string }) {
  const net = useNet();
  const view = net.views[id];
  const info = net.tables.find((t) => t.id === id);
  useEffect(() => {
    if (!view && net.status === "open") request({ type: "watch", table: id }, "table").catch(() => { /* toast shown */ });
  }, [id, net.status, !!view]);
  if (!info && !view) return <div className="panel">Looking for table {id}…</div>;
  if (!view) return <PreGame info={info!} net={net} />;
  return <TablePane view={view} info={info ?? null} news={net.news[id] ?? []} moments={net.moments[id] ?? []} at={net.viewAt[id] ?? Date.now()} onAct={(a) => act(id, a)} address={net.address} pending={net.pending?.table === id ? net.pending.type : null} />;
}

function PreGame({ info, net }: { info: TableInfo; net: NetState }) {
  const me = info.seats.find((s) => s.you);
  const host = info.host === net.session;
  const { mine, pick } = useMyChogs();
  const sitHere = (loaner: boolean): void => {
    const go = async () => {
      if (loaner) { await request({ type: "sit", table: info.id, loaner: true }, "table"); return; }
      if (!net.address) throw new Error("Sign in first (top right), then sit with your Chog.");
      await sitWithChog(info.id, pick, mine);
    };
    go().catch((e) => alert((e as Error).message));
  };
  return (
    <div className="panel">
      <h2>{info.name} <span className="chip">{info.mode}</span> {!info.timers ? <span className="chip">no clock</span> : null}</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        {info.seats.map((s) => <div className="seat" key={s.seat} style={{ minHeight: 0, width: 200 }}><div className="head"><img className="pfp" src={imageUrl(fileFromName(s.name))} alt="" /><div><div className="name">{s.name}{s.you ? " (you)" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{s.label}</div>{s.kind === "loaner" ? <span className="stamp loaner">LOANER</span> : s.kind === "bot" ? <span className="stamp bot">BOT</span> : <span className="stamp">VERIFIED</span>}</div></div></div>)}
        {info.seats.length === 0 ? <span className="muted">no one seated yet</span> : null}
      </div>
      <div className="actions">
        {!me && info.seats.length < info.maxSeats ? <button className="btn purple" disabled={!!net.address && mine === null} onClick={() => sitHere(false)}>{!net.address ? "Sign in and sit with your Chog" : mine === null ? "reading your Chogs…" : pick !== null ? `Sit with ${tokenById(pick)?.name ?? "your Chog"}` : "No Chog in this wallet"}</button> : null}
        {!me && info.seats.length < info.maxSeats && mine && mine.length > 1 ? <a href="#/" className="muted" style={{ fontSize: 12 }}>(play as another of your Chogs: pick it in the lobby)</a> : null}
        {!me && info.seats.length < info.maxSeats ? <button className="btn ghost" onClick={() => sitHere(true)}>Sit with a loaner</button> : null}
        {host ? <button className="btn ghost" disabled={info.seats.length >= info.maxSeats} onClick={() => request({ type: "addBot", table: info.id }, "table").catch(() => {})}>Add a bot</button> : null}
        {host ? <button className="btn big green" disabled={info.seats.length < 2} onClick={() => request({ type: "start", table: info.id }, "tables").catch(() => {})}>Deal</button> : <span className="muted">Waiting for the host to deal{info.seats.length < 2 ? " (two seats at least)" : ""}.</span>}
        {me ? <button className="btn small red" onClick={() => request({ type: "leave", table: info.id }, "table").then(() => { location.hash = "#/"; }).catch(() => {})}>Leave</button> : null}
        <a href="#/" className="muted">← tables</a>
      </div>
    </div>
  );
}
/** TableInfo seats carry the metadata name "CHOG #<file>"; the file is the marketplace number. */
const fileFromName = (name: string): number => Number(/#(\d+)/.exec(name)?.[1] ?? 1);

export interface PaneProps { view: View; info: TableInfo | null; news: NewsLine[]; moments?: Moment[]; at: number; onAct: (a: Action) => void; address: `0x${string}` | null; practice?: boolean; coach?: React.ReactNode; /** the action type in flight (sent, no view back yet) */ pending?: string | null }

export function TablePane({ view, info, news, moments, at, onAct, address, practice, coach, pending }: PaneProps) {
  const me = view.viewer === "stands" ? null : view.seats.find((s) => s.seat === view.viewer) ?? null;
  const legal = view.legal;
  const [chooser, setChooser] = useState<{ title: string; options: Array<{ label: string; action: Action }> } | null>(null);
  const [sell, setSell] = useState(false);
  const [trade, setTrade] = useState(false);
  const [alertSeen, setAlertSeen] = useState(false);
  useEffect(() => { setAlertSeen(false); }, [view.winner]);
  const [showing, setShowing] = useState<Moment | null>(null); // the moment on the floor right now (for the seat it hits)
  const lastOut = useMemo(() => [...(moments ?? [])].reverse().find((m) => m.out && m.card)?.card ?? null, [moments]);
  const actors = useMemo(() => whoActs(view), [view]);
  const upHuman = actors.map((s) => view.seats.find((x) => x.seat === s)!).filter((s) => s.kind !== "bot" && !s.autopilot);
  const deadlineMs = info?.timers === false || !upHuman.length ? null : view.phase === "lobby" ? DEADLINE_MS.lobby! : view.prompt ? (view.prompt.kind === "airdrop" ? DEADLINE_MS.airdrop! : DEADLINE_MS.prompt!) : view.phase === "fight.pileOn" ? DEADLINE_MS["fight.pileOn"]! : DEADLINE_MS.turn!;
  const do_ = (a: Action) => { setChooser(null); setSell(false); setTrade(false); onAct(a); };
  const of = <T extends Action["type"]>(t: T) => legal.filter((a): a is Extract<Action, { type: T }> => a.type === t);

  // a hand card's possible plays
  const cardOptions = (c: CardView): Array<{ label: string; action: Action }> => {
    const out: Array<{ label: string; action: Action }> = [];
    for (const a of legal) {
      if (a.type === "PLAY" && a.card === c.inst) out.push({ label: a.side ? `${c.def.text.split(".")[0]} → the ${a.side}` : a.target !== undefined ? `Play on ${nameOf(view, a.target)}${a.target === me?.seat ? " (yourself)" : ""}` : "Play", action: a });
      else if (a.type === "EQUIP" && a.card === c.inst) out.push({ label: "Equip", action: a });
      else if (a.type === "LOOK_FOR_TROUBLE" && a.card === c.inst) out.push({ label: "Look for trouble: fight it", action: a });
      else if (a.type === "USE_PERK" && a.discard === c.inst) out.push({ label: "Safecracker: discard it for +3", action: a });
    }
    return out;
  };
  const onCard = (c: CardView) => {
    const opts = cardOptions(c);
    if (opts.length === 0) return;
    if (opts.length === 1) return do_(opts[0]!.action);
    setChooser({ title: c.def.name, options: opts });
  };
  const asks = of("ASK_HELP");
  const trades = of("TRADE_OFFER");
  const sellable = of("SELL")[0];
  const promptMine = !!(view.prompt && me && view.prompt.seats.includes(me.seat));
  const fighterIsMe = !!(view.fight && me && view.fight.fighter === me.seat);

  return (
    <div className="table">
      <div className="strip">
        <span className="phase">{PHASE_LABEL[view.phase]}</span>
        {practice ? <span className="stamp practice">PRACTICE</span> : null}
        {info ? <span className="chip">{info.name}</span> : null}
        <span className="chip">{view.mode}</span>
        {view.turn ? <span>Turn {view.turn.no} · {nameOf(view, view.turn.seat)}{view.turn.seat === me?.seat ? " (you)" : ""}</span> : null}
        {actors.length && view.phase !== "over" ? <span className="lower3">{actors.some((s) => s === me?.seat) ? "YOU ARE UP" : `${actors.map((s) => nameOf(view, s)).join(", ")} to act`}</span> : null}
        {deadlineMs ? <Clock key={`${view.seq}`} ms={deadlineMs} at={at} /> : null}
        <span className="spacer" style={{ flex: 1 }} />
        {me && view.phase !== "over" ? <button className="btn small ghost" onClick={() => do_({ type: "AUTOPILOT", seat: me.seat, on: !me.autopilot })}>{me.autopilot ? "Take back control" : "Autopilot"}</button> : null}
        <a href="#/" className="muted">← tables</a>
      </div>

      <Track view={view} me={me} />
      <div className="seats">
        {view.seats.map((s) => { const hit = showing?.seat === s.seat ? showing : null; return <Seat key={`${s.seat}-${hit ? hit.key : ""}`} s={s} view={view} me={me} up={actors.includes(s.seat)} hit={hit} />; })}
      </div>

      <div className="floor">
        <Headline view={view} me={me} actors={actors} news={news} />
        {coach}
        {!practice && !coach ? <LiveCoach view={view} me={me} actors={actors} /> : null}
        {view.fight ? <Fight view={view} me={me} /> : (
          <>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="decks">
                <div className="deck trouble"><span>TROUBLE</span><b>{view.decks.trouble}</b><span style={{ fontSize: 10 }}>{view.decks.troubleDiscard} out</span></div>
                <div className="deck loot"><span>LOOT</span><b>{view.decks.loot}</b><span style={{ fontSize: 10 }}>{view.decks.lootDiscard} out</span></div>
                {lastOut ? <div className="lastout"><span className="muted" style={{ fontSize: 10 }}>last card out</span><Card card={lastOut} small /></div> : null}
              </div>
              {view.peek ? <div><div className="lower3">Lookout: the top Trouble card</div><div style={{ marginTop: 6 }}><Card card={view.peek} small /></div></div> : null}
            </div>
          </>
        )}
        <Moments moments={moments ?? []} view={view} onShowing={setShowing} />
      </div>

      <div className="side">
        {info?.escrow ? <Stands info={info} view={view} address={address} /> : null}
        <div className="ticker">
          <div className="lower3" style={{ marginBottom: 6 }}>GLOBAL ALERT NEWS</div>
          {[...news].reverse().map((l) => <div className={`line ${l.kind}`} key={l.seq}><b>{l.kind === "breaking" ? "BREAKING " : l.kind === "alert" ? "▶ " : ""}</b>{l.text}</div>)}
        </div>
      </div>

      {me ? (
        <div className="actionbar">
          {of("START_GAME").length ? <Act t="START_GAME" cls="big green" pending={pending} onClick={() => do_(of("START_GAME")[0]!)}>Deal</Act> : null}
          {of("START_TROUBLE").length ? <Act t="START_TROUBLE" cls="big red" pending={pending} onClick={() => do_(of("START_TROUBLE")[0]!)}>Start trouble</Act> : null}
          {asks.length ? <Act t="ASK_HELP" cls="big purple" pending={pending} onClick={() => setChooser({ title: "Ask for help (offer a cut of the bags)", options: asks.map((a) => ({ label: `${nameOf(view, a.to)} · ${roleLabel(view.seats.find((s) => s.seat === a.to)?.playRole)} · ${a.cut} bag${a.cut === 1 ? "" : "s"}`, action: a })) })}>Ask for help</Act> : null}
          {of("PASS").length ? <Act t="PASS" cls={fighterIsMe && view.phase === "fight.setup" ? "big red" : "big"} pending={pending} onClick={() => do_(of("PASS")[0]!)}>{fighterIsMe && view.phase === "fight.setup" ? "Fight!" : "Pass"}</Act> : null}
          {of("LEAVE_FIGHT").length ? <Act t="LEAVE_FIGHT" cls="ghost" pending={pending} onClick={() => do_(of("LEAVE_FIGHT")[0]!)}>Walk out of the fight</Act> : null}
          {of("GRAB_BAG").length ? <Act t="GRAB_BAG" cls="" pending={pending} onClick={() => do_(of("GRAB_BAG")[0]!)}>Grab a bag</Act> : null}
          {sellable ? <Act t="SELL" cls="" pending={pending} onClick={() => setSell(true)}>Sell gear for a level</Act> : null}
          {trades.length ? <Act t="TRADE_OFFER" cls="ghost" pending={pending} onClick={() => setTrade(true)}>Trade gear</Act> : null}
          {of("END_TURN").length ? <Act t="END_TURN" cls="big" pending={pending} onClick={() => do_(of("END_TURN")[0]!)}>End turn</Act> : null}
          {!legal.length && view.phase !== "over" ? <span className="muted">{pending ? "Sending…" : actors.length ? `Waiting for ${actors.map((s) => nameOf(view, s)).join(", ")}. Nothing to do until it is your priority.` : "Nothing to do until it is your priority."}</span> : null}
          {legal.length && pending ? <span className="muted">sending…</span> : null}
        </div>
      ) : null}
      <div className="hand">
        {me ? (
          <>
            <div className="row" style={{ marginBottom: 6, justifyContent: "space-between" }}><span className="lower3" title={powerTitle(me)}>YOUR HAND · POWER {powerParts(me).total} = level {me.level} + kit {powerParts(me).kit} + gear {powerParts(me).gear}</span><span className="muted" style={{ fontSize: 12 }}>glowing cards can be played now · six is the hand limit</span></div>
            <div className="handrow">
              {(me.hand ?? []).map((c) => { const n = cardOptions(c).length; return <Card key={c.inst} card={c} onClick={n ? () => onCard(c) : undefined} className={n ? "" : "dim"} badge={n ? undefined : undefined} />; })}
              {me.hand?.length === 0 ? <span className="muted">Empty hand.</span> : null}
            </div>
            {me.gear.length ? <div className="row" style={{ marginTop: 8 }}><span className="muted">Equipped:</span>{me.gear.map((g) => { const u = of("UNEQUIP").find((a) => a.card === g.inst); return <Card key={g.inst} card={g} small onClick={u ? () => do_(u) : undefined} badge={u ? "unequip" : undefined} />; })}</div> : null}
          </>
        ) : <div className="muted">You are in the stands. Everything public is shown; hands and sealed Rug choices are not.</div>}
      </div>

      {chooser ? <div className="overlay" onClick={() => setChooser(null)}><div className="modal" onClick={(e) => e.stopPropagation()}><h2>{chooser.title}</h2><div className="choices">{chooser.options.map((o, i) => <button className="btn" key={i} onClick={() => do_(o.action)}>{o.label}</button>)}<button className="btn ghost" onClick={() => setChooser(null)}>Never mind</button></div></div></div> : null}
      {sell && me && sellable ? <SellModal me={me} legal={sellable} onDone={do_} onClose={() => setSell(false)} /> : null}
      {trade && me ? <TradeModal view={view} me={me} offers={trades} onDone={do_} onClose={() => setTrade(false)} /> : null}
      {promptMine && me ? <Prompt view={view} me={me} onDone={do_} deadline={deadlineMs ? { ms: deadlineMs, at } : null} /> : null}
      {view.phase === "over" && !alertSeen ? <GlobalAlert view={view} onClose={() => setAlertSeen(true)} practice={practice ?? false} /> : null}
    </div>
  );
}

/** An action button: disabled while any action is in flight; the one that was clicked reads 'sending…'. */
function Act({ t, cls, pending, onClick, children }: { t: string; cls: string; pending: string | null | undefined; onClick: () => void; children: React.ReactNode }) {
  const mine = pending === t;
  return <button className={`btn ${cls} ${mine ? "sending" : ""}`} disabled={!!pending} onClick={onClick}>{mine ? "sending…" : children}</button>;
}

export const nameOf = (view: View, seat: SeatId): string => view.seats.find((s) => s.seat === seat)?.chog.name ?? `seat ${seat}`;
/** Who must act now, from the view alone (mirrors the server's actors()). */
export function whoActs(view: View): SeatId[] {
  if (view.phase === "over") return [];
  if (view.prompt) return view.prompt.seats;
  if (view.phase === "lobby") return [view.seats[0]!.seat];
  if (view.fight) {
    if (view.phase === "fight.setup") return [view.fight.fighter];
    if (view.phase === "fight.pileOn" && view.fight.priority !== null) return [view.fight.priority];
  }
  return view.turn ? [view.turn.seat] : [];
}

function Clock({ ms, at }: { ms: number; at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, at + ms - now);
  return <span className="row" title="the server's clock; silence is a pass / the default"><span className="clock"><div style={{ width: `${(100 * left) / ms}%`, background: left < 8000 ? "var(--red)" : "var(--green)" }} /></span><span className="mono">{Math.ceil(left / 1000)}s</span></span>;
}

function Seat({ s, view, me, up, hit }: { s: SeatView; view: View; me: SeatView | null; up: boolean; hit: Moment | null }) {
  const isMe = me?.seat === s.seat;
  const helper = view.fight?.helpers.find((h) => h.seat === s.seat);
  const fighter = view.fight?.fighter === s.seat;
  const shake = hit && (hit.kind === "fud" || hit.kind === "bad" || hit.kind === "rekt" || hit.kind === "lost" || (hit.kind === "jeet" && hit.tone === "red"));
  const pop = hit && (hit.kind === "won" || hit.kind === "levelup" || hit.kind === "rug");
  return (
    <div className={`seat ${up ? "up" : ""} ${isMe ? "me" : ""} ${shake ? "hit" : ""} ${pop ? "pop" : ""}`}>
      <div className="head">
        <a href={`#/chog/${s.chog.tokenId}`} title="the Chog sheet"><img className="pfp" src={imageUrl(s.chog.file)} alt="" /></a>
        <div>
          <div className="name">{s.chog.name}{isMe ? " (you)" : ""}</div>
          <div className="role" title={ROLE_INFO[s.playRole ?? s.role].perk}>{roleLabel(s.playRole ?? s.role)}{s.role === "legend" ? " (Legend)" : ""}</div>
          <div className="row" style={{ gap: 4 }}>
            {s.kind === "loaner" ? <span className="stamp loaner">LOANER</span> : s.kind === "bot" ? <span className="stamp bot">BOT</span> : null}
            {s.autopilot && s.kind !== "bot" ? <span className="stamp auto">AUTOPILOT</span> : null}
            {s.rekt ? <span className="stamp rekt">REKT</span> : null}
            {fighter ? <span className="stamp">FIGHTER</span> : helper ? <span className="stamp" title={`cut: ${helper.cut} bags`}>HELPER ·{helper.cut}🛍</span> : null}
          </div>
        </div>
      </div>
      <div className="stats">
        <div className="stat2 level" title="first to level 10 controls the world"><b>{s.level}</b><small>LEVEL</small></div>
        <div className={`stat2 power ${s.kitOn ? "" : "off"}`} title={powerTitle(s)}><b>{powerParts(s).total}</b><small>POWER</small></div>
      </div>
      <div className="chips">
        {!s.kitOn ? <span className="chip kit off" title="the kit (+3) is switched off until this seat's next turn starts">kit OFF</span> : null}
        {s.gear.map((g) => <span className="chip" key={g.inst} title={g.def.text}>{g.def.name} +{g.def.bonus}</span>)}
        <span className="chip">{s.handCount} in hand</span>
        <span className={`rug ${s.rug}`}>{s.rug === "held" ? "RUG HELD" : "RUG PULLED"}</span>
        {!s.connected && s.kind === "chog" ? <span className="chip">offline</span> : null}
      </div>
    </div>
  );
}

function Fight({ view, me }: { view: View; me: SeatView | null }) {
  const f = view.fight!;
  const muscle = sideHasMuscle(view);
  const win = f.power.fighter > f.power.threat || (f.power.fighter === f.power.threat && muscle);
  const threat = f.threat.def;
  const side = [f.fighter, ...f.helpers.map((h) => h.seat)].map((s) => view.seats.find((x) => x.seat === s)!);
  const bodies = side.reduce((a, s) => a + powerParts(s).total, 0);
  const sideCards = f.plays.filter((p) => p.side === "fighter" && !p.cancelled).reduce((a, p) => a + p.mod, 0);
  const sideOther = f.power.fighter - bodies - sideCards; // perks, the Degen die
  const lock = threat.lock?.length && !f.power.lockOpen ? f.power.lockPenalty : 0;
  const threatCards = f.plays.filter((p) => p.side === "threat" && !p.cancelled).reduce((a, p) => a + p.mod, 0);
  const threatOther = f.power.threat - (threat.level ?? 0) - lock - threatCards;
  const diff = f.power.fighter - f.power.threat;
  const mineSide = me !== null && side.some((s) => s.seat === me.seat);
  const verdict = diff > 0 ? `${mineSide ? "YOU ARE" : nameOf(view, f.fighter).toUpperCase() + " IS"} WINNING BY ${diff}` : diff === 0 ? (muscle ? "TIED — THE MUSCLE WINS IT" : "TIED — A TIE LOSES") : `${mineSide ? "YOU ARE" : nameOf(view, f.fighter).toUpperCase() + " IS"} LOSING BY ${-diff}`;
  const sgn = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
  const mp = matchPoint(view);
  return (
    <div className="col">
      {mp ? <div className="matchpoint">MATCH POINT · {mp.seat === me?.seat ? "win this fight and YOU take the world" : `${mp.name} takes the world if this fight is won${me && view.phase === "fight.pileOn" && f.priority === me.seat ? " — your priority: play on the threat side or pass" : ""}`}</div> : null}
      <div className="row"><span className="live">LIVE</span><span className="lower3">{nameOf(view, f.fighter)}{f.helpers.length ? ` + ${f.helpers.map((h) => nameOf(view, h.seat)).join(" + ")}` : ""} vs {threat.name}</span><span className={`verdict ${win ? "win" : "lose"}`}>{verdict}</span>{f.pendingAsk ? <span className="chip">asking {nameOf(view, f.pendingAsk.to)} for {f.pendingAsk.cut} bags…</span> : null}{f.rugPending.length ? <span className="chip" style={{ background: "var(--red)" }}>sealed choices: {f.rugPending.map((s) => nameOf(view, s)).join(", ")}</span> : null}</div>
      <div className="fight">
        <div className="side-box">
          <div className={`power ${win ? "win" : "lose"}`}>{f.power.fighter}</div>
          <div>{nameOf(view, f.fighter)}'s side {f.helpers.length ? `(${f.helpers.length} helper${f.helpers.length === 1 ? "" : "s"})` : "(alone)"}</div>
          <div className="math">{side.map((s) => <span key={s.seat} title={powerTitle(s)}>{s.chog.name} <b>{powerParts(s).total}</b> · </span>)}cards <b>{sgn(sideCards)}</b>{sideOther ? <> · perks/dice <b>{sgn(sideOther)}</b></> : null} = <b>{f.power.fighter}</b></div>
          {threat.lock?.length ? <div className={`lock ${f.power.lockOpen ? "" : "closed"}`}>{f.power.lockOpen ? `Lock open: ${threat.lock.map(roleLabel).join(" + ")} on side` : `LOCKED: needs ${threat.lock.map(roleLabel).join(" + ")} (+${f.power.lockPenalty} to the threat)`}</div> : null}
          {f.plays.filter((p) => p.side === "fighter").length ? <div className="plays">{f.plays.filter((p) => p.side === "fighter").map((p, i) => <span className={`chip ${p.cancelled ? "off" : ""}`} key={i}>{p.card.def.name} {p.mod >= 0 ? "+" : ""}{p.mod} ({nameOf(view, p.by)})</span>)}</div> : null}
        </div>
        <div className="vs">VS</div>
        <div className="side-box" style={{ display: "flex", gap: 10 }}>
          <Card card={f.threat} small />
          <div>
            <div className={`power ${win ? "lose" : "win"}`}>{f.power.threat}</div>
            <div>Threat level {threat.level}{(threat.levelsWon ?? 1) > 1 ? ` · BOSS (${threat.levelsWon} levels)` : ""} · {threat.bags} bag{threat.bags === 1 ? "" : "s"}</div>
            <div className="math">level <b>{threat.level ?? 0}</b>{lock ? <> · LOCKED <b>+{lock}</b></> : null} · cards <b>{sgn(threatCards)}</b>{threatOther ? <> · other <b>{sgn(threatOther)}</b></> : null} = <b>{f.power.threat}</b></div>
            {f.plays.filter((p) => p.side === "threat").length ? <div className="plays">{f.plays.filter((p) => p.side === "threat").map((p, i) => <span className={`chip ${p.cancelled ? "off" : ""}`} key={i}>{p.card.def.name} {p.mod >= 0 ? "+" : ""}{p.mod} ({nameOf(view, p.by)})</span>)}</div> : null}
          </div>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {view.phase === "fight.setup" ? (f.fighter === me?.seat ? "Ask for help, play a key or a jeet card, or fight." : `${nameOf(view, f.fighter)} is setting up the fight.`) : view.phase === "fight.pileOn" ? (f.priority === me?.seat ? "Your priority: play one card or pass. A play restarts the passes." : `Priority: ${f.priority !== null ? nameOf(view, f.priority) : "—"}. The fight resolves after everyone passes.`) : view.phase === "fight.rug" ? "Rug choices are sealed and revealed together." : ""}
      </div>
    </div>
  );
}
const sideHasMuscle = (view: View): boolean => {
  const f = view.fight!;
  const sides = [f.fighter, ...f.helpers.map((h) => h.seat)].map((s) => view.seats.find((x) => x.seat === s)!);
  return sides.some((s) => s.playRole === "muscle") || f.plays.some((p) => !p.cancelled && p.card.def.effects.some((e) => e.kind === "countAs" && e.role === "muscle"));
};

function Prompt({ view, me, onDone, deadline }: { view: View; me: SeatView; onDone: (a: Action) => void; deadline: { ms: number; at: number } | null }) {
  const p = view.prompt!;
  const legal = view.legal;
  // the clock inside the modal (the strip's clock is under the overlay): what silence does, and how long you have
  const silent = p.kind === "rug" ? "keeps your Rug" : p.kind === "answerHelp" ? "declines" : p.kind === "airdrop" ? "keeps the first six" : p.kind === "tradeAnswer" ? "declines" : "picks for you";
  const clock = deadline ? <div className="row promptclock"><Clock key={`${view.seq}`} ms={deadline.ms} at={deadline.at} /><span className="muted" style={{ fontSize: 12 }}>when the clock runs out, silence {silent}</span></div> : null;
  const [keep, setKeep] = useState<string[]>(() => (legal.find((a) => a.type === "AIRDROP_KEEP") as Extract<Action, { type: "AIRDROP_KEEP" }> | undefined)?.cards ?? []);
  if (p.kind === "rug") {
    const f = view.fight!;
    return (
      <div className="overlay"><div className="modal rug">
        <h2>THE RUG</h2>{clock}
        <div>The fight is won: <b>{f.threat.def.levelsWon ?? 1} level{(f.threat.def.levelsWon ?? 1) === 1 ? "" : "s"}</b> to {nameOf(view, f.fighter)}, <b>{f.threat.def.bags} bags</b> split by the cuts. You still hold your Rug. Choose in secret; the choices are revealed together.</div>
        <ul style={{ margin: "8px 0" }}><li><b>Keep</b>: the cuts stand. Your Rug stays for later.</li><li><b>Pull</b>: if you are the only one who pulls, you take every bag and every level of this fight. If two or more pull, the bag tears: nothing for anyone. A pulled Rug is spent for the game and written on your Chog's record.</li></ul>
        <div className="choices">
          <button className="btn big green" onClick={() => onDone({ type: "RUG", seat: me.seat, pull: false })}>Keep</button>
          <button className="btn big red" onClick={() => onDone({ type: "RUG", seat: me.seat, pull: true })}>PULL THE RUG</button>
        </div>
      </div></div>
    );
  }
  if (p.kind === "answerHelp") {
    const f = view.fight!;
    const ask = f.pendingAsk!;
    return (
      <div className="overlay"><div className="modal">
        <h2>{nameOf(view, f.fighter)} asks for your help</h2>{clock}
        <div className="row" style={{ alignItems: "flex-start" }}><Card card={f.threat} small /><div>Against <b>{f.threat.def.name}</b> (power {f.power.threat}; their side {f.power.fighter} now, <b>{f.power.fighter + powerParts(me).total}</b> with your {powerParts(me).total}). Your cut: <b>{ask.cut} of {f.threat.def.bags} bags</b>. Levels go to the fighter. If the fight is lost you roll to jeet too. If it is won, anyone still holding a Rug may pull it.</div></div>
        <div className="choices"><button className="btn big green" onClick={() => onDone({ type: "ANSWER_HELP", seat: me.seat, accept: true })}>I'm in for {ask.cut}</button><button className="btn big ghost" onClick={() => onDone({ type: "ANSWER_HELP", seat: me.seat, accept: false })}>Not my fight</button></div>
      </div></div>
    );
  }
  if (p.kind === "tradeAnswer") {
    return (
      <div className="overlay"><div className="modal"><h2>A trade is offered</h2>{clock}<div>Another player offers a gear swap. Accept?</div><div className="choices"><button className="btn big green" onClick={() => onDone({ type: "TRADE_ANSWER", seat: me.seat, accept: true })}>Accept</button><button className="btn big ghost" onClick={() => onDone({ type: "TRADE_ANSWER", seat: me.seat, accept: false })}>Decline</button></div></div></div>
    );
  }
  if (p.kind === "airdrop") {
    const hand = me.hand ?? [];
    const toggle = (inst: string) => setKeep((k) => (k.includes(inst) ? k.filter((x) => x !== inst) : k.length >= 6 ? k : [...k, inst]));
    return (
      <div className="overlay"><div className="modal">
        <h2>Airdrop: keep 6</h2>{clock}
        <div>You hold {hand.length}. Pick the 6 to keep; the rest are charity: they drop to the lowest-level player (a Sob Story first; you discard if that is you).</div>
        <div className="handrow" style={{ marginTop: 8 }}>{hand.map((c) => <Card key={c.inst} card={c} small selected={keep.includes(c.inst)} className={keep.includes(c.inst) ? "" : "dim"} badge={keep.includes(c.inst) ? "KEEP" : undefined} onClick={() => toggle(c.inst)} />)}</div>
        <div className="choices"><button className="btn big" disabled={keep.length !== Math.min(6, hand.length)} onClick={() => onDone({ type: "AIRDROP_KEEP", seat: me.seat, cards: keep })}>Keep these {keep.length}</button></div>
      </div></div>
    );
  }
  if (p.kind === "pickRole" || p.kind === "pickSkin") {
    const opts = legal.filter((a) => a.type === "PICK_ROLE" || a.type === "PICK_SKIN");
    return (
      <div className="overlay"><div className="modal"><h2>{p.kind === "pickRole" ? "A Legend picks a role" : "A rare skin picks a colour"}</h2>{clock}<div className="choices">{opts.map((a, i) => <button className="btn" key={i} onClick={() => onDone(a)}>{a.type === "PICK_ROLE" ? `${roleLabel(a.role)} — ${ROLE_INFO[a.role].perk}` : a.type === "PICK_SKIN" ? a.skin : ""}</button>)}</div></div></div>
    );
  }
  return null;
}

function SellModal({ me, legal, onDone, onClose }: { me: SeatView; legal: Extract<Action, { type: "SELL" }>; onDone: (a: Action) => void; onClose: () => void }) {
  const all = [...(me.hand ?? []), ...me.gear].filter((c) => legal.cards.includes(c.inst));
  const [sel, setSel] = useState<string[]>([]); // nothing picked until you pick it (2026-10-13: everything pre-picked read as 'already selling')
  const total = all.filter((c) => sel.includes(c.inst)).reduce((a, c) => a + (c.def.value ?? 0), 0);
  const levels = Math.floor(total / 1000);
  return (
    <div className="overlay" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h2>Sell gear for a level</h2>
      <div>Click the gear you want to sell. Every <b>1,000 notes</b> sold is <b>one level</b>. The notes are the price printed on each card; they never touch $CHOG. The 10th level cannot be bought.</div>
      <div className="handrow" style={{ marginTop: 8 }}>{all.map((c) => { const on = sel.includes(c.inst); return <Card key={c.inst} card={c} small selected={on} className={on ? "" : "dim"} badge={on ? `SELLING ${c.def.value ?? 0}` : undefined} onClick={() => setSel((s) => (s.includes(c.inst) ? s.filter((x) => x !== c.inst) : [...s, c.inst]))} />; })}</div>
      <div className="choices" style={{ alignItems: "center" }}><span className="lower3">{total.toLocaleString()} of 1,000 notes{levels > 1 ? ` (${levels} levels)` : ""}</span><button className="btn big green" disabled={total < 1000} onClick={() => onDone({ type: "SELL", seat: me.seat, cards: sel })}>{total < 1000 ? `Pick ${(1000 - total).toLocaleString()} more notes` : levels > 1 ? `Sell for ${levels} levels` : "Sell for a level"}</button><button className="btn ghost" onClick={onClose}>Never mind</button></div>
    </div></div>
  );
}

function TradeModal({ view, me, offers, onDone, onClose }: { view: View; me: SeatView; offers: Array<Extract<Action, { type: "TRADE_OFFER" }>>; onDone: (a: Action) => void; onClose: () => void }) {
  const [give, setGive] = useState<string | null>(null);
  const mine = [...(me.hand ?? []), ...me.gear].filter((c) => offers.some((o) => o.give === c.inst));
  const takes = give ? offers.filter((o) => o.give === give) : [];
  const nameFor = (seat: SeatId, inst: string): string => { const s = view.seats.find((x) => x.seat === seat)!; return s.gear.find((g) => g.inst === inst)?.def.name ?? "a card in hand"; };
  return (
    <div className="overlay" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h2>Trade gear</h2>
      <div className="muted">Pick what you give; then whose gear you want. They must accept.</div>
      <div className="handrow" style={{ marginTop: 8 }}>{mine.map((c) => <Card key={c.inst} card={c} small selected={give === c.inst} className={give && give !== c.inst ? "dim" : ""} badge={give === c.inst ? "GIVING" : undefined} onClick={() => setGive(c.inst)} />)}</div>
      {give ? <div className="choices">{takes.map((o, i) => <button className="btn" key={i} onClick={() => onDone(o)}>{nameOf(view, o.to)}: {nameFor(o.to, o.take)}</button>)}</div> : null}
      <div className="choices"><button className="btn ghost" onClick={onClose}>Never mind</button></div>
    </div></div>
  );
}

function Stands({ info, view, address }: { info: TableInfo; view: View; address: `0x${string}` | null }) {
  const e = info.escrow!;
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const fmt = (wei: string): string => { try { return Number(formatUnits(BigInt(wei), 18)).toLocaleString(); } catch { return wei; } };
  const doFund = async (kind: number, targetTokenId: number, trigger: number, id: `0x${string}`) => {
    setBusy(true);
    try {
      const tx = await fund({ escrow: e.address, chog: e.chog, id, kind, targetTokenId, trigger, amount: parseUnits(amount, 18), expiry: e.expiry, toSeason: false });
      alert(`Sent: ${tx}. The table sees the deposit within ~15 s; a bounty becomes active at the target's next turn.`);
    } catch (err) { alert((err as Error).message.split("\n")[0]); } finally { setBusy(false); }
  };
  return (
    <div className="panel">
      <h2>The stands · $CHOG</h2>
      {!e.eligible ? <div className="muted">This table has a loaner or bot only, so nothing is ever settled from it.</div> : (
        <>
          <div className="stat"><span>Pot → the winner's chest</span><b>{fmt(e.pot.funded)}</b></div>
          {e.bounties.map((b) => <div className="stat" key={b.id}><span>{b.trigger.toUpperCase()} on {nameOf(view, b.seat)} {b.active ? <span className="chip" style={{ background: "var(--red)" }}>active</span> : b.funded !== "0" ? <span className="chip">arms next turn</span> : null}</span><b>{fmt(b.funded)}</b></div>)}
          {view.phase !== "over" ? (
            <div className="col" style={{ marginTop: 8 }}>
              <div className="row"><input value={amount} onChange={(ev) => setAmount(ev.target.value)} style={{ width: 90 }} /> <span className="muted">$CHOG, from your wallet (a permit + one transaction)</span></div>
              <div className="row">
                <button className="btn small green" disabled={busy || !address} onClick={() => doFund(KIND.pot, 0, 0, e.potId)}>Fund the pot</button>
                {e.bounties.map((b) => <button className="btn small pink" key={b.id} disabled={busy || !address} onClick={() => doFund(KIND.bounty, b.tokenId, TRIGGER[b.trigger], b.id)}>{b.trigger === "hit" ? "HIT" : "RUG"} bounty on {nameOf(view, b.seat)}</button>)}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>HIT pays whoever first lowers the target's level or rekts it with a FUD from the hand; RUG pays whoever rugs it. Unclaimed money is reclaimable by the funder after {new Date(e.expiry * 1000).toLocaleString()}. Settlement is attested by the game's result signer and limited by the escrow: destination, amount, once.</div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The floor's spotlight: the newest moments one at a time, each for its beat (shorter when several queue up). Click skips one. */
function Moments({ moments, view, onShowing }: { moments: Moment[]; view: View; onShowing: (m: Moment | null) => void }) {
  const [queue, setQueue] = useState<Moment[]>([]);
  const [now, setNow] = useState<Moment | null>(null);
  const seen = useRef<number>(-1);
  const mounted = useRef(false);
  useEffect(() => {
    // on arrival at a table, what already happened is history, not a show
    if (!mounted.current) { mounted.current = true; seen.current = moments.length ? moments[moments.length - 1]!.key : -1; return; }
    const fresh = moments.filter((m) => m.key > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1]!.key;
    setQueue((q) => [...q, ...fresh].slice(-8));
  }, [moments]);
  useEffect(() => {
    if (now || !queue.length) return;
    const [head, ...rest] = queue;
    setQueue(rest);
    setNow(head!);
  }, [queue, now]);
  useEffect(() => {
    if (!now) { onShowing(null); return; }
    onShowing(now);
    const ms = Math.max(800, now.ms * Math.max(0.4, 1 - 0.18 * queue.length));
    const t = setTimeout(() => setNow(null), ms);
    return () => clearTimeout(t);
  }, [now]);
  useEffect(() => { setQueue([]); setNow(null); }, [view.tableId]);
  if (!now) return null;
  const seat = now.seat !== null ? view.seats.find((s) => s.seat === now.seat) ?? null : null;
  return (
    <div className={`moment ${now.tone} ${now.kind}`} onClick={() => setNow(null)} title="click to skip">
      {now.card ? <Card card={now.card} /> : null}
      <div className="mtext">
        {seat ? <div className="row" style={{ justifyContent: "center", marginBottom: 6 }}><img className="mface" src={imageUrl(seat.chog.file)} alt="" /><span className="mwho">{seat.chog.name}{seat.seat === view.viewer ? " (you)" : ""}</span></div> : null}
        <div className="mtitle">{now.title}</div>
        {now.sub ? <div className="msub">{now.sub}</div> : null}
      </div>
    </div>
  );
}

export { ChogFace };
