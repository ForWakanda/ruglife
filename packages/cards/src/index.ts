import type { CardSet, TokenRow } from "@ruglife/protocol";
import tokensJson from "./tokens.json" with { type: "json" };
export { cardSetV0 } from "./set-v0.js";

export interface TokenTable {
  collection: string;
  chainId: number;
  total: number;
  roleCounts: Record<string, number>;
  roleHash: string;
  tokens: TokenRow[];
}
export const tokens = tokensJson as unknown as TokenTable;
const byTokenId = new Map<number, TokenRow>(tokens.tokens.map((t) => [t.tokenId, t]));
const byFile = new Map<number, TokenRow>(tokens.tokens.map((t) => [t.file, t]));
export const tokenById = (tokenId: number): TokenRow | undefined => byTokenId.get(tokenId);
export const tokenByFile = (file: number): TokenRow | undefined => byFile.get(file);
/** The marketplace number is NOT the tokenId: file = ((tokenId + 1460) mod 1969) + 1. */
export const fileOf = (tokenId: number): number => ((tokenId + 1460) % 1969) + 1;
export const tokenIdOf = (file: number): number => (((file - 1 - 1460) % 1969) + 1969) % 1969;

export const cardSets: Record<string, CardSet> = {};
import { cardSetV0 as v0 } from "./set-v0.js";
cardSets[v0.id] = v0;

/** Rejects a set that uses an effect the engine does not implement yet, or a malformed row. */
export function validateCardSet(set: CardSet, supported: ReadonlySet<string>): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const c of set.cards) {
    if (ids.has(c.id)) errs.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    const effects = [...c.effects, ...(c.badStuff ?? [])];
    for (const e of effects) if (!supported.has(e.kind)) errs.push(`${c.id}: effect ${e.kind} unsupported`);
    if (c.type === "threat") {
      if (!c.level || !c.bags || !c.badStuff) errs.push(`${c.id}: threat needs level, bags, badStuff`);
      if (c.deck !== "trouble") errs.push(`${c.id}: threat must be in trouble`);
    }
    if (c.type === "gear") {
      if (!c.slot || c.bonus === undefined || c.value === undefined) errs.push(`${c.id}: gear needs slot, bonus, value`);
      if (c.deck !== "loot") errs.push(`${c.id}: gear must be in loot`);
    }
    if ((c.type === "fud" || c.type === "boost") && c.deck !== "trouble") errs.push(`${c.id}: ${c.type} must be in trouble`);
    if ((c.type === "levelup" || c.type === "key") && c.deck !== "loot") errs.push(`${c.id}: ${c.type} must be in loot`);
    if (c.type === "boost" && !c.effects.every((e) => (e.kind === "power" && e.side === "threat") || e.kind === "bags")) errs.push(`${c.id}: a boost only modifies the threat (power side threat, bags)`);
    if (c.type === "fud" && !c.effects.every((e) => ["levels", "rekt", "discard", "kitOff", "stealGear", "skipTurn"].includes(e.kind))) errs.push(`${c.id}: fud effect not allowed`);
    if (c.type === "fud" && c.effects.some((e) => e.kind === "levels" && e.n > 0)) errs.push(`${c.id}: fud cannot add levels`);
  }
  return errs;
}
