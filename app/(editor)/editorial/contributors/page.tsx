import type { Metadata } from "next";
import { listContributorsForEditorial } from "@/lib/story/editorial-queries";
import { ContributorRowActions } from "./contributor-row-actions";
import { CreateContributorForm } from "./create-contributor-form";

export const metadata: Metadata = {
  title: "Contributors — Editorial",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function EditorialContributorsPage() {
  const contributors = await listContributorsForEditorial();

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Contributors
      </h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Every contributor record. Linking/unlinking an account is an audited,
        editor/admin-only action — see the contributor_links history for the
        full trail of who linked or unlinked whom.
      </p>

      <CreateContributorForm />

      <ul className="mt-8 divide-y divide-black/10 dark:divide-white/10">
        {contributors.map((c) => (
          <li
            key={c.id}
            className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{c.displayName}</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    c.isLinked
                      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-black/10 text-black/70 dark:bg-white/10 dark:text-white/70"
                  }`}
                >
                  {c.isLinked ? "Linked" : "Unlinked"}
                </span>
              </div>
              <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                {c.attributionType} · {c.publicStatus}
              </p>
            </div>
            <ContributorRowActions contributorId={c.id} isLinked={c.isLinked} />
          </li>
        ))}
        {contributors.length === 0 && (
          <li className="py-4 text-sm text-black/60 dark:text-white/60">
            No contributor records yet.
          </li>
        )}
      </ul>
    </div>
  );
}
