/**
 * The rate-limit numbers, and nothing else.
 *
 * WHY THIS IS A SEPARATE FILE FROM lib/rate-limit.ts: that module imports
 * the Supabase server client and next/headers, so importing it pulls in
 * env-var validation and a whole request-scoped runtime. Anything that only
 * wants to *read* the numbers -- the /admin "Rate limits" table, and its
 * test -- was paying for all of that, and the test could not even load
 * without a full server environment.
 *
 * So this file has NO imports at all, deliberately. Keep it that way: the
 * moment it needs one, the display path starts dragging a runtime behind it
 * again.
 *
 * lib/rate-limit.ts re-exports every one of these, so existing
 * `from "@/lib/rate-limit"` imports are unaffected.
 *
 * The reasoning BEHIND each number stays next to the code that enforces it,
 * in lib/rate-limit.ts -- this file is the values, not the argument for
 * them.
 */

/** Sign-in: counts FAILED attempts only. */
export const SIGN_IN_WINDOW_SECONDS = 15 * 60;
export const SIGN_IN_IP_LIMIT = 25;
export const SIGN_IN_IDENTIFIER_LIMIT = 8;

/** Password reset: counts every request. */
export const PASSWORD_RESET_WINDOW_SECONDS = 60 * 60;
export const PASSWORD_RESET_IP_LIMIT = 20;
export const PASSWORD_RESET_EMAIL_LIMIT = 5;

/** Signup: counts every request. */
export const SIGN_UP_WINDOW_SECONDS = 60 * 60;
export const SIGN_UP_IP_LIMIT = 10;
export const SIGN_UP_EMAIL_LIMIT = 3;

/** PDF import: counts every request, keyed on the session user id. */
export const PDF_IMPORT_WINDOW_SECONDS = 60 * 60;
export const PDF_PREVIEW_LIMIT = 20;
export const PDF_ATTACH_LIMIT = 20;
