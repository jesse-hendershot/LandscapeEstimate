import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Everything is private except sign-in, sign-up and static assets.
 *
 * Deny-by-default is deliberate. An allow-list of protected routes means every
 * new route you add is public until someone remembers to list it, and the route
 * you forget will be the one that reads the catalog.
 */
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless they carry
    // search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
