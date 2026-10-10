// Append-only files; everything derived is rebuildable (tech-design § 7).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class Store {
  constructor(public readonly dir: string) {
    mkdirSync(join(dir, "tables"), { recursive: true });
  }
  tableLog(id: string, row: unknown): void {
    appendFileSync(join(this.dir, "tables", `${id}.jsonl`), JSON.stringify(row) + "\n");
  }
  readJson<T>(name: string, fallback: T): T {
    const p = join(this.dir, name);
    if (!existsSync(p)) return fallback;
    try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return fallback; }
  }
  writeJson(name: string, value: unknown): void {
    const p = join(this.dir, name);
    writeFileSync(p + ".tmp", JSON.stringify(value));
    writeFileSync(p, JSON.stringify(value));
  }
}
