import { initBotId } from "botid/client/core";

/**
 * Vercel BotID — runs in the browser to attach a signed proof header to
 * the routes listed below. The server then verifies via checkBotId().
 *
 * Locally (dev) BotID short-circuits to "human" so this is a no-op until
 * deployed on Vercel. Free tier covers up to 1k checks/day.
 */
initBotId({
  protect: [
    { path: "/api/track", method: "POST" },
    { path: "/api/site/rate", method: "POST" },
    { path: "/api/site/visit", method: "POST" },
  ],
});
