import type { NextConfig } from "next";

// Server Action body-size limit for the editorial content-import Server
// Action (app/(editor)/editorial/import-actions.ts#importStoryContentAction).
// Deliberately NOT set equal to lib/story/content-import.ts's
// MAX_IMPORT_INPUT_BYTES (2,000,000 bytes) -- that constant is the
// authoritative, product-level limit, enforced by a real UTF-8 byte-length
// check INSIDE the action, before any parsing. This framework-level ceiling
// only needs enough margin that the raw text plus its JSON-string escaping,
// the surrounding Server Action invocation payload shape, and Next's own
// request framing don't get rejected before the action's own check ever
// runs -- +25% (2.5 MB) is that margin. Cross-referenced in both files
// deliberately, so the two numbers can't silently drift apart without a
// comment pointing back here.
// MAX_IMPORT_INPUT_BYTES (2,000,000, defined in lib/story/content-import.ts) + 25%.
const SERVER_ACTION_BODY_SIZE_LIMIT = "2.5mb";

// Request-body ceiling for any route matched by proxy.ts (Next 16's renamed
// middleware). Next buffers the body so the proxy can read it, and defaults
// that buffer to 10 MB -- past which it *silently truncates* ("Only the
// first 10MB will be available unless configured"), it does not reject.
//
// proxy.ts's matcher includes "/editorial/:path*", which covers both PDF
// import Route Handlers (pdf-preview, pdf-attach). Those accept files up to
// MAX_PDF_IMPORT_INPUT_BYTES (75 MiB, lib/story/pdf-validation.ts, sized
// against a real ~57 MB 151-page Canva export -- see
// docs/pdf-import-spike-findings.md). Left at the default, every genuinely
// large Canva export would arrive truncated and be rejected as a corrupt
// PDF: a confusing, wrong error for a perfectly valid file. 80 MB is
// 75 MiB (78.6 MB) plus a small margin for multipart framing/boundaries,
// mirroring how SERVER_ACTION_BODY_SIZE_LIMIT above is sized above its own
// in-code limit rather than exactly at it. The routes themselves still
// enforce the real 75 MiB ceiling in code (pdfImportFileSchema), so this is
// a transport ceiling only, never the product-level limit.
const PROXY_CLIENT_MAX_BODY_SIZE = "80mb";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: SERVER_ACTION_BODY_SIZE_LIMIT,
    },
    proxyClientMaxBodySize: PROXY_CLIENT_MAX_BODY_SIZE,
  },
  // lib/story/pdf-import.ts's PDF-page rasterizer (docs/pdf-canva-import-plan.md
  // Stage 1) depends on @napi-rs/canvas (a native-binary Node addon) and
  // pdfjs-dist (a large module graph not meant to run through webpack's
  // browser-oriented transforms). Both must be excluded from Next's server
  // bundling and loaded via plain `require`/dynamic `import` at runtime
  // instead -- the same reason `sharp` (lib/story/image-pipeline.ts) already
  // works without needing to be listed here (Next auto-detects a few common
  // native packages, but not these two).
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
