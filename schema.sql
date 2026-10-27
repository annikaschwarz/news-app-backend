-- News articles collected by the agent Worker
CREATE TABLE IF NOT EXISTS articles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  topic            TEXT    NOT NULL,
  headline         TEXT    NOT NULL,
  source           TEXT,
  publication_date TEXT,                                   -- ISO 8601 date (YYYY-MM-DD)
  url              TEXT    NOT NULL UNIQUE,
  summary          TEXT,
  relevance_score  INTEGER CHECK (relevance_score BETWEEN 1 AND 10),
  fetched_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_topic      ON articles (topic);
CREATE INDEX IF NOT EXISTS idx_articles_pub_date   ON articles (publication_date);
CREATE INDEX IF NOT EXISTS idx_articles_relevance  ON articles (relevance_score);
CREATE INDEX IF NOT EXISTS idx_articles_fetched_at ON articles (fetched_at);

-- Failed-login tracking for the Pages /login function (one row per client IP).
CREATE TABLE IF NOT EXISTS login_attempts (
  ip           TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
