/**
 * Outbound Adapter: Multi-Agent SDK Bridge (`AgentSdkBridgePort`).
 *
 * Synchronizes active `llama-server` endpoint, model ID, cohort prefix header
 * (`X-Llama-Cohort`), and Binary Fuse8/16 context capsule headers across all 7
 * coding agent harnesses:
 *   1. `pi`          -> `@earendil-works/pi-coding-agent` (`pi-provider.json`)
 *   2. `antigravity` -> Antigravity CLI MCP & OpenAI provider (`.mcp.json`)
 *   3. `opencode`    -> OpenCode (`opencode.json`)
 *   4. `claude`      -> Claude Code / `@anthropic-ai/sdk` (`claude-sdk-bridge.json`)
 *   5. `google_adk`  -> Google ADK / `@google/genai` (`google-genai-bridge.json`)
 *   6. `codex`       -> OpenAI Codex CLI (`codex-config.toml`)
 *   7. `copilot`     -> GitHub Copilot (`copilot-byok.json`)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DomainErrors, type DomainError, Result } from "../domain/result.ts";
import type { LlamaInstanceSpec } from "../domain/types.ts";
import type {
  AgentSdkBridgePort,
  AgentSdkSyncArtifact,
  AgentSdkSyncReceipt,
  SupportedAgentHarness,
} from "../ports/outbound.ts";

export interface AgentSdkAdapterOptions {
  readonly outputDir?: string | null;
}

export class MultiAgentSdkBridgeAdapter implements AgentSdkBridgePort {
  private readonly outputDir: string | null;

  constructor(options?: AgentSdkAdapterOptions) {
    this.outputDir = options?.outputDir ?? null;
    Object.freeze(this);
  }

  private buildArtifact(
    harness: SupportedAgentHarness,
    activeInstance: LlamaInstanceSpec,
    resolvedSettings: Readonly<Record<string, string>>,
  ): AgentSdkSyncArtifact {
    const baseUrl = `http://${activeInstance.host}:${activeInstance.port}/v1`;
    const evidenceFilterEnabled =
      (resolvedSettings.capsule_filter ?? "fuse8_simhash64") !== "disabled";
    const evidenceStrategy = resolvedSettings.evidence_strategy ?? "maxsim_exact_cover";
    const evidenceKeep = resolvedSettings.evidence_keep_ratio ?? "20%";
    const thinkingEffort = resolvedSettings.thinking_effort ?? "max_deep_think";
    const reasoningBudget =
      thinkingEffort === "off"
        ? 0
        : thinkingEffort === "fast_direct"
          ? 2048
          : thinkingEffort === "balanced"
            ? 8192
            : thinkingEffort === "high_analytical"
              ? 16384
              : -1;

    const commonHeaders: Readonly<Record<string, string>> = Object.freeze({
      "X-Llama-Cohort": `cohort-${activeInstance.modelId}-${activeInstance.templateId}`,
      "X-Llama-Capsule-Filter": resolvedSettings.capsule_filter ?? "fuse8_simhash64",
      "X-Llama-Evidence-Strategy": evidenceStrategy,
      "X-Llama-Evidence-Keep": evidenceKeep,
      "X-Llama-Engine-Flavor": activeInstance.engineFlavor,
      "X-Evidence-Filter": evidenceFilterEnabled ? "true" : "false",
      "X-Evidence-Strategy": evidenceStrategy,
      "X-Evidence-Top-K": "20",
      "X-Evidence-Chunk-Tokens": "128",
      "X-Evidence-Symbol-Boost": "0.15",
      "X-Evidence-Chunk-Expansion": "true",
      "X-Llama-Thinking-Effort": thinkingEffort,
    });

    const evidenceCapsuleConfig = Object.freeze({
      enabled: evidenceFilterEnabled,
      strategy: evidenceStrategy,
      chunk_tokens: 128,
      top_k: 20,
      symbol_boost: 0.15,
      chunk_expansion: true,
      capsule_filter: resolvedSettings.capsule_filter ?? "fuse8_simhash64",
    });

    const requestDefaults = Object.freeze({
      evidence_filter: evidenceFilterEnabled,
      evidence_strategy: evidenceStrategy,
      evidence_chunk_tokens: 128,
      evidence_top_k: 20,
      evidence_symbol_boost: 0.15,
      evidence_chunk_expansion: true,
      thinking_effort: thinkingEffort,
      reasoning_budget: reasoningBudget,
      evidence_capsule: evidenceCapsuleConfig,
    });

    switch (harness) {
      case "pi": {
        const payload = JSON.stringify(
          {
            sdk: "@earendil-works/pi-coding-agent",
            provider: "ik-llama-local",
            baseUrl,
            model: activeInstance.modelId,
            template: activeInstance.templateId,
            contextWindow: Number(resolvedSettings.ctx_size ?? 524288),
            compaction: "disabled_by_fuse8_capsules",
            headers: commonHeaders,
            requestDefaults,
            ...requestDefaults,
          },
          null,
          2,
        );
        return Object.freeze({
          harness: "pi",
          sdkPackageName: "@earendil-works/pi-coding-agent",
          configFilePath: "pi-provider.json",
          endpointUrl: baseUrl,
          modelId: activeInstance.modelId,
          headers: commonHeaders,
          payloadPreview: payload,
        });
      }

      case "antigravity": {
        const payload = JSON.stringify(
          {
            sdk: "antigravity-cli-mcp",
            mcpServers: {
              "ik-llama-capsule": {
                endpoint: baseUrl,
                model: activeInstance.modelId,
                headers: commonHeaders,
                requestDefaults,
              },
            },
          },
          null,
          2,
        );
        return Object.freeze({
          harness: "antigravity",
          sdkPackageName: "@google-deepmind/antigravity-mcp",
          configFilePath: ".mcp.json",
          endpointUrl: baseUrl,
          modelId: activeInstance.modelId,
          headers: commonHeaders,
          payloadPreview: payload,
        });
      }

      case "opencode": {
        const payload = JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            provider: {
              ik_llama: {
                npm: "@ai-sdk/openai-compatible",
                options: {
                  baseURL: baseUrl,
                  headers: commonHeaders,
                  body: requestDefaults,
                },
                models: {
                  [activeInstance.modelId]: {
                    name: activeInstance.modelId,
                    limit: {
                      context: Number(resolvedSettings.ctx_size ?? 524288),
                      output: 32768,
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        );
        return Object.freeze({
          harness: "opencode",
          sdkPackageName: "@opencode-ai/sdk",
          configFilePath: "opencode.json",
          endpointUrl: baseUrl,
          modelId: activeInstance.modelId,
          headers: commonHeaders,
          payloadPreview: payload,
        });
      }

      case "claude": {
        const payload = JSON.stringify(
          {
            sdk: "@anthropic-ai/sdk",
            anthropicBaseUrl: `http://${activeInstance.host}:${activeInstance.port}`,
            defaultModel: activeInstance.modelId,
            defaultHeaders: commonHeaders,
            defaultBody: requestDefaults,
          },
          null,
          2,
        );
        return Object.freeze({
          harness: "claude",
          sdkPackageName: "@anthropic-ai/sdk",
          configFilePath: "claude-sdk-bridge.json",
          endpointUrl: baseUrl,
          modelId: activeInstance.modelId,
          headers: commonHeaders,
          payloadPreview: payload,
        });
      }

      case "google_adk": {
        const payload = JSON.stringify(
          {
            sdk: "@google/genai",
            vertexai: false,
            httpOptions: {
              baseUrl,
              headers: commonHeaders,
            },
            model: activeInstance.modelId,
          },
          null,
          2,
        );
        return Object.freeze({
          harness: "google_adk",
          sdkPackageName: "@google/genai",
          configFilePath: "google-genai-bridge.json",
          endpointUrl: baseUrl,
          modelId: activeInstance.modelId,
          headers: commonHeaders,
          payloadPreview: payload,
        });
      }

      case "codex": {
        const payload = [
          "# OpenAI Codex CLI Local Provider Bridge",
          `model = "${activeInstance.modelId}"`,
          'model_provider = "ik_llama"',
          "",
          "[model_providers.ik_llama]",
          'name = "ik_llama.cpp Local Capsule Engine"',
          `base_url = "${baseUrl}"`,
          `http_headers = { "X-Llama-Cohort" = "${commonHeaders["X-Llama-Cohort"]}", "X-Llama-Capsule-Filter" = "${commonHeaders["X-Llama-Capsule-Filter"]}" }`,
          "",
        ].join("\n");
        return Object.freeze({
          harness: "codex",
          sdkPackageName: "@openai/codex-sdk",
          configFilePath: "codex-config.toml",
          endpointUrl: baseUrl,
          modelId: activeInstance.modelId,
          headers: commonHeaders,
          payloadPreview: payload,
        });
      }

      case "copilot": {
        const payload = JSON.stringify(
          {
            sdk: "@github/copilot-language-server",
            "github.copilot.advanced": {
              debug: {
                overrideProxyUrl: baseUrl,
                chatOverrideProxyUrl: `${baseUrl}/chat/completions`,
              },
              byokModel: activeInstance.modelId,
              extraHeaders: commonHeaders,
            },
          },
          null,
          2,
        );
        return Object.freeze({
          harness: "copilot",
          sdkPackageName: "@github/copilot-sdk",
          configFilePath: "copilot-byok.json",
          endpointUrl: baseUrl,
          modelId: activeInstance.modelId,
          headers: commonHeaders,
          payloadPreview: payload,
        });
      }

      case "weftd": {
        const payload = JSON.stringify(
          {
            sdk: "oh-my-agents-weftd",
            daemon: "weftd",
            bridge: "ctx-capsule",
            endpoint: baseUrl,
            model: activeInstance.modelId,
            template: activeInstance.templateId,
            headers: commonHeaders,
            requestDefaults,
          },
          null,
          2,
        );
        return Object.freeze({
          harness: "weftd",
          sdkPackageName: "oh-my-agents",
          configFilePath: "weft-capsule-bridge.json",
          endpointUrl: baseUrl,
          modelId: activeInstance.modelId,
          headers: commonHeaders,
          payloadPreview: payload,
        });
      }
    }
  }

  async syncHarnesses(
    harnesses: readonly SupportedAgentHarness[],
    activeInstance: LlamaInstanceSpec,
    resolvedSettings: Readonly<Record<string, string>>,
  ): Promise<Result<AgentSdkSyncReceipt, DomainError>> {
    return Result.tryCatchAsync(
      async () => {
        const artifacts: AgentSdkSyncArtifact[] = [];
        for (const h of harnesses) {
          const artifact = this.buildArtifact(h, activeInstance, resolvedSettings);
          artifacts.push(artifact);

          if (this.outputDir) {
            const fullPath = path.join(this.outputDir, artifact.configFilePath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, artifact.payloadPreview, "utf8");
          }
        }

        return Object.freeze({
          syncedHarnesses: Object.freeze([...harnesses]),
          artifacts: Object.freeze(artifacts),
          outputDir: this.outputDir ?? "in-memory",
        });
      },
      (err) =>
        DomainErrors.sdkIntegration(
          harnesses.join(","),
          err instanceof Error ? err.message : String(err),
        ),
    );
  }
}
