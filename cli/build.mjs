import { chmod, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundles src/ together with the ai-tutor-todo-api contract, which ships as
// TypeScript source and so has to be inlined; the real npm dependencies stay
// external and resolve from node_modules at run time. This is also `prepare`,
// so a root `npm install` leaves a working `npx ai-tutor` behind.
const here = new URL(".", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", here), "utf8"));

await build({
  absWorkingDir: fileURLToPath(here),
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: Object.keys(pkg.dependencies),
  logLevel: "warning",
});

// On POSIX the bin is a symlink to this file, so it has to be executable.
await chmod(new URL("dist/index.js", here), 0o755);
