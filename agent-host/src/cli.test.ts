import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("agent host CLI", () => {
  it("does not configure file-backed session storage by default", async () => {
    const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");

    expect(source).not.toContain("FileSessionStorage");
    expect(source).not.toContain("loadFromStorage");
  });
});
