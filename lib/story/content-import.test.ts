import { describe, expect, it } from "vitest";
import {
  plainTextToBlocks,
  sanitizeHtmlToBlocks,
  MAX_IMPORT_INPUT_BYTES,
} from "@/lib/story/content-import";
import { storyContentText } from "@/lib/validation/story";

describe("plainTextToBlocks", () => {
  it("splits blank-line-separated paragraphs, joined by a blank line", () => {
    const result = plainTextToBlocks("First paragraph.\n\nSecond paragraph.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe(
      "First paragraph.\n\nSecond paragraph.",
    );
    expect(result.report.blocksProduced).toBe(2);
  });

  it("collapses a single newline within a paragraph to a space", () => {
    const result = plainTextToBlocks("Line one\nLine two");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe("Line one Line two");
  });

  it("escapes a leading character that would otherwise look like a heading/list/quote marker", () => {
    const result = plainTextToBlocks("# Not a heading\n\n- Not a list item");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe(
      "\\# Not a heading\n\n\\- Not a list item",
    );
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
    const text = storyContentText(result.blocks);
    // h1 collapses to "##" -- a leading "#" is reserved for the story title.
    expect(text).toContain("## Title");
    expect(text).toContain("**bold**");
    expect(text).toContain("*italic*");
  });

  it("maps heading levels 1-6 onto ## through ######", () => {
    for (const [tag, expected] of [
      ["h1", "##"],
      ["h2", "##"],
      ["h3", "###"],
      ["h4", "####"],
      ["h5", "#####"],
      ["h6", "######"],
    ] as const) {
      const result = sanitizeHtmlToBlocks(`<${tag}>Heading</${tag}>`);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(storyContentText(result.blocks)).toBe(`${expected} Heading`);
    }
  });

  it("converts a safe link into Markdown link syntax using the shared isSafeHref matrix", () => {
    const result = sanitizeHtmlToBlocks(
      '<p>See <a href="https://example.com/path">this link</a>.</p>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe(
      "See [this link](https://example.com/path).",
    );
  });

  it("drops an unsafe link but keeps its text, and reports it (bounded, not logged)", () => {
    const result = sanitizeHtmlToBlocks(
      '<p>Click <a href="javascript:alert(1)">here</a>.</p>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe("Click here.");
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
    expect(storyContentText(result.blocks)).not.toContain("alert");
    expect(result.report.droppedElements.script).toBe(1);
    expect(result.report.droppedElements.iframe).toBe(1);
  });

  it("strips event/presentational attributes from surviving elements", () => {
    const result = sanitizeHtmlToBlocks(
      '<p onclick="evil()" style="color:red" class="x">Text</p>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).not.toContain("evil");
    expect(storyContentText(result.blocks)).not.toContain("color:red");
    expect(result.report.attributesStripped).toBeGreaterThan(0);
  });

  it("unwraps safe containers instead of dropping their text", () => {
    const result = sanitizeHtmlToBlocks(
      "<div><section><p>Nested text.</p></section></div>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe("Nested text.");
  });

  it("flattens a nested list into one flat list block", () => {
    const result = sanitizeHtmlToBlocks(
      "<ul><li>One</li><li>Two<ul><li>Two A</li><li>Two B</li></ul></li></ul>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe(
      "- One\n- Two\n- Two A\n- Two B",
    );
  });

  it("flattens a nested blockquote into one quote block", () => {
    const result = sanitizeHtmlToBlocks(
      "<blockquote>Outer <blockquote>Inner</blockquote></blockquote>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe("> Outer Inner");
  });

  it("converts a table to a single plain-text paragraph and reports it", () => {
    const result = sanitizeHtmlToBlocks(
      "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe("A B C D");
    expect(result.report.convertedTables).toBe(1);
  });

  it("converts a pre/code block to a single plain-text paragraph and reports it", () => {
    const result = sanitizeHtmlToBlocks("<pre><code>const x = 1;</code></pre>");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.convertedCodeBlocks).toBeGreaterThanOrEqual(1);
  });

  it("splits a <br> into two lines within the same block, never two blocks", () => {
    const result = sanitizeHtmlToBlocks("<p>Line one<br>Line two</p>");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe("Line one\nLine two");
    expect(result.report.blocksProduced).toBe(1);
  });

  it("drops unsupported leaf elements (e.g. img -- no inline image embeds from import) without crashing", () => {
    const result = sanitizeHtmlToBlocks(
      '<p>Look:</p><img src="photo.jpg" alt="a photo">',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(storyContentText(result.blocks)).toBe("Look:");
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

  it("every produced document validates against the canonical schema", () => {
    const result = sanitizeHtmlToBlocks(
      '<h2>Title</h2><p>Body <a href="/relative">link</a>.</p><ul><li>Item</li></ul><blockquote>Quote</blockquote>',
    );
    expect(result.ok).toBe(true);
  });
});
