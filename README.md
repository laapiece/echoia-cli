# echoia

Publish, schedule and triage social media from your terminal.

A thin command line over the [Echoia API](https://echoia.io/docs/api) — the same
endpoints the app and the MCP server use, so anything you can do here you can do
from a script or a CI job.

```bash
npm install -g echoia
echoia login
echoia post "Doors open Friday." --platforms instagram,facebook --at 2d
```

## Install

Requires Node 18 or newer. **Zero dependencies** — a globally installed CLI that
pulls in a tree of transitive packages is a supply-chain liability for something
this small.

```bash
npm install -g echoia
```

## Authenticate

Create a key in **Settings → Developers** at [app.echoia.io](https://app.echoia.io),
then either store it once:

```bash
echoia login          # prompts, input is not echoed
```

…or set an environment variable, which is what a CI job should do:

```bash
export ECHOIA_API_KEY="eko_..."
```

The environment always wins over the stored key, so you can point a single
command at a different workspace without logging out. Stored keys live in
`~/.config/echoia/config.json` with `0600` permissions.

## Commands

| Command | Does |
|---|---|
| `echoia login` | Store and verify your API key |
| `echoia logout` | Remove the stored key |
| `echoia whoami` | Show which workspace this key opens |
| `echoia accounts` | List connected social accounts |
| `echoia posts` | List posts |
| `echoia post` | Create a draft, schedule, or publish |
| `echoia stats <id>` | Daily performance of one post |
| `echoia comments` | List comments with sentiment and tags |
| `echoia reply <id>` | Reply publicly to a comment |
| `echoia raw <path>` | Call any endpoint directly |

`echoia <command> --help` for the options of any one of them.

## Posting

Without `--at` or `--now`, a post is saved as a **draft** — the safe default.

```bash
# Draft, for a human to review in the app
echoia post "Something I'm still thinking about" -p linkedin

# Scheduled — ISO datetime, or a shorthand: 30m, 2h, 3d, 1w
echoia post "Doors open Friday." -p instagram,facebook --at 3d
echoia post "Live at noon." -p x --at 2026-09-12T12:00:00Z

# Immediate. Asks for confirmation unless --yes; needs the `publish` scope.
echoia post "We're live." -p x --now
```

Extras:

```bash
echoia post "New drop" -p instagram \
  --media https://cdn.example.com/shot.jpg \
  --first-comment "Full details in the link in bio."
```

## Triage

```bash
# What still needs an answer
echoia comments --unreplied

# Only the unhappy ones
echoia comments --unreplied --sentiment negative

# Answer one — the id comes from the list above
echoia reply 17865099186639825 --platform threads --message "Thanks — glad it landed."
```

Publishing and replying both confirm before acting when run in a terminal. Pass
`--yes` to skip that, which is what you want in automation and nowhere else.

## Scripting

Every command takes `--json`, so nothing needs to parse a human-formatted table.

```bash
# Platforms that need reconnecting
echoia accounts --json | jq -r '.accounts[] | select(.needsReconnect) | .platform'

# Unanswered questions
echoia comments --unreplied --limit 50 --json \
  | jq -r '.comments[] | select(.tags | index("question")) | "\(.author): \(.text)"'
```

### In CI

```yaml
- name: Schedule the release announcement
  env:
    ECHOIA_API_KEY: ${{ secrets.ECHOIA_API_KEY }}
  run: |
    npx echoia post "Version ${{ github.ref_name }} is out." \
      --platforms x,linkedin --at 1h --yes
```

Give CI its own token with `write` only. A pipeline that cannot publish
immediately cannot publish a mistake immediately.

## Exit codes

`0` on success, `1` on any failure. Errors go to stderr with a hint — a `403`
tells you which scope is missing, a `429` tells you whether waiting will help.

## Environment

| Variable | Effect |
|---|---|
| `ECHOIA_API_KEY` | The key. Takes precedence over the stored one. |
| `ECHOIA_BASE_URL` | Point at another API host. Defaults to `https://app.echoia.io/api/v1`. |
| `ECHOIA_CONFIG_DIR` | Where to keep `config.json`. |
| `NO_COLOR` | Disable colour. Colour is also off when stdout is not a TTY. |

## Documentation

[echoia.io/docs/cli](https://echoia.io/docs/cli) · [API reference](https://echoia.io/docs/api) · [MCP server](https://echoia.io/docs/mcp)

## License

MIT
