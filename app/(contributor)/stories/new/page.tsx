import type { Metadata } from "next";
import { NewStoryForm } from "./new-story-form";

export const metadata: Metadata = {
  title: "New Story",
};

export default function NewStoryPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        New Story
      </h1>
      <p className="mt-2 text-black/70 dark:text-white/70">
        Give it a working title to get started — you can write and edit
        everything else on the next page, and nothing here is published until
        you submit it.
      </p>
      <NewStoryForm />
    </div>
  );
}
