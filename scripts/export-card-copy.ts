// Editorial proof sheet from the playable definitions. Run: npx tsx scripts/export-card-copy.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { cardSetV0 } from "../packages/cards/src/set-v0.js";

const cell = (value: unknown): string => `"${String(value ?? "").replaceAll('"', '""')}"`;
const columns = ["id", "deck", "type", "name", "flavour", "rules", "level", "levels won", "bags", "slot", "power bonus", "notes", "locks"];
const rows = cardSetV0.cards.map((c) => [c.id, c.deck, c.type, c.name, c.flavour, c.text, c.level, c.levelsWon, c.bags, c.slot, c.bonus, c.value, c.lock?.join(" + ")]);
mkdirSync("docs", { recursive: true });
writeFileSync("docs/card-copy.csv", [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n");
console.log(`Exported ${rows.length} cards from ${cardSetV0.id} ${cardSetV0.version} to docs/card-copy.csv`);
