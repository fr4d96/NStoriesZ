import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
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
 * below. It does NOT cover CJK or emoji -- see `sanitizeForFont()`.
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

function fontPath(key: FontKey): string {
  return path.join(liberationFontDir(), FONT_FILES[key]);
}

/**
 * The regular face, opened once, purely so `sanitizeForFont()` can ask the
 * REAL font which code points it can draw. A hand-maintained list of Unicode
 * ranges was the alternative and would be wrong the moment it drifted from
 * the actual .ttf; this cannot drift.
 */
let coverageFontCache: fontkit.Font | undefined;

function coverageFont(): fontkit.Font {
  if (!coverageFontCache) {
    const opened = fontkit.openSync(fontPath("regular"));
    // openSync widens to Font | FontCollection because a .ttc holds several
    // faces. These are plain .ttf files, so the collection branch is
    // unreachable -- but assert it rather than assume it, so a swapped font
    // file fails here with a clear message instead of somewhere downstream.
    //
    // Narrowed on the method actually used below, NOT on `getFont`: fontkit
    // puts `getFont` on a single Font too, so that discriminator matches
    // everything and rejects the good case.
    if (!("hasGlyphForCodePoint" in opened)) {
      throw new Error(
        `Expected a single-face font at ${FONT_FILES.regular}, got a collection.`,
      );
    }
    coverageFontCache = opened;
  }
  return coverageFontCache;
}

/**
 * Replaces characters Liberation Sans has no glyph for, so unsupported text
 * renders as a visible "?" rather than the silent blank box a missing glyph
 * otherwise produces. The realistic case is a contributor whose chosen
 * display name is in a non-Latin script (Chinese, Tamil, Arabic) --
 * Kakinotes' initial market is Malaysia, so this is not hypothetical.
 *
 * Handled this way rather than by shipping a CJK font because a font with
 * that coverage is 10-20 MB on every deployment of this route, for a case
 * the export can degrade gracefully on instead. The limitation is stated in
 * docs/implementation-status.md rather than hidden.
 */
export function sanitizeForFont(text: string): string {
  const font = coverageFont();
  let out = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    // Keep the newlines and tabs pdfkit's own layout depends on; every
    // other control character is dropped rather than turned into "?".
    if (char === "\n" || char === "\t") {
      out += char;
      continue;
    }
    if (codePoint === undefined || codePoint < 0x20) continue;
    out += font.hasGlyphForCodePoint(codePoint) ? char : "?";
  }
  return out;
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

  private text(value: string): string {
    return sanitizeForFont(value);
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

    this.doc.font(FONT_FILES.regular).fontSize(8).fillColor(MUTED);
    this.doc.text(this.text(this.input.title), left, y, {
      width: width - 40,
      align: "left",
      lineBreak: false,
      ellipsis: true,
    });
    this.doc.text(String(this.pageNumber), left, y, {
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
      this.doc
        .font(FONT_FILES[fontKeyFor(run, options)])
        .fontSize(size)
        .fillColor(color);
      this.doc.text(this.text(run.text), {
        // Only the FIRST call of a continued chain establishes the column;
        // pdfkit ignores width/align on the rest of the chain.
        width: column.width,
        continued: !isLast,
        lineGap,
        underline: Boolean(run.link),
        strike: run.strike,
        link: run.link ?? undefined,
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
    const value = this.text(node.value.replace(/\s+$/, ""));
    const innerWidth = column.width - CODE_PADDING * 2;
    this.doc.font(FONT_FILES.regular).fontSize(BODY_SIZE - 1);
    const height = this.doc.heightOfString(value, {
      width: innerWidth,
      lineGap: 2,
    });

    this.doc.moveDown(0.3);
    this.ensureSpace(height + CODE_PADDING * 2);
    const top = this.doc.y;
    this.doc
      .save()
      .rect(column.left, top, column.width, height + CODE_PADDING * 2)
      .fill(CODE_BG)
      .restore();
    this.doc
      .fillColor(CODE_INK)
      .text(value, column.left + CODE_PADDING, top + CODE_PADDING, {
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
            ? this.text(
                runsToPlainText(phrasingToPieces(cell.children, PLAIN_STYLE)),
              )
            : "",
        );
      }

      this.doc
        .font(isHeader ? FONT_FILES.bold : FONT_FILES.regular)
        .fontSize(BODY_SIZE - 0.5);
      const rowHeight =
        Math.max(
          ...cells.map((value) =>
            this.doc.heightOfString(value || " ", { width: innerWidth }),
          ),
        ) +
        padding * 2;

      this.ensureSpace(rowHeight);
      const top = this.doc.y;

      cells.forEach((value, columnIndex) => {
        this.doc
          .fillColor(isHeader ? INK : MUTED)
          .text(
            value,
            column.left + columnIndex * cellWidth + padding,
            top + padding,
            { width: innerWidth },
          );
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
    this.doc.font(FONT_FILES.italic).fontSize(BODY_SIZE - 1.5);
    const captionHeight = describedBy
      ? this.doc.heightOfString(this.text(describedBy), { width }) + 4
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
      this.doc
        .font(FONT_FILES.italic)
        .fontSize(BODY_SIZE - 1.5)
        .fillColor(MUTED)
        .text(this.text(describedBy), column.left, this.doc.y + 4, { width });
    }

    this.doc.x = column.left;
    this.doc.moveDown(0.7);
  }

  // -- Document sections -------------------------------------------------

  renderHeader(): void {
    const column = this.column;

    this.doc
      .font(FONT_FILES.bold)
      .fontSize(23)
      .fillColor(INK)
      .text(this.text(this.input.title), column.left, this.doc.y, {
        width: column.width,
        lineGap: 2,
      });

    if (this.input.excerpt) {
      this.doc.moveDown(0.4);
      this.doc
        .font(FONT_FILES.italic)
        .fontSize(12)
        .fillColor(MUTED)
        .text(this.text(this.input.excerpt), {
          width: column.width,
          lineGap: 2,
        });
    }

    this.doc.moveDown(0.6);
    // Engineering Rule 17: the personal-experience label travels with the
    // story. A PDF is the copy most likely to be read away from the site, so
    // it carries the label at the top, not only in the colophon.
    this.doc
      .font(FONT_FILES.regular)
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        this.text(
          `Personal experience, not advice — shared by ${endWithStop(
            this.input.attributionValue,
          )}`,
        ),
        { width: column.width },
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
      this.doc.font(FONT_FILES.regular).fontSize(9.5);
      const height = this.doc.heightOfString(this.text(value), {
        width: column.width - labelWidth,
      });
      this.ensureSpace(height + 4);
      const top = this.doc.y;
      this.doc
        .fillColor(MUTED)
        .text(label, column.left, top, { width: labelWidth - 8 });
      this.doc
        .fillColor(INK)
        .text(this.text(value), column.left + labelWidth, top, {
          width: column.width - labelWidth,
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
      this.doc.font(FONT_FILES.regular).fontSize(BODY_SIZE);
      const label = expense.note
        ? `${expense.name} — ${expense.note}`
        : expense.name;
      const amountWidth = 90;
      const height = this.doc.heightOfString(this.text(label), {
        width: column.width - amountWidth,
      });
      this.ensureSpace(height + 6);
      const top = this.doc.y;
      this.doc.fillColor(INK).text(this.text(label), column.left, top, {
        width: column.width - amountWidth,
      });
      this.doc.text(formatNzdCents(expense.amountNzdCents), column.left, top, {
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
    this.doc
      .font(FONT_FILES.regular)
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(
        this.text(
          `Your copy of "${this.input.title}" (${this.input.statusLabel}), ` +
            `exported from Kakinotes on ${exported}. This is one person's ` +
            `personal account of a Working Holiday Visa experience, not advice. ` +
            `${this.input.siteUrl}`,
        ),
        column.left,
        this.doc.y,
        { width: column.width, lineGap: 2 },
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
      Title: sanitizeForFont(input.title),
      Author: sanitizeForFont(input.attributionValue),
      Creator: "Kakinotes",
      Subject: "Personal experience, not advice.",
      CreationDate: input.exportedAt,
    },
  });

  doc.registerFont(FONT_FILES.regular, fontPath("regular"));
  doc.registerFont(FONT_FILES.bold, fontPath("bold"));
  doc.registerFont(FONT_FILES.italic, fontPath("italic"));
  doc.registerFont(FONT_FILES.boldItalic, fontPath("boldItalic"));

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  const renderer = new StoryPdfRenderer(doc, input);
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
