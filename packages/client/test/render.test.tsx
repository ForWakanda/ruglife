// Fixtures rendered: every view of a recorded game renders, and every legal action of the viewer is reachable in the markup.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { Action, GameConfig } from "@ruglife/protocol";
import { apply, createGame, viewFor } from "@ruglife/engine";
import { TablePane, whoActs } from "../src/table.js";
import { newsLines } from "../src/news.js";

const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/standard-4.json", import.meta.url), "utf8")) as { config: GameConfig; actions: Action[] };

describe("client renders a recorded game", () => {
  it("every view renders; hands are hidden from the stands; the news reads", () => {
    let s = createGame(fixture.config);
    let rendered = 0, lines = 0;
    for (const a of fixture.actions) {
      const r = apply(s, a);
      s = r.state;
      const stands = viewFor(s, "stands");
      const html = renderToStaticMarkup(<TablePane view={stands} info={null} news={newsLines(stands, r.events)} at={0} onAct={() => {}} address={null} />);
      expect(html).toContain("GLOBAL ALERT NEWS");
      expect(stands.seats.every((x) => x.hand === null)).toBe(true);
      lines += newsLines(stands, r.events).length;
      for (const seat of s.seats) {
        const v = viewFor(s, seat.seat);
        const mine = renderToStaticMarkup(<TablePane view={v} info={null} news={[]} at={0} onAct={() => {}} address={null} />);
        if (v.legal.some((x) => x.type === "START_TROUBLE")) expect(mine).toContain("Start trouble");
        if (v.legal.some((x) => x.type === "END_TURN")) expect(mine).toContain("End turn");
        if (v.legal.some((x) => x.type === "ASK_HELP")) expect(mine).toContain("Ask for help");
        if (v.prompt?.kind === "rug" && v.prompt.seats.includes(seat.seat)) expect(mine).toContain("PULL THE RUG");
        rendered++;
      }
      if (s.phase !== "over") expect(whoActs(stands).length).toBeGreaterThan(0);
    }
    expect(s.phase).toBe("over");
    const final = renderToStaticMarkup(<TablePane view={viewFor(s, "stands")} info={null} news={[]} at={0} onAct={() => {}} address={null} />);
    expect(final).toContain("controls the world");
    expect(rendered).toBeGreaterThan(100);
    expect(lines).toBeGreaterThan(50);
  });
});
