import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <PlaceholderPage title="Sign in">
      <p>
        Contributor sign-in isn&apos;t built yet — this page is a placeholder.
        Sign-in, along with contributor profiles and roles, is planned for the
        next phase of the project.
      </p>
    </PlaceholderPage>
  );
}
