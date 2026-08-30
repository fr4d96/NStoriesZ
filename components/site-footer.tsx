import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export function SiteFooter() {
  return (
    // The footer FLIPS with the theme; it is not an always-dark band.
    //
    // It used to be `bg-forest text-white` in both renditions. Two problems in
    // light mode: it sat directly under the .journiq-share band (itself a dark
    // scrimmed photo), so the page ended on ~1400px of unbroken dark after a
    // warm off-white body; and light `--forest` was #17110d, a warm brown-black
    // left over from the retired Field Journal palette, butting against
    // .journiq-share's cool rgba(2, 4, 6) -- two different blacks touching.
    //
    // Reading the ordinary surface tokens ends the page on the same paper it
    // started on, and leaves .journiq-share as the page's single dark band,
    // which is what makes the contribute CTA the emphatic beat it is meant to
    // be. Dark mode is unaffected in character: --surface there is #0d1218.
    <footer
      id="about"
      className="border-t border-border-subtle bg-surface text-foreground"
    >
      <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_.7fr_.7fr_.7fr]">
          <div>
            <Link
              href="/"
              className="flex items-center gap-2.5 text-xl font-black"
            >
              <BrandLogo className="border border-border-subtle" />
              Kakinotes
            </Link>
            <p className="mt-4 max-w-md text-sm text-muted-foreground">
              A storytelling community for honest working-holiday experiences
              across Aotearoa New Zealand.
            </p>
            <p className="mt-5 max-w-lg text-xs leading-5 text-foreground/65">
              Kakinotes is an independent platform for personal stories and does
              not provide immigration, legal, employment, tax, or financial
              advice.
            </p>
          </div>
          <div>
            <strong>Explore</strong>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
              <Link href="/stories">Stories</Link>
              {/* The landing page's region tiles were folded into the index's
                  Place filter axis; "Destinations" now opens the match quiz,
                  which is what still asks the reader about place. */}
              <Link href="/#match">Destinations</Link>
            </div>
          </div>
          <div>
            <strong>Community</strong>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
              <Link href="/sign-up">Share a story</Link>
              <Link href="/contributors">Contributors</Link>
              <Link href="/about">About</Link>
            </div>
          </div>
          <div>
            <strong>Support</strong>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/community-guidelines">Guidelines</Link>
              <Link href="/copyright">Copyright &amp; Removal</Link>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-border-subtle pt-5 text-xs text-foreground/65 sm:flex-row sm:justify-between">
          <span>© 2026 Kakinotes</span>
          <span>
            Made for working-holiday travellers in Aotearoa New Zealand
          </span>
        </div>
      </div>
    </footer>
  );
}
