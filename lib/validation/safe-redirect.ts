/**
 * Validates a client-supplied "return to" path (e.g. ?next=/my-stories) so
 * auth flows never become an open redirect. Only same-site, root-relative
 * paths are accepted — no protocol-relative ("//evil.com"), no absolute
 * URLs, no backslashes (browsers sometimes treat "/\evil.com" like "//").
 */
export function resolveSafeReturnTo(
  candidate: string | null | undefined,
  fallback = "/",
): string {
  if (!candidate) {
    return fallback;
  }

  if (!candidate.startsWith("/")) {
    return fallback;
  }

  if (candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return fallback;
  }

  // Reject anything that isn't a plain path+query+hash Next.js can route to
  // internally — in particular, no embedded scheme like "/\t/evil.com" or
  // "/javascript:alert(1)" disguised as a path.
  if (!/^\/[a-zA-Z0-9\-._~!$&'()*+,;=:@/%?#]*$/.test(candidate)) {
    return fallback;
  }

  return candidate;
}
