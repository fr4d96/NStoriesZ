import { describe, expect, it } from "vitest";
import { htmlPasteToMarkdown } from "./html-paste";

function md(html: string): string {
  const result = htmlPasteToMarkdown(html);
  if (!result.ok) throw new Error(`conversion failed: ${result.reason}`);
  return result.markdown;
}

describe("htmlPasteToMarkdown — structure", () => {
  it("separates block elements with a blank line", () => {
    expect(md("<p>First para.</p><p>Second para.</p>")).toBe(
      "First para.\n\nSecond para.",
    );
  });

  it("maps headings, collapsing h1 to ## because # is the story title", () => {
    expect(md("<h1>Arrival</h1>")).toBe("## Arrival");
    expect(md("<h2>Arrival</h2>")).toBe("## Arrival");
    expect(md("<h3>Week one</h3>")).toBe("### Week one");
    expect(md("<h6>Aside</h6>")).toBe("###### Aside");
  });

  it("converts unordered and ordered lists", () => {
    expect(md("<ul><li>Apples</li><li>Pears</li></ul>")).toBe(
      "- Apples\n- Pears",
    );
    expect(md("<ol><li>Land</li><li>Find work</li></ol>")).toBe(
      "1. Land\n2. Find work",
    );
  });

  it("flattens a nested list into the same list", () => {
    expect(
      md("<ul><li>Islands<ul><li>North</li><li>South</li></ul></li></ul>"),
    ).toBe("- Islands\n- North\n- South");
  });

  it("converts a blockquote, prefixing every line", () => {
    expect(md("<blockquote><p>Just go.</p></blockquote>")).toBe("> Just go.");
  });

  it("collapses a table to one plain-text paragraph rather than guessing a grid", () => {
    const result = md(
      "<table><tr><td>Week</td><td>Job</td></tr><tr><td>1</td><td>Kiwi picking</td></tr></table>",
    );
    expect(result).toContain("Week");
    expect(result).toContain("Kiwi picking");
    expect(result).not.toContain("|");
  });

  it("unwraps unknown and container tags instead of losing their text", () => {
    expect(md("<div><section><p>Kept.</p></section></div>")).toBe("Kept.");
    expect(md("<weird-tag><p>Also kept.</p></weird-tag>")).toBe("Also kept.");
  });

  it("turns <br> into a Markdown hard break, not a soft one", () => {
    // Two trailing spaces before the newline: a bare "\n" would render as a
    // space and silently merge two deliberately separate lines.
    expect(md("<p>Line one<br>Line two</p>")).toBe("Line one  \nLine two");
  });
});

describe("htmlPasteToMarkdown — emphasis", () => {
  it("converts semantic emphasis tags", () => {
    expect(md("<p><strong>Bold</strong> and <em>italic</em></p>")).toBe(
      "**Bold** and *italic*",
    );
    expect(md("<p><s>Gone</s></p>")).toBe("~~Gone~~");
  });

  it("reads Google Docs' inline styles, which use spans rather than tags", () => {
    expect(md('<p><span style="font-weight:700">Bold</span> text</p>')).toBe(
      "**Bold** text",
    );
    expect(md('<p><span style="font-style:italic">Slanted</span></p>')).toBe(
      "*Slanted*",
    );
    expect(
      md('<p><span style="text-decoration:line-through">Cut</span></p>'),
    ).toBe("~~Cut~~");
  });

  it("does not bold the whole document because of Google Docs' <b style=font-weight:normal> wrapper", () => {
    const googleDocs =
      '<b style="font-weight:normal" id="docs-internal-guid-x">' +
      "<p>Ordinary paragraph.</p></b>";
    expect(md(googleDocs)).toBe("Ordinary paragraph.");
  });

  it("never wraps a whitespace-only run in emphasis markers", () => {
    expect(md("<p>a<strong> </strong>b</p>")).toBe("a b");
  });

  it("has no representation for underline, by design", () => {
    expect(md("<p><u>Underlined</u></p>")).toBe("Underlined");
  });
});

describe("htmlPasteToMarkdown — safety", () => {
  it("removes dangerous subtrees entirely, text included", () => {
    const result = md("<p>Before</p><script>alert('x')</script><p>After</p>");
    expect(result).toBe("Before\n\nAfter");
    expect(result).not.toContain("alert");
  });

  it("never emits image syntax — images only enter as ![[mediaId]] embed tokens", () => {
    const result = md(
      '<p>Look<img src="https://example.com/a.jpg" alt="a"></p>',
    );
    expect(result).toBe("Look");
    expect(result).not.toContain("![");
  });

  it("keeps a safe http(s) link", () => {
    expect(md('<p><a href="https://example.com">Guide</a></p>')).toBe(
      "[Guide](https://example.com)",
    );
  });

  it("drops an unsafe href but keeps the words, and counts it", () => {
    const result = htmlPasteToMarkdown(
      '<p>Read <a href="javascript:alert(1)">this</a> now</p>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toBe("Read this now");
    expect(result.unsafeLinksRemoved).toBe(1);
  });

  it("drops a mailto: link the same way (only http/https are safe hrefs)", () => {
    const result = htmlPasteToMarkdown(
      '<p><a href="mailto:me@example.com">Email me</a></p>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toBe("Email me");
    expect(result.unsafeLinksRemoved).toBe(1);
  });

  it("escapes literal Markdown characters so pasted text can't become formatting", () => {
    expect(md("<p>Cost was 5 * 3 [approx] ~ NZD</p>")).toBe(
      "Cost was 5 \\* 3 \\[approx\\] \\~ NZD",
    );
  });

  it("escapes a leading block marker so a pasted line can't become a heading", () => {
    expect(md("<p># Not a heading</p>")).toBe("\\# Not a heading");
  });
});

describe("htmlPasteToMarkdown — failure modes (caller falls back to plain paste)", () => {
  it("rejects markup with no text at all", () => {
    const result = htmlPasteToMarkdown("<div><span></span></div>");
    expect(result).toEqual({ ok: false, reason: "empty_content" });
  });

  it("rejects an oversized payload rather than truncating it", () => {
    const result = htmlPasteToMarkdown(`<p>${"x".repeat(2_000_001)}</p>`);
    expect(result).toEqual({ ok: false, reason: "input_too_large" });
  });

  it("rejects a payload with too many nodes", () => {
    const result = htmlPasteToMarkdown("<p>hi</p>".repeat(20_001));
    expect(result).toEqual({ ok: false, reason: "too_many_nodes" });
  });

  it("rejects a payload nested past the depth cap", () => {
    const deep = "<div>".repeat(70) + "text" + "</div>".repeat(70);
    const result = htmlPasteToMarkdown(deep);
    expect(result).toEqual({ ok: false, reason: "too_deeply_nested" });
  });

  it("rejects content the story content schema itself would reject", () => {
    // Over storyContentSchema's 50,000-character ceiling, but under this
    // module's own input cap -- the schema is the real content boundary.
    const result = htmlPasteToMarkdown(`<p>${"word ".repeat(11_000)}</p>`);
    expect(result).toEqual({ ok: false, reason: "invalid_content" });
  });
});

describe("htmlPasteToMarkdown — a realistic Google Docs paste", () => {
  it("keeps headings, emphasis, a link and a list from one document", () => {
    const html = `
      <meta charset="utf-8">
      <b style="font-weight:normal" id="docs-internal-guid-1">
        <h1 dir="ltr"><span style="font-weight:700">Six months in Otago</span></h1>
        <p dir="ltr"><span>I landed in </span><span style="font-weight:700">Queenstown</span><span> with </span><span style="font-style:italic">no plan</span><span>.</span></p>
        <ul><li dir="ltr"><p dir="ltr"><span>Cherry picking</span></p></li><li dir="ltr"><p dir="ltr"><span>Hostel reception</span></p></li></ul>
        <p dir="ltr"><a href="https://example.com/visa">The official page</a></p>
      </b>`;
    expect(md(html)).toBe(
      [
        "## **Six months in Otago**",
        "I landed in **Queenstown** with *no plan*.",
        "- Cherry picking\n- Hostel reception",
        "[The official page](https://example.com/visa)",
      ].join("\n\n"),
    );
  });
});
