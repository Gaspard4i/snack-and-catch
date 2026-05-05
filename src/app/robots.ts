import type { MetadataRoute } from "next";

const BASE =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/admin/", "/debug", "/debug/"],
      },
      // Block known scraper bots outright. Polite ones honour this; the
      // rest are caught by BotID + UA filter + rate limit.
      {
        userAgent: [
          "GPTBot",
          "ChatGPT-User",
          "CCBot",
          "ClaudeBot",
          "anthropic-ai",
          "Google-Extended",
          "PerplexityBot",
          "Bytespider",
          "SemrushBot",
          "AhrefsBot",
          "MJ12bot",
          "DotBot",
          "PetalBot",
          "DataForSeoBot",
        ],
        disallow: "/",
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
