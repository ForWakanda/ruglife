import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { replay } from "../src/sim.js";

const dir = join(import.meta.dirname, "../../../fixtures");
describe("recorded games replay byte-identically", () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    it(f, () => {
      const fx = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const r = replay(fx.config, fx.actions);
      expect(r.digest).toBe(fx.digest);
      expect(r.events.length).toBe(fx.eventCount);
      expect(r.final.winner).toBe(fx.winner);
    });
  }
});
