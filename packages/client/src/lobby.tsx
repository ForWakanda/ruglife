// The lobby: tables, your Chogs, loaners, bots, pilot keys. Sitting with a Chog is a signature check, never a transaction.
import { useEffect, useState } from "react";
import type { TableInfo } from "@ruglife/protocol";
import { tokenById } from "@ruglife/cards";
import { request, send, useNet } from "./net.js";
import { chogsOf, hasWallet, registerPilot, signIn } from "./wallet.js";
import { imageUrl, roleLabel } from "./cards.js";

const PICK_KEY = "ruglife.chog";

export function Lobby() {
  const net = useNet();
  const [mine, setMine] = useState<number[] | null>(null);
  const [pick, setPick] = useState<number | null>(() => { try { const v = localStorage.getItem(PICK_KEY); return v ? Number(v) : null; } catch { return null; } });
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"standard" | "tournament">("standard");
  const [timers, setTimers] = useState(true);
  const [pilotId, setPilotId] = useState("");
  const [pilotAddr, setPilotAddr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!net.address) { setMine(null); return; }
    chogsOf(net.address).then(setMine).catch(() => setMine([]));
  }, [net.address]);
  useEffect(() => { try { if (pick !== null) localStorage.setItem(PICK_KEY, String(pick)); } catch { /* ignore */ } }, [pick]);

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
    if (!net.address) await signIn();
    if (pick === null) throw new Error("pick one of your Chogs first (or sit as a loaner)");
    await request({ type: "sit", table: t.id, tokenId: pick }, "table");
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

  return (
    <div className="grid2">
      <div className="col">
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
                    <button className="btn small purple" disabled={busy !== null} onClick={() => sitChog(t)}>Sit with {pick !== null ? tokenById(pick)?.name ?? "your Chog" : "your Chog"}</button>
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
            <div className="chogpick">
              {mine.map((id) => { const t = tokenById(id); if (!t) return null; return (
                <div className={`chog ${pick === id ? "on" : ""}`} key={id} onClick={() => setPick(id)}>
                  <img src={imageUrl(t.file)} alt={t.name} />
                  <div style={{ fontWeight: 800, fontSize: 12 }}>{t.name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{roleLabel(t.role)}</div>
                  <a href={`#/chog/${id}`} style={{ fontSize: 11 }} onClick={(e) => e.stopPropagation()}>sheet</a>
                </div>
              ); })}
            </div>
          )}
          {net.address ? <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Pilot keys you were given also work: sit with that Chog's tokenId and the server checks the owner's signature.</div> : null}
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
