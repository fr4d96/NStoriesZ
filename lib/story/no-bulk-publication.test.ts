import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Prompt 7's brief is explicit: "Do not add bulk publication ... every story
// still requires individual review." This is a structural regression test,
// not a UI assertion -- it fails the moment any bulk-shaped
// publish/approve/moderate function name is added anywhere in lib/story/ or
// the generated database types, regardless of whether it's ever wired into a
// page.

const BULK_NAME_PATTERN =
  /\bbulk[_-]?(publish|approve|moderate)|\b(publish|approve|moderate)[_-]?bulk\b/i;

function readTextFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      readTextFiles(full, out);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("no bulk publication path", () => {
  it("lib/story/ defines no bulk publish/approve/moderate function", () => {
    const root = path.join(__dirname, "..", "..", "lib", "story");
    const files = readTextFiles(root);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const exportedFunctionNames =
        content.match(/export\s+(?:async\s+)?function\s+(\w+)/g) ?? [];
      for (const match of exportedFunctionNames) {
        if (BULK_NAME_PATTERN.test(match)) {
          offenders.push(`${file}: ${match}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the generated Supabase RPC surface has no bulk publish/approve/moderate function", () => {
    const typesPath = path.join(__dirname, "..", "..", "types", "database.ts");
    const content = readFileSync(typesPath, "utf8");
    const functionsSectionMatch = content.match(
      /Functions:\s*\{([\s\S]*?)\n\s{4}\}/,
    );
    expect(functionsSectionMatch).not.toBeNull();
    const functionNames =
      functionsSectionMatch![1].match(/^\s{6}(\w+):\s*\{/gm) ?? [];
    const offenders = functionNames.filter((name) =>
      BULK_NAME_PATTERN.test(name),
    );
    expect(offenders).toEqual([]);
  });
});
