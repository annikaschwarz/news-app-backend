// GET /login shows the form; POST /login checks the password and sets the session cookie.
// Wrong attempts are slowed down (1s each) and, after MAX_FAILS within the window, locked out per IP.
import { SESSION_COOKIE, createSession, getCookie, safeEqual, sessionCookie, verifySession } from "./_lib/auth.js";

const WINDOW_SECONDS = 15 * 60;
const MAX_FAILS = 5;
const FAIL_DELAY_MS = 1000;
const MAX_PASSWORD_LENGTH = 200;

const page = (message = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Log in · AI Investment News</title>
<style>
  :root { --bg:#f6f7f9; --surface:#fff; --text:#16191f; --muted:#5f6877; --border:#e2e5ea; --accent:#2f5bea; --accent-text:#fff; --err-bg:#fde3e1; --err-fg:#8a1f17; }
  @media (prefers-color-scheme: dark) { :root { --bg:#101216; --surface:#181b21; --text:#eceef2; --muted:#9aa3b2; --border:#2a2f38; --accent:#6b8cff; --accent-text:#0d1020; --err-bg:#4a1f1c; --err-fg:#ffb4ad; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; background:var(--bg); color:var(--text);
    font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  form { width:100%; max-width:360px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; }
  h1 { font-size:1.3rem; margin:0 0 4px; }
  p { margin:0 0 16px; color:var(--muted); font-size:.9rem; }
  label { display:block; font-size:.85rem; color:var(--muted); margin-bottom:4px; }
  input { width:100%; font:inherit; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); }
  button { width:100%; margin-top:14px; font:inherit; font-weight:600; padding:10px; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:var(--accent-text); cursor:pointer; }
  .err { margin-bottom:14px; padding:9px 12px; border-radius:8px; background:var(--err-bg); color:var(--err-fg); font-size:.9rem; }
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>AI Investment News</h1>
  <p>Private dashboard. Log in to continue.</p>
  ${message ? `<div class="err" role="alert">${message}</div>` : ""}
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus required maxlength="${MAX_PASSWORD_LENGTH}">
  <button type="submit">Log in</button>
</form>
</body>
</html>`;

const html = (body, status = 200, extra = {}) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSeconds = () => Math.floor(Date.now() / 1000);

// Failed-attempt tracking in D1. Errors here must not lock the owner out, so they are logged
// and the fixed delay still applies.
async function secondsLocked(db, ip) {
  try {
    const row = await db.prepare("SELECT fails, window_start FROM login_attempts WHERE ip = ?").bind(ip).first();
    if (!row) return 0;
    const left = WINDOW_SECONDS - (nowSeconds() - row.window_start);
    return row.fails >= MAX_FAILS && left > 0 ? left : 0;
  } catch (err) {
    console.error("login_attempts read failed:", err);
    return 0;
  }
}

async function recordFailure(db, ip) {
  try {
    await db
      .prepare(
        `INSERT INTO login_attempts (ip, fails, window_start) VALUES (?1, 1, ?2)
         ON CONFLICT(ip) DO UPDATE SET
           fails = CASE WHEN ?2 - window_start > ?3 THEN 1 ELSE fails + 1 END,
           window_start = CASE WHEN ?2 - window_start > ?3 THEN ?2 ELSE window_start END`,
      )
      .bind(ip, nowSeconds(), WINDOW_SECONDS)
      .run();
  } catch (err) {
    console.error("login_attempts write failed:", err);
  }
}

async function clearFailures(db, ip) {
  try {
    await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
  } catch (err) {
    console.error("login_attempts clear failed:", err);
  }
}

export async function onRequestGet({ request, env }) {
  if (await verifySession(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET)) {
    return Response.redirect(new URL("/", request.url), 302);
  }
  return html(page());
}

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET || !env.SITE_PASSWORD) return new Response("Site is not configured", { status: 500 });

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const locked = await secondsLocked(env.DB, ip);
  if (locked > 0) {
    return html(page(`Too many attempts. Try again in ${Math.ceil(locked / 60)} minute(s).`), 429, {
      "Retry-After": String(locked),
    });
  }

  let password = "";
  try {
    const form = await request.formData();
    const value = form.get("password");
    if (typeof value === "string") password = value.slice(0, MAX_PASSWORD_LENGTH);
  } catch {
    // Malformed body counts as a wrong password.
  }

  if (password && (await safeEqual(password, env.SITE_PASSWORD))) {
    await clearFailures(env.DB, ip);
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": sessionCookie(await createSession(env.SESSION_SECRET)),
        "Cache-Control": "no-store",
      },
    });
  }

  await recordFailure(env.DB, ip);
  await sleep(FAIL_DELAY_MS);
  return html(page("Wrong password."), 401);
}
