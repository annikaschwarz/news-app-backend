// GET /api/articles — behind the login (see ../_middleware.js). Forwards to the Worker with
// the internal key, which the browser never sees.

const WORKER_URL = "https://news-app-backend.annika-schwarz-co.workers.dev";

export async function onRequestGet({ request, env }) {
  if (!env.INTERNAL_API_KEY) return Response.json({ error: "Not configured" }, { status: 500 });
  try {
    const upstream = await fetch(`${WORKER_URL}/articles${new URL(request.url).search}`, {
      headers: { "X-Internal-Key": env.INTERNAL_API_KEY },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Articles service unavailable" }, { status: 502 });
  }
}
