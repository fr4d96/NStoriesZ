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
  // instead.
  //
  // `sharp` (lib/story/image-pipeline.ts, lib/story/heic.ts) is here for the
  // same reason, NOT because it works without this -- an earlier version of
  // this comment claimed Next auto-detects sharp and only napi-rs/canvas
  // and pdfjs-dist needed listing. That assumption was wrong under this
  // project's Turbopack build: confirmed live via a real Vercel production
  // deployment's function logs, every image upload crashed at cold start
  // (500 FUNCTION_INVOCATION_FAILED, zero outgoing requests, ~200ms) with
  // `ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object
  // file`. Root cause: sharp is a native addon (a compiled .node binding
  // plus a separate libvips .so it dlopen()s at runtime, shipped as a
  // platform-specific optional dependency, @img/sharp-libvips-linux-x64)
  // -- exactly the same class of "not a plain JS require(), invisible to
  // static bundling/tracing" problem @napi-rs/canvas already has, and the
  // reason serverExternalPackages exists at all: it tells Next to leave the
  // whole node_modules/sharp directory (native binary included) untouched
  // by Turbopack's own bundling instead of trying to trace/transform it,
  // so Vercel's deployment packaging can find and include the native
  // library that a JS-level static trace can't see. sharp's own package
  // was present in package-lock.json with correct linux-x64 optional
  // dependencies the whole time -- this was never an install problem, only
  // a bundling one.
  //
  // `heic-decode` and its dependency `libheif-js` (lib/story/heic.ts) are
  // here for the exact same class of problem, one level removed: instead of
  // a native .node/.so binary, libheif-js's Emscripten-compiled bundle
  // (node_modules/libheif-js/libheif-wasm/libheif-bundle.js) locates its
  // ~1 MB libheif.wasm at runtime via `__dirname + "/libheif.wasm"` and
  // `fs.readFileSync()` -- invisible to static bundling/tracing because it
  // is not a JS `require`/`import` of that file. Left untraced, the .wasm
  // never reaches the deployed Vercel function, and every HEIC upload fails
  // at the decode step in production while working locally (node_modules is
  // fully present on disk in dev).
  //
  // serverExternalPackages alone does NOT fix either package: it stops
  // Turbopack transforming them, but it does not make @vercel/nft include
  // files that no static `require`/`import` points at. Confirmed by reading
  // the built .nft.json trace files (see outputFileTracingIncludes below,
  // which is where both are actually rescued).
  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdfjs-dist",
    "sharp",
    "heic-decode",
    "libheif-js",
  ],
  // Native/binary files that no static import points at, so @vercel/nft
  // never traces them and Vercel never deploys them. Both entries below were
  // verified by grepping the built .next/server/app/**/*.nft.json files --
  // do the same after changing anything here, because a key that matches
  // nothing fails SILENTLY at build time and only surfaces as a 500 in
  // production.
  //
  // Keys use `*`, never the literal `[id]` segment: they are matched with
  // picomatch against the normalized route path, which reads a literal
  // `[id]` as a single-character glob class (matching "i" or "d") rather
  // than as dynamic-segment text. Confirmed live -- a literal-bracket key
  // silently never matched and the file stayed missing from the trace.
  //
  // Values are globs so that neither a platform nor a version bump breaks
  // this again: on Vercel npm installs only the linux-x64 optional package,
  // locally only darwin-arm64, and the libvips filename carries its own
  // version (libvips-cpp.so.8.18.3).
  outputFileTracingIncludes: {
    // sharp's `.node` binding IS traced automatically, but the separate
    // libvips shared library it dlopen()s at runtime is NOT -- nft picks up
    // the libvips package's index.js/package.json/versions.json and leaves
    // the 17 MB .so/.dylib behind. That is the direct cause of the
    // production error `ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot
    // open shared object file`, which took down every route below, not just
    // the upload handler: `/my-stories` renders StoryCoverThumbnail, whose
    // mintPreviewUrlAction imports lib/story/image-pipeline.ts -> sharp, so
    // the whole page 500s and no story image ever loads.
    //
    // Listed per-route rather than globally on purpose: this adds ~17 MB to
    // each function it applies to, and only these eight entries actually
    // pull sharp into their bundle (re-derive with:
    // grep -rl "node_modules/sharp" .next/server/app --include="*.nft.json").
    "/my-stories": ["./node_modules/@img/sharp-libvips-*/lib/*"],
    "/stories/*/edit": ["./node_modules/@img/sharp-libvips-*/lib/*"],
    "/stories/*/preview": ["./node_modules/@img/sharp-libvips-*/lib/*"],
    "/stories/new/pdf-attach": ["./node_modules/@img/sharp-libvips-*/lib/*"],
    "/editorial/*/edit": ["./node_modules/@img/sharp-libvips-*/lib/*"],
    "/editorial/new/pdf-attach": ["./node_modules/@img/sharp-libvips-*/lib/*"],
    "/moderation/stories/*": ["./node_modules/@img/sharp-libvips-*/lib/*"],
    // The upload route needs libvips too, plus libheif-js's WASM binary,
    // which libheif-bundle.js locates at runtime via
    // `fs.readFileSync(__dirname + "/libheif.wasm")` -- again invisible to
    // static tracing. Without it every HEIC (iPhone/iPad) upload fails at
    // the decode step in production while working locally.
    "/stories/*/edit/upload": [
      "./node_modules/@img/sharp-libvips-*/lib/*",
      "./node_modules/libheif-js/libheif-wasm/libheif.wasm",
    ],
  },
};

export default nextConfig;
