// POST /api/refresh — Pages Function behind the frontend's Refresh button.
// Forwards to the Worker's /agent with the pipeline secret, which is a Pages
// secret (PIPELINE_SECRET) and never reaches the browser.

const AGENT_URL = "https://news-app-backend.annika-schwarz-co.workers.dev/agent";

export async function onRequestPost({ env }) {
  if (!env.PIPELINE_SECRET) {
    return Response.json({ error: "Refresh is not configured" }, { status: 500 });
  }
  const upstream = await fetch(AGENT_URL, {
    headers: { Authorization: `Bearer ${env.PIPELINE_SECRET}` },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
