import type { Metadata } from "next";
import { listMyStoriesWithCovers } from "@/lib/story/contributor-queries";
import { MyStoriesView } from "./my-stories-view";

export const metadata: Metadata = {
  title: "My Stories",
};

export default async function MyStoriesPage() {
  const stories = await listMyStoriesWithCovers();

  return <MyStoriesView stories={stories} />;
}
