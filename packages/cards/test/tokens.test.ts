import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cardSetV0, fileOf, tokenById, tokenByFile, tokenIdOf, tokens } from "../src/index.js";

describe("token table", () => {
  it("has all 1,969 Chogs with the role split of the rules spec", () => {
    expect(tokens.total).toBe(1969);
    expect(tokens.roleCounts).toEqual({ face: 551, safecracker: 277, muscle: 277, lookout: 267, sob: 267, hacker: 208, degen: 112, legend: 10 });
  });
  it("reproduces the brain's role-map hash (sha256 of {file: Role} with python's separators)", () => {
    const names: Record<string, string> = { face: "Face", safecracker: "Safecracker", muscle: "Muscle", lookout: "Lookout", sob: "Sob Story", hacker: "Hacker", degen: "Degen", legend: "Legend" };
    const sorted = [...tokens.tokens].sort((a, b) => a.file - b.file);
    const py = "{" + sorted.map((t) => `"${t.file}": "${names[t.role]}"`).join(", ") + "}";
    expect(createHash("sha256").update(py).digest("hex")).toBe("3876274eb4cd4668b2f3f891bea1cf212ef5ae5e9f365178145f7574b702a3b7");
  });
  it("maps the marketplace number both ways (the number is not the tokenId)", () => {
    expect(fileOf(1)).toBe(1462); expect(fileOf(2)).toBe(1463); expect(fileOf(1969 - 1)).toBe(1460);
    expect(fileOf(287)).toBe(1748); expect(fileOf(1659)).toBe(1151);
    for (let id = 0; id < 1969; id++) expect(tokenIdOf(fileOf(id))).toBe(id);
    expect(tokenById(287)?.name).toBe("CHOG #1748");
    expect(tokenById(287)?.role).toBe("lookout");
    expect(tokenByFile(1151)?.role).toBe("safecracker");
  });
  it("the ten Legends have no eyes", () => {
    const legends = tokens.tokens.filter((t) => t.role === "legend");
    expect(legends).toHaveLength(10);
    for (const l of legends) { expect(l.tier).toBe("Legendary"); expect(l.traits.eyes).toBeNull(); }
  });
  it("card set v0 has every type and ids are unique", () => {
    const ids = new Set(cardSetV0.cards.map((c) => c.id));
    expect(ids.size).toBe(cardSetV0.cards.length);
    for (const t of ["threat", "fud", "boost", "gear", "oneshot", "levelup", "key"]) expect(cardSetV0.cards.some((c) => c.type === t)).toBe(true);
    expect(cardSetV0.cards.filter((c) => c.type === "threat" && (c.levelsWon ?? 1) >= 2).length).toBeGreaterThanOrEqual(3);
  });
});
