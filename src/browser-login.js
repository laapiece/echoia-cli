import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { hostname } from "node:os";
import { c, out } from "./ui.js";

/**
 * Browser sign-in — RFC 8252 (OAuth for native apps) with PKCE (RFC 7636).
 *
 * A published CLI cannot keep a client secret: anyone can read it off npm. PKCE
 * replaces it. We invent a random verifier, send only its SHA-256 to the
 * browser, and later present the verifier itself — proving we are the same
 * process, without ever having stored a shared secret.
 *
 * The browser comes back to a loopback port with a one-time CODE, not the key.
 * A key in a redirect URL would survive in browser history, in the referrer
 * header and in any proxy log; a code that needs the verifier does not.
 */

const CALLBACK_TIMEOUT_MS = 5 * 60_000;

// RFC 7636 §4.1: 43–128 unreserved characters. 32 random bytes gives 43.
function newVerifier() {
  return randomBytes(32).toString("base64url");
}

function challengeFor(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Opens the default browser without shelling through a shell. */
function openBrowser(url) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    // No shell, and the URL is passed as an argv entry — nothing to quote or
    // escape, so a crafted URL cannot become a command.
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: false });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const PAGE = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#111}` +
  `div{text-align:center;max-width:26rem;padding:2rem}h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;color:#666}</style>` +
  `<div><h1>${title}</h1><p>${body}</p></div>`;

/**
 * Full browser flow. Returns { code, verifier } for the caller to exchange.
 */
export async function browserLogin({ baseUrl, scopes }) {
  const verifier = newVerifier();
  const challenge = challengeFor(verifier);
  const state = randomBytes(16).toString("base64url");
  const label = `Echoia CLI on ${hostname()}`.slice(0, 60);

  // Start listening BEFORE opening the browser, so the redirect can never
  // arrive at a closed port.
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();

  const codePromise = new Promise((resolve, reject) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") return res.writeHead(404).end();
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(PAGE("Sign-in rejected", "That response didn't match this terminal session."));
        server.close();
        return reject(new Error("The browser came back with a mismatched response. Start again."));
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE("You're signed in", "You can close this tab and return to your terminal."));
      server.close();
      resolve(code);
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the browser. Run `echoia login` again."));
    }, CALLBACK_TIMEOUT_MS);
    timer.unref?.();
  });

  // The consent screen lives on the app, not the API.
  const appOrigin = new URL(baseUrl).origin;
  const authorize = new URL("/cli/authorize", appOrigin);
  authorize.searchParams.set("challenge", challenge);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("port", String(port));
  authorize.searchParams.set("label", label);
  authorize.searchParams.set("scopes", scopes.join(","));

  const opened = openBrowser(authorize.toString());
  out(opened ? "Opening your browser to approve this terminal…" : "Open this URL to approve:");
  out(c.dim(`  ${authorize}`));
  out(c.dim("Waiting… (Ctrl-C to cancel)"));

  const code = await codePromise;
  return { code, verifier };
}
