// POST /api/chat — behind the login (see ../_middleware.js). Forwards to the Worker with the
// internal key, which the browser never sees. The Worker enforces the question/answer limits.

const WORKER_URL = "https://news-app-backend.annika-schwarz-co.workers.dev";
const MAX_BODY_CHARS = 2000;

export async function onRequestPost({ request, env }) {
  if (!env.INTERNAL_API_KEY) return Response.json({ error: "Not configured" }, { status: 500 });

  const body = await request.text();
  if (body.length > MAX_BODY_CHARS) return Response.json({ error: "Request too large" }, { status: 413 });

  try {
    const upstream = await fetch(`${WORKER_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Key": env.INTERNAL_API_KEY },
      body,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Chat service unavailable" }, { status: 502 });
  }
}
