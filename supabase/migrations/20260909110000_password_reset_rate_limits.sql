-- Extends the sign-in rate limiter (20260909100000_auth_rate_limits.sql) to
-- cover forgotPasswordAction.
--
-- THE ABUSE THIS STOPS: forgot-password takes an address and sends mail to
-- it, with nothing in front of it. Anyone who knows an address is registered
-- could point a loop at it and generate a password-reset email per request
-- -- inbox flooding for the victim, and the platform's own email quota
-- burned to do it.
--
-- TWO DIFFERENCES FROM SIGN-IN, both deliberate:
--
-- 1. It counts EVERY REQUEST, not every failure. Bombing an inbox does not
--    care whether the send succeeded, so there is no "failure" to wait for.
--    That makes record_auth_failure() a wrong name for half its callers now,
--    hence the rename below -- a misleading name on a security-relevant
--    function is how a future change quietly assumes the wrong thing.
--
-- 2. Its buckets are SEPARATE from sign-in's ('reset_ip'/'reset_email' vs
--    'ip'/'identifier'). Sharing them would let a reset request eat a
--    sign-in allowance and vice versa, so one form could lock the other.
--
-- The window is an argument, not schema, so the caller uses a longer one
-- here (60 minutes vs 15): a handful of resets an hour is generous for a
-- real person, while a 15-minute window would still permit ~96 mails a day
-- to one address.

alter table public.auth_rate_limits
  drop constraint auth_rate_limits_scope_known;

alter table public.auth_rate_limits
  add constraint auth_rate_limits_scope_known
  check (scope in ('ip', 'identifier', 'reset_ip', 'reset_email'));

-- Grants, comments and the function OID survive a rename, so nothing needs
-- re-granting; only the generated types and the two call sites change.
alter function public.record_auth_failure(text, text, integer)
  rename to record_auth_attempt;

comment on function public.record_auth_attempt(text, text, integer) is
  'Counts one attempt against a key. For sign-in scopes the caller only counts FAILED attempts; for password-reset scopes it counts every request, because inbox flooding does not care whether the send succeeded. Still no paired clear/reset function, deliberately -- see 20260909100000_auth_rate_limits.sql.';

comment on constraint auth_rate_limits_scope_known on public.auth_rate_limits is
  'Sign-in buckets (ip, identifier) and password-reset buckets (reset_ip, reset_email) are deliberately separate so neither form can spend the other''s allowance.';
