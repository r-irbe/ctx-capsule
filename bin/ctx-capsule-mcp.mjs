#!/usr/bin/env node
/**
 * Stdio JSON-RPC 2.0 MCP Server Entrypoint (`ctx-capsule-mcp`).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "mcp_entry.ts");
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", entry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
