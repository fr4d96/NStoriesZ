import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Terms",
};

export default function TermsPage() {
  return (
    <PlaceholderPage title="Terms">
      <p>
        Our full terms of use are being finalised. This page is a placeholder.
      </p>
    </PlaceholderPage>
  );
}
