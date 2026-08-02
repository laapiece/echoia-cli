import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from "node:fs";

/**
 * Where the API key lives.
 *
 * Two sources, environment first: a CI job sets ECHOIA_API_KEY and must never
 * depend on a file that isn't there, while a human runs `echoia login` once and
 * forgets about it. Env winning also means you can override a stored key for a
 * single command without logging out.
 */

const CONFIG_DIR =
  process.env.ECHOIA_CONFIG_DIR ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "echoia");

const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const DEFAULT_BASE_URL = "https://app.echoia.io/api/v1";

function readFile() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Refuses to send the key in clear text.
 *
 * ECHOIA_BASE_URL is the one setting that decides where a bearer token is
 * sent, and a plain http:// host would put it on the wire for anyone on the
 * path to read. Loopback is exempt so `next dev` stays usable.
 */
export function assertSafeBaseUrl(baseUrl) {
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid base URL: ${baseUrl}`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  if (u.protocol !== "https:" && !loopback) {
    throw new Error(
      `Refusing to send your API key over ${u.protocol}// to ${u.host}. Use https, or a localhost address for development.`
    );
  }
  return baseUrl;
}

export function getConfig() {
  const file = readFile();
  const baseUrl = process.env.ECHOIA_BASE_URL || file.baseUrl || DEFAULT_BASE_URL;
  return {
    apiKey: process.env.ECHOIA_API_KEY || file.apiKey || null,
    baseUrl: assertSafeBaseUrl(baseUrl),
    // Tells `logout` and `whoami` where the key actually came from.
    source: process.env.ECHOIA_API_KEY ? "env" : file.apiKey ? "file" : null,
  };
}

export function saveApiKey(apiKey, baseUrl) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const next = { ...readFile(), apiKey };
  if (baseUrl && baseUrl !== DEFAULT_BASE_URL) next.baseUrl = baseUrl;
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  // Re-applied explicitly: writeFileSync only honours `mode` when creating.
  chmodSync(CONFIG_FILE, 0o600);
  return CONFIG_FILE;
}

export function clearApiKey() {
  if (!existsSync(CONFIG_FILE)) return false;
  rmSync(CONFIG_FILE);
  return true;
}

export const configPath = CONFIG_FILE;
