import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import * as fontkit from "fontkit";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type {
  Blockquote,
  Code,
  Heading,
  List,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";
import { MEDIA_EMBED_REGEX } from "@/lib/story/markdown-media";
import { formatNzdCents } from "@/lib/story/expense-per-month";
import { isSafeHref } from "@/lib/validation/story";

/**
 * Renders one story into a self-contained PDF the contributor can keep.
 *
 * Deliberately PURE: everything this needs -- text, image bytes, labels --
 * arrives already resolved and already authorized in `StoryPdfInput`. It
 * holds no Supabase client and performs no authorization, so the whole
 * layout is unit-testable without a database and there is no second place
 * where a "can this person read this story" decision could quietly diverge
 * from the route handler's.
 *
 * `server-only` because pdfkit and the font loading below are Node-side:
 * this must never be pulled into a Client Component bundle.
 */

// --- Fonts --------------------------------------------------------------

/**
 * Liberation Sans, borrowed from pdfjs-dist's bundled standard-font
 * directory (already a production dependency, for the PDF importer).
 *
 * WHY NOT PDFKIT'S BUILT-IN FONTS: Helvetica/Times/Courier are the PDF
 * base-14 fonts and are WinAnsi-encoded, which has no macron vowels. This
 * is a New Zealand product whose own seeded region list contains Manawatū,
 * Whakatāne and Whangārei (20260812120000_seed_nz_regions_destinations.sql),
 * so a base-14 font cannot render its own reference data. Verified with
 * fontkit before choosing: Liberation Sans covers Latin Extended-A (the
 * macrons), curly quotes, en/em dashes and the bullet characters used
 * below. It does NOT cover CJK or emoji -- those come from the fallback
 * faces declared in FALLBACK_FONT_FILES, via segmentByFont().
 *
 * WHY NOT A COMMITTED FONT FILE: this adds no binary to the repo. Liberation
 * is SIL OFL 1.1 (node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION),
 * which permits embedding in a document.
 *
 * The resolver below is the pattern established by
 * lib/story/pdf-import.ts#standardFontDataUrl() -- read that function's
 * comment before touching this one. A bare `require.resolve()` is rewritten
 * by Turbopack (this repo's bundler for both dev and build) and returns a
 * module id rather than a path; `process.getBuiltinModule("node:module")`
 * reaches the real Node resolver at runtime, which no bundler rewrites.
 *
 * These .ttf files are also why `/stories/*\/export` needs an
 * `outputFileTracingIncludes` entry in next.config.ts: nothing statically
 * imports them, so @vercel/nft cannot see them and Vercel would otherwise
 * deploy the route without its fonts.
 */
let fontDirCache: string | undefined;

function liberationFontDir(): string {
  if (!fontDirCache) {
    const nodeModuleApi = process.getBuiltinModule("node:module");
    const pkgPath = nodeModuleApi
      .createRequire(import.meta.url)
      .resolve("pdfjs-dist/package.json");
    if (!path.isAbsolute(pkgPath) || !pkgPath.endsWith("package.json")) {
      throw new Error(
        `Could not resolve pdfjs-dist's package directory: got ${JSON.stringify(
          pkgPath,
        )}. See this function's doc comment -- the bundler has intercepted ` +
          `module resolution instead of letting Node resolve it.`,
      );
    }
    fontDirCache = path.join(path.dirname(pkgPath), "standard_fonts");
  }
  return fontDirCache;
}

const FONT_FILES = {
  regular: "LiberationSans-Regular.ttf",
  bold: "LiberationSans-Bold.ttf",
  italic: "LiberationSans-Italic.ttf",
  boldItalic: "LiberationSans-BoldItalic.ttf",
} as const;

type FontKey = keyof typeof FONT_FILES;

/**
 * Fallback faces for scripts Liberation Sans has no glyphs for. Unlike the
 * Liberation faces (which ride along inside pdfjs-dist), these are committed
 * to this repo -- no npm package ships the static .ttf pdfkit needs
 * (@fontsource has only per-range .woff2 subsets), and the one that does
 * (@expo-google-fonts/*) unpacks 96 MB of weights to use two files.
 *
 * Both are SIL OFL 1.1 -- see assets/fonts/LICENSE-OFL.txt.
 *
 *  - NotoSansSC-Regular.ttf (10.1 MB, 30,898 glyphs) covers Simplified and a
 *    large slice of Traditional Chinese. Malaysia -- this product's launch
 *    market -- uses Simplified, and a Chinese-Malaysian contributor's own
 *    display name is the case this whole mechanism exists for.
 *  - NotoEmoji-Regular.ttf (0.8 MB, 1,905 glyphs) is the MONOCHROME Noto
 *    Emoji, deliberately NOT Noto Color Emoji. Colour emoji fonts store
 *    glyphs as bitmaps (sbix/CBDT) or layered COLR, none of which pdfkit
 *    writes into a PDF -- verified against Apple Color Emoji, which has an
 *    sbix table and no outlines at all, so embedding it yields blank boxes.
 *    This one has real outlines and subsets normally; emoji come out as
 *    black line art.
 *
 * There is deliberately NO bold CJK face: a second weight is another 10 MB,
 * so CJK inside bold text renders at regular weight. Latin around it still
 * goes bold. Flat-looking in a heading, never missing.
 */
const FALLBACK_FONT_FILES = {
  cjk: "NotoSansSC-Regular.ttf",
  emoji: "NotoEmoji-Regular.ttf",
} as const;

type FallbackKey = keyof typeof FALLBACK_FONT_FILES;

/** Every registered pdfkit font name -- the Liberation faces plus fallbacks. */
type RegisteredFont =
  (typeof FONT_FILES)[FontKey] | (typeof FALLBACK_FONT_FILES)[FallbackKey];

/**
 * The `turbopackIgnore` is load-bearing, not noise-suppression.
 *
 * liberationFontDir() deliberately resolves through Node's real resolver at
 * runtime (see its comment), so Turbopack cannot see what this path is. Its
 * static analysis treats an unresolvable path.join as "could be anything"
 * and responds by tracing the ENTIRE project into the export route's
 * bundle -- measured at 128 app source files and 2 public/ files that this
 * route has no use for, on top of the ~17 MB of libvips it legitimately
 * needs.
 *
 * Nothing is lost by opting out, because tracing was never how these files
 * got deployed: next.config.ts's `outputFileTracingIncludes` entry for
 * `/stories/*\/export` names
 * `pdfjs-dist/standard_fonts/LiberationSans-*.ttf` explicitly, precisely
 * because nothing statically imports them. Verify with the grep that entry's
 * own comment prescribes after changing either side.
 *
 * NOT fixed by "statically scoping the path" (Turbopack's other suggestion):
 * hardcoding node_modules/pdfjs-dist/ under process.cwd() assumes a flat,
 * non-hoisted install layout and would break exactly where this module's
 * resolver was written to be careful. NOT fixed by committing the Liberation
 * faces either -- that reverses this file's documented "adds no binary to
 * the repo" decision for a warning.
 */
function fontPath(key: FontKey): string {
  return path.join(
    /*turbopackIgnore: true*/ liberationFontDir(),
    FONT_FILES[key],
  );
}

/**
 * Committed fonts live in `assets/fonts/`, resolved from the process working
 * directory. NOT next to this module via `import.meta.url`: that is a bundler
 * artefact under Turbopack and does not point at a real repo path, whereas
 * `process.cwd()` is the deployed project root on Vercel. Paired with the
 * `outputFileTracingIncludes` entry for `/stories/*\/export` in
 * next.config.ts, which is what actually gets the files deployed.
 */
function fallbackFontPath(key: FallbackKey): string {
  return path.join(process.cwd(), "assets", "fonts", FALLBACK_FONT_FILES[key]);
}

/**
 * The brand mark for the letterhead, as bytes pdfkit can embed.
 *
 * SHRUNK FIRST, DELIBERATELY. public/kakinotes-icon.png is 650x480 and
 * 495 KB -- pdfkit embeds a PNG as-is rather than recompressing it, so
 * handing it the original would turn a 37 KB story export into a ~530 KB
 * one for a mark drawn 18pt wide. sharp crops it to a centred square (the
 * same `object-cover` the site's BrandLogo does) and scales it to 128px,
 * which costs a few KB instead.
 *
 * Read from process.cwd(), matching fallbackFontPath() rather than
 * import.meta.url, for the reason documented there. That also means
 * @vercel/nft cannot see it: next.config.ts's outputFileTracingIncludes
 * entry for `/stories/*\/export` names this file explicitly, exactly like
 * the fonts beside it.
 *
 * RETURNS NULL RATHER THAN THROWING on any failure. A missing or unreadable
 * logo must not 500 a contributor's download of their own writing -- the
 * letterhead is simply omitted. The trade is that a deployment which forgot
 * the trace entry would lose the mark silently, which is why there is a test
 * asserting the bytes are embedded, and why that config entry's own comment
 * prescribes checking the built .nft.json.
 */
let brandMarkCache: Buffer | null | undefined;

async function brandMarkBytes(): Promise<Buffer | null> {
  if (brandMarkCache !== undefined) return brandMarkCache;
  try {
    const source = path.join(process.cwd(), "public", "kakinotes-icon.png");
    brandMarkCache = await sharp(source)
      .resize(128, 128, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
  } catch {
    brandMarkCache = null;
  }
  return brandMarkCache;
}

/**
 * The three faces opened for glyph lookup, so segmentation asks the REAL
 * fonts what they can draw. A hand-maintained list of Unicode ranges was the
 * alternative and would be wrong the moment it drifted from the .ttf files;
 * this cannot drift.
 */
type CoverageFonts = {
  primary: fontkit.Font;
  cjk: fontkit.Font;
  emoji: fontkit.Font;
};

let coverageFontsCache: CoverageFonts | undefined;

function openSingleFace(file: string): fontkit.Font {
  const opened = fontkit.openSync(file);
  // openSync widens to Font | FontCollection because a .ttc holds several
  // faces. These are all single-face files, so the collection branch is
  // unreachable -- but assert it rather than assume it, so a swapped font
  // file fails here with a clear message instead of somewhere downstream.
  //
  // Narrowed on the method actually used below, NOT on `getFont`: fontkit
  // puts `getFont` on a single Font too, so that discriminator matches
  // everything and rejects the good case.
  if (!("hasGlyphForCodePoint" in opened)) {
    throw new Error(
      `Expected a single-face font at ${file}, got a collection. Unwrap it ` +
        `with getFont(postscriptName) before registering it with pdfkit.`,
    );
  }
  return opened;
}

function coverageFonts(): CoverageFonts {
  if (!coverageFontsCache) {
    coverageFontsCache = {
      primary: openSingleFace(fontPath("regular")),
      cjk: openSingleFace(fallbackFontPath("cjk")),
      emoji: openSingleFace(fallbackFontPath("emoji")),
    };
  }
  return coverageFontsCache;
}

/**
 * One stretch of text that can be drawn in a single face. `fallback` is null
 * when the caller's own face (regular/bold/italic/bold-italic) can draw it.
 */
export type TextSegment = { text: string; fallback: FallbackKey | null };

/**
 * Splits text into runs by which font can actually draw each character.
 *
 * Order matters: the PRIMARY face is tried first even though Noto Sans SC
 * also carries Latin glyphs. Checking CJK first would quietly re-set every
 * ASCII letter in the document in a different typeface.
 *
 * Coverage is checked against Liberation Sans REGULAR only. The bold and
 * italic faces are the same family with the same character set, so a
 * per-weight check would cost three more parsed fonts to answer identically.
 *
 * A character no face can draw still becomes "?" -- visibly wrong beats the
 * silent blank box a missing glyph renders as.
 */
export function segmentByFont(text: string): TextSegment[] {
  const fonts = coverageFonts();
  const segments: TextSegment[] = [];

  const push = (char: string, fallback: FallbackKey | null) => {
    const last = segments[segments.length - 1];
    if (last && last.fallback === fallback) last.text += char;
    else segments.push({ text: char, fallback });
  };

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    // Keep the newlines and tabs pdfkit's own layout depends on; every other
    // control character is dropped rather than turned into "?".
    if (char === "\n" || char === "\t") {
      push(char, null);
      continue;
    }
    if (codePoint === undefined || codePoint < 0x20) continue;

    if (fonts.primary.hasGlyphForCodePoint(codePoint)) push(char, null);
    else if (fonts.cjk.hasGlyphForCodePoint(codePoint)) push(char, "cjk");
    else if (fonts.emoji.hasGlyphForCodePoint(codePoint)) push(char, "emoji");
    else push("?", null);
  }

  return segments;
}

/**
 * The face to MEASURE mixed-font text with. pdfkit's heightOfString() uses
 * one font, so a string that switches faces mid-line cannot be measured
 * exactly. Picking the fallback present biases the estimate high -- CJK
 * glyphs are wider and taller than Latin, so the text wraps sooner and
 * reserves more vertical space than it needs. Over-reserving costs a little
 * whitespace; under-reserving overlaps the next block.
 */
function measurementFont(segments: TextSegment[]): RegisteredFont {
  if (segments.some((segment) => segment.fallback === "cjk")) {
    return FALLBACK_FONT_FILES.cjk;
  }
  if (segments.some((segment) => segment.fallback === "emoji")) {
    return FALLBACK_FONT_FILES.emoji;
  }
  return FONT_FILES.regular;
}

/**
 * Ends a sentence without doubling the stop. "First name + initial" is one of
 * the three attribution styles the product offers, so a contributor called
 * "Aisyah R." would otherwise be credited as "Aisyah R.." on every export.
 */
function endWithStop(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// --- Page geometry ------------------------------------------------------

const PAGE_MARGIN = 56;
/** Reserved band at the foot of every page for the footer rule + line. */
const FOOTER_BAND = 34;
const BODY_SIZE = 10.5;
const BODY_LINE_GAP = 3.5;
const LIST_INDENT = 16;
const QUOTE_INDENT = 14;
const CODE_PADDING = 8;
const MIN_IMAGE_WIDTH = 96;

/**
 * The screen width an image's stored embed width is relative to. The public
 * story page lays its content out in a `max-w-5xl` (64rem = 1024px)
 * container (app/(public)/stories/[id]/page.tsx), and an inline image
 * renders at its stored CSS pixel width inside that column
 * (components/story/content-block-renderer.tsx). Mapping stored width to a
 * FRACTION of the PDF's text column, rather than treating it as an absolute
 * point size, is what makes a half-width photo on screen stay a half-width
 * photo on paper.
 */
const REFERENCE_SCREEN_COLUMN = 1024;

const INK = "#1a1a1a";
const MUTED = "#5f5f5f";
const RULE = "#d8d4cf";
const LINK_INK = "#1c5d99";
const CODE_BG = "#f4f2ef";
const CODE_INK = "#8a4b2a";

// --- Input --------------------------------------------------------------

export type StoryPdfImage = {
  mediaId: string;
  /** Processed derivative bytes (JPEG or PNG -- both pdfkit-native). */
  bytes: Buffer;
  /**
   * Intrinsic pixel dimensions, resolved by the caller (which already has
   * sharp loaded to fetch the bytes). Supplied rather than read here so this
   * module stays synchronous and sharp-free; pdfkit's own `openImage()` would
   * do the job but is absent from @types/pdfkit, and a cast to reach it would
   * buy nothing the caller cannot provide for free.
   */
  width: number;
  height: number;
  altText: string | null;
  caption: string | null;
  decorative: boolean;
};

export type StoryPdfExpense = {
  name: string;
  amountNzdCents: number;
  note: string | null;
};

export type StoryPdfInput = {
  title: string;
  excerpt: string | null;
  /** The contributor-chosen display name, exactly as it would be published. */
  attributionValue: string;
  /** Canonical one-block Markdown, via normalizeStoryContentJson(). */
  markdown: string;
  images: StoryPdfImage[];
  tripLabel: string | null;
  travelStyleLabel: string | null;
  locations: string[];
  tags: string[];
  expenses: StoryPdfExpense[];
  totalExpenseNzdCents: number | null;
  /** "Published", "Draft", "In review" -- what this copy actually is. */
  statusLabel: string;
  exportedAt: Date;
  siteUrl: string;
};

// --- Inline model -------------------------------------------------------

type Run = {
  kind: "run";
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: string | null;
};

type EmbedPiece = { kind: "embed"; mediaId: string; width?: number };

type InlinePiece = Run | EmbedPiece;

type RunStyle = Omit<Run, "kind" | "text">;

const PLAIN_STYLE: RunStyle = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: null,
};

/**
 * Splits a Markdown text node's value into plain runs and image-embed
 * markers. `![[mediaId]]` is this codebase's deliberately non-standard embed
 * token (lib/story/markdown-media.ts), so remark leaves it in a text node --
 * the same assumption lib/story/remark-media-embed.ts makes for the web
 * renderer. Splitting here, rather than reusing that plugin, keeps the PDF
 * free of the hast/`data-*` machinery the plugin exists to produce.
 */
function splitTextNode(value: string, style: RunStyle): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  const regex = new RegExp(MEDIA_EMBED_REGEX);
  let lastEnd = 0;
  for (const match of value.matchAll(regex)) {
    const start = match.index ?? 0;
    if (start > lastEnd) {
      pieces.push({ kind: "run", text: value.slice(lastEnd, start), ...style });
    }
    pieces.push({
      kind: "embed",
      mediaId: match[1].toLowerCase(),
      width: match[2] ? Number(match[2]) : undefined,
    });
    lastEnd = start + match[0].length;
  }
  if (lastEnd < value.length) {
    pieces.push({ kind: "run", text: value.slice(lastEnd), ...style });
  }
  return pieces;
}

function phrasingToPieces(
  nodes: PhrasingContent[],
  style: RunStyle,
): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        pieces.push(...splitTextNode(node.value, style));
        break;
      case "strong":
        pieces.push(
          ...phrasingToPieces(node.children, { ...style, bold: true }),
        );
        break;
      case "emphasis":
        pieces.push(
          ...phrasingToPieces(node.children, { ...style, italic: true }),
        );
        break;
      case "delete":
        pieces.push(
          ...phrasingToPieces(node.children, { ...style, strike: true }),
        );
        break;
      case "inlineCode":
        pieces.push({ kind: "run", text: node.value, ...style, code: true });
        break;
      case "link": {
        // Re-checked even though storyContentSchema already refused unsafe
        // hrefs on save: legacy revisions predate that schema, and an
        // exported PDF is a file that leaves the platform. An unsafe href
        // loses the link and keeps the text, matching lib/story/html-paste.ts.
        const href = isSafeHref(node.url) ? node.url : null;
        pieces.push(
          ...phrasingToPieces(node.children, { ...style, link: href }),
        );
        break;
      }
      case "break":
        pieces.push({ kind: "run", text: "\n", ...style });
        break;
      case "image":
      case "imageReference":
        // storyContentSchema rejects standard image syntax outright, and a
        // legacy document carrying one has no resolvable bytes here.
        break;
      default:
        if ("children" in node && Array.isArray(node.children)) {
          pieces.push(
            ...phrasingToPieces(node.children as PhrasingContent[], style),
          );
        }
    }
  }
  return pieces;
}

function isRun(piece: InlinePiece): piece is Run {
  return piece.kind === "run";
}

function runsToPlainText(pieces: InlinePiece[]): string {
  return pieces
    .filter(isRun)
    .map((run) => run.text)
    .join("");
}

// --- Renderer -----------------------------------------------------------

type Doc = InstanceType<typeof PDFDocument>;

/** Horizontal band the current block draws into. */
type Column = { left: number; width: number };

type WriteOptions = {
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  lineGap?: number;
};

function fontKeyFor(run: Run, options: WriteOptions): FontKey {
  const bold = run.bold || Boolean(options.bold);
  const italic = run.italic || Boolean(options.italic);
  if (bold && italic) return "boldItalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "regular";
}

class StoryPdfRenderer {
  /** Prepared by buildStoryPdf(); null when the mark could not be read. */
  private brandMark: Buffer | null = null;

  setBrandMark(bytes: Buffer | null): void {
    this.brandMark = bytes;
  }
  private readonly doc: Doc;
  private readonly input: StoryPdfInput;
  private readonly imagesById: Map<string, StoryPdfImage>;
  /** Ids drawn in the body, so the gallery at the end doesn't repeat them. */
  private readonly placed = new Set<string>();
  private pageNumber = 0;

  constructor(doc: Doc, input: StoryPdfInput) {
    this.doc = doc;
    this.input = input;
    this.imagesById = new Map(
      input.images.map((image) => [image.mediaId, image]),
    );
  }

  get column(): Column {
    return {
      left: this.doc.page.margins.left,
      width:
        this.doc.page.width -
        this.doc.page.margins.left -
        this.doc.page.margins.right,
    };
  }

  private get contentBottom(): number {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  /** Break to a new page unless `needed` points still fit below the cursor. */
  private ensureSpace(needed: number): void {
    if (this.doc.y + needed > this.contentBottom) this.doc.addPage();
  }

  /**
   * The pdfkit font name for one segment: its fallback face when it has one,
   * otherwise the caller's own weight/style.
   */
  private fontNameFor(segment: TextSegment, baseFont: FontKey): RegisteredFont {
    if (segment.fallback) return FALLBACK_FONT_FILES[segment.fallback];
    return FONT_FILES[baseFont];
  }

  /**
   * Draws a string that may switch faces mid-word, as one pdfkit `continued`
   * chain so the text still flows and wraps as a single paragraph.
   *
   * `align` is honoured only on the first call of a chain (pdfkit's rule), so
   * anything non-left-aligned must be single-segment ASCII -- which every
   * right-aligned caller here is (page numbers, currency, list markers). Those
   * go through `drawPlain()` instead and never reach this method.
   */
  private drawSegments(
    value: string,
    options: {
      baseFont: FontKey;
      size: number;
      color: string;
      width: number;
      x?: number;
      y?: number;
      lineGap?: number;
      lineBreak?: boolean;
      ellipsis?: boolean;
      underline?: boolean;
      strike?: boolean;
      link?: string;
      /** Leave the chain open so a caller can append more segments. */
      continued?: boolean;
    },
  ): void {
    const segments = segmentByFont(value);
    if (segments.length === 0) return;

    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1;
      this.doc
        .font(this.fontNameFor(segment, options.baseFont))
        .fontSize(options.size)
        .fillColor(options.color);

      const shared = {
        lineGap: options.lineGap,
        underline: options.underline,
        strike: options.strike,
        link: options.link,
        continued: isLast ? Boolean(options.continued) : true,
      };

      if (index === 0 && options.x !== undefined && options.y !== undefined) {
        this.doc.text(segment.text, options.x, options.y, {
          ...shared,
          width: options.width,
          lineBreak: options.lineBreak,
          ellipsis: options.ellipsis,
        });
      } else if (index === 0) {
        this.doc.text(segment.text, {
          ...shared,
          width: options.width,
          lineBreak: options.lineBreak,
          ellipsis: options.ellipsis,
        });
      } else {
        // Only the FIRST call of a continued chain establishes the column;
        // pdfkit ignores width/align/position on the rest of the chain.
        this.doc.text(segment.text, shared);
      }
    });
  }

  /**
   * Height of a string once wrapped, measured in the widest face it needs.
   * See `measurementFont()` -- a mixed-face string cannot be measured exactly,
   * so this biases high rather than overlapping the block below.
   */
  private measureText(
    value: string,
    baseFont: FontKey,
    size: number,
    width: number,
    lineGap?: number,
  ): number {
    const segments = segmentByFont(value);
    const measureWith = measurementFont(segments);
    const font =
      measureWith === FONT_FILES.regular ? FONT_FILES[baseFont] : measureWith;
    this.doc.font(font).fontSize(size);
    return this.doc.heightOfString(segments.map((s) => s.text).join(""), {
      width,
      lineGap,
    });
  }

  /**
   * Text guaranteed to be ASCII the primary face covers -- page numbers,
   * formatted currency, list markers. Kept separate from `drawSegments()`
   * because these are the only callers that need `align`, which pdfkit
   * honours only on an unchained call.
   */
  private drawPlain(
    value: string,
    options: {
      baseFont: FontKey;
      size: number;
      color: string;
      x: number;
      y: number;
      width: number;
      align?: "left" | "right" | "center";
      lineBreak?: boolean;
    },
  ): void {
    this.doc
      .font(FONT_FILES[options.baseFont])
      .fontSize(options.size)
      .fillColor(options.color)
      .text(value, options.x, options.y, {
        width: options.width,
        align: options.align,
        lineBreak: options.lineBreak,
      });
  }

  // -- Footer ------------------------------------------------------------

  /**
   * Drawn on `pageAdded` -- which is also why the document is constructed
   * with `autoFirstPage: false`: the very first page would otherwise be
   * added before this listener is attached and would silently lose its
   * footer.
   *
   * THE BOTTOM MARGIN IS ZEROED WHILE DRAWING, and that is load-bearing.
   * The footer sits inside the reserved band BELOW the text area, i.e. below
   * `page.maxY()` (= height - margins.bottom). pdfkit's `text()` compares the
   * cursor against `maxY()` and calls `addPage()` when it is past it -- so
   * drawing the footer at its own y re-entered `addPage()` from inside this
   * very handler and recursed until the stack blew. Worse, the first symptom
   * was not a stack overflow but "Cannot read properties of undefined
   * (reading 'metrics')" thrown from pdfkit's font embedding, because the
   * re-entrant page was created while the first font was still being
   * constructed. Zeroing `margins.bottom` for the duration puts the whole
   * page below the cursor, so no automatic break can fire here.
   */
  onPageAdded(): void {
    this.pageNumber += 1;
    const { left, width } = this.column;
    const y = this.doc.page.height - PAGE_MARGIN - FOOTER_BAND + 14;
    const savedX = this.doc.x;
    const savedY = this.doc.y;
    const savedBottom = this.doc.page.margins.bottom;
    this.doc.page.margins.bottom = 0;

    this.doc
      .save()
      .moveTo(left, y - 8)
      .lineTo(left + width, y - 8)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke()
      .restore();

    this.drawSegments(this.input.title, {
      baseFont: "regular",
      size: 8,
      color: MUTED,
      x: left,
      y,
      width: width - 40,
      lineBreak: false,
      ellipsis: true,
    });
    // The page number is always ASCII, and it is the one piece of footer text
    // that must be right-aligned -- see drawPlain()'s note on why alignment
    // and font chaining cannot be combined.
    this.drawPlain(String(this.pageNumber), {
      baseFont: "regular",
      size: 8,
      color: MUTED,
      x: left,
      y,
      width,
      align: "right",
      lineBreak: false,
    });

    this.doc.page.margins.bottom = savedBottom;

    // pdfkit's save()/restore() covers graphics state only, never the text
    // cursor -- reset it by hand or the next block starts at the footer.
    this.doc.x = savedX;
    this.doc.y = savedY;
  }

  // -- Inline ------------------------------------------------------------

  private writeRuns(
    runs: Run[],
    column: Column,
    options: WriteOptions = {},
  ): void {
    const visible = runs.filter((run) => run.text.length > 0);
    if (visible.length === 0) return;

    const size = options.size ?? BODY_SIZE;
    const lineGap = options.lineGap ?? BODY_LINE_GAP;
    this.doc.x = column.left;

    visible.forEach((run, index) => {
      const isLast = index === visible.length - 1;
      const color = run.link
        ? LINK_INK
        : run.code
          ? CODE_INK
          : (options.color ?? INK);
      // Each run is itself split by font coverage, so one **bold** run
      // containing both Latin and Chinese becomes two chained calls in two
      // faces -- and the chain runs unbroken across every run in the
      // paragraph, which is what keeps it wrapping as one block of text.
      this.drawSegments(run.text, {
        baseFont: fontKeyFor(run, options),
        size,
        color,
        width: column.width,
        lineGap,
        underline: Boolean(run.link),
        strike: run.strike,
        link: run.link ?? undefined,
        continued: !isLast,
      });
    });

    // A continued chain leaves the cursor mid-line; the next block must
    // start at the column's left edge.
    this.doc.x = column.left;
  }

  // -- Blocks ------------------------------------------------------------

  renderBlocks(nodes: RootContent[], column: Column): void {
    for (const node of nodes) this.renderBlock(node, column);
  }

  private renderBlock(node: RootContent, column: Column): void {
    switch (node.type) {
      case "heading":
        this.renderHeading(node, column);
        break;
      case "paragraph":
        this.renderInlineFlow(
          phrasingToPieces(node.children, PLAIN_STYLE),
          column,
        );
        this.doc.moveDown(0.5);
        break;
      case "list":
        this.renderList(node, column);
        break;
      case "blockquote":
        this.renderBlockquote(node, column);
        break;
      case "code":
        this.renderCode(node, column);
        break;
      case "table":
        this.renderTable(node, column);
        break;
      case "thematicBreak":
        this.renderRule(column);
        break;
      case "html":
        // Engineering Rules 6/7: story content is never raw HTML. A legacy
        // document containing some is dropped, never rendered and never
        // printed as visible markup.
        break;
      default:
        if ("children" in node && Array.isArray(node.children)) {
          this.renderBlocks(node.children as RootContent[], column);
        }
    }
  }

  /**
   * Writes inline content, breaking out to an image block wherever an embed
   * token sits. Keeps the contributor's reading order: text before the
   * photo, the photo, then the text after it.
   */
  private renderInlineFlow(
    pieces: InlinePiece[],
    column: Column,
    options: WriteOptions = {},
  ): void {
    let buffer: Run[] = [];
    const flush = () => {
      this.writeRuns(buffer, column, options);
      buffer = [];
    };
    for (const piece of pieces) {
      if (piece.kind === "run") {
        buffer.push(piece);
        continue;
      }
      flush();
      this.renderImage(piece.mediaId, column, piece.width);
    }
    flush();
  }

  private renderHeading(node: Heading, column: Column): void {
    // `#` is reserved for the story title (storyContentSchema rejects h1),
    // so depth 2 is the largest a story body can actually contain.
    const size = node.depth <= 2 ? 15 : node.depth === 3 ? 12.5 : 11;
    this.doc.moveDown(0.6);
    this.ensureSpace(size * 2);
    this.renderInlineFlow(
      phrasingToPieces(node.children, PLAIN_STYLE),
      column,
      { size, bold: true, lineGap: 2 },
    );
    this.doc.moveDown(0.35);
  }

  private renderList(node: List, column: Column, depth = 0): void {
    const inner: Column = {
      left: column.left + LIST_INDENT,
      width: column.width - LIST_INDENT,
    };
    const start = typeof node.start === "number" ? node.start : 1;

    node.children.forEach((item, index) => {
      this.ensureSpace(BODY_SIZE * 2);
      const markerY = this.doc.y;

      if (typeof item.checked === "boolean") {
        this.drawCheckbox(column.left + 2, markerY, item.checked);
      } else if (node.ordered) {
        this.doc
          .font(FONT_FILES.regular)
          .fontSize(BODY_SIZE)
          .fillColor(INK)
          .text(`${start + index}.`, column.left, markerY, {
            width: LIST_INDENT - 4,
            align: "right",
            lineBreak: false,
          });
      } else {
        const bullet = depth === 0 ? "•" : depth === 1 ? "◦" : "▪";
        this.doc
          .font(FONT_FILES.regular)
          .fontSize(BODY_SIZE)
          .fillColor(INK)
          .text(bullet, column.left + 2, markerY, {
            width: LIST_INDENT,
            lineBreak: false,
          });
      }

      this.doc.y = markerY;
      // A nested list re-enters renderList with a deeper bullet; anything
      // else is an ordinary block inside the item's own narrower column.
      for (const child of item.children) {
        if (child.type === "list") this.renderList(child, inner, depth + 1);
        else this.renderBlock(child, inner);
      }
    });
    this.doc.moveDown(0.2);
  }

  /**
   * Liberation Sans has no U+2610/U+2611 checkbox glyphs (verified with
   * fontkit), so a task-list box is drawn as vectors -- which is also
   * sharper than a glyph would be.
   */
  private drawCheckbox(x: number, y: number, checked: boolean): void {
    const size = BODY_SIZE * 0.78;
    const top = y + 1.5;
    this.doc
      .save()
      .lineWidth(0.9)
      .strokeColor(checked ? INK : MUTED)
      .rect(x, top, size, size)
      .stroke();
    if (checked) {
      this.doc
        .moveTo(x + size * 0.22, top + size * 0.52)
        .lineTo(x + size * 0.43, top + size * 0.74)
        .lineTo(x + size * 0.8, top + size * 0.24)
        .lineWidth(1.2)
        .strokeColor(INK)
        .stroke();
    }
    this.doc.restore();
  }

  private renderBlockquote(node: Blockquote, column: Column): void {
    const inner: Column = {
      left: column.left + QUOTE_INDENT,
      width: column.width - QUOTE_INDENT,
    };
    this.doc.moveDown(0.3);
    const startY = this.doc.y;
    const startPage = this.pageNumber;

    for (const child of node.children) {
      if (child.type === "paragraph") {
        this.renderInlineFlow(
          phrasingToPieces(child.children, PLAIN_STYLE),
          inner,
          { italic: true, color: MUTED },
        );
        this.doc.moveDown(0.4);
      } else {
        this.renderBlock(child, inner);
      }
    }

    // The rule is drawn only when the quote stayed on one page. Tracking it
    // across a page break would mean drawing a separate segment on every
    // page the quote spans; the indent and italic already carry the meaning,
    // so this degrades to "no rule" rather than to a rule in the wrong place.
    if (this.pageNumber === startPage) {
      this.doc
        .save()
        .moveTo(column.left + 3, startY)
        .lineTo(column.left + 3, this.doc.y - 4)
        .lineWidth(2)
        .strokeColor(RULE)
        .stroke()
        .restore();
    }
    this.doc.x = column.left;
  }

  /**
   * No monospace font is available (pdfjs-dist ships only Liberation Sans,
   * and pdfkit's built-in Courier would reintroduce both the WinAnsi/macron
   * problem and the .afm disk read this module avoids), so a code block is
   * set in the body face on a tinted panel. Code is vanishingly rare in a
   * first-person travel story; legibility matters more than fixed pitch.
   */
  private renderCode(node: Code, column: Column): void {
    const value = node.value.replace(/\s+$/, "");
    const innerWidth = column.width - CODE_PADDING * 2;
    const height = this.measureText(
      value,
      "regular",
      BODY_SIZE - 1,
      innerWidth,
      2,
    );

    this.doc.moveDown(0.3);
    this.ensureSpace(height + CODE_PADDING * 2);
    const top = this.doc.y;
    this.doc
      .save()
      .rect(column.left, top, column.width, height + CODE_PADDING * 2)
      .fill(CODE_BG)
      .restore();
    this.drawSegments(value, {
      baseFont: "regular",
      size: BODY_SIZE - 1,
      color: CODE_INK,
      x: column.left + CODE_PADDING,
      y: top + CODE_PADDING,
      width: innerWidth,
      lineGap: 2,
    });
    this.doc.y = top + height + CODE_PADDING * 2;
    this.doc.x = column.left;
    this.doc.moveDown(0.5);
  }

  /**
   * Equal-width columns, header row in bold with a rule under it, and a page
   * break between rows rather than inside one.
   *
   * Cell content is flattened to plain text on purpose: pdfkit's `continued`
   * chaining drives the page flow and cannot be confined to a fixed cell
   * box, so bold/italic inside a cell is dropped rather than rendered in the
   * wrong place.
   */
  private renderTable(node: Table, column: Column): void {
    const rows = node.children;
    if (rows.length === 0) return;
    const columnCount = Math.max(...rows.map((row) => row.children.length));
    if (columnCount === 0) return;

    const cellWidth = column.width / columnCount;
    const padding = 5;
    const innerWidth = cellWidth - padding * 2;

    this.doc.moveDown(0.4);

    rows.forEach((row, rowIndex) => {
      const isHeader = rowIndex === 0;
      const cells: string[] = [];
      for (let i = 0; i < columnCount; i += 1) {
        const cell = row.children[i];
        cells.push(
          cell
            ? runsToPlainText(phrasingToPieces(cell.children, PLAIN_STYLE))
            : "",
        );
      }

      const baseFont: FontKey = isHeader ? "bold" : "regular";
      const rowHeight =
        Math.max(
          ...cells.map((value) =>
            this.measureText(
              value || " ",
              baseFont,
              BODY_SIZE - 0.5,
              innerWidth,
            ),
          ),
        ) +
        padding * 2;

      this.ensureSpace(rowHeight);
      const top = this.doc.y;

      cells.forEach((value, columnIndex) => {
        this.drawSegments(value, {
          baseFont,
          size: BODY_SIZE - 0.5,
          color: isHeader ? INK : MUTED,
          x: column.left + columnIndex * cellWidth + padding,
          y: top + padding,
          width: innerWidth,
        });
      });

      this.doc.y = top + rowHeight;
      this.doc
        .save()
        .moveTo(column.left, this.doc.y)
        .lineTo(column.left + column.width, this.doc.y)
        .lineWidth(isHeader ? 1 : 0.4)
        .strokeColor(RULE)
        .stroke()
        .restore();
    });

    this.doc.x = column.left;
    this.doc.moveDown(0.6);
  }

  private renderRule(column: Column): void {
    this.doc.moveDown(0.6);
    this.ensureSpace(12);
    this.doc
      .save()
      .moveTo(column.left, this.doc.y)
      .lineTo(column.left + column.width, this.doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke()
      .restore();
    this.doc.moveDown(0.6);
  }

  // -- Images ------------------------------------------------------------

  private displayWidth(
    stored: number | undefined,
    columnWidth: number,
  ): number {
    if (!stored) return columnWidth;
    const scaled = columnWidth * (stored / REFERENCE_SCREEN_COLUMN);
    return Math.max(MIN_IMAGE_WIDTH, Math.min(columnWidth, scaled));
  }

  renderImage(mediaId: string, column: Column, storedWidth?: number): void {
    const image = this.imagesById.get(mediaId);
    // A detached or still-unprocessed embed renders nothing at all, exactly
    // as ContentBlockRenderer does for a media id with no entry.
    if (!image) return;
    // Marked placed before any early return below, so a photo that cannot be
    // drawn here is not silently retried in the "More photos" gallery.
    this.placed.add(mediaId);
    if (image.width <= 0 || image.height <= 0) return;

    let width = this.displayWidth(storedWidth, column.width);
    let height = (image.height / image.width) * width;

    // A tall photo that cannot fit a whole page is scaled down rather than
    // clipped at the page break.
    const maxHeight =
      this.doc.page.height -
      this.doc.page.margins.top -
      this.doc.page.margins.bottom -
      24;
    if (height > maxHeight) {
      width = width * (maxHeight / height);
      height = maxHeight;
    }

    const caption = image.caption?.trim() || null;
    // Alt text is the fallback caption: it is a description the contributor
    // already wrote, and it is exactly what a reader of a printed copy has
    // no other way to get.
    const describedBy =
      caption ?? (image.decorative ? null : image.altText?.trim() || null);

    this.doc.moveDown(0.4);
    const captionHeight = describedBy
      ? this.measureText(describedBy, "italic", BODY_SIZE - 1.5, width) + 4
      : 0;

    this.ensureSpace(height + captionHeight + 6);
    const top = this.doc.y;
    try {
      this.doc.image(image.bytes, column.left, top, { width, height });
    } catch {
      // Bytes pdfkit cannot decode cost this one photo, never the whole
      // export -- a contributor downloading their own story should not be
      // blocked by one bad derivative.
      this.doc.x = column.left;
      return;
    }
    this.doc.y = top + height;

    if (describedBy) {
      this.drawSegments(describedBy, {
        baseFont: "italic",
        size: BODY_SIZE - 1.5,
        color: MUTED,
        x: column.left,
        y: this.doc.y + 4,
        width,
      });
    }

    this.doc.x = column.left;
    this.doc.moveDown(0.7);
  }

  // -- Document sections -------------------------------------------------

  /**
   * A small mark plus wordmark above the story title, on page one only.
   *
   * The brand had appeared nowhere in an exported PDF except the colophon
   * sentence at the foot of the page and the file's Creator metadata --
   * neither of which reads as a title. This is the letterhead treatment the
   * site header, contributor nav and footer already give it.
   *
   * Page one only, on purpose: the running footer already carries the story
   * title and page number on every page, and repeating the brand there would
   * crowd a band that is deliberately quiet.
   *
   * The circular clip mirrors BrandLogo's `rounded-full object-cover` -- the
   * source art is 650x480, and brandMarkBytes() has already centre-cropped it
   * square, so this only has to round the corners off.
   */
  private renderLetterhead(column: Column): void {
    const mark = this.brandMark;
    if (!mark) return;

    const size = 18;
    const top = this.doc.y;
    const radius = size / 2;

    this.doc
      .save()
      .circle(column.left + radius, top + radius, radius)
      .clip()
      .image(mark, column.left, top, { width: size, height: size })
      .restore();

    this.drawPlain("Kakinotes", {
      baseFont: "bold",
      size: 11,
      color: INK,
      x: column.left + size + 7,
      y: top + 4.5,
      width: column.width - size - 7,
    });

    this.doc.y = top + size;
    this.doc.moveDown(0.9);
  }

  renderHeader(): void {
    const column = this.column;

    this.renderLetterhead(column);

    this.drawSegments(this.input.title, {
      baseFont: "bold",
      size: 23,
      color: INK,
      x: column.left,
      y: this.doc.y,
      width: column.width,
      lineGap: 2,
    });

    if (this.input.excerpt) {
      this.doc.moveDown(0.4);
      this.drawSegments(this.input.excerpt, {
        baseFont: "italic",
        size: 12,
        color: MUTED,
        x: column.left,
        y: this.doc.y,
        width: column.width,
        lineGap: 2,
      });
    }

    this.doc.moveDown(0.6);
    // Engineering Rule 17: the personal-experience label travels with the
    // story. A PDF is the copy most likely to be read away from the site, so
    // it carries the label at the top, not only in the colophon.
    this.drawSegments(
      `Personal experience, not advice — shared by ${endWithStop(
        this.input.attributionValue,
      )}`,
      {
        baseFont: "regular",
        size: 9,
        color: MUTED,
        x: column.left,
        y: this.doc.y,
        width: column.width,
      },
    );

    this.doc.moveDown(0.8);
    this.renderFacts(column);
  }

  private renderFacts(column: Column): void {
    const rows: [string, string][] = [];
    if (this.input.tripLabel) rows.push(["Trip", this.input.tripLabel]);
    if (this.input.travelStyleLabel)
      rows.push(["Travel style", this.input.travelStyleLabel]);
    if (this.input.locations.length)
      rows.push(["Places", this.input.locations.join(", ")]);
    if (this.input.tags.length) rows.push(["Tags", this.input.tags.join(", ")]);
    if (typeof this.input.totalExpenseNzdCents === "number")
      rows.push([
        "Total cost",
        formatNzdCents(this.input.totalExpenseNzdCents),
      ]);
    if (rows.length === 0) return;

    const labelWidth = 92;
    this.doc
      .save()
      .moveTo(column.left, this.doc.y)
      .lineTo(column.left + column.width, this.doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke()
      .restore();
    this.doc.moveDown(0.5);

    for (const [label, value] of rows) {
      const valueWidth = column.width - labelWidth;
      const height = this.measureText(value, "regular", 9.5, valueWidth);
      this.ensureSpace(height + 4);
      const top = this.doc.y;
      // The label is a fixed English word ("Trip", "Places"); only the value
      // can carry a contributor's own tags or place names.
      this.drawPlain(label, {
        baseFont: "regular",
        size: 9.5,
        color: MUTED,
        x: column.left,
        y: top,
        width: labelWidth - 8,
      });
      this.drawSegments(value, {
        baseFont: "regular",
        size: 9.5,
        color: INK,
        x: column.left + labelWidth,
        y: top,
        width: valueWidth,
      });
      this.doc.y = top + height + 3;
    }

    this.doc.moveDown(0.4);
    this.doc
      .save()
      .moveTo(column.left, this.doc.y)
      .lineTo(column.left + column.width, this.doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke()
      .restore();
    this.doc.x = column.left;
    this.doc.moveDown(0.9);
  }

  renderExpenses(): void {
    if (this.input.expenses.length === 0) return;
    const column = this.column;

    this.doc.moveDown(0.6);
    this.ensureSpace(60);
    this.doc
      .font(FONT_FILES.bold)
      .fontSize(13)
      .fillColor(INK)
      .text("What it cost", column.left, this.doc.y, { width: column.width });
    this.doc.moveDown(0.5);

    for (const expense of this.input.expenses) {
      const label = expense.note
        ? `${expense.name} — ${expense.note}`
        : expense.name;
      const amountWidth = 90;
      const labelWidth = column.width - amountWidth;
      // The label can be a contributor-typed custom category or note; the
      // amount is always formatted currency, and is the right-aligned half.
      const height = this.measureText(label, "regular", BODY_SIZE, labelWidth);
      this.ensureSpace(height + 6);
      const top = this.doc.y;
      this.drawSegments(label, {
        baseFont: "regular",
        size: BODY_SIZE,
        color: INK,
        x: column.left,
        y: top,
        width: labelWidth,
      });
      this.drawPlain(formatNzdCents(expense.amountNzdCents), {
        baseFont: "regular",
        size: BODY_SIZE,
        color: INK,
        x: column.left,
        y: top,
        width: column.width,
        align: "right",
        lineBreak: false,
      });
      this.doc.y = top + height + 4;
    }

    if (typeof this.input.totalExpenseNzdCents === "number") {
      this.doc
        .save()
        .moveTo(column.left, this.doc.y)
        .lineTo(column.left + column.width, this.doc.y)
        .lineWidth(0.5)
        .strokeColor(RULE)
        .stroke()
        .restore();
      this.doc.moveDown(0.35);
      const top = this.doc.y;
      this.doc
        .font(FONT_FILES.bold)
        .fontSize(BODY_SIZE)
        .fillColor(INK)
        .text("Total", column.left, top, { width: column.width / 2 });
      this.doc.text(
        formatNzdCents(this.input.totalExpenseNzdCents),
        column.left,
        top,
        { width: column.width, align: "right", lineBreak: false },
      );
      this.doc.y = top + BODY_SIZE + 6;
    }
    this.doc.x = column.left;
  }

  /** Photos attached to the story but never placed in the text. */
  renderGallery(): void {
    const remaining = this.input.images.filter(
      (image) => !this.placed.has(image.mediaId),
    );
    if (remaining.length === 0) return;
    const column = this.column;

    this.doc.moveDown(0.8);
    this.ensureSpace(80);
    this.doc
      .font(FONT_FILES.bold)
      .fontSize(13)
      .fillColor(INK)
      .text("More photos", column.left, this.doc.y, { width: column.width });
    this.doc.moveDown(0.5);

    for (const image of remaining) {
      this.renderImage(image.mediaId, column);
    }
  }

  renderColophon(): void {
    const column = this.column;
    this.doc.moveDown(1);
    this.ensureSpace(70);
    this.renderRule(column);
    const exported = this.input.exportedAt.toISOString().slice(0, 10);
    this.drawSegments(
      `Your copy of "${this.input.title}" (${this.input.statusLabel}), ` +
        `exported from Kakinotes on ${exported}. This is one person's ` +
        `personal account of a Working Holiday Visa experience, not advice. ` +
        `${this.input.siteUrl}`,
      {
        baseFont: "regular",
        size: 8.5,
        color: MUTED,
        x: column.left,
        y: this.doc.y,
        width: column.width,
        lineGap: 2,
      },
    );
  }
}

// --- Entry point --------------------------------------------------------

/**
 * `markdown` is expected to be the canonical one-block Markdown produced by
 * normalizeStoryContentJson(); an empty document still yields a valid PDF
 * with the header, facts and photos rather than throwing.
 */
export async function buildStoryPdf(input: StoryPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    // autoFirstPage: false so the `pageAdded` footer listener below catches
    // page 1 too -- with the default, page 1 exists before any listener can
    // be attached and silently loses its footer.
    autoFirstPage: false,
    margins: {
      top: PAGE_MARGIN,
      bottom: PAGE_MARGIN + FOOTER_BAND,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
    },
    // Naming a real font file here is NOT cosmetic: pdfkit otherwise
    // initialises the document with Helvetica, which does an
    // `fs.readFileSync(__dirname + "/data/Helvetica.afm")` inside its own
    // package at runtime. That read is invisible to @vercel/nft's static
    // tracing -- the same class of failure next.config.ts documents for
    // libheif's .wasm, working locally and 500-ing in production. Verified
    // by instrumenting fs.readFileSync: with this option set, zero .afm
    // files are read.
    font: fontPath("regular"),
    info: {
      // Raw, unsegmented values: PDF metadata strings are written as UTF-16BE
      // literals and never reference an embedded font, so a Chinese title
      // shows correctly in a reader's Properties panel regardless of which
      // faces the page content uses.
      Title: input.title,
      Author: input.attributionValue,
      Creator: "Kakinotes",
      Subject: "Personal experience, not advice.",
      CreationDate: input.exportedAt,
    },
  });

  doc.registerFont(FONT_FILES.regular, fontPath("regular"));
  doc.registerFont(FONT_FILES.bold, fontPath("bold"));
  doc.registerFont(FONT_FILES.italic, fontPath("italic"));
  doc.registerFont(FONT_FILES.boldItalic, fontPath("boldItalic"));
  // Fallback faces, registered under their own filenames so segmentByFont()'s
  // key maps straight onto a pdfkit font name. pdfkit SUBSETS what it embeds,
  // so naming a 10 MB CJK font here costs the deployment, not the output: a
  // page of Chinese still produces a PDF measured in kilobytes.
  doc.registerFont(FALLBACK_FONT_FILES.cjk, fallbackFontPath("cjk"));
  doc.registerFont(FALLBACK_FONT_FILES.emoji, fallbackFontPath("emoji"));

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  const renderer = new StoryPdfRenderer(doc, input);
  // Awaited out here because reading and shrinking the mark is async while
  // renderHeader() is not; a null simply omits the letterhead.
  renderer.setBrandMark(await brandMarkBytes());
  doc.on("pageAdded", () => renderer.onPageAdded());
  doc.addPage();

  renderer.renderHeader();

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(input.markdown) as Root;
  renderer.renderBlocks(tree.children, renderer.column);

  renderer.renderExpenses();
  renderer.renderGallery();
  renderer.renderColophon();

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

/**
 * ASCII, lowercase, dash-separated -- safe for the `filename=` parameter of
 * a Content-Disposition header on any client. The route handler pairs this
 * with a UTF-8 `filename*` so a contributor whose title is not ASCII still
 * gets a meaningful name where the browser supports it.
 */
export function storyPdfFilename(title: string, exportedAt: Date): string {
  const slug = title
    .normalize("NFKD")
    // Strip the combining marks NFKD just split off, so "Wānaka" becomes
    // "wanaka" rather than losing the vowel entirely.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const date = exportedAt.toISOString().slice(0, 10);
  return `${slug || "story"}-${date}.pdf`;
}
