# Architecture — WHV Compass NZ

This describes the target architecture. Nothing described here is implemented yet — check
[docs/implementation-status.md](implementation-status.md) for what actually exists.

## Application structure

Next.js App Router, Server Components by default, strict TypeScript throughout.

```
app/
  (public)/                  # anonymous-readable
    page.tsx                 # landing / discovery
    stories/
      page.tsx                # browse + filters (region, destination, work type, year, style, cost)
      [slug]/page.tsx         # published story detail — approved revision only
    contributors/[slug]/page.tsx  # public contributor profile — public fields only
    sitemap.ts / robots.ts   # approved published stories only
  (auth)/
    login/, register/        # Supabase Auth (cookie-based SSR)
  (contributor)/
    drafts/                  # list own drafts
    drafts/[id]/edit/        # structured story editor (Client Component island)
    drafts/[id]/preview/     # private preview, same renderer as public detail page
  (editor)/
    imports/                 # editor-assisted import workflow for founding catalogue
  (moderation)/
    queue/                   # moderation queue: approve / reject with reason
  api/ or actions in-file    # Route Handlers / Server Actions for trusted mutations
lib/
  supabase/
    server.ts                # server-side client (cookies, RLS as the signed-in user)
    admin.ts                 # service-role client — server-only, never imported by client code
    middleware.ts            # session refresh for SSR cookie auth
  validation/                 # Zod schemas per trust boundary
  story/                       # shared story-block rendering + sanitization
  images/                       # metadata-stripping + derivative generation helpers
components/
  ui/                          # accessible, reusable primitives (Tailwind)
  story/                       # story block renderer, filter controls, etc.
supabase/
  migrations/                  # versioned SQL: schema, RLS, storage policies
  seed.sql                      # fictional seed data
types/
  database.ts                  # generated Supabase types, never hand-edited
tests/
  unit + component (Vitest/RTL), co-located or under tests/
e2e/
  Playwright specs for critical flows
```

## Authentication boundaries

- Supabase Auth with the current SSR package, cookie-based sessions (no client-stored JWT reliance).
- A single `middleware.ts` refreshes the session cookie on every request.
- Three server-side Supabase client factories:
  - **Anonymous/public** context uses the anon key + RLS as an unauthenticated user for public routes.
  - **Authenticated user** context uses the anon key + the user's session cookie — RLS runs as that
    user, so contributor/editor/moderator scoping is enforced by policy, not by application trust.
  - **Service-role** client exists only in server-only modules (`lib/supabase/admin.ts`), used solely
    for privileged operations that must bypass RLS deliberately (e.g. generating signed URLs for
    private draft images to their owner) — never exported to anything a Client Component can reach.
- Roles (contributor / editor / moderator / admin) live in a protected table the user cannot write to
  themselves (Engineering Rule 4) — never in `auth.users` metadata the client can influence, and never
  trusted from a client-supplied claim.

## Data-access conventions

- Every exposed table has RLS enabled — no exceptions (Engineering Rule 3, non-negotiable per rule 21).
- Server Actions/Route Handlers re-validate ownership, role, and state server-side even though RLS
  would also reject an unauthorized write — defense in depth per Engineering Rule 3.
- Client-supplied identifiers (contributor ID, story ID, revision ID, status) are only ever used to
  *look up* a row; the authorization decision comes from the authenticated session + RLS + a
  server-side re-check, never from trusting the supplied value's implied permission.
- All mutations that matter (create/edit draft, submit, approve, reject, publish, upload image) go
  through Server Actions or Route Handlers — never direct client-side writes to Supabase tables.

## RLS strategy

- `profiles` (public-editable fields) vs. `user_roles` (protected: contributor/editor/moderator/admin)
  are separate tables. Only privileged server-side logic (service-role, behind an admin check) can
  write `user_roles`.
- `stories` (identity/ownership/current-published-revision pointer) vs. `story_revisions` (versioned
  content + status: draft / pending / approved / rejected / archived) are separate tables.
- Public SELECT policy on `story_revisions` matches only `status = 'approved' AND published_at is not
  null` and only through the story's designated published revision — never a bare "latest" query.
- Contributor SELECT/UPDATE policy on `story_revisions` matches `contributor_id = auth.uid()` regardless
  of status, so they can see and edit their own drafts/pending/rejected revisions but never another
  contributor's.
- Moderator SELECT/UPDATE policy matches role = moderator, scoped to pending revisions; moderators do
  not get blanket write access to arbitrary story content.
- Reference tables (regions, destinations, work types, travel styles, nationalities) are public-read,
  admin-write — modeled as data per the product's own requirement, not hard-coded enums.

## Story revision strategy

- A `stories` row is the stable identity (slug, contributor, created_at) plus a pointer to the
  currently published revision (nullable until first approval).
- Every draft, submission, edit, and re-submission creates/updates a `story_revisions` row with its
  own status. Approving a revision updates the `stories.published_revision_id` pointer atomically;
  it never mutates a previously-approved revision's content in place.
- This guarantees Engineering Rules 10–11: public reads always resolve through the pointer to an
  approved revision, and an in-flight edit cannot be visible publicly until it replaces the pointer.

## Storage and image-promotion strategy

- Two buckets minimum: `story-images-private` (drafts, pending, rejected) and `story-images-public`
  (only approved derivatives).
- Storage policies mirror the RLS model: private bucket readable only by the owning contributor (via
  signed URL) and editors/moderators; public bucket readable by anyone, writable only by a trusted
  server-side promotion step.
- On approval, a server-side job strips metadata (EXIF/GPS/etc.), generates the published derivative(s),
  and copies them into the public bucket — draft originals are never served publicly (Engineering
  Rules 13–14).

## Testing strategy

- Vitest + React Testing Library for components, validation schemas, and pure logic (story block
  rendering/sanitization, filter logic, image-metadata stripping helpers).
- Playwright for the critical end-to-end flows: reader browse/filter/read, contributor draft →
  preview → submit, moderator approve/reject, editor import, and a negative test proving an
  unapproved/draft story is unreachable via public URL, sitemap, or search.
- Lint, typecheck, unit tests, and production build are required quality gates (see CLAUDE.md
  Definition of Done) before any task is considered complete.

## Deployment assumptions

- No deployment or push is performed as part of this documentation task.
- Target hosting is assumed to be Vercel (Next.js) + Supabase-hosted Postgres/Auth/Storage, but this
  is an assumption to confirm with the user, not a decision already made — see open assumptions in
  [docs/implementation-status.md](implementation-status.md).
