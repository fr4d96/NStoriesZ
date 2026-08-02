import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Contributors",
};

export default function ContributorsPage() {
  return (
    <PlaceholderPage title="Contributors">
      <p>
        Public contributor profiles — showing only the fields each contributor
        chooses to make public — will be listed here. This page is a
        placeholder.
      </p>
    </PlaceholderPage>
  );
}
