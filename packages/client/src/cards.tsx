// Card and Chog rendering. The picture on every card is a real Chog from the collection (CardView.cast).
import type { CardView, ChogRef, Role, RoleOrLegend } from "@ruglife/protocol";

const GATEWAY = "https://chog-genesis.mypinata.cloud/ipfs/bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e";
/** The marketplace number is the file name. */
export const imageUrl = (file: number): string => `${GATEWAY}/${file}.webp`;

export const ROLE_INFO: Record<RoleOrLegend, { label: string; perk: string }> = {
  face: { label: "Face", perk: "As the fighter, may take a second helper." },
  safecracker: { label: "Safecracker", perk: "In a fight they are in: discard a card for +3, once a turn." },
  muscle: { label: "Muscle", perk: "A side with a Muscle wins ties; carries any number of Big gear." },
  lookout: { label: "Lookout", perk: "+2 on jeet rolls; sees the top Trouble card at the start of their turn." },
  sob: { label: "Sob Story", perk: "Once a game, shrugs off a Bad Stuff after a failed jeet; wins airdrop ties." },
  hacker: { label: "Hacker", perk: "Once a turn, rerolls a failed jeet (the second roll stands)." },
  degen: { label: "Degen", perk: "Rolls at the start of each own fight: 1–2 → −2, 5–6 → +4." },
  legend: { label: "Legend", perk: "A 1/1: picks any role at sit-down, fixed for the game." },
};
export const roleLabel = (r: RoleOrLegend | Role | null | undefined): string => (r ? ROLE_INFO[r].label : "—");

export function ChogFace({ chog, size = 40 }: { chog: ChogRef; size?: number }) {
  return (
    <span className="face">
      <img src={imageUrl(chog.file)} alt={chog.name} width={size} height={size} loading="lazy" />
      <span>{chog.name}</span>
    </span>
  );
}

export function Card({ card, small, onClick, selected, badge, cancelled, className }: { card: CardView; small?: boolean; onClick?: (() => void) | undefined; selected?: boolean; badge?: string | undefined; cancelled?: boolean; className?: string | undefined }) {
  const d = card.def;
  const cls = ["card", d.type, small ? "small" : "", onClick ? "click" : "", selected ? "selected" : "", cancelled ? "cancelled" : "", className ?? ""].filter(Boolean).join(" ");
  const top = d.type === "threat" ? `LV ${d.level}` : d.type === "gear" ? `+${d.bonus}` : d.type.toUpperCase();
  return (
    <div className={cls} onClick={onClick} role={onClick ? "button" : undefined} title={d.text}>
      <div className="frame"><span>{d.type === "threat" && (d.levelsWon ?? 1) > 1 ? "BOSS" : d.type.toUpperCase()}</span><span>{top}</span></div>
      {card.cast.file > 0 ? <img src={imageUrl(card.cast.file)} alt="" loading="lazy" /> : null}
      <div className="body">
        <div className="name">{d.name}</div>
        {!small && d.flavour ? <div className="flav">{d.flavour}</div> : null}
        <div className="text">{d.text}</div>
      </div>
      {card.cast.file > 0 ? <div className="cast">starring {card.cast.name}</div> : null}
      {badge ? <span className="stamp badge">{badge}</span> : null}
    </div>
  );
}

export function CardBack({ deck }: { deck: "trouble" | "loot" }) {
  return <div className={`deck ${deck} cardback`}>{deck === "trouble" ? "TROUBLE" : "LOOT"}</div>;
}
