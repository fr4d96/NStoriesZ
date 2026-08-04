import type { MetadataRoute } from "next";
import {
  listPublishedStories,
  listPublicContributors,
} from "@/lib/story/public-queries";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const revalidate = 3600;

// Bounded loops, not a single unbounded call: 50 pages * 50 rows (the RPCs'
// own server-side clamp) is a generous ceiling for the founding catalogue
// and prevents this route from ever becoming an accidental full-table scan
// if the catalogue grows large.
const MAX_PAGES = 50;
const PAGE_SIZE = 50;

async function allPublishedStorySlugs(): Promise<
  { slug: string; publishedAt: string }[]
> {
  const slugs: { slug: string; publishedAt: string }[] = [];
  let cursorPublishedAt: string | undefined;
  let cursorId: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await listPublishedStories({
      cursorPublishedAt,
      cursorId,
      limit: PAGE_SIZE,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      slugs.push({ slug: row.slug, publishedAt: row.published_at });
    }
    if (rows.length < PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    cursorPublishedAt = last.published_at;
    cursorId = last.story_id;
  }
  return slugs;
}

async function allPublicContributorSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  let cursorDisplayName: string | undefined;
  let cursorId: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await listPublicContributors({
      cursorDisplayName,
      cursorId,
      limit: PAGE_SIZE,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.public_slug) slugs.push(row.public_slug);
    }
    if (rows.length < PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    cursorDisplayName = last.display_name;
    cursorId = last.contributor_id;
  }
  return slugs;
}

const staticRoutes = [
  "",
  "/stories",
  "/contributors",
  "/about",
  "/privacy",
  "/terms",
  "/community-guidelines",
  "/copyright",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [stories, contributorSlugs] = await Promise.all([
    allPublishedStorySlugs(),
    allPublicContributorSlugs(),
  ]);

  return [
    ...staticRoutes.map((path) => ({
      url: `${siteUrl}${path}`,
    })),
    ...stories.map((s) => ({
      url: `${siteUrl}/stories/${s.slug}`,
      lastModified: s.publishedAt,
    })),
    ...contributorSlugs.map((slug) => ({
      url: `${siteUrl}/contributors/${slug}`,
    })),
  ];
}
