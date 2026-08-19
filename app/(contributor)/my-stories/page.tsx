import { Suspense } from "react";
import type { Metadata } from "next";
import { listMyStoriesWithCovers } from "@/lib/story/contributor-queries";
import { MyStoriesView } from "./my-stories-view";
import { SubmissionToast } from "./submission-toast";

export const metadata: Metadata = {
  title: "My Stories",
};

export default async function MyStoriesPage() {
  const stories = await listMyStoriesWithCovers();

  return (
    <>
      <Suspense fallback={null}>
        <SubmissionToast />
      </Suspense>
      <MyStoriesView stories={stories} />
    </>
  );
}
