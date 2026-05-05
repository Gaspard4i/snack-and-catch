import { NextRequest, NextResponse } from "next/server";

const REALM = "Snack & Catch admin";
const USER = "admin";

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 6) {
    // Fail closed if the password is not configured. Better a 503 than
    // a wide-open admin panel.
    return new NextResponse("Admin password not configured", {
      status: 503,
      headers: {
        "X-Robots-Tag": "noindex, nofollow",
        "cache-control": "no-store",
      },
    });
  }
  const header = req.headers.get("authorization");

  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(":");
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (timingSafeEqual(user, USER) && timingSafeEqual(pass, expected)) {
        const res = NextResponse.next();
        // Tag the browser as admin so the analytics tracker and PostHog
        // skip every event from this user. Readable by JS on purpose
        // (httpOnly: false) — clients need to check it.
        res.cookies.set("sc-admin", "1", {
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
          sameSite: "lax",
        });
        return res;
      }
    } catch {
      /* fall through to 401 */
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "X-Robots-Tag": "noindex, nofollow",
      "cache-control": "no-store",
    },
  });
}

export const config = {
  matcher: ["/admin/:path*"],
};
