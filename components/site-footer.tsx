import Link from "next/link";

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/community-guidelines", label: "Community Guidelines" },
  { href: "/copyright", label: "Copyright & Removal" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border-subtle bg-surface-muted">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm sm:px-6">
        <p className="max-w-2xl text-foreground/70">
          WHV Compass NZ is an independent platform for personal stories. It is
          not affiliated with, and does not represent, Immigration New Zealand
          or any government agency. Every story here is one person&apos;s
          personal experience, not immigration, legal, employment, tax, or
          financial advice.
        </p>
        <nav aria-label="Legal" className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {legalLinks.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
