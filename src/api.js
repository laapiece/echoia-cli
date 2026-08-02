import { getConfig } from "./config.js";

/**
 * Thin wrapper over the Echoia REST API.
 *
 * Node 18+ ships fetch, so this package has zero dependencies — a global CLI
 * that pulls in a tree of transitive packages is a supply-chain liability for
 * something this small.
 */

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }

  /** Actionable advice, so the CLI never just prints a status code. */
  get hint() {
    if (this.status === 401) return "Run `echoia login` with a valid key, or check ECHOIA_API_KEY.";
    if (this.status === 403) return "This token lacks the scope this command needs. Create one with it in Settings → Developers.";
    if (this.status === 429 && /quota/i.test(this.message)) return "A monthly quota is spent — retrying will not help.";
    if (this.status === 429) return "Rate limited. Wait a moment and try again.";
    if (this.status === 404) return "Not found in this workspace. Check the id.";
    return null;
  }
}

export class NotAuthenticated extends Error {
  constructor() {
    super("Not logged in.");
  }
}

export async function request(path, { method = "GET", body, query } = {}) {
  const { apiKey, baseUrl } = getConfig();
  if (!apiKey) throw new NotAuthenticated();

  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        "User-Agent": "echoia-cli",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    if (e?.name === "TimeoutError") throw new Error("The request timed out after 60s.");
    throw new Error(`Could not reach ${url.host}: ${e.message}`);
  }

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.status, `Unexpected non-JSON response (HTTP ${res.status}).`, text);
  }

  if (!res.ok) {
    throw new ApiError(res.status, payload.error || `HTTP ${res.status}`, payload);
  }
  return payload;
}

export const api = {
  accounts: () => request("/accounts"),
  posts: (query) => request("/posts", { query }),
  createPost: (body) => request("/posts", { method: "POST", body }),
  postStats: (id) => request(`/posts/${encodeURIComponent(id)}/stats`),
  comments: (query) => request("/comments", { query }),
  reply: (body) => request("/comments/reply", { method: "POST", body }),
};
