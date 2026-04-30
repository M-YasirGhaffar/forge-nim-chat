import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: cookie-presence gate for /chat*, /settings*, and /login.
 *
 * We only check whether the `session` cookie exists — Edge runtime cannot import
 * `firebase-admin`, so full session verification still happens server-side via
 * `getSessionUser()` in pages/route handlers. This middleware exists to short-circuit
 * the obviously-unauthenticated case before hitting Node SSR.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = request.cookies.get("session");

  // Already-authenticated users hitting /login go straight to /chat.
  if (pathname === "/login") {
    if (session) {
      const url = request.nextUrl.clone();
      url.pathname = "/chat";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // If a `next` query is present, validate it: must be a safe relative path.
    const rawNext = request.nextUrl.searchParams.get("next");
    if (rawNext && !isSafeNext(rawNext)) {
      const url = request.nextUrl.clone();
      url.searchParams.delete("next");
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  // /chat* and /settings* require a session cookie.
  if (pathname.startsWith("/chat") || pathname.startsWith("/settings")) {
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      const safePath = pathname + search;
      if (isSafeNext(safePath)) {
        url.searchParams.set("next", safePath);
      }
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

function isSafeNext(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  return true;
}

export const config = {
  matcher: ["/chat/:path*", "/settings/:path*", "/login"],
};
