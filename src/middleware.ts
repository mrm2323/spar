import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";

/** No beta check (public or internal). */
const isBetaPublic = createRouteMatcher([
  "/api/beta/verify",
  "/api/waitlist",
  "/api/vapi/webhook",
]);

/** Shown when signed in but not approved — must not redirect away. */
const isBetaPendingPage = createRouteMatcher(["/beta/pending(.*)"]);

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/session(.*)",
  "/forensics(.*)",
  "/notes(.*)",
]);

/** Authenticated APIs that should respect beta (same as app features). */
const isProtectedApi = createRouteMatcher([
  "/api/session(.*)",
  "/api/forensics(.*)",
  "/api/memory(.*)",
  "/api/process-attachment",
  "/api/kabir(.*)",
  "/api/user/phone",
  "/api/sessions",
]);

function needsBetaGate(req: NextRequest) {
  return isProtectedRoute(req) || isProtectedApi(req);
}

export default clerkMiddleware(async (auth, req) => {
  if (isBetaPublic(req)) {
    return NextResponse.next();
  }

  if (isBetaPendingPage(req)) {
    return NextResponse.next();
  }

  if (!needsBetaGate(req)) {
    return NextResponse.next();
  }

  await auth.protect();

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.next();
  }

  const verifyUrl = new URL("/api/beta/verify", req.url);
  let verifyRes: Response;
  try {
    verifyRes = await fetch(verifyUrl, {
      headers: {
        cookie: req.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });
  } catch (e) {
    console.error("[middleware] beta verify fetch failed", e);
    return NextResponse.json(
      { error: "service_unavailable" },
      { status: 503 }
    );
  }

  let data: { approved?: boolean } = {};
  try {
    data = (await verifyRes.json()) as { approved?: boolean };
  } catch {
    /* noop */
  }

  if (data.approved) {
    return NextResponse.next();
  }

  if (isProtectedApi(req)) {
    return NextResponse.json(
      {
        error: "beta_required",
        message:
          "Beta access not enabled for this account. Join the waitlist or wait for approval.",
      },
      { status: 403 }
    );
  }

  return NextResponse.redirect(new URL("/beta/pending", req.url));
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
