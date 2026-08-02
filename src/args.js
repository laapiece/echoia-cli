/**
 * Minimal argument parser.
 *
 * Node's util.parseArgs exists, but it needs every option declared up front and
 * throws on unknown ones — awkward when each subcommand takes a different set.
 * This is ~40 lines and behaves the way people expect from a CLI.
 *
 * Supports: --flag, --key value, --key=value, -k value, and positionals.
 * Everything after `--` is treated as a positional, so post text starting with
 * a dash still works.
 */
export function parseArgs(argv, { booleans = [], aliases = {} } = {}) {
  const flags = {};
  const positionals = [];
  let literal = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (literal) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      literal = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = splitOnce(arg.slice(2), "=");
      const key = aliases[rawKey] ?? rawKey;
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
      } else if (booleans.includes(key)) {
        flags[key] = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("-")) flags[key] = true;
        else {
          flags[key] = next;
          i++;
        }
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const key = aliases[arg.slice(1)] ?? arg.slice(1);
      if (booleans.includes(key)) {
        flags[key] = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("-")) flags[key] = true;
        else {
          flags[key] = next;
          i++;
        }
      }
      continue;
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}

function splitOnce(s, sep) {
  const i = s.indexOf(sep);
  return i === -1 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

/** `--platforms x,instagram` → ["x", "instagram"] */
export function list(value) {
  if (value === undefined || value === true) return undefined;
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Accepts an ISO datetime or a relative shorthand: 30m, 2h, 3d, 1w.
 * Relative is what people reach for when scheduling from a terminal.
 */
export function when(value) {
  if (!value || value === true) return undefined;
  const m = String(value).match(/^(\d+)\s*(m|h|d|w)$/i);
  if (m) {
    const n = Number(m[1]);
    const ms = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2].toLowerCase()];
    return new Date(Date.now() + n * ms).toISOString();
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Could not read "${value}" as a date. Use an ISO datetime or a shorthand like 2h, 3d, 1w.`);
  }
  return d.toISOString();
}
