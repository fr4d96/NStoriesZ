// @vitest-environment node
//
// server-only throws outside Next's own bundler, same as
// lib/story/image-pipeline.test.ts — mocked to a no-op here for the same
// reason.
import { describe, expect, it, vi, beforeAll } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

const { buildStoryPdf, segmentByFont, storyPdfFilename } =
  await import("@/lib/story/story-pdf");
type StoryPdfInput = Parameters<typeof buildStoryPdf>[0];
type StoryPdfImage = StoryPdfInput["images"][number];

const EXPORTED_AT = new Date("2026-09-07T02:30:00.000Z");

/** A real, decodable JPEG — pdfkit embeds actual bytes, not a stub. */
async function testImage(
  mediaId: string,
  overrides: Partial<StoryPdfImage> = {},
): Promise<StoryPdfImage> {
  const width = 800;
  const height = 600;
  const bytes = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 90, g: 130, b: 110 },
    },
  })
    .jpeg()
    .toBuffer();
  return {
    mediaId,
    bytes,
    width,
    height,
    altText: null,
    caption: null,
    decorative: false,
    ...overrides,
  };
}

function input(overrides: Partial<StoryPdfInput> = {}): StoryPdfInput {
  return {
    title: "A year in Whangārei",
    excerpt: "Picking kiwifruit, and what it actually cost.",
    attributionValue: "Aisyah R.",
    markdown: "It rained for a week.",
    images: [],
    tripLabel: "2025-03-01 – 2026-02-28",
    travelStyleLabel: "Budget",
    locations: ["Manawatū", "Whakatāne"],
    tags: ["kiwifruit", "first job"],
    expenses: [],
    totalExpenseNzdCents: null,
    statusLabel: "Published",
    exportedAt: EXPORTED_AT,
    siteUrl: "https://kakinotes.example",
    ...overrides,
  };
}

/** Every text run in the rendered PDF, via pdfjs-dist. */
async function extractText(pdf: Buffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
  });
  const doc = await task.promise;
  try {
    let out = "";
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await (await doc.getPage(page)).getTextContent();
      for (const item of content.items) {
        if ("str" in item) out += item.str;
      }
      out += "\n";
    }
    return out;
  } finally {
    await task.destroy();
  }
}

async function pageCount(pdf: Buffer): Promise<number> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjsLib.getDocument({ data: new Uint8Array(pdf) });
  const doc = await task.promise;
  try {
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}

/** Collapses segments to a compact "text|font" form for readable assertions. */
function shape(text: string): string {
  return segmentByFont(text)
    .map((s) => `${s.text}|${s.fallback ?? "primary"}`)
    .join(" ");
}

describe("segmentByFont", () => {
  it("keeps Latin and macrons on the primary face", () => {
    // The whole reason this module does not use a PDF base-14 font.
    expect(shape("Manawatū Whakatāne")).toBe("Manawatū Whakatāne|primary");
  });

  it("keeps typographic punctuation on the primary face", () => {
    expect(shape("“curly” — dash … café Zoë")).toBe(
      "“curly” — dash … café Zoë|primary",
    );
  });

  it("routes Chinese to the CJK face", () => {
    expect(shape("陈美玲")).toBe("陈美玲|cjk");
  });

  it("routes emoji to the emoji face", () => {
    expect(shape("🌏")).toBe("🌏|emoji");
  });

  it("splits a mixed string without dragging Latin into the CJK face", () => {
    // Noto Sans SC carries Latin glyphs too, so checking it before the
    // primary face would quietly re-typeset every ASCII letter.
    const segments = segmentByFont("Hi 陈美玲 there");
    expect(segments.map((s) => s.fallback)).toEqual([null, "cjk", null]);
    expect(segments.map((s) => s.text)).toEqual(["Hi ", "陈美玲", " there"]);
  });

  it("still falls back to ? for a script no face covers", () => {
    // Devanagari is in neither Liberation Sans nor either fallback.
    const segments = segmentByFont("नमस्ते");
    expect(segments).toHaveLength(1);
    expect(segments[0].fallback).toBeNull();
    expect(segments[0].text).toMatch(/^\?+$/);
  });

  it("keeps newlines and tabs but drops other control characters", () => {
    expect(shape("a\nb\tc\u0007d")).toBe("a\nb\tcd|primary");
  });
});

describe("storyPdfFilename", () => {
  it("slugifies to ASCII and dates the file", () => {
    expect(storyPdfFilename("A year in Whangārei", EXPORTED_AT)).toBe(
      "a-year-in-whangarei-2026-09-07.pdf",
    );
  });

  it("falls back rather than producing a bare dash for an unsluggable title", () => {
    expect(storyPdfFilename("陈美玲", EXPORTED_AT)).toBe(
      "story-2026-09-07.pdf",
    );
  });

  it("does not end the slug in a dash after truncation", () => {
    const name = storyPdfFilename(
      "x".repeat(40) + " " + "y".repeat(40),
      EXPORTED_AT,
    );
    expect(name).not.toContain("--");
    expect(name).toMatch(/^[a-z0-9-]+-2026-09-07\.pdf$/);
  });
});

describe("buildStoryPdf", () => {
  it("produces a structurally valid PDF", async () => {
    const pdf = await buildStoryPdf(input());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-1024).toString("latin1")).toContain("%%EOF");
  });

  it("puts the brand letterhead on page one", async () => {
    // The wordmark is real text, so it survives extraction.
    const text = await extractText(await buildStoryPdf(input()));
    expect(text).toContain("Kakinotes");
  });

  it("embeds the brand mark itself, not just the word", async () => {
    // WHY THIS EXISTS: brandMarkBytes() returns null rather than throwing
    // when public/kakinotes-icon.png cannot be read -- a missing logo must
    // never 500 a contributor's download of their own writing. The cost of
    // that choice is that losing the file would be SILENT. This input has no
    // story photos, so any embedded image is the letterhead mark; if the
    // file disappears or moves, this fails instead of shipping a logo-less
    // export nobody notices.
    const pdf = await buildStoryPdf(input({ images: [] }));
    expect(pdf.includes(Buffer.from("/Image"))).toBe(true);
  });

  it("renders the title, macron place names and the story text", async () => {
    const text = await extractText(
      await buildStoryPdf(
        input({ markdown: "We drove south from Whangārei to Manawatū." }),
      ),
    );
    expect(text).toContain("A year in Whangārei");
    expect(text).toContain("We drove south from Whangārei to Manawatū.");
    // The facts block.
    expect(text).toContain("Manawatū, Whakatāne");
  });

  it("carries the personal-experience label (Engineering Rule 17)", async () => {
    const text = await extractText(await buildStoryPdf(input()));
    expect(text).toContain("Personal experience, not advice");
    // "First name + initial" is one of the product's attribution styles, so
    // the label must not end up crediting "Aisyah R..".
    expect(text).toContain("shared by Aisyah R.");
    expect(text).not.toContain("Aisyah R..");
  });

  it("does add a full stop to an attribution that lacks one", async () => {
    const text = await extractText(
      await buildStoryPdf(input({ attributionValue: "Tui" })),
    );
    expect(text).toContain("shared by Tui.");
  });

  it("says which version of the story this copy is", async () => {
    const text = await extractText(
      await buildStoryPdf(input({ statusLabel: "Draft" })),
    );
    expect(text).toContain("(Draft)");
    expect(text).toContain("exported from Kakinotes on 2026-09-07");
  });

  it("renders headings, lists, task lists, quotes and tables", async () => {
    const markdown = [
      "## Finding work",
      "",
      "Some **bold** and *italic* and ~~struck~~ text.",
      "",
      "- first bullet",
      "- second bullet",
      "",
      "1. step one",
      "2. step two",
      "",
      "- [x] packed",
      "- [ ] unpacked",
      "",
      "> It rained the whole first week.",
      "",
      "| Item | Cost |",
      "| --- | --- |",
      "| Hostel | 200 |",
      "",
      "---",
      "",
      "### Smaller heading",
    ].join("\n");
    const text = await extractText(await buildStoryPdf(input({ markdown })));

    expect(text).toContain("Finding work");
    expect(text).toContain("Smaller heading");
    expect(text).toContain("first bullet");
    expect(text).toContain("step one");
    expect(text).toContain("packed");
    expect(text).toContain("It rained the whole first week.");
    expect(text).toContain("Hostel");
    expect(text).toContain("Cost");
    // Ordered-list numbers are drawn as markers, not part of the item text.
    expect(text).toContain("1.");
  });

  it("keeps link text but drops an unsafe href", async () => {
    const markdown =
      "See [the rules](https://immigration.govt.nz) and [this](javascript:alert(1)).";
    const pdf = await buildStoryPdf(input({ markdown }));
    const text = await extractText(pdf);

    expect(text).toContain("the rules");
    // Text survives; the href does not reach the file at all.
    expect(text).toContain("this");
    expect(pdf.toString("latin1")).not.toContain("javascript:");
  });

  it("places an embedded photo inline and does not repeat it in the gallery", async () => {
    const image = await testImage("11111111-1111-4111-8111-111111111111", {
      caption: "The orchard at dawn",
    });
    const text = await extractText(
      await buildStoryPdf(
        input({
          markdown: `Before.\n\n![[${image.mediaId}]]\n\nAfter.`,
          images: [image],
        }),
      ),
    );

    expect(text).toContain("Before.");
    expect(text).toContain("The orchard at dawn");
    expect(text).toContain("After.");
    // Every attached image was placed, so there is no trailing gallery.
    expect(text).not.toContain("More photos");
  });

  it("collects unplaced photos into a gallery at the end", async () => {
    const placed = await testImage("11111111-1111-4111-8111-111111111111");
    const unplaced = await testImage("22222222-2222-4222-8222-222222222222", {
      caption: "Left over",
    });
    const text = await extractText(
      await buildStoryPdf(
        input({
          markdown: `![[${placed.mediaId}]]`,
          images: [placed, unplaced],
        }),
      ),
    );

    expect(text).toContain("More photos");
    expect(text).toContain("Left over");
  });

  it("falls back to alt text when a photo has no caption, but not when decorative", async () => {
    const described = await testImage("11111111-1111-4111-8111-111111111111", {
      altText: "A row of kiwifruit vines",
    });
    const decorative = await testImage("22222222-2222-4222-8222-222222222222", {
      altText: "A divider flourish",
      decorative: true,
    });
    const text = await extractText(
      await buildStoryPdf(input({ images: [described, decorative] })),
    );

    expect(text).toContain("A row of kiwifruit vines");
    expect(text).not.toContain("A divider flourish");
  });

  it("renders the expense breakdown with a total", async () => {
    const text = await extractText(
      await buildStoryPdf(
        input({
          expenses: [
            { name: "Rent", amountNzdCents: 780000, note: "shared room" },
            { name: "Food", amountNzdCents: 312050, note: null },
          ],
          totalExpenseNzdCents: 1092050,
        }),
      ),
    );

    expect(text).toContain("What it cost");
    expect(text).toContain("Rent");
    expect(text).toContain("shared room");
    expect(text).toContain("$7,800.00");
    expect(text).toContain("Total");
    expect(text).toContain("$10,920.50");
  });

  it("renders Chinese in the title, the body and the facts block", async () => {
    const pdf = await buildStoryPdf(
      input({
        title: "陈美玲 in Whangārei",
        attributionValue: "陈美玲",
        markdown: "## 找工作\n\n我在紐西蘭的一年。It rained.",
        tags: ["奇异果", "first job"],
      }),
    );
    const text = await extractText(pdf);
    expect(text).toContain("陈美玲 in Whangārei");
    expect(text).toContain("找工作");
    expect(text).toContain("我在紐西蘭的一年。It rained.");
    expect(text).toContain("奇异果");
    // The whole point: no question marks where the glyphs used to be missing.
    expect(text).not.toContain("???");
  });

  it("renders emoji instead of dropping them", async () => {
    const text = await extractText(
      await buildStoryPdf(
        input({ markdown: "We picked kiwifruit 🥝 and left 🌏" }),
      ),
    );
    expect(text).toContain("🥝");
    expect(text).toContain("🌏");
  });

  it("keeps the file small even though the CJK font is 10 MB", async () => {
    // pdfkit subsets: only the glyphs actually used are embedded. This is the
    // whole reason a 10 MB fallback face is affordable — the cost lands on the
    // deployment, not on every contributor's download.
    const pdf = await buildStoryPdf(
      input({ markdown: "我在紐西蘭的一年，非常好。" }),
    );
    expect(pdf.byteLength).toBeLessThan(400_000);
  });

  it("does not re-typeset Latin text in the CJK face", async () => {
    // Noto Sans SC has Latin glyphs too. If coverage were checked in the
    // wrong order the whole document would silently change typeface, which is
    // invisible in extracted text — so assert on the embedded font names.
    const pdf = await buildStoryPdf(
      input({ markdown: "Mostly English with one 陈 character." }),
    );
    const raw = pdf.toString("latin1");
    expect(raw).toContain("LiberationSans");
    expect(raw).toContain("NotoSansSC");
  });

  it("survives an empty story body", async () => {
    const pdf = await buildStoryPdf(input({ markdown: "" }));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(await extractText(pdf)).toContain("A year in Whangārei");
  });

  it("ignores an embed token whose media is not attached", async () => {
    const pdf = await buildStoryPdf(
      input({
        markdown:
          "Before.\n\n![[33333333-3333-4333-8333-333333333333]]\n\nAfter.",
      }),
    );
    const text = await extractText(pdf);
    expect(text).toContain("Before.");
    expect(text).toContain("After.");
    // The raw token must never be printed as literal text.
    expect(text).not.toContain("33333333-3333");
  });

  it("paginates a long story and numbers every page", async () => {
    const markdown = Array.from(
      { length: 90 },
      (_, i) => `Paragraph ${i + 1}. ${"The weather turned again. ".repeat(6)}`,
    ).join("\n\n");
    const pdf = await buildStoryPdf(input({ markdown }));
    const pages = await pageCount(pdf);
    expect(pages).toBeGreaterThan(2);

    const text = await extractText(pdf);
    // The footer runs on every page, so the last page number appears.
    expect(text).toContain(String(pages));
    expect(text).toContain("Paragraph 90.");
  });

  it("never renders raw HTML from a legacy document", async () => {
    const pdf = await buildStoryPdf(
      input({ markdown: "<script>alert(1)</script>\n\nReal text." }),
    );
    const text = await extractText(pdf);
    expect(text).toContain("Real text.");
    expect(text).not.toContain("alert(1)");
  });
});

describe("font loading", () => {
  /**
   * Regression guard for a failure that is INVISIBLE locally: pdfkit
   * initialises a document with Helvetica and reads
   * `node_modules/pdfkit/js/data/Helvetica.afm` off disk to do it. That read
   * is not a static import, so @vercel/nft never traces the file and Vercel
   * deploys the route without it — working in dev, 500-ing in production.
   * `buildStoryPdf` avoids it by naming a real font file in the constructor.
   * See next.config.ts's comments on libheif's .wasm for the same class of
   * bug that actually shipped.
   */
  it("reads no pdfkit .afm metrics, so nothing depends on untraced files", async () => {
    const fs = await import("node:fs");
    const real = fs.default.readFileSync;
    const afmReads: string[] = [];
    const spy = vi.spyOn(fs.default, "readFileSync").mockImplementation(((
      file: Parameters<typeof real>[0],
      ...rest: unknown[]
    ) => {
      if (typeof file === "string" && file.endsWith(".afm"))
        afmReads.push(file);
      return (real as (...args: unknown[]) => unknown)(file, ...rest);
    }) as typeof real);

    try {
      await buildStoryPdf(input());
    } finally {
      spy.mockRestore();
    }

    expect(afmReads).toEqual([]);
  });
});

beforeAll(() => {
  // pdfjs-dist's text extraction is slow on the paginated case; these are
  // still well inside Vitest's default timeout on CI hardware, but the
  // long-story test renders ~90 paragraphs.
  vi.setConfig({ testTimeout: 30_000 });
});
