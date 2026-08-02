import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Copyright & Removal",
};

export default function CopyrightPage() {
  return (
    <PlaceholderPage title="Copyright & Removal">
      <p>
        If you believe a published story or image infringes your rights, or you
        are a contributor who wants a story corrected, withdrawn, or deleted, a
        reporting and removal process is coming soon. This page is a
        placeholder.
      </p>
    </PlaceholderPage>
  );
}
