import type { Metadata } from "next";
import { StartNewStory } from "./start-new-story";

export const metadata: Metadata = {
  title: "New Story",
};

// Never statically generated: StartNewStory always creates a real draft the
// moment this route is actually visited, so nothing here should be cached
// or pre-rendered.
export const dynamic = "force-dynamic";

export default function NewStoryPage() {
  return <StartNewStory />;
}
