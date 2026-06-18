import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isPublicRoute = (pathname: string) => {
  return (
    pathname === "/" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/sso-callback")
  );
};

export default function middleware(request: NextRequest) {
  const token = request.cookies.get("omnimind_token")?.value;
  const { pathname } = request.nextUrl;

  // If user has a token and goes to auth, redirect to homepage
  if (token && pathname.startsWith("/auth")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // If user does not have a token and tries to access a protected route, redirect to /auth
  if (!token && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
