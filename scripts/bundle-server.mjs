// Bundles the server into ONE plain-JS file for the games box (412 MB, Node 22, no node_modules, no tsx):
//   node scripts/bundle-server.mjs   →   dist/server/index.mjs
// Everything (viem, ws, the engine, the card set, tokens.json) goes in. ws's optional native accelerators are left external — ws
// catches their absence. Run it with the repo root as cwd: the server reads packages/client/dist and data/ relative to cwd.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist/server", { recursive: true });
const r = await build({
  entryPoints: ["packages/server/src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/server/index.mjs",
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  sourcemap: false,
  minify: false,
  logLevel: "info",
  metafile: true,
});
const bytes = Object.values(r.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`bundled: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
