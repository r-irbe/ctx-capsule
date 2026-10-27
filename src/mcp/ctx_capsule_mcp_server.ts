/**
 * Tier 2: Universal Zero-Dependency Stdio JSON-RPC 2.0 MCP Server (`src/mcp/ctx_capsule_mcp_server.ts`).
 *
 * Implements the Model Context Protocol (`initialize`, `notifications/initialized`,
 * `tools/list`, `tools/call`) over stdio or programmatic dispatch, exposing 5 tools:
 *   1. `capsule_status`
 *   2. `capsule_switch_preset`
 *   3. `capsule_pack_context`
 *   4. `capsule_sync_agents`
 *   5. `capsule_pto_tune`
 */

import * as readline from "node:readline";
import { packContextCapsules } from "../domain/evidence_packer.ts";
import { transition } from "../domain/reducer.ts";
import { Branded, DomainErrors } from "../domain/result.ts";
import { buildLlamaServerCliArgs, resolveHierarchicalSettings } from "../domain/toml_hierarchy.ts";
import type { CapsuleControlState, PtoMode } from "../domain/types.ts";
import { formatStatusBarLine } from "../integrations/pi_sdk_extension.ts";
import { createCapsuleHexagonalRuntime } from "../index.ts";
import type { SupportedAgentHarness } from "../ports/outbound.ts";

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export const CTX_CAPSULE_MCP_TOOLS: readonly McpToolDefinition[] = Object.freeze([
  {
    name: "capsule_status",
    description:
      "Returns active model, template preset, VRAM/RAM tier metrics, status bar line, and resolved llama-server CLI arguments.",
    inputSchema: {
      type: "object",
      properties: {
        probeLive: {
          type: "boolean",
          description: "Optionally probe live llama-server HTTP /health and GPU telemetry before returning.",
        },
      },
    },
  },
  {
    name: "capsule_switch_preset",
    description:
      "Switches active template preset (templateId) and/or model checkpoint (modelId) and returns the updated state and llama-server CLI flags.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "Template preset ID (e.g. ds41-1017-np1-512k-max-speed, coding_pinpoint, low_vram_1m)",
        },
        modelId: {
          type: "string",
          description: "Model ID (e.g. deepseek_v41_flash, qwen38_27b, glm_53_flash, leanstral_119b)",
        },
      },
    },
  },
  {
    name: "capsule_pack_context",
    description:
      "Computes deterministic 64-bit SimHash + Binary Fuse8 fingerprint deduplication and MaxSim token-overlap scoring (with identifier/symbol boost) over context chunks.",
    inputSchema: {
      type: "object",
      properties: {
        chunks: {
          oneOf: [
            { type: "array", items: { type: "string" } },
            { type: "string" },
          ],
          description: "Array of context chunk strings or a raw document string to partition and pack.",
        },
        query: {
          type: "string",
          description: "Optional query string for MaxSim token-overlap and code symbol scoring.",
        },
        keepRatio: {
          type: "number",
          description: "Fraction of chunks to retain (0.05..1.0, default 0.25).",
        },
        symbolBoost: {
          type: "number",
          description: "Boost multiplier for code identifiers and symbols (default 3.5).",
        },
      },
      required: ["chunks"],
    },
  },
  {
    name: "capsule_sync_agents",
    description:
      "Synchronizes coding agent SDK configurations for any subset of [pi, antigravity, opencode, claude, google_adk, codex, copilot, weftd].",
    inputSchema: {
      type: "object",
      properties: {
        harnesses: {
          type: "array",
          items: {
            type: "string",
            enum: ["pi", "antigravity", "opencode", "claude", "google_adk", "codex", "copilot", "weftd"],
          },
          description: "Subset of agent harnesses to synchronize (defaults to all 8).",
        },
        outputDir: {
          type: "string",
          description: "Optional directory to write generated agent configuration files.",
        },
      },
    },
  },
  {
    name: "capsule_pto_tune",
    description:
      "Runs Clang-21 IRPGO + ThinLTO + Machine Function Splitting Profile-Targeted Optimization (dry_run or live) and returns the optimization receipt.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["irpgo_thinlto_split", "cs_irpgo_2stage", "continuous_live_server"],
          description: "PTO optimization mode (default irpgo_thinlto_split).",
        },
        executionMode: {
          type: "string",
          enum: ["dry_run", "live"],
          description: "Execution mode: dry_run (default) or live.",
        },
      },
    },
  },
]);

export interface CtxCapsuleMcpServerOptions {
  readonly workspaceRoot?: string;
  readonly sdkOutputDir?: string | null;
  readonly processMode?: "dry_run" | "live";
}

export class CtxCapsuleMcpServer {
  private readonly workspaceRoot: string;
  private readonly runtime: ReturnType<typeof createCapsuleHexagonalRuntime>;
  private state: CapsuleControlState;

  constructor(options?: CtxCapsuleMcpServerOptions) {
    this.workspaceRoot = options?.workspaceRoot ?? process.cwd();
    this.runtime = createCapsuleHexagonalRuntime({
      workspaceRoot: this.workspaceRoot,
      sdkOutputDir: options?.sdkOutputDir ?? null,
      processMode: options?.processMode ?? "dry_run",
    });
    this.state = this.runtime.initialState;
  }

  getState(): CapsuleControlState {
    return this.state;
  }

  private buildStatusSummary(): Record<string, unknown> {
    const resolved = resolveHierarchicalSettings(this.state);
    const activeModel =
      this.state.models.find((m) => m.id === this.state.activeModelId) ?? this.state.models[0];
    const activeInst =
      this.state.instances.find((i) => i.id === this.state.activeInstanceId) ??
      this.state.instances[0];
    const cliArgs = buildLlamaServerCliArgs(activeModel, activeInst, resolved);

    return {
      activeModelId: this.state.activeModelId,
      activeModelDisplayName: activeModel.displayName,
      activeTemplateId: this.state.activeTemplateId,
      activeHardwareProfileId: this.state.activeHardwareProfileId,
      activeInstanceId: this.state.activeInstanceId,
      statusBarLine: formatStatusBarLine(this.state),
      metrics: this.state.metrics,
      systemTelemetry: this.state.systemTelemetry,
      resolvedSettings: resolved,
      cliArgs,
    };
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean; structured?: unknown }> {
    switch (name) {
      case "capsule_status": {
        if (args.probeLive === true) {
          const activeInst =
            this.state.instances.find((i) => i.id === this.state.activeInstanceId) ??
            this.state.instances[0];
          const probeRes = await this.runtime.liveTelemetry.probeSystemTelemetry(
            activeInst.host,
            activeInst.port,
            activeInst.pid,
          );
          if (probeRes.isOk()) {
            const tr = transition(this.state, {
              _tag: "IngestLiveTelemetry",
              telemetry: probeRes.value,
            });
            if (tr.isOk()) {
              this.state = tr.value.state;
            }
          }
        }
        const statusObj = this.buildStatusSummary();
        return {
          content: [{ type: "text", text: JSON.stringify(statusObj, null, 2) }],
          structured: statusObj,
        };
      }

      case "capsule_switch_preset": {
        const modelId = typeof args.modelId === "string" ? args.modelId.trim() : "";
        const templateId = typeof args.templateId === "string" ? args.templateId.trim() : "";

        if (!modelId && !templateId) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Expected at least one of modelId or templateId in capsule_switch_preset",
              },
            ],
          };
        }

        if (modelId) {
          const res = transition(this.state, {
            _tag: "SwitchActiveModel",
            modelId: Branded.unsafeModelId(modelId),
          });
          if (res.isErr()) {
            return {
              isError: true,
              content: [{ type: "text", text: DomainErrors.format(res.error) }],
            };
          }
          this.state = res.value.state;
          await this.runtime.interpreter.interpretEffects(res.value.effects, this.state);
        }

        if (templateId) {
          const res = transition(this.state, {
            _tag: "ApplyTemplate",
            templateId: Branded.unsafeTemplateId(templateId),
          });
          if (res.isErr()) {
            return {
              isError: true,
              content: [{ type: "text", text: DomainErrors.format(res.error) }],
            };
          }
          this.state = res.value.state;
          await this.runtime.interpreter.interpretEffects(res.value.effects, this.state);
        }

        const updated = this.buildStatusSummary();
        return {
          content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
          structured: updated,
        };
      }

      case "capsule_pack_context": {
        const rawChunks = (args.chunks as readonly string[] | string | undefined) ?? [];
        const query = typeof args.query === "string" ? args.query : undefined;
        const keepRatio = typeof args.keepRatio === "number" ? args.keepRatio : undefined;
        const symbolBoost = typeof args.symbolBoost === "number" ? args.symbolBoost : undefined;

        const packed = packContextCapsules({
          chunks: rawChunks,
          query,
          keepRatio,
          symbolBoost,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(packed, null, 2) }],
          structured: packed,
        };
      }

      case "capsule_sync_agents": {
        const defaultHarnesses: readonly SupportedAgentHarness[] = [
          "pi",
          "antigravity",
          "opencode",
          "claude",
          "google_adk",
          "codex",
          "copilot",
          "weftd",
        ];
        const requested = Array.isArray(args.harnesses)
          ? (args.harnesses.map(String) as SupportedAgentHarness[])
          : defaultHarnesses;

        const activeInst =
          this.state.instances.find((i) => i.id === this.state.activeInstanceId) ??
          this.state.instances[0];
        const resolved = resolveHierarchicalSettings(this.state);

        const adapter =
          typeof args.outputDir === "string"
            ? new (this.runtime.agentSdks.constructor as typeof import("../adapters/agent_sdk_adapter.ts").MultiAgentSdkBridgeAdapter)({
                outputDir: args.outputDir,
              })
            : this.runtime.agentSdks;

        const syncRes = await adapter.syncHarnesses(requested, activeInst, resolved);
        if (syncRes.isErr()) {
          return {
            isError: true,
            content: [{ type: "text", text: DomainErrors.format(syncRes.error) }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(syncRes.value, null, 2) }],
          structured: syncRes.value,
        };
      }

      case "capsule_pto_tune": {
        const mode = (typeof args.mode === "string" ? args.mode : "irpgo_thinlto_split") as PtoMode;
        const tr = transition(this.state, {
          _tag: "TriggerPtoTraceAndOptimize",
          mode,
        });
        if (tr.isErr()) {
          return {
            isError: true,
            content: [{ type: "text", text: DomainErrors.format(tr.error) }],
          };
        }
        this.state = tr.value.state;
        const execRes = await this.runtime.interpreter.interpretEffects(
          tr.value.effects,
          this.state,
        );
        if (execRes.isErr()) {
          return {
            isError: true,
            content: [{ type: "text", text: DomainErrors.format(execRes.error) }],
          };
        }

        const ptoReceipts = this.runtime.ptoAdapter.getReceiptsHistory();
        const latestReceipt = ptoReceipts[ptoReceipts.length - 1] ?? null;
        const payload = {
          statusBarLine: formatStatusBarLine(this.state),
          activeInstance:
            this.state.instances.find((i) => i.id === this.state.activeInstanceId) ??
            this.state.instances[0],
          ptoReceipt: latestReceipt,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structured: payload,
        };
      }

      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown MCP tool: ${name}` }],
        };
    }
  }

  async handleJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const reqId = request.id ?? null;

    if (request.method === "notifications/initialized" || request.method.startsWith("notifications/")) {
      return null;
    }

    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: reqId,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "@r-irbe/ctx-capsule",
            version: "0.2.0",
          },
        },
      };
    }

    if (request.method === "ping") {
      return {
        jsonrpc: "2.0",
        id: reqId,
        result: {},
      };
    }

    if (request.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: reqId,
        result: {
          tools: CTX_CAPSULE_MCP_TOOLS,
        },
      };
    }

    if (request.method === "tools/call") {
      const params = request.params ?? {};
      const toolName = typeof params.name === "string" ? params.name : "";
      const toolArgs =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};

      const res = await this.callTool(toolName, toolArgs);
      return {
        jsonrpc: "2.0",
        id: reqId,
        result: {
          content: res.content,
          isError: res.isError ?? false,
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id: reqId,
      error: {
        code: -32601,
        message: `Method not found: ${request.method}`,
      },
    };
  }
}

export function startStdioMcpServer(options?: CtxCapsuleMcpServerOptions): CtxCapsuleMcpServer {
  const server = new CtxCapsuleMcpServer(options);
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    void (async () => {
      try {
        const parsed = JSON.parse(trimmed) as JsonRpcRequest;
        const response = await server.handleJsonRpcRequest(parsed);
        if (response !== null) {
          process.stdout.write(`${JSON.stringify(response)}\n`);
        }
      } catch (err) {
        const errResp: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: err instanceof Error ? err.message : "Parse error",
          },
        };
        process.stdout.write(`${JSON.stringify(errResp)}\n`);
      }
    })();
  });

  return server;
}
