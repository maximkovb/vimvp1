import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
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
  matcher: ["/admin/:path*", "/portfolio/:path*", "/profile/:path*"],
};
