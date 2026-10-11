import { useEffect, useState } from "react";
import { connect, dismissError, useNet } from "./net.js";
import { Lobby } from "./lobby.js";
import { TableScreen } from "./table.js";
import { Sheet } from "./sheet.js";
import { Practice } from "./practice.js";
import { short, signIn } from "./wallet.js";

function useHash(): string {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    const on = () => setH(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}

export function App() {
  const net = useNet();
  const hash = useHash();
  useEffect(() => { connect(); }, []);
  const [busy, setBusy] = useState(false);
  const route = hash.replace(/^#\/?/, "");
  const [head, arg] = route.split("/");
  let page;
  if (head === "t" && arg) page = <TableScreen id={arg} />;
  else if (head === "chog" && arg) page = <Sheet tokenId={Number(arg)} />;
  else if (head === "practice") page = <Practice />;
  else page = <Lobby />;
  const onSignIn = async () => {
    setBusy(true);
    try { await signIn(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="#/">RUG LIFE</a>
        <span className="live">LIVE</span>
        <nav>
          <a href="#/" className={head === "" ? "on" : ""}>Tables</a>
          <a href="#/practice" className={head === "practice" ? "on" : ""}>Practice</a>
        </nav>
        <span className="spacer" />
        <span className="muted mono">{net.status === "open" ? "connected" : net.status}</span>
        {net.address ? <span className="stamp">{short(net.address)}</span> : <button className="btn small" onClick={onSignIn} disabled={busy || net.status !== "open"}>{busy ? "signing…" : "Sign in with wallet"}</button>}
      </header>
      <main className="main">{page}</main>
      <div className="toasts">
        {net.errors.map((e) => (
          <div className="toast" key={e.id} onClick={() => dismissError(e.id)}><b>{e.code}</b>{e.detail ? `: ${e.detail}` : ""}</div>
        ))}
      </div>
    </div>
  );
}
