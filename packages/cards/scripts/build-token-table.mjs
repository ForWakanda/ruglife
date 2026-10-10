#!/usr/bin/env node
// Builds packages/cards/src/tokens.json from the Chog Genesis metadata mirror.
// Usage: node build-token-table.mjs [metadataDir]   (default ~/chogathon-prep/collection/metadata)
// The metadata is the collection's own (third-party) data; this script and its output are ours.
// Role rule = the exact Eyes → role table in the brain's role-map (58 values, 8 roles).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

const dir = process.argv[2] ?? join(homedir(), "chogathon-prep/collection/metadata");
const out = new URL("../src/tokens.json", import.meta.url);

const EYES = {
  face: ["Happy","Round","Normal Eye","Heart","Round Eye","Flat","Vertical","Base","XD","Red Round Eye","Blue Round Eye","Green Happy","Mixed Happy","Normal","Red Flat","Up","Blue Flat","Blue Happy","Green Round Eye","Mixed Round Eye"],
  safecracker: ["Purple laser","fire laser","Green laser","cyan laser"],
  muscle: ["Dead","Tired","Angry","MOG","Smirk","Chog Viper","Thug","Blue Smirk","Green Smirk"],
  lookout: ["Side Eye","Anime Glass","Retro Glass","3D Glass","BTC Glass","Green Side Eye","Mixed Side Eye"],
  sob: ["Round Crying","Round Tear","Closed Eye Crying","Teary","Worried"],
  hacker: ["Gradient visor","Sunset visor","Plasma visor","Modern VR","Classic VR"],
  degen: ["Frog","Clown Eye","Clown Eye Mix","Retard","Blue Retard","Mixed Retard","Green Retard","Red Retard"],
};
const eyesToRole = new Map();
for (const [role, vals] of Object.entries(EYES)) for (const v of vals) eyesToRole.set(v, role);

const SKINS = new Set(["Pink","Origin","Red","Black","Yellow"]);
const fileToTokenId = (file) => ((file - 1 - 1460) % 1969 + 1969) % 1969; // inverse of ((tokenId+1460) mod 1969)+1

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => Number(f.slice(0, -5))).sort((a, b) => a - b);
if (files.length !== 1969) throw new Error(`expected 1969 metadata files, found ${files.length}`);

const tokens = [];
const roleOf = {};
for (const file of files) {
  const m = JSON.parse(readFileSync(join(dir, `${file}.json`), "utf8"));
  const t = Object.fromEntries(m.attributes.map((a) => [a.trait_type, a.value]));
  let role;
  if (t.Tier === "Legendary") role = "legend";
  else {
    role = eyesToRole.get(t.Eyes);
    if (!role) throw new Error(`file ${file}: unmapped Eyes "${t.Eyes}"`);
  }
  roleOf[file] = role === "sob" ? "Sob Story" : role === "legend" ? "Legend" : role[0].toUpperCase() + role.slice(1);
  const tokenId = fileToTokenId(file);
  if (((tokenId + 1460) % 1969) + 1 !== file) throw new Error(`offset round trip failed for ${file}`);
  const skin = SKINS.has(t.Skin) ? t.Skin.toLowerCase() : null; // null = rare skin, picks one at sit-down
  tokens.push({
    file, tokenId, name: m.name, role,
    skin, rareSkin: skin ? null : (t.Skin ?? null),
    tier: t.Tier, base: t.Base, form: t.Form,
    traits: { eyes: t.Eyes ?? null, head: t.Head ?? null, body: t.Body ?? null, accessory: t.Accessory ?? null, mouth: t.Mouth ?? null, aura: t.Aura ?? null, background: t.Background ?? null, side: t.Side ?? null, naked: t.Naked ?? null },
  });
}
// Hash check against the brain's role-map: sha256 of JSON {file: RoleName} with sorted keys.
const sorted = Object.fromEntries(Object.keys(roleOf).map(Number).sort((a, b) => a - b).map((k) => [String(k), roleOf[k]]));
const roleHash = createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
// python json.dumps(sort_keys=True) uses ", " and ": " separators — try that too.
const pyJson = "{" + Object.entries(sorted).map(([k, v]) => `"${k}": "${v}"`).join(", ") + "}";
const roleHashPy = createHash("sha256").update(pyJson).digest("hex");
const counts = {};
for (const tk of tokens) counts[tk.role] = (counts[tk.role] ?? 0) + 1;
const expected = { face: 551, safecracker: 277, muscle: 277, lookout: 267, sob: 267, hacker: 208, degen: 112, legend: 10 };
for (const [r, n] of Object.entries(expected)) if (counts[r] !== n) throw new Error(`role ${r}: ${counts[r]} != ${n}`);
tokens.sort((a, b) => a.tokenId - b.tokenId);
writeFileSync(out, JSON.stringify({ collection: "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763", chainId: 143, total: tokens.length, roleCounts: counts, roleHash, tokens }));
console.log(JSON.stringify({ total: tokens.length, counts, roleHash, roleHashPy, expectedRoleMapHash: "3876274eb4cd4668b2f3f891bea1cf212ef5ae5e9f365178145f7574b702a3b7" }, null, 1));
