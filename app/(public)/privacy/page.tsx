import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  return (
    <PlaceholderPage title="Privacy">
      <p>
        Our full privacy policy is being finalised. WHV Compass NZ does not
        collect passport scans, visa or immigration documents, bank credentials,
        exact live locations, or medical records.
      </p>
    </PlaceholderPage>
  );
}
