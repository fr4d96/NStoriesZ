import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Stories",
};

export default function StoriesPage() {
  return (
    <PlaceholderPage title="Stories">
      <p>
        Approved stories will be browsable and filterable here by region,
        destination, work type, trip year, travel style, and reported cost.
        Browsing and filtering aren&apos;t built yet — this page is a
        placeholder.
      </p>
    </PlaceholderPage>
  );
}
