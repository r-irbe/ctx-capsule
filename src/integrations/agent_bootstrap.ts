/**
 * Tier 3: Standardized Multi-Agent Bootstrap CLI (`src/integrations/agent_bootstrap.ts`).
 *
 * Implements `ctx-capsule init [--target <dir>] [--agents pi,claude,antigravity,opencode,codex,copilot,weftd] [--preset <id>] [--model <id>]`:
 *   - Scaffolds `.ctx-capsule/config.toml` and `.ctx-capsule/templates/`
 *   - Writes/merges coding agent wiring for each selected agent:
 *     - `pi`: `.pi/provider-capsule.json` + `.pi/extensions/ctx-capsule.json`
 *     - `antigravity` / `claude` / `cursor`: `.mcp.json` (`mcpServers.ctx-capsule` -> `ctx-capsule-mcp`)
 *     - `opencode`: `opencode.json`
 *     - `codex`: `.codex/config.toml`
 *     - `copilot`: `.github/copilot-capsule.json`
 *     - `weftd` (`oh-my-agents`): `.weft/capsule-bridge.json`
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInitialControlState, transition } from "../domain/reducer.ts";
import { Branded, DomainErrors, type DomainError, Result } from "../domain/result.ts";
import {
  buildLlamaServerCliArgs,
  compileHierarchicalTomlBundle,
  renderTemplateToml,
  resolveHierarchicalSettings,
} from "../domain/toml_hierarchy.ts";
import { buildCapsuleRequestDefaults, buildCapsuleRequestHeaders } from "./pi_sdk_extension.ts";

export type BootstrapAgentId =
  | "pi"
  | "claude"
  | "antigravity"
  | "cursor"
  | "opencode"
  | "codex"
  | "copilot"
  | "weftd";

export const ALL_BOOTSTRAP_AGENTS: readonly BootstrapAgentId[] = Object.freeze([
  "pi",
  "claude",
  "antigravity",
  "opencode",
  "codex",
  "copilot",
  "weftd",
]);

export interface BootstrapInitOptions {
  readonly targetDir: string;
  readonly agents?: readonly BootstrapAgentId[];
  readonly presetId?: string;
  readonly modelId?: string;
  readonly port?: number;
}

export interface BootstrapInitReceipt {
  readonly targetDir: string;
  readonly activeModelId: string;
  readonly activeTemplateId: string;
  readonly port: number;
  readonly configuredAgents: readonly BootstrapAgentId[];
  readonly writtenFiles: readonly string[];
}

async function readJsonFileIfExists(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // File does not exist or invalid JSON
  }
  return {};
}

async function writeTextFile(filePath: string, content: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

export function parseBootstrapAgentsList(raw?: string): readonly BootstrapAgentId[] {
  if (!raw || raw.trim().length === 0 || raw.trim() === "all") {
    return ALL_BOOTSTRAP_AGENTS;
  }
  const valid = new Set<string>([
    "pi",
    "claude",
    "antigravity",
    "cursor",
    "opencode",
    "codex",
    "copilot",
    "weftd",
  ]);
  const selected: BootstrapAgentId[] = [];
  for (const part of raw.split(",")) {
    const token = part.trim().toLowerCase();
    if (valid.has(token) && !selected.includes(token as BootstrapAgentId)) {
      selected.push(token as BootstrapAgentId);
    }
  }
  return selected.length > 0 ? Object.freeze(selected) : ALL_BOOTSTRAP_AGENTS;
}

export async function runAgentBootstrapInit(
  options: BootstrapInitOptions,
): Promise<Result<BootstrapInitReceipt, DomainError>> {
  const targetDir = path.resolve(options.targetDir);
  const agents =
    options.agents && options.agents.length > 0 ? options.agents : ALL_BOOTSTRAP_AGENTS;

  let state = createInitialControlState({
    hierarchyRootDir: ".ctx-capsule/hierarchy",
    unifiedModelsTomlPath: ".ctx-capsule/config.toml",
  });

  if (options.modelId) {
    const mRes = transition(state, {
      _tag: "SwitchActiveModel",
      modelId: Branded.unsafeModelId(options.modelId),
    });
    if (mRes.isErr()) {
      return Result.err(mRes.error);
    }
    state = mRes.value.state;
  }

  if (options.presetId) {
    const tRes = transition(state, {
      _tag: "ApplyTemplate",
      templateId: Branded.unsafeTemplateId(options.presetId),
    });
    if (tRes.isErr()) {
      return Result.err(tRes.error);
    }
    state = tRes.value.state;
  }

  if (options.port !== undefined) {
    const pRes = transition(state, {
      _tag: "SetSettingValue",
      key: "instance_port",
      value: String(options.port),
    });
    if (pRes.isOk()) {
      state = pRes.value.state;
    }
  }

  const resolved = resolveHierarchicalSettings(state);
  const activeInst =
    state.instances.find((i) => i.id === state.activeInstanceId) ?? state.instances[0];
  const effectivePort = Number(options.port ?? resolved.instance_port ?? activeInst.port);
  const baseUrl = `http://${activeInst.host}:${effectivePort}/v1`;
  const headers = buildCapsuleRequestHeaders(state);
  const requestDefaults = buildCapsuleRequestDefaults(state);
  const activeModel =
    state.models.find((m) => m.id === state.activeModelId) ?? state.models[0];
  const cliArgs = buildLlamaServerCliArgs(
    activeModel,
    Object.freeze({ ...activeInst, port: Branded.unsafePortNumber(effectivePort) }),
    resolved,
  );

  const bundleRes = compileHierarchicalTomlBundle(state);
  if (bundleRes.isErr()) {
    return Result.err(bundleRes.error);
  }

  return Result.tryCatchAsync(
    async () => {
      const writtenFiles: string[] = [];

      // 1. Scaffold `.ctx-capsule/config.toml` and `.ctx-capsule/templates/*.toml`
      const configTomlPath = path.join(targetDir, ".ctx-capsule", "config.toml");
      writtenFiles.push(await writeTextFile(configTomlPath, bundleRes.value.compiledModelsToml));

      for (const tmpl of state.templates) {
        const tmplPath = path.join(targetDir, ".ctx-capsule", "templates", `${tmpl.id}.toml`);
        writtenFiles.push(await writeTextFile(tmplPath, renderTemplateToml(tmpl)));
      }

      // 2. Write/merge agent configurations
      const needsMcpJson = agents.some(
        (a) => a === "antigravity" || a === "claude" || a === "cursor",
      );
      if (needsMcpJson) {
        const mcpPath = path.join(targetDir, ".mcp.json");
        const existingMcp = await readJsonFileIfExists(mcpPath);
        const existingServers =
          existingMcp.mcpServers && typeof existingMcp.mcpServers === "object"
            ? (existingMcp.mcpServers as Record<string, unknown>)
            : {};

        const mergedMcp = {
          ...existingMcp,
          mcpServers: {
            ...existingServers,
            "ctx-capsule": {
              command: "ctx-capsule-mcp",
              args: [],
              env: {
                CTX_CAPSULE_MODEL: state.activeModelId,
                CTX_CAPSULE_TEMPLATE: state.activeTemplateId,
                CTX_CAPSULE_ENDPOINT: baseUrl,
              },
            },
          },
        };
        writtenFiles.push(
          await writeTextFile(mcpPath, `${JSON.stringify(mergedMcp, null, 2)}\n`),
        );
      }

      for (const agent of agents) {
        switch (agent) {
          case "pi": {
            const providerPath = path.join(targetDir, ".pi", "provider-capsule.json");
            const providerPayload = {
              sdk: "@earendil-works/pi-coding-agent",
              provider: "ctx-capsule-local",
              baseUrl,
              model: state.activeModelId,
              template: state.activeTemplateId,
              contextWindow: Number(resolved.ctx_size ?? 524288),
              compaction: "disabled_by_fuse8_capsules",
              headers,
              requestDefaults,
              cliArgs,
            };
            writtenFiles.push(
              await writeTextFile(providerPath, `${JSON.stringify(providerPayload, null, 2)}\n`),
            );

            const extPath = path.join(targetDir, ".pi", "extensions", "ctx-capsule.json");
            const extPayload = {
              name: "@r-irbe/ctx-capsule",
              entrypoint: "@r-irbe/ctx-capsule/pi-extension",
              enabled: true,
              options: {
                initialModelId: state.activeModelId,
                initialTemplateId: state.activeTemplateId,
              },
            };
            writtenFiles.push(
              await writeTextFile(extPath, `${JSON.stringify(extPayload, null, 2)}\n`),
            );
            break;
          }

          case "opencode": {
            const opencodePath = path.join(targetDir, "opencode.json");
            const existing = await readJsonFileIfExists(opencodePath);
            const existingProviders =
              existing.provider && typeof existing.provider === "object"
                ? (existing.provider as Record<string, unknown>)
                : {};
            const existingMcp =
              existing.mcp && typeof existing.mcp === "object"
                ? (existing.mcp as Record<string, unknown>)
                : {};

            const merged = {
              $schema: "https://opencode.ai/config.json",
              ...existing,
              provider: {
                ...existingProviders,
                ctx_capsule: {
                  npm: "@ai-sdk/openai-compatible",
                  options: {
                    baseURL: baseUrl,
                    headers,
                    body: requestDefaults,
                  },
                  models: {
                    [state.activeModelId]: {
                      name: state.activeModelId,
                      limit: {
                        context: Number(resolved.ctx_size ?? 524288),
                        output: 32768,
                      },
                    },
                  },
                },
              },
              mcp: {
                ...existingMcp,
                "ctx-capsule": {
                  type: "local",
                  command: ["ctx-capsule-mcp"],
                  enabled: true,
                },
              },
            };
            writtenFiles.push(
              await writeTextFile(opencodePath, `${JSON.stringify(merged, null, 2)}\n`),
            );
            break;
          }

          case "codex": {
            const codexPath = path.join(targetDir, ".codex", "config.toml");
            const codexToml = [
              "# Generated by @r-irbe/ctx-capsule multi-agent bootstrap",
              `model = "${state.activeModelId}"`,
              'model_provider = "ctx_capsule"',
              "",
              "[model_providers.ctx_capsule]",
              'name = "ctx-capsule Local llama-server Engine"',
              `base_url = "${baseUrl}"`,
              `http_headers = { "X-Llama-Cohort" = "${headers["X-Llama-Cohort"]}", "X-Llama-Capsule-Filter" = "${headers["X-Llama-Capsule-Filter"]}", "X-Evidence-Filter" = "${headers["X-Evidence-Filter"]}" }`,
              "",
              "[mcp_servers.ctx-capsule]",
              'command = "ctx-capsule-mcp"',
              "args = []",
              "",
            ].join("\n");
            writtenFiles.push(await writeTextFile(codexPath, codexToml));
            break;
          }

          case "copilot": {
            const copilotPath = path.join(targetDir, ".github", "copilot-capsule.json");
            const copilotPayload = {
              sdk: "@github/copilot-language-server",
              "github.copilot.advanced": {
                debug: {
                  overrideProxyUrl: baseUrl,
                  chatOverrideProxyUrl: `${baseUrl}/chat/completions`,
                },
                byokModel: state.activeModelId,
                extraHeaders: headers,
              },
              mcpServers: {
                "ctx-capsule": {
                  command: "ctx-capsule-mcp",
                  args: [],
                },
              },
            };
            writtenFiles.push(
              await writeTextFile(copilotPath, `${JSON.stringify(copilotPayload, null, 2)}\n`),
            );
            break;
          }

          case "weftd": {
            const weftPath = path.join(targetDir, ".weft", "capsule-bridge.json");
            const weftPayload = {
              daemon: "weftd",
              harness: "oh-my-agents",
              bridge: "@r-irbe/ctx-capsule",
              endpointUrl: baseUrl,
              modelId: state.activeModelId,
              templateId: state.activeTemplateId,
              headers,
              requestDefaults,
              mcpServer: {
                name: "ctx-capsule",
                command: "ctx-capsule-mcp",
                args: [],
              },
            };
            writtenFiles.push(
              await writeTextFile(weftPath, `${JSON.stringify(weftPayload, null, 2)}\n`),
            );
            break;
          }

          case "antigravity":
          case "claude":
          case "cursor":
            // Already handled by `.mcp.json` above
            break;
        }
      }

      return Object.freeze({
        targetDir,
        activeModelId: state.activeModelId,
        activeTemplateId: state.activeTemplateId,
        port: effectivePort,
        configuredAgents: Object.freeze([...agents]),
        writtenFiles: Object.freeze(writtenFiles),
      });
    },
    (err) =>
      DomainErrors.sdkIntegration(
        agents.join(","),
        err instanceof Error ? err.message : String(err),
      ),
  );
}
