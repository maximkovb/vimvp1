import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isAdminRoute = req.nextUrl.pathname.startsWith("/admin");
  const isPortfolioRoute = req.nextUrl.pathname.startsWith("/portfolio");

  if ((isAdminRoute || isPortfolioRoute) && !req.auth) {
    const signInUrl = new URL("/auth/signin", req.url);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: ["/admin/:path*", "/portfolio/:path*"],
};
