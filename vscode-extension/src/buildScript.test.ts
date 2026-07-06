import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("extension build script", () => {
  it("packages the bundled agent host as CommonJS", async () => {
    const source = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");

    expect(source).toContain('outfile: resolve(bundledHostDir, "cli.cjs")');
    expect(source).toContain('format: "cjs"');
  });
});
