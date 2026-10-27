#!/usr/bin/env node
/**
 * CLI Entrypoint for `@r-irbe/ctx-capsule` (`ctx-capsule`).
 *
 * Supports:
 *   ctx-capsule status
 *   ctx-capsule tui
 *   ctx-capsule init --agents pi,claude,antigravity,opencode,codex,copilot,weftd
 *   ctx-capsule preset <templateId>
 *   ctx-capsule launch [modelId]
 *   ctx-capsule pto [mode]
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "cli_entry.ts");
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", entry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
