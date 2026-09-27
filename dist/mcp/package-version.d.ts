/**
 * The installed package's version, read from package.json at runtime so the MCP handshake and
 * `--version` cannot drift from the published version. This file sits two levels below the
 * package root in both src/ and dist/ (`<root>/{src,dist}/mcp/`), so the relative path holds
 * for local runs and installed packages alike.
 */
export declare function packageVersion(): string;
//# sourceMappingURL=package-version.d.ts.map