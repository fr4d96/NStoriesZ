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
  // Unlike sharp, serverExternalPackages alone does NOT fix this: `sharp` is
  // one of @vercel/nft's built-in special-cased packages, so its native
  // binary gets included in the trace automatically once nft stops trying
  // to transform the package; libheif-js's runtime-computed `fs.readFileSync`
  // path has no such special case and is never found by nft's static
  // analysis, with or without serverExternalPackages (confirmed by
  // inspecting .next/server/app/.../upload/route.js.nft.json after a build
  // -- libheif-bundle.js was listed, libheif.wasm was not). The .wasm must
  // be force-included per-route via outputFileTracingIncludes below;
  // serverExternalPackages is still needed alongside it so Turbopack leaves
  // the package's own runtime `fs`/`__dirname` logic untransformed.
  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdfjs-dist",
    "sharp",
    "heic-decode",
    "libheif-js",
  ],
  // Keyed with a `*` wildcard, not the literal `[id]` segment: this key is
  // matched with picomatch against the route path, which parses a literal
  // `[id]` as a single-character glob class (matching one character "i" or
  // "d") rather than as the literal three-character dynamic-segment text --
  // confirmed live, the literal-bracket key silently never matched and the
  // .wasm was absent from the built trace file.
  outputFileTracingIncludes: {
    "/stories/*/edit/upload": [
      "./node_modules/libheif-js/libheif-wasm/libheif.wasm",
    ],
  },
};

export default nextConfig;
