import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Suspense } from "react";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { FooterText } from "@/components/FooterText";
import { HeaderNav } from "@/components/HeaderNav";
import { SavedRecipesIcon } from "@/components/SavedRecipesIcon";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { FloatingFeedback } from "@/components/FloatingFeedback";
import { SatisfactionModal } from "@/components/SatisfactionModal";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { CookieBanner } from "@/components/CookieBanner";
import { PostHogLoader } from "@/components/PostHogLoader";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://snack-and-catch.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Snack & Catch",
    template: "%s",
  },
  description:
    "Cobblemon companion: cooking recipes, seasonings and spawn spots for every Pokémon.",
  openGraph: {
    type: "website",
    siteName: "Snack & Catch",
    title: "Snack & Catch — Cobblemon companion",
    description:
      "Cook the right snack. Catch the right Cobblemon. Recipes and spawn spots in one place.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Snack & Catch — Cobblemon companion",
    description:
      "Cook the right snack. Catch the right Cobblemon. Recipes and spawn spots in one place.",
  },
};

/**
 * Enables iOS safe-area insets (notch + home indicator) so the sticky
 * MobileBottomNav can reserve space above the indicator via
 * `env(safe-area-inset-bottom)`. Without `viewportFit: cover`, iOS
 * reports the inset as 0.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const THEMES = ["light", "dark", "pokecenter", "grass", "fire", "water"];

async function IntlShell({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem themes={THEMES}>
          <Suspense fallback={<div className="min-h-full" />}>
            <IntlShell>
              <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-40">
                <div className="mx-auto max-w-5xl px-6 py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-6">
                    <Link href="/" className="font-semibold tracking-tight">
                      Snack <span className="text-accent">&amp;</span> Catch
                    </Link>
                    <HeaderNav
                      showDebug={
                        process.env.NODE_ENV !== "production" ||
                        process.env.DEBUG_ROUTES === "1"
                      }
                    />
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2">
                    <SavedRecipesIcon />
                    <LocaleSwitcher />
                    <ThemeSwitcher />
                  </div>
                </div>
              </header>
              <main className="flex-1 pb-20 sm:pb-0">{children}</main>
              <footer className="hidden sm:block border-t border-border text-xs text-muted py-4">
                <div className="mx-auto max-w-5xl px-6">
                  <FooterText />
                </div>
              </footer>
              <MobileBottomNav
                showDebug={
                  process.env.NODE_ENV !== "production" ||
                  process.env.DEBUG_ROUTES === "1"
                }
              />
              <FloatingFeedback />
              <SatisfactionModal />
              <Suspense fallback={null}>
                <AnalyticsTracker />
              </Suspense>
              <PostHogLoader />
              <CookieBanner />
            </IntlShell>
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
