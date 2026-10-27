import { runCapsuleCli } from "./index.ts";

const exitCode = await runCapsuleCli({
  argv: process.argv.slice(2),
  workspaceRoot: process.cwd(),
});
process.exitCode = exitCode;
