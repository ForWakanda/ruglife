// GLOBAL ALERT — the win screen. A newscast: the kid in the banana suit has taken the world.
import type { View } from "@ruglife/protocol";
import { imageUrl } from "./cards.js";

export function GlobalAlert({ view, onClose, practice }: { view: View; onClose: () => void; practice?: boolean }) {
  const w = view.seats.find((s) => s.seat === view.winner);
  if (!w) return null;
  const over = (view as unknown as { seedHash: string }).seedHash;
  return (
    <div className="globalalert" onClick={onClose}>
      <div className="title">GLOBAL ALERT</div>
      <div className="sub">{w.chog.name} controls the world</div>
      <img src={imageUrl(w.chog.file)} alt={w.chog.name} />
      <div className="meta">
        {practice ? <div><span className="stamp practice">PRACTICE</span> nothing was recorded.</div> : null}
        <div>{w.kind === "chog" ? "Prizes in this table's pot go to this Chog's chest. The record follows the token." : w.kind === "loaner" ? "A loaner: no record, no prize." : "A bot: no record, no prize."}</div>
        <div className="mono">seed hash {over.slice(0, 16)}… · anyone can replay this table</div>
        <div className="muted">click anywhere to see the table</div>
      </div>
    </div>
  );
}
