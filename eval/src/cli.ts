import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export type McpHandle = {
  url: string;
  token: string;
  projectRoot: string;
  child: ChildProcess;
  kill: () => Promise<void>;
};

const BEARER_RE = /bearer:\s*([A-Za-z0-9._\-]+)/i;
const ADDR_RE = /(?:serving|MCP).*(127\.0\.0\.1:\d+|localhost:\d+)/i;
const URL_RE = /(https?:\/\/[^\s]+)/i;

export async function startMcp(projectRoot: string, timeoutMs = 30_000): Promise<{ handle: McpHandle; startupMs: number }> {
  const startedAt = Date.now();
  const bin = await resolveGritqaBin();

  // Prefer HTTP mode on a fixed loopback port 0 == OS picks free port when we use 127.0.0.1:0,
  // but gritqa --serve expects an explicit host:port. Use 127.0.0.1:0 semantics via Go's net.Listen.
  // The CLI's serve mode accepts --serve=127.0.0.1:0 ? Check: it normalises via loopback().
  // Safer: let gritqa pick via 127.0.0.1:0, then parse the actual bound address from stderr.
  const child = spawn(bin, ["--serve=127.0.0.1:0"], {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  // Allow parent to exit even if child is still running; we manage lifecycle explicitly
  child.unref();

  let stderr = "";
  let url: string | null = null;
  let token: string | null = null;

  const onData = (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;

    // Check accumulated stderr, not just the chunk, in case output is split
    if (!url) {
      const addrMatch = stderr.match(ADDR_RE);
      if (addrMatch) {
        const hostPort = addrMatch[1];
        url = `http://${hostPort}`;
      }
      const urlMatch = stderr.match(URL_RE);
      if (urlMatch && urlMatch[1].includes("127.0.0.1")) {
        url = urlMatch[1].replace(/\/$/, "");
      }
    }
    if (!token) {
      const bearerMatch = stderr.match(BEARER_RE);
      if (bearerMatch) token = bearerMatch[1].trim();
      const altMatch = stderr.match(/token[:\s]+([A-Za-z0-9._\-]{20,})/i);
      if (altMatch && !token) token = altMatch[1].trim();
    }
  };

  child.stderr?.on("data", onData);
  child.stdout?.on("data", onData);

  // Wait until we have both url and token, or timeout
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (url && token) break;
    if (child.exitCode !== null) {
      throw new Error(`gritqa --serve exited early (code ${child.exitCode}): ${stderr.slice(-2000)}`);
    }
    await sleep(150);
  }

  if (!url || !token) {
    // Fallback: try to parse whatever we have; maybe token is printed elsewhere
    // Try reading from stderr more aggressively
    const fallbackUrl = stderr.match(/127\.0\.0\.1:\d+/)?.[0];
    if (fallbackUrl && !url) url = `http://${fallbackUrl}`;
    // Token may be after "Bearer" in different casing
    const fallbackToken = stderr.match(/[A-Za-z0-9_\-]{24,}/)?.[0];
    if (fallbackToken && !token) token = fallbackToken;

    if (!url || !token) {
      try {
        child.kill("SIGTERM");
      } catch {}
      throw new Error(
        `Timed out waiting for gritqa MCP server (url=${url ?? "?"}, token=${token ? "yes" : "no"}). Stderr tail:\n${stderr.slice(-3000)}`
      );
    }
  }

  const startupMs = Date.now() - startedAt;

  const kill = async () => {
    try {
      child.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stderr?.destroy();
      child.stdout?.destroy();
      // @ts-ignore
      child.stdin?.destroy?.();
    } catch {}
    try {
      if (child.exitCode === null) child.kill("SIGKILL");
    } catch {}
    await sleep(300);
    try {
      // @ts-ignore - unref may not be typed
      child.unref?.();
    } catch {}
    // Force destroy again
    try {
      child.stderr?.destroy();
      child.stdout?.destroy();
    } catch {}
  };

  return {
    handle: { url: url!, token: token!, projectRoot, child, kill },
    startupMs,
  };
}

async function resolveGritqaBin(): Promise<string> {
  const candidates = [
    process.env.GRITQA_BIN,
    "/tmp/gritqa",
    "gritqa",
    "../cli/gritqa",
    "./cli/gritqa",
    new URL("../../cli/gritqa", import.meta.url).pathname,
  ].filter(Boolean) as string[];

  // Try to find a built binary, else fall back to `go run`
  for (const c of candidates) {
    if (c === "gritqa") return c; // assume on PATH
    try {
      const { stat } = await import("node:fs/promises");
      await stat(c);
      return c;
    } catch {}
  }
  // Fallback: go run from repo root
  return "gritqa";
}

export function gritqaBinForGoRun(projectRoot: string): { cmd: string; args: string[] } {
  // If gritqa binary not found on PATH, caller can use `go run`
  return { cmd: "go", args: ["run", "./...", "--serve=127.0.0.1:0"] };
}
