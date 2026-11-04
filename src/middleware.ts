import { NextResponse, type NextRequest } from "next/server";

// Cheap edge check: no session cookie → login. Real validation happens server-side on every request.
const PUBLIC = ["/login", "/api/cron", "/_next", "/favicon", "/manifest.webmanifest", "/icon-", "/apple-touch-icon", "/brand/"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("sm_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
