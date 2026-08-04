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

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: SERVER_ACTION_BODY_SIZE_LIMIT,
    },
  },
};

export default nextConfig;
