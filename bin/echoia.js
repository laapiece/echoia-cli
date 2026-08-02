#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs } from "../src/args.js";
import { ApiError, NotAuthenticated } from "../src/api.js";
import { c, out, fail } from "../src/ui.js";
import * as cmd from "../src/commands.js";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
);

const BOOLEANS = ["json", "now", "yes", "unreplied", "help", "version"];
const ALIASES = { h: "help", v: "version", y: "yes", a: "accounts", p: "platforms", m: "message", n: "limit" };

const COMMANDS = {
  login: { run: cmd.login, blurb: "Store and verify your API key" },
  logout: { run: cmd.logout, blurb: "Remove the stored key" },
  whoami: { run: cmd.whoami, blurb: "Show which workspace this key opens" },
  accounts: { run: cmd.accounts, blurb: "List connected social accounts" },
  posts: { run: cmd.posts, blurb: "List posts" },
  post: { run: cmd.post, blurb: "Create a draft, schedule, or publish" },
  stats: { run: cmd.stats, blurb: "Daily performance of one post" },
  comments: { run: cmd.comments, blurb: "List comments with sentiment and tags" },
  reply: { run: cmd.reply, blurb: "Reply publicly to a comment" },
  raw: { run: cmd.raw, blurb: "Call any endpoint directly" },
};

const HELP = {
  post: `${c.bold("echoia post")} <text> --accounts <list> [options]

  --accounts, -a <list>    Who publishes: instagram:@you, @you, or an id  ${c.dim("(required)")}
  --platforms, -p <list>   Shorthand: x,instagram — only when the platform
                           ${c.dim("has exactly ONE connected account")}
  --at <when>              Schedule it: ISO datetime, or 30m / 2h / 3d / 1w
  --now                    Publish immediately ${c.dim("(needs the publish scope)")}
  --media <urls>           Comma-separated https:// media URLs
  --first-comment <text>   Posted under it once live
  --yes, -y                Skip the confirmation before publishing
  --json                   Print the raw response

  ${c.dim("Without --at or --now the post is saved as a draft.")}

${c.dim("Examples")}
  echoia post "Doors open Friday." -a instagram:@acme,x:@acme --at 2d
  echoia post "Live now." -p x --now -y`,

  posts: `${c.bold("echoia posts")} [options]

  --status <status>   draft | scheduled | publishing | published | partial | failed
  --limit, -n <n>     How many to return (max 50)
  --json              Print the raw response`,

  comments: `${c.bold("echoia comments")} [options]

  --platform <p>       Only this platform
  --sentiment <s>      positive | negative | neutral
  --unreplied          Only comments with no reply yet
  --limit, -n <n>      How many to return (max 50)
  --json               Print the raw response

${c.dim("Example")}
  echoia comments --unreplied --sentiment negative`,

  reply: `${c.bold("echoia reply")} <commentId> --platform <p> --message <text>

  --platform <p>     The comment's platform  ${c.dim("(required)")}
  --message, -m      What to say  ${c.dim("(required)")}
  --account <id>     Which connected account replies
  --yes, -y          Skip the confirmation
  --json             Print the raw response

  ${c.dim("commentId comes from `echoia comments`. Replies post publicly, immediately.")}`,

  stats: `${c.bold("echoia stats")} <postId> [--json]

  ${c.dim("postId comes from `echoia posts`.")}`,

  login: `${c.bold("echoia login")} [--stdin | --key <key>] [--base-url <url>]

  --stdin              Read the key from stdin  ${c.dim('echo "$KEY" | echoia login --stdin')}
  --key <key>          ${c.dim("Discouraged — visible in `ps` and in shell history")}
  --base-url <url>     Another API host: https, or a localhost address

  ${c.dim("With neither flag you are prompted, and the key is not echoed.")}
  ${c.dim("ECHOIA_API_KEY in the environment always takes precedence.")}`,
};

function usage() {
  out(`${c.bold("echoia")} ${c.dim("v" + pkg.version)} — publish, schedule and triage social media from your terminal.

${c.dim("USAGE")}
  echoia <command> [options]

${c.dim("COMMANDS")}
${Object.entries(COMMANDS)
  .map(([name, { blurb }]) => `  ${name.padEnd(10)} ${c.dim(blurb)}`)
  .join("\n")}

${c.dim("GLOBAL")}
  --json         Machine-readable output
  --help, -h     Help for a command: echoia post --help
  --version, -v  Print the version

${c.dim("GETTING STARTED")}
  echoia login              ${c.dim("store your key from Settings → Developers")}
  echoia accounts           ${c.dim("check what is connected")}
  echoia post "Hello" -p x --at 2h

${c.dim("Docs: https://echoia.io/docs/cli")}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positionals } = parseArgs(argv, { booleans: BOOLEANS, aliases: ALIASES });
  const name = positionals.shift();

  if (flags.version) return out(pkg.version);
  if (!name || name === "help") return usage();

  const command = COMMANDS[name];
  if (!command) {
    const near = Object.keys(COMMANDS).filter((k) => k.startsWith(name[0]));
    fail(
      `Unknown command "${name}".`,
      near.length ? `Did you mean: ${near.join(", ")}? Run \`echoia\` for the full list.` : "Run `echoia` for the list."
    );
    return;
  }

  if (flags.help) return out(HELP[name] ?? `No extra options for \`echoia ${name}\`.`);

  await command.run({ flags, positionals });
}

main().catch((e) => {
  if (e instanceof NotAuthenticated) {
    fail("Not logged in.", "Run `echoia login`, or set ECHOIA_API_KEY.");
  } else if (e instanceof ApiError) {
    fail(e.message, e.hint);
  } else {
    fail(e.message || String(e));
  }
});
