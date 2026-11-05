import { NextResponse } from "next/server";

const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "sd_session";

export function proxy(request) {
  const { pathname } = request.nextUrl;

  // Public routes: the login screen, publicly-readable story pages, and the
  // claim page. Whoever opens a claim link has no account yet, so it cannot
  // ask for a session; the one-time token in the path is what it checks.
  if (pathname === "/login" || pathname.startsWith("/stories/") || pathname.startsWith("/claim/")) {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
