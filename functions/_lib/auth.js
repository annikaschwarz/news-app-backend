// Session + password helpers shared by the login functions and the middleware.
// The session is stateless: "<expiry-epoch-seconds>.<HMAC-SHA256 signature>", signed with SESSION_SECRET.

const enc = new TextEncoder();

// __Host- prefix: browsers only accept it when Secure, Path=/ and no Domain is set.
export const SESSION_COOKIE = "__Host-session";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function toBase64Url(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const hmacKey = (secret, usage) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

export async function createSession(secret) {
  const payload = String(Math.floor(Date.now() / 1000) + SESSION_MAX_AGE);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

export async function verifySession(value, secret) {
  if (!value || !secret) return false;
  const parts = value.split(".");
  if (parts.length !== 2 || !/^\d{1,12}$/.test(parts[0])) return false;
  if (Number(parts[0]) <= Math.floor(Date.now() / 1000)) return false; // expired
  try {
    // subtle.verify compares the signature in constant time.
    return await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromBase64Url(parts[1]), enc.encode(parts[0]));
  } catch {
    return false;
  }
}

// Constant-time string comparison: hash both sides to equal length, then timingSafeEqual.
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([a, b].map((v) => crypto.subtle.digest("SHA-256", enc.encode(v))));
  return crypto.subtle.timingSafeEqual(x, y);
}

export function getCookie(request, name) {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";
export const sessionCookie = (value) => `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_MAX_AGE}; ${COOKIE_FLAGS}`;
export const clearedCookie = () => `${SESSION_COOKIE}=; Max-Age=0; ${COOKIE_FLAGS}`;
