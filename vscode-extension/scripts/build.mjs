import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const distDir = resolve(packageDir, "dist");
const bundledHostDir = resolve(packageDir, "host-dist", "agent-host");
const bundledHostEntry = resolve(packageDir, "../agent-host/src/cli.ts");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await rm(resolve(packageDir, "host-dist"), { recursive: true, force: true });
await mkdir(bundledHostDir, { recursive: true });

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

await build({
  absWorkingDir: packageDir,
  entryPoints: [bundledHostEntry],
  outfile: resolve(bundledHostDir, "cli.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
  // import.meta.url is unavailable in CJS format; cli.ts guards against
  // undefined at runtime via the isDirectExecution helper, so this is safe.
  logOverride: {
    "empty-import-meta": "silent"
  }
});
