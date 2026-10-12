// The road to level 10 and the one-line headline: what is happening at the table right now, in words a first-timer can follow.
import type { SeatView, View } from "@ruglife/protocol";
import { imageUrl, roleLabel } from "./cards.js";
import type { NewsLine } from "./news.js";

const nameOf = (view: View, seat: number): string => view.seats.find((s) => s.seat === seat)?.chog.name ?? `seat ${seat}`;

/** Every seat on a ladder from the start level to 10. The 10th rung is GLOBAL ALERT. */
export function Track({ view, me }: { view: View; me: SeatView | null }) {
  const start = view.mode === "tournament" ? 6 : 1;
  const rungs: number[] = [];
  for (let l = start; l <= 10; l++) rungs.push(l);
  const fighter = view.fight?.fighter ?? null;
  return (
    <div className="track" title="first to level 10 controls the world; the 10th level must come from a fight">
      <div className="lower3 track-title">THE ROAD TO LEVEL 10</div>
      <div className="rungs" style={{ gridTemplateColumns: `repeat(${rungs.length}, 1fr)` }}>
        {rungs.map((l) => {
          const here = view.seats.filter((s) => Math.min(10, Math.max(start, s.level)) === l);
          return (
            <div className={`rung ${l === 10 ? "finish" : ""}`} key={l}>
              <div className="faces">
                {here.map((s) => (
                  <img key={s.seat} className={`face ${s.seat === me?.seat ? "me" : ""} ${s.seat === fighter ? "fighting" : ""} ${s.rekt ? "rekt" : ""}`} src={imageUrl(s.chog.file)} alt={s.chog.name}
                    title={`${s.chog.name} · level ${s.level} · ${roleLabel(s.playRole ?? s.role)}${s.seat === me?.seat ? " (you)" : ""}`} />
                ))}
              </div>
              <div className="num">{l === 10 ? "GLOBAL ALERT" : l}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One sentence about now: who is up and what they are doing. Under it, the last thing that happened. */
export function Headline({ view, me, actors, news }: { view: View; me: SeatView | null; actors: number[]; news: NewsLine[] }) {
  const f = view.fight;
  const last = news.length ? news[news.length - 1]! : null;
  const mine = me !== null && actors.includes(me.seat);
  let line: string;
  if (view.phase === "over") line = view.winner !== null ? `GLOBAL ALERT: ${nameOf(view, view.winner)} controls the world.` : "Game over.";
  else if (view.phase === "lobby") line = mine ? "Deal the table when everyone is seated." : "Waiting for the host to deal.";
  else if (view.prompt && mine) {
    const k = view.prompt.kind;
    line = k === "rug" ? "THE RUG. Keep it, or pull it and take the whole fight." : k === "answerHelp" ? `${f ? nameOf(view, f.fighter) : "The fighter"} wants your help in the fight.` : k === "airdrop" ? "Too many cards: choose six to keep." : k === "tradeAnswer" ? "A trade is offered." : "Your call.";
  }
  else if (f) {
    const threat = f.threat.def.name;
    const fighter = f.fighter === me?.seat ? "You are" : `${nameOf(view, f.fighter)} is`;
    if (view.phase === "fight.setup") line = mine ? `You run into ${threat}. Ask for help, play a card, or Fight!` : `${fighter} setting up a fight with ${threat}.`;
    else if (view.phase === "fight.pileOn") line = mine ? `${fighter === "You are" ? "Your fight" : `${nameOf(view, f.fighter)}'s fight`} with ${threat}: pile on for or against, or pass.` : `${nameOf(view, f.priority ?? f.fighter)} is deciding whether to pile on.`;
    else if (view.phase === "fight.rug") line = mine ? "Sealed Rug choices." : "Everyone in the fight seals a Rug choice.";
    else line = `${fighter} fighting ${threat}.`;
  }
  else if (view.turn && view.turn.seat === me?.seat) line = view.phase === "turn.start" ? "YOUR TURN. Start trouble: flip the top Trouble card." : view.phase === "turn.airdrop" ? "Airdrop." : "Your free play: equip, sell, trade, look for trouble or grab a bag, then end the turn.";
  else if (view.turn) line = `${nameOf(view, view.turn.seat)}'s turn.`;
  else line = "";
  return (
    <div className={`headline ${mine ? "mine" : ""}`}>
      <div className="now">{line}</div>
      {last && view.phase !== "over" ? <div className={`last ${last.kind}`}>{last.kind === "breaking" ? "BREAKING: " : ""}{last.text}</div> : null}
    </div>
  );
}
