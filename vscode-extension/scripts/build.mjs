import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const distDir = resolve(packageDir, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const tscBin = resolve(packageDir, "../node_modules/typescript/bin/tsc");

execFileSync(process.execPath, [tscBin, "-p", "tsconfig.json", "--emitDeclarationOnly"], {
  cwd: packageDir,
  stdio: "inherit"
});

await build({
  absWorkingDir: packageDir,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  sourcemap: false,
  logLevel: "info"
});
