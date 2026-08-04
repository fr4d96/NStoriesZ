// Structured RPC error classification. Supabase/PostgREST surfaces a
// Postgres error's SQLSTATE as `.code` on the thrown/returned error object
// -- already an established pattern in this codebase:
// app/(contributor)/actions.ts#createOwnContributorAction already checks
// `error.code === "23505"` (unique_violation) on a real Supabase error, so
// this isn't a new mechanism, just applying the existing one to the custom
// 'WHV01' SQLSTATE that
// supabase/migrations/20260804092100_submit_consent_requires_terms_version.sql's
// submit_revision_with_consent() raises when the caller's
// p_expected_terms_version no longer matches current_terms_version().

export function isTermsChangedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "WHV01"
  );
}
