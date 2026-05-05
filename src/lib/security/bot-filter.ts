/**
 * Cheap UA-based bot filter — runs in O(1) before any DB call. Catches
 * naive scripts (curl, wget, python-requests) and known SEO crawlers
 * trying to POST. Stealth headless browsers will pass this and need
 * BotID instead — that's the deal.
 */
const BOT_PATTERNS = [
  /bot/i,
  /spider/i,
  /crawl/i,
  /scrape/i,
  /headlesschrome/i,
  /phantomjs/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,
  /python-requests/i,
  /python-urllib/i,
  /^curl\//i,
  /^wget\//i,
  /go-http-client/i,
  /libwww-perl/i,
  /java\//i,
  /okhttp/i,
  /apache-httpclient/i,
  /postmanruntime/i,
  /insomnia/i,
];

export function looksLikeBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  if (userAgent.length < 20) return true;
  return BOT_PATTERNS.some((re) => re.test(userAgent));
}
