-- On every new auth.users row, create a default profile and an ordinary
-- 'user' role row. SECURITY DEFINER (runs as the trigger owner, bypassing
-- RLS — necessary since the new user has no session yet at insert time),
-- explicit search_path, and ON CONFLICT DO NOTHING so retried/duplicate
-- invocations (e.g. a webhook redelivery) never error.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates a default profile + ordinary user role for every new auth.users row. Idempotent (ON CONFLICT DO NOTHING) so retries are safe.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
