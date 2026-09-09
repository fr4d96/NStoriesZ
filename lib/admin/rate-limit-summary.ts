import {
  SIGN_IN_IDENTIFIER_LIMIT,
  SIGN_IN_IP_LIMIT,
  SIGN_IN_WINDOW_SECONDS,
  PASSWORD_RESET_EMAIL_LIMIT,
  PASSWORD_RESET_IP_LIMIT,
  PASSWORD_RESET_WINDOW_SECONDS,
  SIGN_UP_EMAIL_LIMIT,
  SIGN_UP_IP_LIMIT,
  SIGN_UP_WINDOW_SECONDS,
  PDF_ATTACH_LIMIT,
  PDF_PREVIEW_LIMIT,
  PDF_IMPORT_WINDOW_SECONDS,
} from "@/lib/rate-limit-config";

/**
 * The rate limits, in a shape a table can render.
 *
 * READ FROM THE SAME CONSTANTS THE LIMITER ENFORCES, never retyped. A
 * hand-written list of these numbers would be correct exactly until someone
 * tuned one, and a settings page that quietly lies about the setting is
 * worse than no page at all -- the same reasoning that keeps
 * lib/admin/dashboard-analytics.ts deriving rather than restating.
 *
 * This is deliberately NOT the live counters. Those live in
 * `public.rate_limits`, which has RLS on with zero policies and every grant
 * revoked, because which accounts are under attack is not information to
 * hand out. Showing them would need a new admin-only SECURITY DEFINER
 * function, and the rows would be SHA-256 hashes rather than names anyway.
 */
export type RateLimitRow = {
  key: string;
  surface: string;
  scope: string;
  counts: string;
  limit: number;
  windowMinutes: number;
  whenExceeded: string;
};

const minutes = (seconds: number) => Math.round(seconds / 60);

const TELLS_YOU = "Tells you how long to wait";
const SILENT = "Sends nothing, same reply as always";
const HTTP_429 = "HTTP 429 with a retry time";

export function rateLimitRows(): RateLimitRow[] {
  return [
    {
      key: "sign-in-identifier",
      surface: "Sign in",
      scope: "per email or username",
      counts: "failed attempts",
      limit: SIGN_IN_IDENTIFIER_LIMIT,
      windowMinutes: minutes(SIGN_IN_WINDOW_SECONDS),
      whenExceeded: TELLS_YOU,
    },
    {
      key: "sign-in-ip",
      surface: "Sign in",
      scope: "per IP address",
      counts: "failed attempts",
      limit: SIGN_IN_IP_LIMIT,
      windowMinutes: minutes(SIGN_IN_WINDOW_SECONDS),
      whenExceeded: TELLS_YOU,
    },
    {
      key: "reset-email",
      surface: "Password reset",
      scope: "per email address",
      counts: "every request",
      limit: PASSWORD_RESET_EMAIL_LIMIT,
      windowMinutes: minutes(PASSWORD_RESET_WINDOW_SECONDS),
      whenExceeded: SILENT,
    },
    {
      key: "reset-ip",
      surface: "Password reset",
      scope: "per IP address",
      counts: "every request",
      limit: PASSWORD_RESET_IP_LIMIT,
      windowMinutes: minutes(PASSWORD_RESET_WINDOW_SECONDS),
      whenExceeded: SILENT,
    },
    {
      key: "sign-up-email",
      surface: "Sign up",
      scope: "per email address",
      counts: "every request",
      limit: SIGN_UP_EMAIL_LIMIT,
      windowMinutes: minutes(SIGN_UP_WINDOW_SECONDS),
      whenExceeded: TELLS_YOU,
    },
    {
      key: "sign-up-ip",
      surface: "Sign up",
      scope: "per IP address",
      counts: "every request",
      limit: SIGN_UP_IP_LIMIT,
      windowMinutes: minutes(SIGN_UP_WINDOW_SECONDS),
      whenExceeded: TELLS_YOU,
    },
    {
      key: "pdf-preview",
      surface: "PDF import preview",
      scope: "per signed-in person",
      counts: "every request",
      limit: PDF_PREVIEW_LIMIT,
      windowMinutes: minutes(PDF_IMPORT_WINDOW_SECONDS),
      whenExceeded: HTTP_429,
    },
    {
      key: "pdf-attach",
      surface: "PDF import attach",
      scope: "per signed-in person",
      counts: "every request",
      limit: PDF_ATTACH_LIMIT,
      windowMinutes: minutes(PDF_IMPORT_WINDOW_SECONDS),
      whenExceeded: HTTP_429,
    },
  ];
}
