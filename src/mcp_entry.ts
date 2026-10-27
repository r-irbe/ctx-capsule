import { startStdioMcpServer } from "./mcp/ctx_capsule_mcp_server.ts";

startStdioMcpServer({
  workspaceRoot: process.cwd(),
});
