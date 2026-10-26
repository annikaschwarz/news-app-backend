// News Intelligence App — API / agent Worker.
//   GET /health    status + timestamp
//   GET /agent     fetch fresh articles for every topic (also runs on the daily cron)
//   GET /articles  query stored articles (topic, from, to, source, min_score, limit)

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5-5";
const ARTICLES_PER_TOPIC = 5;
const MAX_STORED_PER_TOPIC = 20;
const MAX_CONTINUATIONS = 5;
// Guards against repeated /agent calls (each run costs API credits).
const AGENT_COOLDOWN_MINUTES = 10;

const TOPICS = [
  {
    key: "frontier-ai",
    name: "Frontier AI labs and models",
    brief:
      "Major model releases, capability jumps, agents, pricing and enterprise adoption at OpenAI, Anthropic, Google DeepMind, Meta, xAI, Mistral and DeepSeek, and what each means for competitive position and valuations.",
  },
  {
    key: "ai-infrastructure",
    name: "AI infrastructure and supply chain",
    brief:
      "GPUs and custom chips (Nvidia, AMD, TSMC, Broadcom), data center build-outs, power and energy for AI, hyperscaler capex, and how this is financed (private credit, PE, sovereign funds).",
  },
  {
    key: "ai-capital-markets",
    name: "AI capital markets and deal flow",
    brief:
      "Mega-rounds, valuations, secondaries and tender offers, IPO pipeline, M&A, and how institutional and individual investors can get exposure.",
  },
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------- Agent ----------

function buildPrompt(topic, today, weekAgo) {
  return `You are a research analyst for an investment professional who invests in frontier technology.

Today is ${today}. Use web search to find the ${ARTICLES_PER_TOPIC} most recent significant news articles published between ${weekAgo} and ${today} on this topic:

${topic.name}: ${topic.brief}

Selection:
- Prefer Reuters, Bloomberg, Financial Times, WSJ, The Information, company filings and official announcements.
- Pick news that moves valuations, capital flows or competitive position, or that an investor could act on. Skip consumer features, opinion pieces and rehashed stories.
- Each article must be a distinct story with a direct article URL (not a homepage, tag page or search page).
- Only include articles whose publication date you can confirm from the page or search result, within the date range. Never estimate a date.
- Return fewer than ${ARTICLES_PER_TOPIC} rather than padding with weak, secondary or off-topic sources, but search thoroughly first: there is almost always significant news in a week.

For each article provide:
- headline: the article's headline
- source: the publication name
- publication_date: YYYY-MM-DD
- url: the direct article URL
- summary: 2-3 sentences, ending with why it matters to an investor (state facts only; no caveats about sourcing or dates)
- relevance_score: integer 1-10 (high for news that moves valuations, capital flows or competitive position; low for consumer features, opinion, rehashed stories)

Reply with only a JSON array of objects with exactly those keys, no other text.`;
}

// Web search splits the reply across several content blocks, so join every text block.
function extractArticles(content) {
  const text = content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("No JSON array in model reply");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Model reply is not an array");
  return parsed;
}

function cleanArticle(a) {
  const url = typeof a.url === "string" ? a.url.trim() : "";
  const headline = typeof a.headline === "string" ? a.headline.trim() : "";
  if (!/^https?:\/\//i.test(url) || !headline) return null;
  const score = Math.round(Number(a.relevance_score));
  const date = typeof a.publication_date === "string" ? a.publication_date.slice(0, 10) : null;
  return {
    headline,
    url,
    source: typeof a.source === "string" ? a.source.trim() : null,
    publication_date: /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : null,
    summary: typeof a.summary === "string" ? a.summary.trim() : null,
    relevance_score: Number.isFinite(score) ? Math.min(10, Math.max(1, score)) : null,
  };
}

async function searchTopic(client, topic, today, weekAgo) {
  const messages = [{ role: "user", content: buildPrompt(topic, today, weekAgo) }];
  let response;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    // Server-side search loop paused: resend with the partial turn and it resumes.
    messages.splice(1, messages.length - 1, { role: "assistant", content: response.content });
  }
  if (response.stop_reason === "refusal") throw new Error("Request was declined");
  if (response.stop_reason === "pause_turn") throw new Error("Search did not finish");
  const articles = extractArticles(response.content).map(cleanArticle).filter(Boolean);
  if (articles.length === 0) {
    const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").slice(0, 300);
    console.warn(`Topic ${topic.key} returned no articles. Reply: ${reply}`);
  }
  return articles;
}

async function storeArticles(db, topicKey, articles) {
  let inserted = 0;
  let skipped = 0;
  for (const a of articles) {
    const result = await db
      .prepare(
        `INSERT INTO articles (topic, headline, source, publication_date, url, summary, relevance_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO NOTHING`,
      )
      .bind(topicKey, a.headline, a.source, a.publication_date, a.url, a.summary, a.relevance_score)
      .run();
    if (result.meta.changes > 0) inserted++;
    else skipped++;
  }
  // Keep only the newest MAX_STORED_PER_TOPIC articles for this topic.
  const pruned = await db
    .prepare(
      `DELETE FROM articles WHERE topic = ?1 AND id NOT IN (
         SELECT id FROM articles WHERE topic = ?1
         ORDER BY COALESCE(publication_date, substr(fetched_at, 1, 10)) DESC, fetched_at DESC, id DESC
         LIMIT ?2)`,
    )
    .bind(topicKey, MAX_STORED_PER_TOPIC)
    .run();
  return { inserted, skipped, removed: pruned.meta.changes };
}

async function runAgent(env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);

  // Topics run in parallel; one failing topic doesn't stop the others.
  const results = await Promise.all(
    TOPICS.map(async (topic) => {
      try {
        const articles = await searchTopic(client, topic, today, weekAgo);
        return { topic: topic.key, found: articles.length, ...(await storeArticles(env.DB, topic.key, articles)) };
      } catch (err) {
        console.error(`Topic ${topic.key} failed:`, err);
        return { topic: topic.key, error: String(err?.message ?? err), inserted: 0, skipped: 0 };
      }
    }),
  );

  const { total } = await env.DB.prepare("SELECT COUNT(*) AS total FROM articles").first();
  return {
    inserted: results.reduce((n, r) => n + r.inserted, 0),
    skipped: results.reduce((n, r) => n + r.skipped, 0),
    total,
    topics: results,
    ran_at: now.toISOString(),
  };
}

async function handleAgent(env) {
  const last = await env.DB.prepare("SELECT MAX(fetched_at) AS last FROM articles").first();
  if (last?.last) {
    const minutesAgo = (Date.now() - Date.parse(last.last)) / 60000;
    if (minutesAgo < AGENT_COOLDOWN_MINUTES) {
      return json(
        {
          error: `Articles were refreshed ${Math.floor(minutesAgo)} minutes ago; try again in ${Math.ceil(AGENT_COOLDOWN_MINUTES - minutesAgo)} minutes.`,
          last_refreshed: last.last,
        },
        429,
      );
    }
  }
  return json(await runAgent(env));
}

// ---------- Articles ----------

async function handleArticles(url, env) {
  const p = url.searchParams;
  const where = [];
  const binds = [];

  if (p.get("topic")) {
    where.push("topic = ?");
    binds.push(p.get("topic"));
  }
  if (p.get("source")) {
    where.push("source LIKE ?");
    binds.push(`%${p.get("source")}%`);
  }
  if (p.get("from")) {
    where.push("publication_date >= ?");
    binds.push(p.get("from"));
  }
  if (p.get("to")) {
    where.push("publication_date <= ?");
    binds.push(p.get("to"));
  }
  const minScore = Number(p.get("min_score"));
  if (p.get("min_score") && Number.isFinite(minScore)) {
    where.push("relevance_score >= ?");
    binds.push(minScore);
  }
  const limit = Math.min(Math.max(parseInt(p.get("limit") ?? "50", 10) || 50, 1), 200);

  const sql = `SELECT id, topic, headline, source, publication_date, url, summary, relevance_score, fetched_at
    FROM articles ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY publication_date DESC, relevance_score DESC, fetched_at DESC
    LIMIT ?`;
  const { results } = await env.DB.prepare(sql).bind(...binds, limit).all();
  const meta = await env.DB.prepare("SELECT MAX(fetched_at) AS last_refreshed FROM articles").first();

  return json({ articles: results, count: results.length, last_refreshed: meta?.last_refreshed ?? null });
}

// ---------- Entry points ----------

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case "/health":
          return json({ status: "ok", timestamp: new Date().toISOString() });
        case "/agent":
          return await handleAgent(env);
        case "/articles":
          return await handleArticles(url, env);
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (err) {
      console.error(err);
      return json({ error: "Internal error", detail: String(err?.message ?? err) }, 500);
    }
  },

  // Two UTC crons (11:00 and 12:00) cover daylight and standard time; only the one
  // that lands on 7 AM in New York actually runs.
  async scheduled(controller, env, ctx) {
    const nyHour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })
        .format(new Date(controller.scheduledTime)),
    );
    if (nyHour !== 7) return;
    ctx.waitUntil(runAgent(env).then((r) => console.log("Cron agent run:", JSON.stringify(r))));
  },
};
