import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "About",
};

export default function AboutPage() {
  return (
    <PlaceholderPage title="About Kakinotes">
      <p>
        Kakinotes shares detailed, written first-person stories from Working
        Holiday Visa travellers in New Zealand, so future travellers can find
        accounts relevant to their own plans.
      </p>
      <p>
        Kakinotes is an independent platform. It is not Immigration New Zealand
        and does not provide immigration, legal, employment, tax, or financial
        advice — every story is one person&apos;s personal experience.
      </p>
      <p>
        A fuller description of the project, its founding contributors, and how
        stories are reviewed is coming soon.
      </p>
    </PlaceholderPage>
  );
}
