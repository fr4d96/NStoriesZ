import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  SIGN_IN_WINDOW_SECONDS,
  SIGN_IN_IP_LIMIT,
  SIGN_IN_IDENTIFIER_LIMIT,
  PASSWORD_RESET_WINDOW_SECONDS,
  PASSWORD_RESET_IP_LIMIT,
  PASSWORD_RESET_EMAIL_LIMIT,
  SIGN_UP_WINDOW_SECONDS,
  SIGN_UP_IP_LIMIT,
  SIGN_UP_EMAIL_LIMIT,
  PDF_IMPORT_WINDOW_SECONDS,
  PDF_PREVIEW_LIMIT,
  PDF_ATTACH_LIMIT,
} from "@/lib/rate-limit-config";

// Re-exported so every existing `from "@/lib/rate-limit"` import keeps
// working; the numbers themselves live in the dependency-free config module
// (see its header for why they had to move).
export {
  SIGN_IN_WINDOW_SECONDS,
  SIGN_IN_IP_LIMIT,
  SIGN_IN_IDENTIFIER_LIMIT,
  PASSWORD_RESET_WINDOW_SECONDS,
  PASSWORD_RESET_IP_LIMIT,
  PASSWORD_RESET_EMAIL_LIMIT,
  SIGN_UP_WINDOW_SECONDS,
  SIGN_UP_IP_LIMIT,
  SIGN_UP_EMAIL_LIMIT,
  PDF_IMPORT_WINDOW_SECONDS,
  PDF_PREVIEW_LIMIT,
  PDF_ATTACH_LIMIT,
};

/**
 * Sign-in rate limiting.
 *
 * Two independent buckets, both counting FAILED attempts only:
 *
 * - **per IP** (25 / 15 min) is the actual brute-force defence, and it can
 *   only ever be spent by the source spending it. Set well above the
 *   per-identifier limit because an office or campus NAT puts many
 *   legitimate people behind one address.
 * - **per identifier** (8 / 15 min) blunts a distributed attack on one
 *   account, which the IP bucket alone cannot see. Set low because a real
 *   person who has forgotten their password does not need nine guesses in a
 *   quarter of an hour, and "Forgot your password?" sits right there.
 *
 * The IP bucket is checked FIRST and short-circuits, which is what stops one
 * source from walking through a list burning other people's allowances --
 * it runs out of its own after 25 failures.
 *
 * Keys are hashed (SHA-256) before they leave this process, so the table
 * stores no readable email, username, or IP address. That is data
 * minimisation, not a security control: the digest is unsalted and proves
 * nothing against someone who can already read the table.
 *
 * EVERYTHING HERE FAILS OPEN. If the check cannot run -- database
 * unreachable, migration not yet applied, RPC error -- the sign-in proceeds
 * unthrottled. A rate limiter that locks the whole platform out when its own
 * storage hiccups is a worse outage than the one it prevents, and the
 * password check itself is still in front of every account. The same
 * reasoning as hasContributorIdentity()'s documented fail-open in
 * lib/auth/contributor-identity.ts.
 */

export type RateLimitVerdict =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

const ALLOWED: RateLimitVerdict = { allowed: true };

function hashKey(scope: string, value: string): string {
  return createHash("sha256").update(`${scope}:${value}`).digest("hex");
}

/**
 * Buckets "Foo@Example.com  " and "foo@example.com" together, so changing
 * the case of what you type does not hand you a fresh allowance. Matches how
 * classifySignInIdentifier() normalises before resolving.
 */
function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * The client address, as reported by whatever proxy sits in front.
 *
 * These headers are only as trustworthy as that proxy: on Vercel they are
 * set by the platform, but an origin reachable directly would let a caller
 * spoof them and mint a fresh IP bucket per request. The per-identifier
 * bucket does not depend on them and still applies, which is why an unknown
 * address skips the IP check rather than failing the sign-in.
 *
 * Returns null in local development, where neither header is set. Bucketing
 * every developer under a shared "unknown" key would throttle a machine
 * nobody is attacking.
 */
async function clientIp(): Promise<string | null> {
  try {
    const headerList = await headers();
    const realIp = headerList.get("x-real-ip")?.trim();
    if (realIp) return realIp;

    // Left-most entry is the originating client by convention.
    const forwarded = headerList.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

type Bucket =
  | "ip"
  | "identifier"
  | "reset_ip"
  | "reset_email"
  | "signup_ip"
  | "signup_email"
  | "pdf_preview_user"
  | "pdf_attach_user";

async function checkBucket(
  scope: Bucket,
  keyHash: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_scope: scope,
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  // `error` is checked here rather than left to the caller's try/catch:
  // callUntypedRpc() used to throw for us, a plain rpc() hands the error
  // back instead. Treating it as ALLOWED is the documented fail-open, not
  // an unhandled case.
  const row = data?.[0];
  if (error || !row || row.allowed) return ALLOWED;

  return {
    allowed: false,
    retryAfterSeconds: row.retry_after_seconds ?? windowSeconds,
  };
}

/**
 * Called before any credential work. Never consumes an attempt -- only
 * recordSignInFailure() does that.
 */
export async function checkSignInRateLimit(
  rawIdentifier: string,
): Promise<RateLimitVerdict> {
  try {
    const ip = await clientIp();
    if (ip) {
      const verdict = await checkBucket(
        "ip",
        hashKey("ip", ip),
        SIGN_IN_IP_LIMIT,
        SIGN_IN_WINDOW_SECONDS,
      );
      if (!verdict.allowed) return verdict;
    }

    return await checkBucket(
      "identifier",
      hashKey("identifier", normalizeIdentifier(rawIdentifier)),
      SIGN_IN_IDENTIFIER_LIMIT,
      SIGN_IN_WINDOW_SECONDS,
    );
  } catch {
    return ALLOWED;
  }
}

/**
 * Counts one failure against both buckets.
 *
 * signInAction calls this on EVERY failing path, including an identifier
 * that resolves to no account at all. That is not incidental: if only real
 * accounts ever accumulated failures, then "this identifier never starts
 * rate-limiting" would itself confirm the account does not exist, quietly
 * undoing the single generic error message the whole sign-in path is built
 * around.
 */
export async function recordSignInFailure(
  rawIdentifier: string,
): Promise<void> {
  try {
    const supabase = await createClient();
    const ip = await clientIp();

    // A returned `error` is deliberately not inspected: there is nothing
    // useful to do with a counter we could not write, and the one thing we
    // must NOT do is fail a sign-in over it.
    const record = (scope: Bucket, keyHash: string) =>
      supabase.rpc("record_rate_limit_attempt", {
        p_scope: scope,
        p_key_hash: keyHash,
        p_window_seconds: SIGN_IN_WINDOW_SECONDS,
      });

    await Promise.all([
      ...(ip ? [record("ip", hashKey("ip", ip))] : []),
      record(
        "identifier",
        hashKey("identifier", normalizeIdentifier(rawIdentifier)),
      ),
    ]);
  } catch {
    // Fail open: a counter we could not write must never block a sign-in.
  }
}

/**
 * "Too many sign-in attempts. Try again in about 12 minutes."
 *
 * Deliberately says nothing about which bucket tripped or whether the
 * identifier names a real account -- it is reachable by typing gibberish
 * into the field nine times.
 */
export function rateLimitedMessage(
  retryAfterSeconds: number,
  label: "sign-in" | "sign-up" = "sign-in",
): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many ${label} attempts. Try again in about ${minutes} minute${
    minutes === 1 ? "" : "s"
  }.`;
}

/**
 * Password-reset limits.
 *
 * A LONGER WINDOW THAN SIGN-IN (60 minutes vs 15) because the harm is
 * cumulative: at sign-in's 15-minute window, five requests per window is
 * still ~480 emails a day into one inbox. An hour makes the ceiling
 * meaningful while staying generous for a real person, who needs one and
 * occasionally a second when the first mail does not arrive.
 *
 * Counts EVERY request rather than every failure -- forgot-password has no
 * failure to wait for, and flooding an inbox does not care whether the send
 * succeeded.
 *
 * Buckets are separate from sign-in's, so neither form can spend the
 * other's allowance.
 */

export async function checkPasswordResetRateLimit(
  rawEmail: string,
): Promise<RateLimitVerdict> {
  try {
    const ip = await clientIp();
    if (ip) {
      const verdict = await checkBucket(
        "reset_ip",
        hashKey("reset_ip", ip),
        PASSWORD_RESET_IP_LIMIT,
        PASSWORD_RESET_WINDOW_SECONDS,
      );
      if (!verdict.allowed) return verdict;
    }

    return await checkBucket(
      "reset_email",
      hashKey("reset_email", normalizeIdentifier(rawEmail)),
      PASSWORD_RESET_EMAIL_LIMIT,
      PASSWORD_RESET_WINDOW_SECONDS,
    );
  } catch {
    return ALLOWED;
  }
}

export async function recordPasswordResetRequest(
  rawEmail: string,
): Promise<void> {
  try {
    const supabase = await createClient();
    const ip = await clientIp();

    const record = (scope: Bucket, keyHash: string) =>
      supabase.rpc("record_rate_limit_attempt", {
        p_scope: scope,
        p_key_hash: keyHash,
        p_window_seconds: PASSWORD_RESET_WINDOW_SECONDS,
      });

    await Promise.all([
      ...(ip ? [record("reset_ip", hashKey("reset_ip", ip))] : []),
      record(
        "reset_email",
        hashKey("reset_email", normalizeIdentifier(rawEmail)),
      ),
    ]);
  } catch {
    // Fail open, same as the sign-in counters.
  }
}

/**
 * Signup limits. The last unthrottled auth entry point.
 *
 * Counts EVERY request, not every failure -- the harm here (a confirmation
 * email sent, an auth.users row plus everything handle_new_user creates
 * behind it) happens when the call SUCCEEDS. Same reasoning as password
 * reset, the opposite of sign-in.
 *
 * The per-IP limit is the defence against mass account creation; the
 * per-email limit is the defence against signing up repeatedly with someone
 * else's address to mail them confirmations they never asked for.
 *
 * Limits are generous for what is a once-ever action, purely to absorb a
 * shared NAT -- a hostel, campus or cafe, very much this platform's
 * audience -- and the honest retry when a confirmation mail does not land.
 */

export async function checkSignUpRateLimit(
  rawEmail: string,
): Promise<RateLimitVerdict> {
  try {
    const ip = await clientIp();
    if (ip) {
      const verdict = await checkBucket(
        "signup_ip",
        hashKey("signup_ip", ip),
        SIGN_UP_IP_LIMIT,
        SIGN_UP_WINDOW_SECONDS,
      );
      if (!verdict.allowed) return verdict;
    }

    return await checkBucket(
      "signup_email",
      hashKey("signup_email", normalizeIdentifier(rawEmail)),
      SIGN_UP_EMAIL_LIMIT,
      SIGN_UP_WINDOW_SECONDS,
    );
  } catch {
    return ALLOWED;
  }
}

export async function recordSignUpAttempt(rawEmail: string): Promise<void> {
  try {
    const supabase = await createClient();
    const ip = await clientIp();

    const record = (scope: Bucket, keyHash: string) =>
      supabase.rpc("record_rate_limit_attempt", {
        p_scope: scope,
        p_key_hash: keyHash,
        p_window_seconds: SIGN_UP_WINDOW_SECONDS,
      });

    await Promise.all([
      ...(ip ? [record("signup_ip", hashKey("signup_ip", ip))] : []),
      record(
        "signup_email",
        hashKey("signup_email", normalizeIdentifier(rawEmail)),
      ),
    ]);
  } catch {
    // Fail open, same as every other counter here.
  }
}

/**
 * PDF import limits.
 *
 * The abuse is resource exhaustion, not credentials: rasterising a PDF runs
 * pdfjs-dist plus @napi-rs/canvas over an input of up to 75 MiB
 * (MAX_PDF_IMPORT_INPUT_BYTES) for up to MAX_PDF_IMPORT_PAGES pages. That is
 * by far the most expensive thing a signed-in person can ask this server to
 * do, and on serverless it is billed by the second.
 *
 * KEYED ON THE USER ID, NOT AN IP. Every one of these routes is
 * authenticated, so the caller's identity is already established
 * server-side from the session -- unspoofable, and free of the shared-NAT
 * problem the auth limits have to tolerate. The id is always taken from the
 * session, never from the request (Engineering Rule 2).
 *
 * PREVIEW AND ATTACH HAVE SEPARATE BUDGETS. Preview is exploratory and
 * repeated -- try a file, look at the thumbnails, try a different file --
 * while attach is the committed action at the end of it. A shared budget
 * would let heavy previewing block the very import the previewing was for,
 * which is precisely the wrong thing to break.
 *
 * Counts every request: the rasterising cost is paid whether or not the PDF
 * turns out to be usable.
 */

export type PdfImportSurface = "preview" | "attach";

function pdfScope(surface: PdfImportSurface): Bucket {
  return surface === "preview" ? "pdf_preview_user" : "pdf_attach_user";
}

function pdfLimit(surface: PdfImportSurface): number {
  return surface === "preview" ? PDF_PREVIEW_LIMIT : PDF_ATTACH_LIMIT;
}

/**
 * `userId` must come from the session (getCurrentUser()/getCurrentUserRole()),
 * never from the request body or a header.
 */
export async function checkPdfImportRateLimit(
  surface: PdfImportSurface,
  userId: string,
): Promise<RateLimitVerdict> {
  try {
    const scope = pdfScope(surface);
    return await checkBucket(
      scope,
      hashKey(scope, userId),
      pdfLimit(surface),
      PDF_IMPORT_WINDOW_SECONDS,
    );
  } catch {
    return ALLOWED;
  }
}

export async function recordPdfImportAttempt(
  surface: PdfImportSurface,
  userId: string,
): Promise<void> {
  try {
    const supabase = await createClient();
    const scope = pdfScope(surface);
    await supabase.rpc("record_rate_limit_attempt", {
      p_scope: scope,
      p_key_hash: hashKey(scope, userId),
      p_window_seconds: PDF_IMPORT_WINDOW_SECONDS,
    });
  } catch {
    // Fail open, same as every other counter here.
  }
}

/**
 * 429 with a Retry-After header -- the correct answer for a Route Handler,
 * where the caller is fetch() rather than a form. The auth actions return
 * form state instead because that is what a Server Action gives back.
 */
export function tooManyRequestsResponse(retryAfterSeconds: number): Response {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return Response.json(
    {
      error: `Too many PDF imports. Try again in about ${minutes} minute${
        minutes === 1 ? "" : "s"
      }.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
