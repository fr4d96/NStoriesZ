import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Community Guidelines",
};

export default function CommunityGuidelinesPage() {
  return (
    <PlaceholderPage title="Community Guidelines">
      <p>
        Our full community guidelines are being finalised. In brief: stories
        must be genuine personal experiences, published with the
        contributor&apos;s permission and rights-cleared images.
      </p>
    </PlaceholderPage>
  );
}
