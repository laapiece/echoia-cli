import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Terminal output. Colour only when stdout is a TTY and NO_COLOR is unset, so
 * piping into a file or a log never produces escape codes.
 */

const useColour = stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColour ? `[${code}m${s}[0m` : String(s));

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
};

export function out(s = "") {
  stdout.write(s + "\n");
}

export function fail(message, hint) {
  process.stderr.write(`${c.red("Error")} ${message}\n`);
  if (hint) process.stderr.write(`${c.dim(hint)}\n`);
  process.exitCode = 1;
}

/** Non-fatal notice. On stderr, so it never pollutes `--json` on stdout. */
export function warn(message) {
  process.stderr.write(`${c.yellow("Warning")} ${message}\n`);
}

/** Reads all of stdin — lets a secret be piped in without ever hitting argv. */
export async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** Strips escape codes so column widths line up when colour is on. */
const width = (s) => String(s).replace(/\[\d+m/g, "").length;

export function table(headers, rows) {
  if (rows.length === 0) return;
  const widths = headers.map((h, i) =>
    Math.max(width(h), ...rows.map((r) => width(r[i] ?? "")))
  );
  const line = (cells, colour) =>
    out(
      cells
        .map((cell, i) => {
          const pad = " ".repeat(Math.max(0, widths[i] - width(cell ?? "")));
          const text = (cell ?? "") + pad;
          return colour ? colour(text) : text;
        })
        .join("  ")
        .trimEnd()
    );

  line(headers, c.dim);
  rows.forEach((r) => line(r));
}

export function truncate(s, n) {
  const str = String(s ?? "").replace(/\s+/g, " ").trim();
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

export function relativeDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const units = [
    [86_400_000 * 365, "y"],
    [86_400_000 * 30, "mo"],
    [86_400_000, "d"],
    [3_600_000, "h"],
    [60_000, "m"],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      return diff >= 0 ? `${n}${label} ago` : `in ${n}${label}`;
    }
  }
  return "just now";
}

export async function prompt(question, { mask = false } = {}) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  if (!mask) {
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  }

  // Hide typed characters — an API key should not survive in scrollback.
  const onData = (char) => {
    if (["\n", "\r", ""].includes(char.toString())) return;
    stdout.write("[2K[200D" + question + "*".repeat(rl.line.length));
  };
  stdin.on("data", onData);
  const answer = await rl.question(question);
  stdin.off("data", onData);
  rl.close();
  stdout.write("\n");
  return answer.trim();
}
