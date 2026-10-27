// Reads SITE_PASSWORD from the environment, falling back to the raw value in .env.
// Parsed by hand (no shell sourcing) so characters like $ in the password stay literal.
// The value is never logged or hard-coded.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function sitePassword() {
  if (process.env.SITE_PASSWORD) return process.env.SITE_PASSWORD;
  const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  try {
    const line = fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("SITE_PASSWORD="));
    const value = line?.slice("SITE_PASSWORD=".length).replace(/^(["'])(.*)\1$/, "$2");
    if (value) return value;
  } catch {
    // fall through to the error below
  }
  throw new Error("SITE_PASSWORD is not set (export it or add it to .env)");
}

export const STATE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".auth", "state.json");
