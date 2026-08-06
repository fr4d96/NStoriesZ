import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Journiq",
    template: "%s | Journiq",
  },
  description:
    "Real, detailed Working Holiday Visa stories from people who've done a working holiday in New Zealand.",
  robots: { index: true, follow: true },
};

/**
 * Deliberately bare: no header, footer, or session check here. Each route
 * group (public, auth, contributor) supplies its own nav in its own layout,
 * so this root layout stays static and cache-friendly for public pages.
 */
// Blocking, pre-hydration: reads the persisted theme (or the system
// preference) and sets data-theme before first paint so there is never a
// flash of the wrong theme or a client/server hydration mismatch.
const themeInitScript = `(() => {
  try {
    const saved = localStorage.getItem("journiq-theme");
    const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = saved === "dark" || saved === "light" ? saved : system;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The blocking inline script below sets data-theme before hydration,
      // deliberately differing from the server-rendered markup (which has
      // no data-theme attribute) -- suppressHydrationWarning tells React
      // this specific, expected attribute mismatch is fine, matching the
      // standard pattern for a pre-hydration theme script.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-black focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
