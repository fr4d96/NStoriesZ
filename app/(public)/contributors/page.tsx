import type { Metadata } from "next";
import Link from "next/link";
import { listPublicContributors } from "@/lib/story/public-queries";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Contributors",
  description:
    "Contributors who've published a real Working Holiday Visa story on Kakinotes.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContributorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const cursorDisplayName = first(raw.cursorDisplayName);
  const cursorId = first(raw.cursorId);

  let contributors: Awaited<ReturnType<typeof listPublicContributors>> = [];
  let loadError = false;
  try {
    contributors = await listPublicContributors({
      cursorDisplayName,
      cursorId,
      limit: 24,
    });
  } catch {
    loadError = true;
  }

  const last = contributors[contributors.length - 1];
  const hasNextPage = contributors.length === 24;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Contributors
      </h1>
      <p className="mt-3 max-w-2xl text-foreground/70">
        People who&apos;ve shared their own Working Holiday experience — showing
        only the fields each contributor has chosen to make public.
      </p>

      <div className="mt-8" aria-live="polite">
        {loadError ? (
          <p className="rounded-md border border-border-subtle bg-surface-muted p-6 text-sm text-foreground/70">
            We couldn&apos;t load contributors right now. Please try again in a
            moment.
          </p>
        ) : contributors.length === 0 ? (
          <p className="rounded-md border border-border-subtle bg-surface-muted p-6 text-sm text-foreground/70">
            No public contributor profiles yet.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contributors.map((c) => (
              <li key={c.contributor_id}>
                <Link
                  href={`/contributors/${c.public_slug}`}
                  className="flex h-full flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-4 hover:shadow-md"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-foreground/70">
                    {c.display_name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <span className="font-medium">{c.display_name}</span>
                  {c.bio ? (
                    <span className="line-clamp-2 text-sm text-foreground/60">
                      {c.bio}
                    </span>
                  ) : null}
                  <span className="mt-auto text-xs text-foreground/50">
                    {c.published_story_count}{" "}
                    {c.published_story_count === 1 ? "story" : "stories"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasNextPage && last ? (
        <div className="mt-10 flex justify-center">
          <Link
            href={`/contributors?cursorDisplayName=${encodeURIComponent(
              last.display_name,
            )}&cursorId=${last.contributor_id}`}
            className="rounded-md border border-border-subtle px-4 py-2 text-sm font-medium hover:bg-surface-muted"
          >
            Load more contributors
          </Link>
        </div>
      ) : null}
    </div>
  );
}
