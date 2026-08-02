import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Account",
};

export default function AccountPage() {
  return (
    <PlaceholderPage title="Account">
      <p>Account and profile settings will be managed here. Coming soon.</p>
    </PlaceholderPage>
  );
}
