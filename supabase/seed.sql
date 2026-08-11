-- Kakinotes — local seed data.
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

-- ---------------------------------------------------------------------
-- Story domain: lookup data + stories covering every lifecycle state.
--
-- Inserted directly (as the seed-running superuser, bypassing RLS/grants)
-- rather than via the SECURITY DEFINER RPCs, because those functions derive
-- the caller from auth.uid() — which is null outside a real authenticated
-- session. This mirrors the existing seed.sql convention above (direct
-- inserts into auth.users/contributors).
-- ---------------------------------------------------------------------

insert into public.regions (id, slug, name, island_or_grouping)
values
  ('33333333-1111-1111-1111-111111111101', 'bay-of-plenty', 'Bay of Plenty', 'North Island'),
  ('33333333-1111-1111-1111-111111111102', 'wellington', 'Wellington', 'North Island'),
  ('33333333-1111-1111-1111-111111111103', 'marlborough', 'Marlborough', 'South Island'),
  ('33333333-1111-1111-1111-111111111104', 'otago', 'Otago', 'South Island')
on conflict (id) do nothing;

insert into public.destinations (id, region_id, slug, name)
values
  ('33333333-2222-1111-1111-111111111101', '33333333-1111-1111-1111-111111111101', 'te-puke', 'Te Puke'),
  ('33333333-2222-1111-1111-111111111102', '33333333-1111-1111-1111-111111111102', 'wellington-city', 'Wellington City'),
  ('33333333-2222-1111-1111-111111111103', '33333333-1111-1111-1111-111111111103', 'blenheim', 'Blenheim'),
  ('33333333-2222-1111-1111-111111111104', '33333333-1111-1111-1111-111111111104', 'queenstown', 'Queenstown')
on conflict (id) do nothing;

insert into public.work_types (id, slug, name)
values
  ('33333333-3333-1111-1111-111111111101', 'horticulture', 'Horticulture'),
  ('33333333-3333-1111-1111-111111111102', 'viticulture', 'Viticulture'),
  ('33333333-3333-1111-1111-111111111103', 'hospitality', 'Hospitality'),
  ('33333333-3333-1111-1111-111111111104', 'tourism', 'Tourism'),
  ('33333333-3333-1111-1111-111111111105', 'retail', 'Retail'),
  ('33333333-3333-1111-1111-111111111106', 'agriculture', 'Agriculture'),
  ('33333333-3333-1111-1111-111111111107', 'administration', 'Administration'),
  ('33333333-3333-1111-1111-111111111108', 'construction', 'Construction'),
  ('33333333-3333-1111-1111-111111111109', 'other', 'Other')
on conflict (id) do nothing;

insert into public.tags (id, slug, name)
values
  ('33333333-4444-1111-1111-111111111101', 'fruit-picking', 'Fruit picking'),
  ('33333333-4444-1111-1111-111111111102', 'hospitality', 'Hospitality'),
  ('33333333-4444-1111-1111-111111111103', 'van-life', 'Van life'),
  ('33333333-4444-1111-1111-111111111104', 'budget-travel', 'Budget travel'),
  ('33333333-4444-1111-1111-111111111105', 'north-island', 'North Island'),
  ('33333333-4444-1111-1111-111111111106', 'south-island', 'South Island'),
  ('33333333-4444-1111-1111-111111111107', 'solo-travel', 'Solo travel'),
  ('33333333-4444-1111-1111-111111111108', 'couple-travel', 'Couple travel'),
  ('33333333-4444-1111-1111-111111111109', 'road-trip', 'Road trip'),
  ('33333333-4444-1111-1111-111111111110', 'first-time-traveller', 'First-time traveller'),
  ('33333333-4444-1111-1111-111111111111', 'seasonal-work', 'Seasonal work')
on conflict (id) do nothing;

-- Story 1: self-service draft, never submitted.
insert into public.stories (id, contributor_id, owner_user_id, source_kind, slug, visibility, lifecycle_status, created_by)
values ('44444444-0001-0001-0001-000000000001', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111102', 'self_submitted', 'still-writing-my-story', 'private', 'draft', '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
insert into public.story_revisions (id, story_id, revision_number, revision_status, title, excerpt, content_json, created_by, updated_by)
values ('44444444-0001-0002-0001-000000000001', '44444444-0001-0001-0001-000000000001', 1, 'draft', 'Still writing my story', 'A work in progress.', '[{"type":"paragraph","text":[{"text":"Draft content, not yet ready."}]}]', '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
update public.stories set current_draft_revision_id = '44444444-0001-0002-0001-000000000001' where id = '44444444-0001-0001-0001-000000000001';

-- Story 2: editorial import awaiting contributor approval.
insert into public.stories (id, contributor_id, owner_user_id, source_kind, slug, visibility, lifecycle_status, assigned_editor_id, created_by)
values ('44444444-0002-0001-0001-000000000001', '22222222-2222-2222-2222-222222222202', null, 'editorial_import', 'a-founding-story-in-prep', 'private', 'awaiting_contributor_approval', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111103')
on conflict (id) do nothing;
insert into public.story_revisions (id, story_id, revision_number, revision_status, title, excerpt, content_json, created_by, updated_by)
values ('44444444-0002-0002-0001-000000000001', '44444444-0002-0001-0001-000000000001', 1, 'draft', 'A founding story, in preparation', 'Imported and structured by an editor, awaiting the contributor''s review.', '[{"type":"paragraph","text":[{"text":"Structured from a written account supplied outside the platform."}]}]', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111103')
on conflict (id) do nothing;
update public.stories set current_draft_revision_id = '44444444-0002-0002-0001-000000000001' where id = '44444444-0002-0001-0001-000000000001';

-- Story 3: self-service, submitted, pending_review (first publication).
insert into public.stories (id, contributor_id, owner_user_id, source_kind, slug, visibility, lifecycle_status, submitted_at, created_by)
values ('44444444-0003-0001-0001-000000000001', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111102', 'self_submitted', 'picking-kiwifruit-in-te-puke', 'private', 'pending_review', now(), '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
insert into public.story_revisions (id, story_id, revision_number, revision_status, title, excerpt, content_json, trip_start_date, trip_end_date, trip_year, travel_style, total_expense_nzd_cents, created_by, updated_by)
values ('44444444-0003-0002-0001-000000000001', '44444444-0003-0001-0001-000000000001', 1, 'submitted', 'Picking kiwifruit in Te Puke', 'Three months of seasonal work in the Bay of Plenty.', '[{"type":"paragraph","text":[{"text":"I spent a season picking kiwifruit."}]}]', '2024-04-01', '2024-06-30', 2024, 'budget', 450000, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
update public.stories set current_draft_revision_id = '44444444-0003-0002-0001-000000000001' where id = '44444444-0003-0001-0001-000000000001';
insert into public.story_revision_locations (revision_id, region_id, destination_id, sort_order)
values ('44444444-0003-0002-0001-000000000001', '33333333-1111-1111-1111-111111111101', '33333333-2222-1111-1111-111111111101', 0)
on conflict do nothing;
insert into public.story_revision_work_types (revision_id, work_type_id)
values ('44444444-0003-0002-0001-000000000001', '33333333-3333-1111-1111-111111111101')
on conflict do nothing;
insert into public.story_revision_tags (revision_id, tag_id)
values ('44444444-0003-0002-0001-000000000001', '33333333-4444-1111-1111-111111111101')
on conflict do nothing;
insert into public.story_publication_consents (story_id, revision_id, contributor_id, event_number, attribution_type, attribution_value, confirmation_method, publication_confirmed_at, identifiable_people_state, terms_version, recorded_by)
values ('44444444-0003-0001-0001-000000000001', '44444444-0003-0002-0001-000000000001', '22222222-2222-2222-2222-222222222201', 1, 'display_name', 'Casey C.', 'account', now(), 'not_applicable', 'whv-compass-terms-2026-08', '11111111-1111-1111-1111-111111111102')
on conflict do nothing;

-- Story 4: published, with a superseded prior revision (proves revision-safety).
insert into public.stories (id, contributor_id, owner_user_id, source_kind, slug, visibility, lifecycle_status, published_at, created_by)
values ('44444444-0004-0001-0001-000000000001', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111102', 'self_submitted', 'wellington-cafe-life', 'public', 'published', now() - interval '30 days', '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
insert into public.story_revisions (id, story_id, revision_number, revision_status, title, excerpt, content_json, trip_start_date, trip_end_date, trip_year, travel_style, total_expense_nzd_cents, created_by, updated_by, approved_at)
values
  ('44444444-0004-0002-0001-000000000001', '44444444-0004-0001-0001-000000000001', 1, 'superseded', 'Working cafes in Wellington', 'My first few months in the capital.', '[{"type":"paragraph","text":[{"text":"Original version of the story."}]}]', '2023-11-01', '2024-02-28', 2023, 'mid_range', 620000, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102', now() - interval '60 days'),
  ('44444444-0004-0002-0001-000000000002', '44444444-0004-0001-0001-000000000001', 2, 'approved', 'Working cafe life in Wellington', 'A year of cafe work in the capital, updated with photos and more detail.', '[{"type":"paragraph","text":[{"text":"Updated, more detailed version of the story."}]}]', '2023-11-01', '2024-10-31', 2023, 'mid_range', 980000, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102', now() - interval '30 days')
on conflict (id) do nothing;
update public.stories set published_revision_id = '44444444-0004-0002-0001-000000000002' where id = '44444444-0004-0001-0001-000000000001';
insert into public.story_revision_locations (revision_id, region_id, destination_id, sort_order)
values
  ('44444444-0004-0002-0001-000000000001', '33333333-1111-1111-1111-111111111102', '33333333-2222-1111-1111-111111111102', 0),
  ('44444444-0004-0002-0001-000000000002', '33333333-1111-1111-1111-111111111102', '33333333-2222-1111-1111-111111111102', 0)
on conflict do nothing;
insert into public.story_revision_work_types (revision_id, work_type_id)
values
  ('44444444-0004-0002-0001-000000000001', '33333333-3333-1111-1111-111111111103'),
  ('44444444-0004-0002-0001-000000000002', '33333333-3333-1111-1111-111111111103')
on conflict do nothing;
insert into public.story_publication_consents (story_id, revision_id, contributor_id, event_number, attribution_type, attribution_value, confirmation_method, publication_confirmed_at, identifiable_people_state, terms_version, recorded_by)
values
  ('44444444-0004-0001-0001-000000000001', '44444444-0004-0002-0001-000000000001', '22222222-2222-2222-2222-222222222201', 1, 'display_name', 'Casey C.', 'account', now() - interval '61 days', 'not_applicable', 'whv-compass-terms-2026-08', '11111111-1111-1111-1111-111111111102'),
  ('44444444-0004-0001-0001-000000000001', '44444444-0004-0002-0001-000000000002', '22222222-2222-2222-2222-222222222201', 2, 'display_name', 'Casey C.', 'account', now() - interval '31 days', 'not_applicable', 'whv-compass-terms-2026-08', '11111111-1111-1111-1111-111111111102')
on conflict do nothing;
insert into public.moderation_actions (story_id, revision_id, moderator_id, previous_status, new_status, user_facing_reason)
values
  ('44444444-0004-0001-0001-000000000001', '44444444-0004-0002-0001-000000000001', '11111111-1111-1111-1111-111111111104', 'submitted', 'approved', null),
  ('44444444-0004-0001-0001-000000000001', '44444444-0004-0002-0001-000000000002', '11111111-1111-1111-1111-111111111104', 'submitted', 'approved', null)
on conflict do nothing;

-- Story 5: published, WITH an in-flight submitted replacement — proves the
-- story root stays 'published' throughout a replacement attempt.
insert into public.stories (id, contributor_id, owner_user_id, source_kind, slug, visibility, lifecycle_status, published_at, submitted_at, created_by)
values ('44444444-0005-0001-0001-000000000001', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111102', 'self_submitted', 'marlborough-vineyard-season', 'public', 'published', now() - interval '90 days', now(), '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
insert into public.story_revisions (id, story_id, revision_number, revision_status, title, excerpt, content_json, trip_start_date, trip_end_date, trip_year, travel_style, total_expense_nzd_cents, created_by, updated_by, approved_at)
values ('44444444-0005-0002-0001-000000000001', '44444444-0005-0001-0001-000000000001', 1, 'approved', 'A vineyard season in Marlborough', 'Pruning and picking through a full season.', '[{"type":"paragraph","text":[{"text":"Original published account."}]}]', '2023-02-01', '2023-05-31', 2023, 'budget', 380000, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102', now() - interval '90 days')
on conflict (id) do nothing;
insert into public.story_revisions (id, story_id, revision_number, revision_status, title, excerpt, content_json, trip_start_date, trip_end_date, trip_year, travel_style, total_expense_nzd_cents, created_by, updated_by)
values ('44444444-0005-0002-0001-000000000002', '44444444-0005-0001-0001-000000000001', 2, 'submitted', 'A vineyard season in Marlborough, revisited', 'Pruning and picking through a full season — updated with cost detail.', '[{"type":"paragraph","text":[{"text":"Revised account with more detail."}]}]', '2023-02-01', '2023-05-31', 2023, 'budget', 410000, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
update public.stories
  set published_revision_id = '44444444-0005-0002-0001-000000000001', current_draft_revision_id = '44444444-0005-0002-0001-000000000002'
  where id = '44444444-0005-0001-0001-000000000001';
insert into public.story_publication_consents (story_id, revision_id, contributor_id, event_number, attribution_type, attribution_value, confirmation_method, publication_confirmed_at, identifiable_people_state, terms_version, recorded_by)
values
  ('44444444-0005-0001-0001-000000000001', '44444444-0005-0002-0001-000000000001', '22222222-2222-2222-2222-222222222201', 1, 'display_name', 'Casey C.', 'account', now() - interval '91 days', 'not_applicable', 'whv-compass-terms-2026-08', '11111111-1111-1111-1111-111111111102'),
  ('44444444-0005-0001-0001-000000000001', '44444444-0005-0002-0001-000000000002', '22222222-2222-2222-2222-222222222201', 2, 'display_name', 'Casey C.', 'account', now(), 'not_applicable', 'whv-compass-terms-2026-08', '11111111-1111-1111-1111-111111111102')
on conflict do nothing;
insert into public.moderation_actions (story_id, revision_id, moderator_id, previous_status, new_status, user_facing_reason)
values ('44444444-0005-0001-0001-000000000001', '44444444-0005-0002-0001-000000000001', '11111111-1111-1111-1111-111111111104', 'submitted', 'approved', null)
on conflict do nothing;

-- Story 6: changes_requested at first publication (terminal revision,
-- ready for create_next_draft_revision()).
insert into public.stories (id, contributor_id, owner_user_id, source_kind, slug, visibility, lifecycle_status, submitted_at, created_by)
values ('44444444-0006-0001-0001-000000000001', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111102', 'self_submitted', 'queenstown-tourism-work', 'private', 'changes_requested', now() - interval '5 days', '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
insert into public.story_revisions (id, story_id, revision_number, revision_status, title, excerpt, content_json, created_by, updated_by)
values ('44444444-0006-0002-0001-000000000001', '44444444-0006-0001-0001-000000000001', 1, 'changes_requested', 'Tourism work in Queenstown', 'Front desk and activity-booking work over a busy season.', '[{"type":"paragraph","text":[{"text":"An early draft that needs more detail."}]}]', '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
insert into public.story_publication_consents (story_id, revision_id, contributor_id, event_number, attribution_type, attribution_value, confirmation_method, publication_confirmed_at, identifiable_people_state, terms_version, recorded_by)
values ('44444444-0006-0001-0001-000000000001', '44444444-0006-0002-0001-000000000001', '22222222-2222-2222-2222-222222222201', 1, 'display_name', 'Casey C.', 'account', now() - interval '5 days', 'not_applicable', 'whv-compass-terms-2026-08', '11111111-1111-1111-1111-111111111102')
on conflict do nothing;
insert into public.moderation_actions (story_id, revision_id, moderator_id, previous_status, new_status, user_facing_reason)
values ('44444444-0006-0001-0001-000000000001', '44444444-0006-0002-0001-000000000001', '11111111-1111-1111-1111-111111111104', 'submitted', 'changes_requested', 'Please add more detail about daily work and typical costs.')
on conflict do nothing;

-- Story 7: rejected (terminal) — a self-service story the contributor
-- declined during editorial review, demonstrating decline_editorial_publication.
insert into public.stories (id, contributor_id, owner_user_id, source_kind, slug, visibility, lifecycle_status, created_by)
values ('44444444-0007-0001-0001-000000000001', '22222222-2222-2222-2222-222222222202', null, 'editorial_import', 'an-import-that-was-declined', 'private', 'rejected', '11111111-1111-1111-1111-111111111103')
on conflict (id) do nothing;
insert into public.story_revisions (id, story_id, revision_number, revision_status, title, excerpt, content_json, created_by, updated_by)
values ('44444444-0007-0002-0001-000000000001', '44444444-0007-0001-0001-000000000001', 1, 'rejected', 'An import the contributor declined', 'Prepared by an editor, but the contributor chose not to proceed.', '[{"type":"paragraph","text":[{"text":"Never confirmed for publication."}]}]', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111103')
on conflict (id) do nothing;
insert into public.editorial_actions (story_id, revision_id, editor_id, action_type, summary)
values ('44444444-0007-0001-0001-000000000001', '44444444-0007-0002-0001-000000000001', '11111111-1111-1111-1111-111111111103', 'contributor_declined', 'Contributor decided not to have this story published after review.')
on conflict do nothing;

-- Story 8: archived via consent revocation — was published, then the
-- contributor revoked consent (terminal; public reads must exclude it
-- despite published_revision_id still being set).
insert into public.stories (id, contributor_id, owner_user_id, source_kind, slug, visibility, lifecycle_status, published_at, archived_at, consent_revoked_at, consent_revoked_by, created_by)
values ('44444444-0008-0001-0001-000000000001', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111102', 'self_submitted', 'a-story-since-withdrawn', 'public', 'archived', now() - interval '120 days', now() - interval '2 days', now() - interval '2 days', '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102')
on conflict (id) do nothing;
insert into public.story_revisions (id, story_id, revision_number, revision_status, title, excerpt, content_json, created_by, updated_by, approved_at)
values ('44444444-0008-0002-0001-000000000001', '44444444-0008-0001-0001-000000000001', 1, 'approved', 'A story since withdrawn', 'This story was published, then the contributor asked for it to be taken down.', '[{"type":"paragraph","text":[{"text":"Formerly public content."}]}]', '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102', now() - interval '120 days')
on conflict (id) do nothing;
update public.stories set published_revision_id = '44444444-0008-0002-0001-000000000001' where id = '44444444-0008-0001-0001-000000000001';
insert into public.story_publication_consents (story_id, revision_id, contributor_id, event_number, attribution_type, attribution_value, confirmation_method, publication_confirmed_at, identifiable_people_state, terms_version, recorded_by)
values ('44444444-0008-0001-0001-000000000001', '44444444-0008-0002-0001-000000000001', '22222222-2222-2222-2222-222222222201', 1, 'display_name', 'Casey C.', 'account', now() - interval '120 days', 'not_applicable', 'whv-compass-terms-2026-08', '11111111-1111-1111-1111-111111111102')
on conflict do nothing;
insert into public.moderation_actions (story_id, revision_id, moderator_id, previous_status, new_status, user_facing_reason)
values ('44444444-0008-0001-0001-000000000001', '44444444-0008-0002-0001-000000000001', '11111111-1111-1111-1111-111111111104', 'submitted', 'approved', null)
on conflict do nothing;
