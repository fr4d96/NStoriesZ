/**
 * Extracts a human-readable message from a caught `unknown` error without
 * assuming it's a real `Error` instance. The Supabase client (postgrest-js,
 * via `.rpc()`/`.from()`) can reject with a plain PostgrestError-shaped
 * object (`{ code, details, hint, message }`) that fails `instanceof
 * Error` -- confirmed live: this silently broke
 * app/(contributor)/stories/new/actions.ts's specific "you need a
 * contributor identity" message, which fell through to a generic fallback
 * for every caller because the `instanceof Error` check was always false.
 * Checking for a `message` property directly, regardless of type, works
 * for both real Errors and these plain rejection objects. Universal (no
 * server/client-only imports) so both Server Actions and client components
 * can share it.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string" &&
    (error as { message: string }).message.length > 0
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}
