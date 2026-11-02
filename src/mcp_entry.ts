import { startStdioMcpServer } from "./mcp/ctx_capsule_mcp_server.ts";

// ctx-capsule standalone MCP entry (synced 2026-10-28 with the pin-harness-bridge
// copy's entry guard semantics).
//
// - CTX_CAPSULE_MCP_LIVE=1 switches the runtime to live adapters (real process
//   spawn / PTO); the default remains dry_run (planner-only, no side effects).
// - CTX_CAPSULE_WORKSPACE_ROOT point at the ik_llama.cpp workspace when the
//   client launches MCP from elsewhere; defaults to cwd.
startStdioMcpServer({
  workspaceRoot: process.env.CTX_CAPSULE_WORKSPACE_ROOT || process.cwd(),
  processMode: process.env.CTX_CAPSULE_MCP_LIVE === "1" ? "live" : "dry_run",
});
