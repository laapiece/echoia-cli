import { api, request } from "./api.js";
import { getConfig, saveApiKey, clearApiKey, configPath, assertSafeBaseUrl, DEFAULT_BASE_URL } from "./config.js";
import { c, out, warn, readStdin, table, truncate, relativeDate, prompt } from "./ui.js";
import { list, when } from "./args.js";
import { browserLogin } from "./browser-login.js";

/**
 * One function per subcommand. Each receives { flags, positionals } and either
 * prints or throws — the entry point owns error formatting and exit codes.
 *
 * Every command honours --json, so the CLI is usable in a pipeline without
 * parsing human-formatted tables.
 */

const json = (flags, data) => {
  if (!flags.json) return false;
  out(JSON.stringify(data, null, 2));
  return true;
};

const STATUS_COLOUR = {
  draft: c.dim,
  scheduled: c.blue,
  publishing: c.yellow,
  published: c.green,
  partial: c.yellow,
  failed: c.red,
};

const SENTIMENT_COLOUR = { positive: c.green, negative: c.red, neutral: c.dim };

/**
 * Trades the one-time code for a key. Hits the app origin rather than the API
 * base, since this endpoint is not part of the versioned public API.
 */
async function exchangeCliCode(baseUrl, code, verifier) {
  const res = await fetch(new URL("/api/cli/auth/token", new URL(baseUrl).origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not complete sign-in (HTTP ${res.status}).`);
  return data;
}

/* ── auth ─────────────────────────────────────────────────────────────── */

export async function login({ flags }) {
  const baseUrl = assertSafeBaseUrl(flags["base-url"] || DEFAULT_BASE_URL);
  let key = typeof flags.key === "string" ? flags.key : null;

  if (key) {
    // A key passed as an argument is readable by every other user on the
    // machine while the process runs (/proc/<pid>/cmdline on Linux, `ps`
    // elsewhere), and CI runners echo commands into their logs. The prompt,
    // --stdin and ECHOIA_API_KEY all avoid that.
    warn("--key puts your key in the process list and your shell history. Prefer `--stdin` or ECHOIA_API_KEY.");
  }

  if (!key && flags.stdin) {
    key = (await readStdin()).trim();
    if (!key) throw new Error("Nothing on stdin. Usage: echo \"$KEY\" | echoia login --stdin");
  }

  // Browser sign-in is the default for a human at a terminal. It needs a
  // browser and someone to click, so anything non-interactive — CI, a
  // container, a piped command — keeps the paste path instead.
  // --browser forces it where TTY detection is unreliable (tmux, wrappers) and
  // makes the flow drivable by tests.
  if (!key && !flags["no-browser"] && (flags.browser || process.stdout.isTTY)) {
    const scopes = list(flags.scope) ?? ["read", "write", "publish", "engage"];
    const { code, verifier } = await browserLogin({ baseUrl, scopes });
    const granted = await exchangeCliCode(baseUrl, code, verifier);
    const path = saveApiKey(granted.key, baseUrl);
    out("");
    out(`${c.green("✓")} Signed in — key saved to ${c.dim(path)}`);
    out(`  ${granted.scopes.join(", ")} · ${granted.workspaces.map((w) => w.name).join(", ")}`);
    return;
  }

  if (!key) {
    out(`Create a key in ${c.bold("Settings → Developers")} at https://app.echoia.io`);
    key = await prompt("API key: ", { mask: true });
  }
  if (!key) throw new Error("No key given.");
  if (!key.startsWith("eko_")) throw new Error("That does not look like an Echoia key — they start with eko_.");

  // Verify before storing, so a typo fails now rather than on the next command.
  process.env.ECHOIA_API_KEY = key;
  process.env.ECHOIA_BASE_URL = baseUrl;
  const { accounts } = await api.accounts();

  delete process.env.ECHOIA_API_KEY;
  delete process.env.ECHOIA_BASE_URL;
  const path = saveApiKey(key, baseUrl);

  out(`${c.green("✓")} Key verified and saved to ${c.dim(path)}`);
  out(
    accounts.length
      ? `  ${accounts.length} connected account${accounts.length === 1 ? "" : "s"}: ${accounts.map((a) => a.platform).join(", ")}`
      : "  No social accounts connected yet — connect one in the app."
  );
}

export async function logout() {
  const { source } = getConfig();
  const removed = clearApiKey();
  if (removed) out(`${c.green("✓")} Removed ${c.dim(configPath)}`);
  else out("Nothing stored — no config file to remove.");
  if (source === "env") {
    out(c.yellow("Note: ECHOIA_API_KEY is still set in your environment and takes precedence."));
  }
}

export async function whoami({ flags }) {
  const { source, baseUrl } = getConfig();
  const { accounts } = await api.accounts();
  if (json(flags, { source, baseUrl, accounts })) return;

  out(`${c.bold("Authenticated")} — key from ${source === "env" ? "ECHOIA_API_KEY" : configPath}`);
  if (baseUrl !== DEFAULT_BASE_URL) out(`API: ${c.dim(baseUrl)}`);
  out("");
  if (!accounts.length) {
    out(c.dim("No connected accounts in this workspace."));
    return;
  }
  table(
    ["PLATFORM", "ACCOUNT", "FOLLOWERS", ""],
    accounts.map((a) => [
      a.platform,
      a.username ? `@${a.username}` : c.dim("—"),
      a.followers == null ? c.dim("—") : String(a.followers),
      a.needsReconnect ? c.red("needs reconnect") : "",
    ])
  );
}

/* ── read ─────────────────────────────────────────────────────────────── */

export async function accounts({ flags }) {
  const data = await api.accounts();
  if (json(flags, data)) return;
  if (!data.accounts.length) return out(c.dim("No connected accounts."));

  table(
    ["PLATFORM", "ACCOUNT", "FOLLOWERS", "ID", ""],
    data.accounts.map((a) => [
      a.platform,
      a.username ? `@${a.username}` : c.dim("—"),
      a.followers == null ? c.dim("—") : String(a.followers),
      c.dim(a.id),
      a.needsReconnect ? c.red("needs reconnect") : a.isActive ? "" : c.dim("inactive"),
    ])
  );
}

export async function posts({ flags }) {
  const data = await api.posts({
    status: typeof flags.status === "string" ? flags.status : undefined,
    limit: flags.limit,
  });
  if (json(flags, data)) return;
  if (!data.posts.length) return out(c.dim("No posts match."));

  table(
    ["STATUS", "WHEN", "PLATFORMS", "CONTENT", "ID"],
    data.posts.map((p) => {
      const colour = STATUS_COLOUR[p.status] ?? ((s) => s);
      const stamp = p.publishedAt ?? p.scheduledAt ?? p.createdAt;
      return [
        colour(p.status),
        relativeDate(stamp),
        (p.platforms ?? []).join(","),
        truncate(p.content, 48),
        c.dim(p.id),
      ];
    })
  );
}

export async function stats({ flags, positionals }) {
  const id = positionals[0];
  if (!id) throw new Error("Which post? Usage: echoia stats <postId>");
  const data = await api.postStats(id);
  if (json(flags, data)) return;

  if (!data.metrics.length) {
    return out(c.dim("No snapshots yet — metrics appear a few hours after publishing."));
  }
  out(`${c.bold(data.post.status)}  ${c.dim(data.post.publishedAt ?? "")}`);
  out("");
  table(
    ["PLATFORM", "DAY", "VIEWS", "LIKES", "COMMENTS", "SHARES"],
    data.metrics.map((m) => [
      m.platform,
      m.day,
      m.views ?? c.dim("—"),
      m.likes ?? c.dim("—"),
      m.comments ?? c.dim("—"),
      m.shares ?? c.dim("—"),
    ])
  );
}

export async function comments({ flags }) {
  const data = await api.comments({
    platform: typeof flags.platform === "string" ? flags.platform : undefined,
    sentiment: typeof flags.sentiment === "string" ? flags.sentiment : undefined,
    unreplied: flags.unreplied ? "1" : undefined,
    limit: flags.limit,
  });
  if (json(flags, data)) return;
  if (!data.comments.length) return out(c.dim("No comments match."));

  table(
    ["", "PLATFORM", "AUTHOR", "COMMENT", "TAGS", "ID"],
    data.comments.map((m) => {
      const colour = SENTIMENT_COLOUR[m.sentiment] ?? ((s) => s);
      return [
        m.replied ? c.dim("·") : c.yellow("!"),
        m.platform,
        truncate(m.author, 18),
        colour(truncate(m.text, 46)),
        (m.tags ?? []).join(","),
        c.dim(m.platformCommentId),
      ];
    })
  );
  out("");
  out(c.dim(`! = unanswered · reply with: echoia reply <id> --platform <p> --message "…"`));
}

/* ── write ────────────────────────────────────────────────────────────── */

export async function post({ flags, positionals }) {
  const content = positionals.join(" ").trim();
  const platforms = list(flags.platforms);
  // A workspace can hold several accounts on one platform, so --platforms is
  // only a shorthand: the server refuses it when it's ambiguous and names the
  // candidates. --accounts is the precise form and takes handles, so nothing
  // has to be looked up first.
  const accountIds = list(flags.accounts);

  if (!content && !flags.media) throw new Error('Nothing to post. Usage: echoia post "Your text" --accounts instagram:@you');
  if (!accountIds?.length && !platforms?.length) {
    throw new Error("Which accounts? Use --accounts instagram:@you (or an id from `echoia accounts`), or --platforms as a shorthand.");
  }
  if (flags.now && flags.at) throw new Error("Use either --now or --at, not both.");

  const body = {
    content,
    ...(accountIds?.length ? { accounts: accountIds } : {}),
    ...(platforms?.length ? { platforms } : {}),
    ...(flags.at ? { scheduledAt: when(flags.at) } : {}),
    ...(flags.now ? { publishNow: true } : {}),
    ...(flags.media ? { mediaUrls: list(flags.media) } : {}),
    ...(flags["first-comment"] ? { firstComments: [String(flags["first-comment"])] } : {}),
  };

  // Publishing is irreversible; make the operator say so out loud unless they
  // passed --yes (which is what a CI job does).
  if (flags.now && !flags.yes && process.stdout.isTTY) {
    const where = accountIds?.length ? accountIds.join(", ") : platforms.join(", ");
    out(`${c.yellow("This publishes immediately")} to ${where}:`);
    out(`  ${truncate(content, 100)}`);
    const answer = await prompt("Type 'yes' to publish: ");
    if (answer.toLowerCase() !== "yes") return out("Cancelled.");
  }

  const data = await api.createPost(body);
  if (json(flags, data)) return;

  const p = data.post;
  const colour = STATUS_COLOUR[p.status] ?? ((s) => s);
  out(`${c.green("✓")} ${colour(p.status)}  ${c.dim(p.id)}`);
  if (p.scheduledAt) out(`  ${relativeDate(p.scheduledAt)} — ${p.scheduledAt}`);

  // Echo the accounts the server actually resolved — the whole point of the
  // shorthand is that you get to see what it meant.
  for (const a of data.accounts ?? []) {
    out(c.dim(`  → ${a.account ?? a.platform} (${a.platform})`));
  }

  for (const r of data.results ?? []) {
    const who = r.accountLabel ? `${r.platform} ${r.accountLabel}` : r.platform;
    out(
      r.success
        ? `  ${c.green("✓")} ${who}${r.url ? ` ${c.dim(r.url)}` : ""}`
        : `  ${c.red("✗")} ${who} ${c.dim(r.error ?? "")}`
    );
  }
  if (data.note) out(c.dim(`  ${data.note}`));
}

export async function reply({ flags, positionals }) {
  const commentId = positionals[0];
  const message = typeof flags.message === "string" ? flags.message : positionals.slice(1).join(" ");
  const platform = typeof flags.platform === "string" ? flags.platform : null;

  if (!commentId) throw new Error('Usage: echoia reply <commentId> --platform x --message "…"');
  if (!platform) throw new Error("Which platform is the comment on? Use --platform (see `echoia comments`).");
  if (!message) throw new Error("Nothing to say. Use --message \"…\".");

  if (!flags.yes && process.stdout.isTTY) {
    out(`${c.yellow("This posts publicly")} on ${platform}:`);
    out(`  ${message}`);
    const answer = await prompt("Type 'yes' to send: ");
    if (answer.toLowerCase() !== "yes") return out("Cancelled.");
  }

  const data = await api.reply({
    platform,
    commentId,
    message,
    ...(flags.account ? { accountId: String(flags.account) } : {}),
  });
  if (json(flags, data)) return;
  out(`${c.green("✓")} Replied${data.repliedAs ? ` as @${data.repliedAs}` : ""}.`);
}

/* ── misc ─────────────────────────────────────────────────────────────── */

export async function raw({ flags, positionals }) {
  const path = positionals[0];
  if (!path) throw new Error('Usage: echoia raw /accounts  ·  echoia raw /posts --method POST --body \'{"…"}\'');
  const data = await request(path.startsWith("/") ? path : `/${path}`, {
    method: typeof flags.method === "string" ? flags.method.toUpperCase() : "GET",
    body: flags.body ? JSON.parse(String(flags.body)) : undefined,
  });
  out(JSON.stringify(data, null, 2));
}
