import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // API admin routes use bearer-token auth (verifyCronAuth) — pass through to route handler.
  if (pathname.startsWith("/api/admin")) return;

  const isProtected =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/portfolio") ||
    pathname.startsWith("/profile");

  if (isProtected && !req.auth) {
    const signInUrl = new URL("/auth/signin", req.url);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/portfolio/:path*", "/profile/:path*"],
};
