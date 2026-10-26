# Project: News Intelligence App — Lab 1 Advanced Track (MGAIC 2026)

## Goal
Cloud-deployed news intelligence app on Cloudflare (no local machine needed):
Cron (7 AM US Eastern) -> Agent Worker (JS) -> Anthropic API with web search -> D1 database (news-db) <- API Worker (GET /articles) -> Cloudflare Pages frontend -> public URL. GitHub repo news-app-backend (public) auto-deploys Pages on push.

## Purpose
I am an investment professional building fluency in AI and the investment opportunities around it, and I invest personally in frontier technology. The feed should surface frontier AI developments that matter for investing, not general tech news.

## Topics
1. Frontier AI labs and models: major model releases, capability jumps, agents, pricing and enterprise adoption at OpenAI, Anthropic, Google DeepMind, Meta, xAI, Mistral and DeepSeek, and what each means for competitive position and valuations
2. AI infrastructure and supply chain: GPUs and custom chips (Nvidia, AMD, TSMC, Broadcom), data center build-outs, power and energy for AI, hyperscaler capex, and how this is financed (private credit, PE, sovereign funds)
3. AI capital markets and deal flow: mega-rounds, valuations, secondaries and tender offers, IPO pipeline, M&A, and how institutional and individual investors can get exposure

## Scoring and summaries
- Relevance 1-10: high for news that moves valuations, capital flows or competitive position, and anything an investor could act on; low for consumer features, opinion, rehashed stories.
- Summary: 2-3 sentences ending with why it matters to an investor.
- Prefer Reuters, Bloomberg, FT, WSJ, The Information, company filings and announcements.

## Environment
- Keys are in .env (ANTHROPIC_API_KEY, CLOUDFLARE_API_TOKEN). Never print, paste or commit them.
- Anthropic key goes in as a Worker secret (wrangler secret put), never in code.
- Cloudflare token has Workers, D1 Edit and Pages Edit permissions.
- Node installed via nvm; if node is missing run: \. "$HOME/.nvm/nvm.sh"
- Cron schedules are UTC. 7 AM US Eastern = 11:00 UTC during daylight time, 12:00 UTC after Nov 1.

## Rules
- Apply D1 schema with --remote, never --local ("no such table" means it was applied locally).
- Anthropic web search splits the reply across several content blocks: concatenate all text blocks before extracting the JSON array.
- .env must stay in .gitignore. Commit everything else.

## Steps (from the handout)
1. Scaffold Workers project news-app-backend with Wrangler; create D1 database news-db (fields: topic, headline, source, publication date, article URL unique, AI summary, relevance 1-10, fetched-at); bind it; apply schema to the REMOTE database; verify ID, columns, 0 rows.
2. Worker endpoints: /health (status + timestamp); /agent (per topic: Anthropic API + web search for the 5 most recent significant articles from the past 7 days; store headline, source, date, URL, summary, score; skip existing URLs; cap 20 per topic by removing oldest; return inserted/skipped/total; also runs on the daily cron); /articles (filters: topic, date range, source, min score, limit; returns articles + count). CORS on all responses. Deploy and trigger /agent once.
3. Push to a new public GitHub repo news-app-backend (no secrets). Verify cron trigger in the Cloudflare dashboard and next run time.
4. Frontend on Cloudflare Pages: cards (linked headline, source, date, colored relevance badge, summary), filters (topic, min relevance, count), grouped by topic, last refreshed time, Refresh button (calls /agent, loading state, reloads). Report public URL.
5. Connect Pages to GitHub for auto-deploy; verify with a small visible change.
6. End-to-end check; report Worker URL, Pages URL, GitHub URL, next scheduled run.
