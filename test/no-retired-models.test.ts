import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CODE_DIRS = ["app", "scripts", "src", "test"];
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const RETIRED_GEMINI_MODEL_FRAGMENT = ["gemini", "2.0"].join("-");

describe("retired model guard", () => {
  it("does not reference Gemini 2.0 in code", () => {
    const matches = CODE_DIRS.flatMap((dir) => scanCodeFiles(join(process.cwd(), dir)))
      .filter(({ content }) => content.toLowerCase().includes(RETIRED_GEMINI_MODEL_FRAGMENT))
      .map(({ path }) => path.replace(`${process.cwd()}/`, ""));

    expect(matches).toEqual([]);
  });
});

function scanCodeFiles(path: string): Array<{ path: string; content: string }> {
  const stats = statSync(path);

  if (stats.isFile()) {
    return CODE_EXTENSIONS.has(extensionFor(path))
      ? [{ path, content: readFileSync(path, "utf8") }]
      : [];
  }

  return readdirSync(path).flatMap((entry) => scanCodeFiles(join(path, entry)));
}

function extensionFor(path: string) {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}
