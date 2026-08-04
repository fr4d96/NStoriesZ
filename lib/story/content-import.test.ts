import { describe, expect, it } from "vitest";
import {
  plainTextToBlocks,
  sanitizeHtmlToBlocks,
  MAX_IMPORT_INPUT_BYTES,
} from "@/lib/story/content-import";

describe("plainTextToBlocks", () => {
  it("splits blank-line-separated paragraphs into separate blocks", () => {
    const result = plainTextToBlocks("First paragraph.\n\nSecond paragraph.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toEqual([
      { type: "paragraph", text: [{ text: "First paragraph." }] },
      { type: "paragraph", text: [{ text: "Second paragraph." }] },
    ]);
    expect(result.report.blocksProduced).toBe(2);
  });

  it("collapses a single newline within a paragraph to a space", () => {
    const result = plainTextToBlocks("Line one\nLine two");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toEqual([
      { type: "paragraph", text: [{ text: "Line one Line two" }] },
    ]);
  });

  it("rejects raw input over MAX_IMPORT_INPUT_BYTES without parsing", () => {
    const huge = "a".repeat(MAX_IMPORT_INPUT_BYTES + 1);
    const result = plainTextToBlocks(huge);
    expect(result).toEqual({ ok: false, error: "input_too_large" });
  });

  it("rejects whitespace-only input as empty content", () => {
    const result = plainTextToBlocks("   \n\n   ");
    expect(result).toEqual({ ok: false, error: "empty_content" });
  });

  it("rejects content that exceeds the canonical schema's document character cap", () => {
    // Well under MAX_IMPORT_INPUT_BYTES but over storyContentSchema's 50,000
    // character document-wide cap -- proves the schema, not just the byte
    // gate, is the final authority.
    const result = plainTextToBlocks("x".repeat(60_000));
    expect(result).toEqual({ ok: false, error: "invalid_content" });
  });
});

describe("sanitizeHtmlToBlocks", () => {
  it("converts headings, paragraphs, and inline marks", () => {
    const result = sanitizeHtmlToBlocks(
      "<h1>Title</h1><p>Hello <strong>bold</strong> and <em>italic</em> text.</p>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks[0]).toEqual({
      type: "heading",
      level: 2,
      text: [{ text: "Title" }],
    });
    expect(result.blocks[1]).toMatchObject({ type: "paragraph" });
    const runs =
      result.blocks[1].type === "paragraph" ? result.blocks[1].text : [];
    expect(
      runs.some((r) => r.text === "bold" && r.marks?.includes("bold")),
    ).toBe(true);
    expect(
      runs.some((r) => r.text === "italic" && r.marks?.includes("italic")),
    ).toBe(true);
  });

  it("maps heading levels 1-6 onto the schema's allowed 2/3", () => {
    for (const [tag, expected] of [
      ["h1", 2],
      ["h2", 2],
      ["h3", 3],
      ["h4", 3],
      ["h5", 3],
      ["h6", 3],
    ] as const) {
      const result = sanitizeHtmlToBlocks(`<${tag}>Heading</${tag}>`);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.blocks[0]).toMatchObject({
        type: "heading",
        level: expected,
      });
    }
  });

  it("converts a safe link into a link mark using the shared isSafeHref matrix", () => {
    const result = sanitizeHtmlToBlocks(
      '<p>See <a href="https://example.com/path">this link</a>.</p>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runs =
      result.blocks[0].type === "paragraph" ? result.blocks[0].text : [];
    const linked = runs.find((r) => r.text === "this link");
    expect(linked?.marks).toEqual([
      { type: "link", href: "https://example.com/path" },
    ]);
  });

  it("drops an unsafe link's mark but keeps its text, and reports it (bounded, not logged)", () => {
    const result = sanitizeHtmlToBlocks(
      '<p>Click <a href="javascript:alert(1)">here</a>.</p>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runs =
      result.blocks[0].type === "paragraph" ? result.blocks[0].text : [];
    // The unsafe link's TEXT survives (merged with its unmarked neighbors,
    // since it now carries no marks either -- consecutive same-mark runs
    // are combined) but no run anywhere carries a link mark.
    expect(runs.map((r) => r.text).join("")).toBe("Click here.");
    expect(
      runs.every(
        (r) =>
          !r.marks?.some((m) => typeof m === "object" && m.type === "link"),
      ),
    ).toBe(true);
    expect(result.report.unsafeLinksRemovedCount).toBe(1);
    expect(result.report.unsafeLinksRemovedSample).toEqual([
      "javascript:alert(1)",
    ]);
  });

  it("removes dangerous subtrees entirely, never inspecting their text", () => {
    const result = sanitizeHtmlToBlocks(
      '<p>Safe text.</p><script>alert(document.cookie)</script><iframe src="evil"></iframe>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(1);
    expect(JSON.stringify(result.blocks)).not.toContain("alert");
    expect(result.report.droppedElements.script).toBe(1);
    expect(result.report.droppedElements.iframe).toBe(1);
  });

  it("strips event/presentational attributes from surviving elements", () => {
    const result = sanitizeHtmlToBlocks(
      '<p onclick="evil()" style="color:red" class="x">Text</p>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.blocks)).not.toContain("evil");
    expect(JSON.stringify(result.blocks)).not.toContain("color:red");
    expect(result.report.attributesStripped).toBeGreaterThan(0);
  });

  it("unwraps safe containers instead of dropping their text", () => {
    const result = sanitizeHtmlToBlocks(
      "<div><section><p>Nested text.</p></section></div>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toEqual([
      { type: "paragraph", text: [{ text: "Nested text." }] },
    ]);
  });

  it("flattens a nested list into one flat list block", () => {
    const result = sanitizeHtmlToBlocks(
      "<ul><li>One</li><li>Two<ul><li>Two A</li><li>Two B</li></ul></li></ul>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(1);
    const list = result.blocks[0];
    expect(list.type).toBe("list");
    if (list.type !== "list") return;
    expect(list.items).toHaveLength(4);
    expect(list.items.map((item) => item.map((r) => r.text).join(""))).toEqual([
      "One",
      "Two",
      "Two A",
      "Two B",
    ]);
  });

  it("flattens a nested blockquote into one quote block", () => {
    const result = sanitizeHtmlToBlocks(
      "<blockquote>Outer <blockquote>Inner</blockquote></blockquote>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("quote");
  });

  it("converts a table to a single plain-text paragraph and reports it", () => {
    const result = sanitizeHtmlToBlocks(
      "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("paragraph");
    expect(result.report.convertedTables).toBe(1);
  });

  it("converts a pre/code block to a single plain-text paragraph and reports it", () => {
    const result = sanitizeHtmlToBlocks("<pre><code>const x = 1;</code></pre>");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(1);
    expect(result.report.convertedCodeBlocks).toBeGreaterThanOrEqual(1);
  });

  it("splits a <br> into two runs within the same block, never two blocks", () => {
    const result = sanitizeHtmlToBlocks("<p>Line one<br>Line two</p>");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(1);
    const runs =
      result.blocks[0].type === "paragraph" ? result.blocks[0].text : [];
    expect(runs.map((r) => r.text)).toEqual(["Line one", "Line two"]);
  });

  it("drops unsupported leaf elements (e.g. img -- no inline image blocks) without crashing", () => {
    const result = sanitizeHtmlToBlocks(
      '<p>Look:</p><img src="photo.jpg" alt="a photo">',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(1);
    expect(result.report.unsupportedElements.img).toBe(1);
  });

  it("rejects raw HTML input over MAX_IMPORT_INPUT_BYTES before parsing", () => {
    const huge = `<p>${"a".repeat(MAX_IMPORT_INPUT_BYTES + 1)}</p>`;
    const result = sanitizeHtmlToBlocks(huge);
    expect(result).toEqual({ ok: false, error: "input_too_large" });
  });

  it("fully rejects (never truncates) input with too many nodes", () => {
    const manyNodes = Array.from(
      { length: 6000 },
      (_, i) => `<p>Line ${i}</p>`,
    ).join("");
    const result = sanitizeHtmlToBlocks(manyNodes);
    expect(result).toEqual({ ok: false, error: "too_many_nodes" });
  });

  it("fully rejects (never truncates) input nested too deeply", () => {
    const deep = "<div>".repeat(50) + "text" + "</div>".repeat(50);
    const result = sanitizeHtmlToBlocks(deep);
    expect(result).toEqual({ ok: false, error: "too_deeply_nested" });
  });

  it("rejects input that produces no usable content", () => {
    const result = sanitizeHtmlToBlocks("<div><script>evil()</script></div>");
    expect(result).toEqual({
      ok: false,
      error: "empty_content",
    });
  });

  it("every produced block validates against the canonical schema", () => {
    const result = sanitizeHtmlToBlocks(
      '<h2>Title</h2><p>Body <a href="/relative">link</a>.</p><ul><li>Item</li></ul><blockquote>Quote</blockquote>',
    );
    expect(result.ok).toBe(true);
  });
});
