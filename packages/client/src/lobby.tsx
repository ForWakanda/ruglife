// The lobby: tables, your Chogs, loaners, bots, pilot keys. Sitting with a Chog is a signature check, never a transaction.
import { useState } from "react";
import type { TableInfo } from "@ruglife/protocol";
import { tokenById } from "@ruglife/cards";
import { request, send, useNet } from "./net.js";
import { hasWallet, registerPilot, signIn } from "./wallet.js";
import { imageUrl, roleLabel } from "./cards.js";
import { HowToPlay } from "./coach.js";
import { refreshChogs, setPick, useMyChogs } from "./chogs.js";

/** Sits the picked Chog at a table. A refusal because the Chog left the wallet re-reads the chain and says what is held now. */
export async function sitWithChog(table: string, pick: number | null, mine: number[] | null): Promise<void> {
  if (pick === null) throw new Error(mine && mine.length === 0 ? "No Chog Genesis in this wallet: sit with a loaner, or get a pilot key from a holder." : "Pick one of your Chogs first, or sit with a loaner.");
  try {
    await request({ type: "sit", table, tokenId: pick }, "table");
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.startsWith("notOwner")) throw e;
    const now = await refreshChogs();
    const names = now.map((id) => tokenById(id)?.name ?? `#${id}`);
    throw new Error(`${tokenById(pick)?.name ?? `#${pick}`} is not in this wallet any more. ${now.length ? `This wallet holds ${names.join(", ")}: ${now.length === 1 ? "it is picked now, click Sit again." : "pick one and click Sit again."}` : "No Chog Genesis here: sit with a loaner."}`);
  }
}

export function Lobby() {
  const net = useNet();
  const { mine, pick } = useMyChogs();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"standard" | "tournament">("standard");
  const [timers, setTimers] = useState(true);
  const [pilotId, setPilotId] = useState("");
  const [pilotAddr, setPilotAddr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const go = (id: string) => { location.hash = `#/t/${id}`; };
  const run = async (label: string, f: () => Promise<unknown>) => {
    setBusy(label);
    try { await f(); } catch (e) { alert((e as Error).message); } finally { setBusy(null); }
  };
  const create = () => run("create", async () => {
    const r = await request({ type: "create", mode, ...(name.trim() ? { name: name.trim() } : {}), timers }, "table");
    go(r.table.id);
  });
  const sitChog = (t: TableInfo) => run(`sit-${t.id}`, async () => {
    if (!net.address) { await signIn(); throw new Error("Signed in. Your Chogs are being read from the chain: pick one and click Sit again."); }
    await sitWithChog(t.id, pick, mine);
    go(t.id);
  });
  const sitLoaner = (t: TableInfo) => run(`loaner-${t.id}`, async () => { await request({ type: "sit", table: t.id, loaner: true }, "table"); go(t.id); });
  const watch = (t: TableInfo) => run(`watch-${t.id}`, async () => { await request({ type: "watch", table: t.id }, "table"); go(t.id); });
  const pilot = () => run("pilot", async () => {
    const id = Number(pilotId);
    if (!Number.isInteger(id) || !tokenById(id)) throw new Error("tokenId (the chain id, not the marketplace number)");
    if (!/^0x[0-9a-fA-F]{40}$/.test(pilotAddr)) throw new Error("pilot wallet address");
    const r = await registerPilot(id, pilotAddr as `0x${string}`, 30);
    alert(`Pilot key registered: ${pilotAddr.slice(0, 8)}… may play ${tokenById(id)!.name} until ${new Date(r.expires * 1000).toLocaleDateString()}. It grants nothing over the chest.`);
  });

  const open = net.tables.filter((t) => t.status === "open");
  const playing = net.tables.filter((t) => t.status === "playing");
  const over = net.tables.filter((t) => t.status === "over");
  const myTable = net.tables.find((t) => t.seats.some((s) => s.you) && t.status !== "over");

  const [rules, setRules] = useState(false);
  return (
    <div className="grid2">
      <div className="col">
        {rules ? <HowToPlay onClose={() => setRules(false)} /> : null}
        <div className="panel newhere"><h2>New here?</h2><div className="row"><span>Two minutes at the practice table teaches the whole game: a fight, a Lock, a helper, a Rug.</span><a className="btn big green" href="#/practice">Practice first</a><button className="btn ghost" onClick={() => setRules(true)}>How to play</button></div></div>
        {myTable ? <div className="panel" style={{ borderColor: "var(--yellow)" }}><h2>You are seated</h2><div className="row"><span className="name">{myTable.name}</span><button className="btn" onClick={() => go(myTable.id)}>Back to the table</button></div></div> : null}
        <div className="panel">
          <h2>Tables</h2>
          {net.tables.length === 0 ? <div className="muted">No tables yet. Open one, add bots, or wait for a human.</div> : null}
          {[...open, ...playing, ...over].map((t) => (
            <div className="tablerow" key={t.id}>
              <div style={{ flex: 1 }}>
                <div className="row"><span className="name">{t.name}</span><span className="chip">{t.mode}</span><span className={`chip ${t.status === "playing" ? "kit" : ""}`}>{t.status}</span>{!t.timers ? <span className="chip">no clock</span> : null}{t.escrow?.eligible ? <span className="chip" style={{ background: "var(--green)", color: "#000" }}>$CHOG</span> : null}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  {t.seats.map((s) => (
                    <span className="face" key={s.seat} title={`${s.label} · ${roleLabel(tokenById(s.tokenId)?.role)}`}>
                      <img src={imageUrl(tokenById(s.tokenId)?.file ?? 1)} alt="" />
                      <span style={{ fontSize: 12 }}>{s.name}{s.you ? " (you)" : ""} {s.kind === "loaner" ? <span className="stamp loaner">LOANER</span> : s.kind === "bot" ? <span className="stamp bot">BOT</span> : null}</span>
                    </span>
                  ))}
                  {t.seats.length === 0 ? <span className="muted">empty</span> : null}
                  <span className="muted">{t.seats.length}/{t.maxSeats}</span>
                </div>
              </div>
              <div className="col">
                {t.status === "open" && !t.seats.some((s) => s.you) && t.seats.length < t.maxSeats ? (
                  <>
                    <button className="btn small purple" disabled={busy !== null || (!!net.address && mine === null)} onClick={() => sitChog(t)}>{!net.address ? "Sign in and sit with your Chog" : mine === null ? "reading your Chogs…" : pick !== null ? `Sit with ${tokenById(pick)?.name ?? "your Chog"}` : "No Chog in this wallet"}</button>
                    <button className="btn small ghost" disabled={busy !== null} onClick={() => sitLoaner(t)}>Sit with a loaner</button>
                  </>
                ) : null}
                {t.seats.some((s) => s.you) ? <button className="btn small" onClick={() => go(t.id)}>Open</button> : <button className="btn small ghost" disabled={busy !== null} onClick={() => watch(t)}>Watch from the stands</button>}
              </div>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>Open a table</h2>
          <div className="row">
            <input placeholder="table name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <select value={mode} onChange={(e) => setMode(e.target.value as "standard" | "tournament")}><option value="standard">standard (from level 1)</option><option value="tournament">tournament (from level 6)</option></select>
            <label className="inline"><input type="checkbox" checked={timers} onChange={(e) => setTimers(e.target.checked)} /> clock</label>
            <button className="btn" disabled={busy !== null || net.status !== "open"} onClick={create}>Open</button>
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Entry is free. No antes, no stakes. Anyone may fund a table's pot or a bounty from their own wallet once it starts.</div>
        </div>
      </div>
      <div className="col">
        <div className="panel">
          <h2>Your Chogs</h2>
          {!net.address ? (
            <div className="col">
              <div>Sign in with the wallet that holds your Chog. It is a signature: nothing is transferred, approved or staked, ever.</div>
              <div className="row"><button className="btn purple" disabled={busy !== null || net.status !== "open"} onClick={() => run("signin", signIn)}>{hasWallet() ? "Sign in with wallet" : "No wallet found"}</button><span className="muted">or sit with a loaner: a real role and kit, marked LOANER, no record, no prizes.</span></div>
            </div>
          ) : mine === null ? <div className="muted">reading the chain…</div> : mine.length === 0 ? (
            <div className="muted">No Chog Genesis in this wallet. Sit with a loaner, or get a pilot key from a holder.</div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 8, justifyContent: "space-between" }}>
                <span>You play as <b>{pick !== null ? tokenById(pick)?.name : "—"}</b>{mine.length > 1 ? <span className="muted"> · click another to switch</span> : null}</span>
                <button className="btn small ghost" disabled={busy !== null} onClick={() => run("refresh", () => refreshChogs())}>Re-read wallet</button>
              </div>
              <div className="chogpick">
                {mine.map((id) => { const t = tokenById(id); if (!t) return null; return (
                  <div className={`chog ${pick === id ? "on" : ""}`} key={id} onClick={() => setPick(id)} title={pick === id ? "the Chog you play as" : "click to play as this Chog"}>
                    {pick === id ? <span className="stamp badge" style={{ position: "absolute", top: 6, left: -6 }}>PLAYING AS</span> : null}
                    <img src={imageUrl(t.file)} alt={t.name} />
                    <div style={{ fontWeight: 800, fontSize: 12 }}>{t.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{roleLabel(t.role)}</div>
                    <a href={`#/chog/${id}`} style={{ fontSize: 11 }} onClick={(e) => e.stopPropagation()}>sheet</a>
                  </div>
                ); })}
              </div>
            </>
          )}
          {net.address ? <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Sold or moved a Chog? Re-read the wallet. Pilot keys you were given also work: sit with that Chog's tokenId and the server checks the owner's signature.</div> : null}
        </div>
        {net.address ? (
          <div className="panel">
            <h2>Lend a Chog (pilot key)</h2>
            <div className="muted" style={{ fontSize: 12 }}>Let another wallet (a friend, a Discord bot) play one of your Chogs for 30 days. A signed message; it grants nothing over the chest or the token, and a newer key revokes it.</div>
            <div className="row" style={{ marginTop: 8 }}>
              <select value={pilotId} onChange={(e) => setPilotId(e.target.value)}><option value="">which Chog</option>{(mine ?? []).map((id) => <option key={id} value={id}>{tokenById(id)?.name}</option>)}</select>
              <input placeholder="pilot wallet 0x…" value={pilotAddr} onChange={(e) => setPilotAddr(e.target.value)} style={{ width: 240 }} />
              <button className="btn small" disabled={busy !== null} onClick={pilot}>Sign the key</button>
            </div>
          </div>
        ) : null}
        <div className="panel">
          <h2>How it works</h2>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>Your Chog is your seat: its Eyes decide your role and perk; its kit is +3 power, always.</li>
            <li>On your turn, start trouble. A Threat is a fight: alone, or with a helper you cut a deal with.</li>
            <li>Locked Threats are +5 unless your side has the role. Nobody can veto a fight.</li>
            <li>Everyone holds one Rug a game. Win with helpers and anyone may pull it: one pull takes everything, two tear the bag.</li>
            <li>First to level 10 controls the world. GLOBAL ALERT.</li>
          </ol>
          <div style={{ marginTop: 8 }}><a href="#/practice">Practice first (3 minutes, labelled practice, writes nothing) →</a></div>
        </div>
      </div>
    </div>
  );
}
export { send };
