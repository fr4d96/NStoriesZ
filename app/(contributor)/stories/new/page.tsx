import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "New Story",
};

export default function NewStoryPage() {
  return (
    <PlaceholderPage title="New Story">
      <p>The story drafting editor isn&apos;t built yet. Coming soon.</p>
    </PlaceholderPage>
  );
}
