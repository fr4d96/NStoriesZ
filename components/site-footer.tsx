import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export function SiteFooter() {
  return (
    // --forest is deliberately dark in both themes ("Deep Ink Band" in
    // DESIGN.md) -- the footer stays an always-dark band regardless of the
    // site's light/dark toggle, but reads as Night Field's ink rather than
    // the retired Field Journal's forest-green.
    <footer id="about" className="bg-forest text-white">
      <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_.7fr_.7fr_.7fr]">
          <div>
            <Link
              href="/"
              className="flex items-center gap-2.5 text-xl font-black"
            >
              <BrandLogo className="border border-white/40" />
              Kakinotes
            </Link>
            <p className="mt-4 max-w-md text-sm text-white/65">
              A storytelling community for honest working-holiday experiences
              across Aotearoa New Zealand.
            </p>
            <p className="mt-5 max-w-lg text-xs leading-5 text-white/45">
              Kakinotes is an independent platform for personal stories and does
              not provide immigration, legal, employment, tax, or financial
              advice.
            </p>
          </div>
          <div>
            <strong>Explore</strong>
            <div className="mt-3 grid gap-2 text-sm text-white/70">
              <Link href="/stories">Stories</Link>
              {/* The landing page's region tiles were folded into the index's
                  Place filter axis; "Destinations" now opens the match quiz,
                  which is what still asks the reader about place. */}
              <Link href="/#match">Destinations</Link>
            </div>
          </div>
          <div>
            <strong>Community</strong>
            <div className="mt-3 grid gap-2 text-sm text-white/70">
              <Link href="/sign-up">Share a story</Link>
              <Link href="/contributors">Contributors</Link>
              <Link href="/about">About</Link>
            </div>
          </div>
          <div>
            <strong>Support</strong>
            <div className="mt-3 grid gap-2 text-sm text-white/70">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/community-guidelines">Guidelines</Link>
              <Link href="/copyright">Copyright &amp; Removal</Link>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-5 text-xs text-white/45 sm:flex-row sm:justify-between">
          <span>© 2026 Kakinotes</span>
          <span>
            Made for working-holiday travellers in Aotearoa New Zealand
          </span>
        </div>
      </div>
    </footer>
  );
}
