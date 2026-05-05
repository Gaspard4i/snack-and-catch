import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withBotId } from "botid/next/config";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // Enables unauthorized()/forbidden() from "next/navigation" to render
    // app/unauthorized.tsx and app/forbidden.tsx.
    authInterrupts: true,
  },
  images: {
    // Variant sprites (mega/gmax/regional/cosmetic) are hot-linked
    // from pokemondb. We pass them through the optimizer so the page
    // gets cached + responsive resizing, instead of bypassing it.
    remotePatterns: [
      { protocol: "https", hostname: "img.pokemondb.net" },
      { protocol: "https", hostname: "cdn.jsdelivr.net" },
    ],
  },
};

export default withNextIntl(withBotId(nextConfig));
