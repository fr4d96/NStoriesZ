import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "My Stories",
};

export default function MyStoriesPage() {
  return (
    <PlaceholderPage title="My Stories">
      <p>Your drafts and published stories will be listed here. Coming soon.</p>
    </PlaceholderPage>
  );
}
