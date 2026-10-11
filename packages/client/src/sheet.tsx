// The Chog sheet: traits, role, and the record (display only; it follows the token, with the controlling wallet of the time).
import { useEffect, useState } from "react";
import { tokenById } from "@ruglife/cards";
import { imageUrl, ROLE_INFO } from "./cards.js";
import { SERVER_HTTP } from "./net.js";

interface TokenRecord { tokenId: number; games: number; wins: number; levelsGained: number; rugsPulled: number; rugsSuffered: number; bountiesCollected: number; appearances: number; wonBeside: Record<string, number>; history: Array<{ table: string; at: number; won: boolean; mode: string; controller?: string | null; level?: number }> }

export function Sheet({ tokenId }: { tokenId: number }) {
  const t = tokenById(tokenId);
  const [rec, setRec] = useState<TokenRecord | null>(null);
  useEffect(() => {
    setRec(null);
    fetch(`${SERVER_HTTP}/api/record/${tokenId}`).then((r) => r.json()).then(setRec).catch(() => setRec(null));
  }, [tokenId]);
  if (!t) return <div className="panel">No such Chog (tokenId {tokenId}).</div>;
  const role = ROLE_INFO[t.role];
  return (
    <div className="sheet">
      <div>
        <img className="big" src={imageUrl(t.file)} alt={t.name} />
        <div className="panel" style={{ marginTop: 12 }}>
          <h2>{t.name}</h2>
          <div className="muted mono">tokenId {t.tokenId} · {t.tier} · {t.base}</div>
          <div style={{ marginTop: 8 }}><b className="display" style={{ fontSize: 22, color: "var(--purple-soft)" }}>{role.label}</b><div>{role.perk}</div></div>
          <div className="chips" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(["eyes", "head", "body", "accessory", "mouth", "aura", "background"] as const).map((k) => t.traits[k] ? <span className="chip" key={k}>{k}: {t.traits[k]}</span> : null)}
          </div>
          <div className="muted" style={{ marginTop: 8 }}>Kit: +3 power, always on unless switched off by a card. Skin: {t.skin ?? `rare (${t.rareSkin})`}.</div>
        </div>
      </div>
      <div className="panel">
        <h2>The record</h2>
        {!rec ? <div className="muted">loading…</div> : rec.games === 0 && rec.appearances === 0 ? <div className="muted">No games yet. The record starts at the first verified table.</div> : (
          <>
            <div className="stat"><span>Games</span><b>{rec.games}</b></div>
            <div className="stat"><span>Wins</span><b>{rec.wins}</b></div>
            <div className="stat"><span>Levels gained</span><b>{rec.levelsGained}</b></div>
            <div className="stat"><span>Rugs pulled</span><b>{rec.rugsPulled}</b></div>
            <div className="stat"><span>Rugs suffered</span><b>{rec.rugsSuffered}</b></div>
            <div className="stat"><span>Bounties collected</span><b>{rec.bountiesCollected}</b></div>
            <div className="stat"><span>Appearances as a card</span><b>{rec.appearances}</b></div>
            {Object.keys(rec.wonBeside).length ? <div style={{ marginTop: 8 }}><b>Won beside:</b> {Object.entries(rec.wonBeside).map(([id, n]) => <a key={id} href={`#/chog/${id}`} style={{ marginRight: 8 }}>{tokenById(Number(id))?.name ?? id} ×{n}</a>)}</div> : null}
            {rec.history.length ? <div style={{ marginTop: 8 }}><b>History</b>{rec.history.slice(-10).reverse().map((h, i) => <div className="mono" key={i}>{new Date(h.at).toISOString().slice(0, 10)} · {h.mode} · {h.won ? "WON" : "lost"}{h.level ? ` · level ${h.level}` : ""}{h.controller ? ` · ${h.controller.slice(0, 6)}…` : ""}</div>)}</div> : null}
          </>
        )}
        <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>The record is kept by the game server and follows the token, not the wallet. Only chest balances and settlements are on-chain.</div>
      </div>
    </div>
  );
}
