import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

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

export const SIGN_IN_WINDOW_SECONDS = 15 * 60;
export const SIGN_IN_IP_LIMIT = 25;
export const SIGN_IN_IDENTIFIER_LIMIT = 8;

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

type Bucket = "ip" | "identifier" | "reset_ip" | "reset_email";

async function checkBucket(
  scope: Bucket,
  keyHash: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_auth_rate_limit", {
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
      supabase.rpc("record_auth_attempt", {
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
export function rateLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many sign-in attempts. Try again in about ${minutes} minute${
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
export const PASSWORD_RESET_WINDOW_SECONDS = 60 * 60;
export const PASSWORD_RESET_IP_LIMIT = 20;
export const PASSWORD_RESET_EMAIL_LIMIT = 5;

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
      supabase.rpc("record_auth_attempt", {
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
