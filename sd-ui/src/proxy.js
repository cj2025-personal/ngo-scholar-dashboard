import { NextResponse } from "next/server";

const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "sd_session";

export function proxy(request) {
  const { pathname } = request.nextUrl;

  // Public routes: the login screen and publicly-readable story pages.
  if (pathname === "/login" || pathname.startsWith("/stories/")) {
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
