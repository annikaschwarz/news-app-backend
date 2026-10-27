// Runs in front of every page and /api route. Without a valid session cookie, pages
// redirect to /login and /api routes answer 401 JSON (a redirect would confuse fetch()).
import { SESSION_COOKIE, getCookie, verifySession } from "./_lib/auth.js";

const PUBLIC_PATHS = new Set(["/login", "/login/", "/logout"]);

export async function onRequest({ request, env, next }) {
  const { pathname } = new URL(request.url);
  if (PUBLIC_PATHS.has(pathname)) return next();

  // Fail closed if the site is not configured.
  if (!env.SESSION_SECRET || !env.SITE_PASSWORD) {
    return new Response("Site is not configured", { status: 500 });
  }

  if (await verifySession(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET)) {
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-store");
    return out;
  }

  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Not signed in" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return Response.redirect(new URL("/login", request.url), 302);
}
