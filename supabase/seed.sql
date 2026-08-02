-- WHV Compass NZ — local seed data.
--
-- Entirely fictional (Engineering Rule 22 — never real contributor names,
-- stories, or images, seed data included). Runs against the LOCAL stack
-- only (`supabase db reset`), never against a hosted project. Password for
-- every seeded account is "password123" (local dev only).
--
-- Inserting directly into auth.users fires the on_auth_user_created trigger
-- (handle_new_user), which creates each account's profiles + user_roles row
-- automatically — we only need to adjust the role afterward for the
-- non-"user" accounts.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111101', 'authenticated', 'authenticated', 'reader.dev@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Riley Reader"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111102', 'authenticated', 'authenticated', 'casey.contributor@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Casey Contributor"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111103', 'authenticated', 'authenticated', 'eden.editor@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Eden Editor"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111104', 'authenticated', 'authenticated', 'morgan.moderator@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Morgan Moderator"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111105', 'authenticated', 'authenticated', 'avery.admin@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Avery Admin"}', now(), now())
on conflict (id) do nothing;

-- The trigger defaults everyone to 'user' — promote the staff accounts.
update public.user_roles set role = 'editor' where user_id = '11111111-1111-1111-1111-111111111103';
update public.user_roles set role = 'moderator' where user_id = '11111111-1111-1111-1111-111111111104';
update public.user_roles set role = 'admin' where user_id = '11111111-1111-1111-1111-111111111105';

-- Casey is a self-service contributor with a public profile.
update public.profiles
set public_profile_enabled = true, public_slug = 'casey-contributor', bio = 'Working holiday in Wellington, 2024.'
where id = '11111111-1111-1111-1111-111111111102';

insert into public.contributors (id, linked_user_id, display_name, public_slug, attribution_type, public_status, created_by)
values ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111102', 'Casey C.', 'casey-contributor', 'display_name', 'public', '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;

-- An editor-prepared founding-catalogue contributor, not yet linked to an
-- account — demonstrates the "prepare before linking" workflow.
insert into public.contributors (id, linked_user_id, display_name, attribution_type, public_status, created_by)
values ('22222222-2222-2222-2222-222222222202', null, 'A. Founding Contributor', 'pseudonym', 'private', '11111111-1111-1111-1111-111111111103')
on conflict (id) do nothing;
