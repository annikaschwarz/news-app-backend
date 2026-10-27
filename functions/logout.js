// Clears the session cookie and returns to the login page.
import { clearedCookie } from "./_lib/auth.js";

export function onRequest() {
  return new Response(null, {
    status: 303,
    headers: { Location: "/login", "Set-Cookie": clearedCookie(), "Cache-Control": "no-store" },
  });
}
