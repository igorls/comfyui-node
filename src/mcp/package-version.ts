import { readFileSync } from "node:fs";

let cached: string | undefined;

/**
 * The installed package's version, read from package.json at runtime so the MCP handshake and
 * `--version` cannot drift from the published version. This file sits two levels below the
 * package root in both src/ and dist/ (`<root>/{src,dist}/mcp/`), so the relative path holds
 * for local runs and installed packages alike.
 */
export function packageVersion(): string {
  if (cached !== undefined) return cached;
  let version = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    if (typeof pkg.version === "string") version = pkg.version;
  } catch {
    // Leave "unknown": a missing version must never stop the server from starting.
  }
  cached = version;
  return version;
}
