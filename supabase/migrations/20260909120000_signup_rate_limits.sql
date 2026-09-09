-- The last unthrottled auth entry point. Sign-in got limits in
-- 20260909100000, password reset in 20260909110000; this completes the set.
--
-- TWO ABUSES, and they want different keys:
--
-- 1. Mass account creation from one source -- junk rows in auth.users,
--    profiles and user_roles (every signup fires handle_new_user), plus a
--    confirmation email per attempt. The per-IP bucket is the defence.
-- 2. Signing up repeatedly with SOMEONE ELSE'S address, which mails them a
--    confirmation they never asked for. The per-email bucket is the defence,
--    and it is why this counts every REQUEST rather than every failure: the
--    mail goes out when the call SUCCEEDS.
--
-- Separate buckets again ('signup_ip'/'signup_email'), for the same reason
-- reset got its own: sharing would let one form spend another's allowance,
-- so signing up could lock someone out of signing in.
--
-- 60-minute window, chosen by the caller. Signing up is a once-ever action
-- for a real person; the limits are generous only to absorb a shared NAT
-- (hostel, campus, cafe -- very much this platform's audience) and the
-- honest retry when a confirmation mail does not arrive.
--
-- THIS IS THE THIRD MIGRATION WIDENING THIS ONE CHECK. It stays an explicit
-- list rather than an open pattern because a closed set is what stops a typo
-- in a scope name silently creating a brand new, always-empty bucket that
-- rate-limits nothing. With signup covered there is no fourth auth entry
-- point waiting, so the churn stops here.

alter table public.auth_rate_limits
  drop constraint auth_rate_limits_scope_known;

alter table public.auth_rate_limits
  add constraint auth_rate_limits_scope_known
  check (
    scope in (
      'ip', 'identifier',
      'reset_ip', 'reset_email',
      'signup_ip', 'signup_email'
    )
  );

comment on constraint auth_rate_limits_scope_known on public.auth_rate_limits is
  'Sign-in (ip, identifier), password reset (reset_ip, reset_email) and signup (signup_ip, signup_email) buckets are deliberately separate, so no auth form can spend another''s allowance. Deliberately a closed list: a typo in a scope name should fail loudly, not create an empty bucket that silently limits nothing.';
