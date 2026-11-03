/**
 * Tier 1: Native `@earendil-works/pi-coding-agent` Extension (`src/integrations/pi_sdk_extension.ts`).
 *
 * Registers:
 *   1. `/capsule` slash command (`status`, `preset <id>`, `model <id>`, `sync`, `pto`, `tui`, `tune`, `launch`, `stop`, `help`).
 *      - When invoked as bare `/capsule` or `/capsule tui` inside Pi's interactive TUI (`ctx.ui.custom`),
 *        mounts `CapsulePiTuiComponent` as a real interactive `@earendil-works/pi-tui` overlay modal (`{ overlay: true }`)
 *        with live 2.5s hardware/server telemetry polling.
 *   2. `ctx_capsule` tool for agent-invoked status inspection, preset/model switching, and SimHash64/MaxSim context packing.
 *   3. `before_model_request`, `session_start`, and `turn_start` lifecycle hooks that inject:
 *      - `X-Llama-Cohort`
 *      - `X-Llama-Capsule-Filter`
 *      - `X-Evidence-Filter`
 *      - `X-Evidence-Strategy`
 *      - `X-Evidence-Top-K`
 *      - `X-Evidence-Symbol-Boost`
 *      - `X-Evidence-Chunk-Expansion`
 *      - `X-Llama-Thinking-Effort`
 *      plus `requestDefaults` and suppress lossy chat compaction when Binary Fuse8/16 capsules are active.
 *   4. `getStatusBarWidget()` and `formatStatusBarLine(state)` for the Pi TUI status bar.
 */

import {
  CapsulePiTuiComponent,
  renderCompactCapsuleStatusCard,
} from "../adapters/pi_tui_adapter.ts";
import { packContextCapsules } from "../domain/evidence_packer.ts";
import { createInitialControlState, transition } from "../domain/reducer.ts";
import { Branded, DomainErrors } from "../domain/result.ts";
import { buildLlamaServerCliArgs, resolveHierarchicalSettings } from "../domain/toml_hierarchy.ts";
import {
  type CapsuleControlState,
  type PtoMode,
  SETTINGS_SCHEMA,
} from "../domain/types.ts";
import { CAPSULE_CLI_HELP, createCapsuleHexagonalRuntime, runCapsuleCli } from "../index.ts";

export const CAPSULE_PI_SUBCOMMANDS = [
  "status",
  "preset",
  "model",
  "sync",
  "pto",
  "tui",
  "tune",
  "launch",
  "stop",
  "export-toml",
  "telemetry",
  "help",
] as const;

export interface CapsuleModelRequestEnvelope {
  headers?: Record<string, string>;
  requestDefaults?: Record<string, unknown>;
  compaction?: string | { enabled: boolean; reason?: string };
  suppressCompaction?: boolean;
  body?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CapsulePiUiCustomComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
  dispose?(): void;
}

export interface CapsulePiExtensionContext {
  readonly cwd: string;
  readonly mode?: "tui" | "rpc" | "print";
  readonly hasUI?: boolean;
  readonly ui?: {
    notify(message: string, level?: "info" | "warning" | "error"): void;
    setStatus?(key: string, text: string | undefined): void;
    custom?<T>(
      factory: (
        tui: { requestRender(): void },
        theme: unknown,
        keybindings: unknown,
        done: (result: T) => void,
      ) => CapsulePiUiCustomComponent | Promise<CapsulePiUiCustomComponent>,
      options?: {
        overlay?: boolean;
        overlayOptions?: Record<string, unknown>;
      },
    ): Promise<T>;
  };
}

export interface CapsulePiHostApi {
  on(
    eventName: string,
    handler: (
      event: Record<string, unknown>,
      ctx: CapsulePiExtensionContext,
    ) => Promise<unknown> | unknown,
  ): void;
  registerCommand(
    name: string,
    spec: {
      description: string;
      getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }>;
      handler: (args: string, ctx: CapsulePiExtensionContext) => Promise<void>;
    },
  ): void;
  registerTool(spec: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    parameters?: Record<string, unknown>;
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: CapsulePiExtensionContext,
    ) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      details?: Record<string, unknown>;
    }>;
  }): void;
}

export interface CapsulePiExtensionOptions {
  readonly workspaceRoot?: string;
  readonly initialModelId?: string;
  readonly initialTemplateId?: string;
  readonly processMode?: "dry_run" | "live";
}

export function formatStatusBarLine(state: CapsuleControlState): string {
  const resolved = resolveHierarchicalSettings(state);
  const capsuleFilter = resolved.capsule_filter ?? "fuse8_simhash64";
  const evStrategy = resolved.evidence_strategy ?? "maxsim_exact_cover";
  const ctxK = Math.round(Number(resolved.ctx_size ?? 524288) / 1024);
  const effort = resolved.thinking_effort ?? "max_deep_think";
  return `ctx-capsule: ${state.activeModelId} | ${state.activeTemplateId} | ${ctxK}K | ${capsuleFilter} (${evStrategy}) | ${effort}`;
}

export function buildCapsuleRequestHeaders(
  state: CapsuleControlState,
): Readonly<Record<string, string>> {
  const resolved = resolveHierarchicalSettings(state);
  const activeInst =
    state.instances.find((i) => i.id === state.activeInstanceId) ?? state.instances[0];
  const capsuleFilter = resolved.capsule_filter ?? "fuse8_simhash64";
  const evStrategy = resolved.evidence_strategy ?? "maxsim_exact_cover";
  const evidenceFilterEnabled = capsuleFilter !== "none" && evStrategy !== "off";
  const thinkingEffort = resolved.thinking_effort ?? "max_deep_think";

  return Object.freeze({
    "X-Llama-Cohort": `cohort-${state.activeModelId}-${state.activeTemplateId}`,
    "X-Llama-Capsule-Filter": capsuleFilter,
    "X-Evidence-Filter": evidenceFilterEnabled ? "true" : "false",
    "X-Evidence-Strategy": evStrategy,
    "X-Evidence-Top-K": resolved.evidence_top_k ?? "16",
    "X-Evidence-Symbol-Boost": resolved.evidence_symbol_boost ?? "3.5",
    "X-Evidence-Chunk-Expansion": resolved.evidence_chunk_expansion ?? "1",
    "X-Llama-Thinking-Effort": thinkingEffort,
    "X-Llama-Engine-Flavor": activeInst.engineFlavor,
  });
}

export function buildCapsuleRequestDefaults(
  state: CapsuleControlState,
): Readonly<Record<string, unknown>> {
  const resolved = resolveHierarchicalSettings(state);
  const capsuleFilter = resolved.capsule_filter ?? "fuse8_simhash64";
  const evStrategy = resolved.evidence_strategy ?? "maxsim_exact_cover";
  const evidenceFilterEnabled = capsuleFilter !== "none" && evStrategy !== "off";
  const thinkingEffort = resolved.thinking_effort ?? "max_deep_think";
  const reasoningBudgetByEffort: Readonly<Record<string, number>> = {
    max_deep_think: -1,
    high_analytical: 16384,
    balanced: 4096,
    fast_direct: 0,
  };

  return Object.freeze({
    evidence_filter: evidenceFilterEnabled,
    evidence_strategy: evStrategy,
    evidence_chunk_tokens: Number(resolved.evidence_chunk_tokens ?? 140),
    evidence_top_k: Number(resolved.evidence_top_k ?? 16),
    evidence_symbol_boost: Number(resolved.evidence_symbol_boost ?? 3.5),
    evidence_chunk_expansion: Number(resolved.evidence_chunk_expansion ?? 1),
    capsule_filter: capsuleFilter,
    thinking_effort: thinkingEffort,
    reasoning_budget: reasoningBudgetByEffort[thinkingEffort] ?? -1,
  });
}

export interface CapsulePiExtensionController {
  getState(): CapsuleControlState;
  getStatusBarWidget(): {
    readonly id: string;
    readonly text: string;
    readonly modelId: string;
    readonly templateId: string;
    readonly capsuleFilter: string;
    readonly compactionSuppressed: boolean;
  };
  formatStatusBarLine(state?: CapsuleControlState): string;
  getActiveHeaders(): Readonly<Record<string, string>>;
  getActiveRequestDefaults(): Readonly<Record<string, unknown>>;
  getResolvedCliArgs(): readonly string[];
  switchModel(modelId: string): Promise<CapsuleControlState>;
  switchPreset(templateId: string): Promise<CapsuleControlState>;
  syncAgents(): Promise<CapsuleControlState>;
  runPto(mode?: PtoMode): Promise<CapsuleControlState>;
  register(pi: CapsulePiHostApi): void;
}

export function createCapsulePiExtension(
  options?: CapsulePiExtensionOptions,
): CapsulePiExtensionController {
  const runtime = createCapsuleHexagonalRuntime({
    workspaceRoot: options?.workspaceRoot ?? process.cwd(),
    processMode: options?.processMode ?? "live",
  });

  let currentState = runtime.initialState;
  if (options?.initialModelId) {
    const res = transition(currentState, {
      _tag: "SwitchActiveModel",
      modelId: Branded.unsafeModelId(options.initialModelId),
    });
    if (res.isOk()) {
      currentState = res.value.state;
    }
  }
  if (options?.initialTemplateId) {
    const res = transition(currentState, {
      _tag: "ApplyTemplate",
      templateId: Branded.unsafeTemplateId(options.initialTemplateId),
    });
    if (res.isOk()) {
      currentState = res.value.state;
    }
  }

  const applyDomainCommand = async (
    cmd: Parameters<typeof transition>[1],
  ): Promise<CapsuleControlState> => {
    const res = transition(currentState, cmd);
    if (res.isErr()) {
      throw new Error(DomainErrors.format(res.error));
    }
    currentState = res.value.state;
    if (res.value.effects.length > 0) {
      await runtime.interpreter.interpretEffects(res.value.effects, currentState);
    }
    return currentState;
  };

  const probeLiveTelemetry = async (): Promise<void> => {
    const activeInst =
      currentState.instances.find((i) => i.id === currentState.activeInstanceId) ??
      currentState.instances[0];
    const probeRes = await runtime.liveTelemetry.probeSystemTelemetry(
      activeInst.host,
      activeInst.port,
      activeInst.pid,
    );
    if (probeRes.isOk()) {
      const next = transition(currentState, {
        _tag: "IngestLiveTelemetry",
        telemetry: probeRes.value,
      });
      if (next.isOk()) {
        currentState = next.value.state;
      }
    }
  };

  const mountInteractiveOverlay = async (
    ctx: CapsulePiExtensionContext,
  ): Promise<boolean> => {
    if (!ctx.hasUI || !ctx.ui?.custom) {
      return false;
    }
    const updatedState = await ctx.ui.custom<CapsuleControlState>(
      (tui, _theme, _kb, done) => {
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        const comp = new CapsulePiTuiComponent({
          initialState: currentState,
          interpreter: runtime.interpreter,
          telemetry: runtime.telemetry,
          onRequestRender: () => {
            tui.requestRender();
          },
          onQuit: () => {
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            done(comp.getState());
          },
        });

        const probeOnce = async (): Promise<void> => {
          const st = comp.getState();
          const inst =
            st.instances.find((i) => i.id === st.activeInstanceId) ?? st.instances[0];
          const res = await runtime.liveTelemetry.probeSystemTelemetry(
            inst.host,
            inst.port,
            inst.pid,
          );
          if (res.isOk()) {
            comp.dispatchCommand({
              _tag: "IngestLiveTelemetry",
              telemetry: res.value,
            });
          }
        };

        void probeOnce();
        pollTimer = setInterval(() => {
          void probeOnce();
        }, 2500);

        return {
          render: (w: number) => comp.render(w),
          handleInput: (data: string) => comp.handleInput(data),
          invalidate: () => comp.invalidate(),
          dispose: () => {
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          },
        };
      },
      { overlay: true },
    );

    if (updatedState) {
      currentState = updatedState;
    }
    return true;
  };

  const controller: CapsulePiExtensionController = {
    getState: () => currentState,
    formatStatusBarLine: (state = currentState) => formatStatusBarLine(state),
    getStatusBarWidget: () => {
      const resolved = resolveHierarchicalSettings(currentState);
      const capsuleFilter = resolved.capsule_filter ?? "fuse8_simhash64";
      return Object.freeze({
        id: "ctx-capsule",
        text: formatStatusBarLine(currentState),
        modelId: currentState.activeModelId,
        templateId: currentState.activeTemplateId,
        capsuleFilter,
        compactionSuppressed: capsuleFilter !== "none",
      });
    },
    getActiveHeaders: () => buildCapsuleRequestHeaders(currentState),
    getActiveRequestDefaults: () => buildCapsuleRequestDefaults(currentState),
    getResolvedCliArgs: () => {
      const model =
        currentState.models.find((m) => m.id === currentState.activeModelId) ??
        currentState.models[0];
      const inst =
        currentState.instances.find((i) => i.id === currentState.activeInstanceId) ??
        currentState.instances[0];
      return buildLlamaServerCliArgs(model, inst, resolveHierarchicalSettings(currentState));
    },
    switchModel: (modelId: string) =>
      applyDomainCommand({
        _tag: "SwitchActiveModel",
        modelId: Branded.unsafeModelId(modelId),
      }),
    switchPreset: (templateId: string) =>
      applyDomainCommand({
        _tag: "ApplyTemplate",
        templateId: Branded.unsafeTemplateId(templateId),
      }),
    syncAgents: () => applyDomainCommand({ _tag: "SyncAllAgentSdks" }),
    runPto: (mode?: PtoMode) =>
      applyDomainCommand({
        _tag: "TriggerPtoTraceAndOptimize",
        mode,
      }),
    register: (pi: CapsulePiHostApi) => {
      const updateUiStatus = (ctx?: CapsulePiExtensionContext): void => {
        if (ctx?.hasUI && ctx.ui?.setStatus) {
          ctx.ui.setStatus("ctx-capsule", formatStatusBarLine(currentState));
        }
      };

      pi.on("session_start", async (_event, ctx) => {
        const savedRes = await runtime.tomlRepo.loadSavedTemplates(currentState.hierarchyRootDir);
        if (savedRes.isOk() && savedRes.value.length > 0) {
          const existingIds = new Set(currentState.templates.map((t) => t.id));
          const merged = [
            ...currentState.templates,
            ...savedRes.value.filter((t) => !existingIds.has(t.id)),
          ];
          currentState = Object.freeze({
            ...currentState,
            templates: Object.freeze(merged),
          });
        }
        updateUiStatus(ctx);
      });

      pi.on("turn_start", async (_event, ctx) => {
        updateUiStatus(ctx);
      });

      pi.on("before_model_request", async (event, ctx) => {
        const req = event as CapsuleModelRequestEnvelope;
        const headers = buildCapsuleRequestHeaders(currentState);
        const requestDefaults = buildCapsuleRequestDefaults(currentState);
        const resolved = resolveHierarchicalSettings(currentState);
        const fuseActive = (resolved.capsule_filter ?? "fuse8_simhash64") !== "none";

        req.headers = {
          ...(req.headers ?? {}),
          ...headers,
        };
        req.requestDefaults = {
          ...(req.requestDefaults ?? {}),
          ...requestDefaults,
        };
        if (req.body && typeof req.body === "object") {
          Object.assign(req.body, requestDefaults);
        }
        if (fuseActive) {
          req.suppressCompaction = true;
          req.compaction = "disabled_by_fuse8_capsules";
        }
        updateUiStatus(ctx);
        return {
          headers: req.headers,
          requestDefaults: req.requestDefaults,
          suppressCompaction: fuseActive,
          compaction: fuseActive ? "disabled_by_fuse8_capsules" : req.compaction,
        };
      });

      pi.registerCommand("capsule", {
        description:
          "ctx-capsule control plane: status | tui | launch | stop | preset <id> | model <id> | tune | pto | sync | help",
        getArgumentCompletions: (prefix: string) =>
          CAPSULE_PI_SUBCOMMANDS.filter((name) => name.startsWith(prefix)).map((name) => ({
            value: name,
            label: name,
          })),
        handler: async (args, ctx) => {
          const trimmed = args.trim();
          const tokens = trimmed ? trimmed.split(/\s+/) : [];
          const sub = tokens[0] ?? "";

          if (sub === "help" || sub === "--help" || sub === "-h") {
            if (ctx.hasUI && ctx.ui) ctx.ui.notify(CAPSULE_CLI_HELP, "info");
            return;
          }

          // Bare `/capsule` or `/capsule tui` mounts the interactive @earendil-works/pi-tui overlay modal
          if (sub === "" || sub === "tui") {
            const mounted = await mountInteractiveOverlay(ctx);
            updateUiStatus(ctx);
            if (mounted) {
              if (ctx.hasUI && ctx.ui) {
                ctx.ui.notify(renderCompactCapsuleStatusCard(currentState), "info");
              }
              return;
            }
          }

          try {
            if (sub === "status" || sub === "") {
              await probeLiveTelemetry();
              updateUiStatus(ctx);
              if (ctx.hasUI && ctx.ui) {
                ctx.ui.notify(renderCompactCapsuleStatusCard(currentState), "info");
              }
              return;
            }
            if (sub === "preset" && tokens[1]) {
              await controller.switchPreset(tokens[1]);
              await controller.syncAgents();
              updateUiStatus(ctx);
              if (ctx.hasUI && ctx.ui) {
                ctx.ui.notify(renderCompactCapsuleStatusCard(currentState), "info");
              }
              return;
            }
            if (sub === "model" && tokens[1]) {
              await controller.switchModel(tokens[1]);
              await controller.syncAgents();
              updateUiStatus(ctx);
              if (ctx.hasUI && ctx.ui) {
                ctx.ui.notify(renderCompactCapsuleStatusCard(currentState), "info");
              }
              return;
            }
            if (sub === "tune") {
              for (const kv of tokens.slice(1)) {
                const eqIdx = kv.indexOf("=");
                if (eqIdx > 0) {
                  const k = kv.slice(0, eqIdx).trim();
                  const v = kv.slice(eqIdx + 1).trim();
                  if (SETTINGS_SCHEMA.some((s) => s.key === k)) {
                    await applyDomainCommand({
                      _tag: "SetSettingValue",
                      key: k,
                      value: v,
                    });
                  }
                }
              }
              await applyDomainCommand({ _tag: "ExportHierarchicalToml" });
              await controller.syncAgents();
              updateUiStatus(ctx);
              if (ctx.hasUI && ctx.ui) {
                ctx.ui.notify(renderCompactCapsuleStatusCard(currentState), "info");
              }
              return;
            }
            if (sub === "launch") {
              if (tokens[1]) {
                await controller.switchModel(tokens[1]);
              }
              await applyDomainCommand({ _tag: "LaunchActiveInstance" });
              await probeLiveTelemetry();
              updateUiStatus(ctx);
              if (ctx.hasUI && ctx.ui) {
                ctx.ui.notify(renderCompactCapsuleStatusCard(currentState), "info");
              }
              return;
            }
            if (sub === "stop") {
              const targetId = tokens[1]
                ? Branded.unsafeInstanceId(tokens[1])
                : currentState.activeInstanceId;
              await applyDomainCommand({
                _tag: "StopLlamaInstance",
                instanceId: targetId,
              });
              updateUiStatus(ctx);
              if (ctx.hasUI && ctx.ui) {
                ctx.ui.notify(renderCompactCapsuleStatusCard(currentState), "info");
              }
              return;
            }
            if (sub === "sync" || sub === "export-toml") {
              await applyDomainCommand({ _tag: "ExportHierarchicalToml" });
              await controller.syncAgents();
              updateUiStatus(ctx);
              if (ctx.hasUI && ctx.ui) {
                ctx.ui.notify(renderCompactCapsuleStatusCard(currentState), "info");
              }
              return;
            }
            if (sub === "pto") {
              await controller.runPto(tokens[1] as PtoMode | undefined);
              updateUiStatus(ctx);
              if (ctx.hasUI && ctx.ui) {
                ctx.ui.notify(renderCompactCapsuleStatusCard(currentState), "info");
              }
              return;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (ctx.hasUI && ctx.ui) ctx.ui.notify(msg, "error");
            return;
          }

          const lines: string[] = [];
          const code = await runCapsuleCli({
            argv: tokens.length > 0 ? tokens : ["status"],
            workspaceRoot: ctx.cwd || options?.workspaceRoot || process.cwd(),
            stdout: (line) => lines.push(line),
          });
          updateUiStatus(ctx);
          const output = lines.join("\n");
          if (ctx.hasUI && ctx.ui) {
            ctx.ui.notify(
              output || renderCompactCapsuleStatusCard(currentState),
              code === 0 ? "info" : "error",
            );
          }
        },
      });

      pi.registerTool({
        name: "ctx_capsule",
        label: "Context Capsule Control Plane",
        description:
          "Inspect ctx-capsule status, switch active model or preset template, pack context chunks via SimHash64 + Binary Fuse8 + MaxSim, or synchronize agent SDK configurations.",
        promptSnippet: "Manage Binary Fuse8 context capsules, presets, and llama-server CLI flags",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["status", "preset", "model", "pack", "sync", "pto"],
            },
            targetId: {
              type: "string",
              description: "Model ID or Template Preset ID when action is model or preset",
            },
            chunks: {
              type: "array",
              items: { type: "string" },
              description: "Context chunks to deduplicate and pack when action is pack",
            },
            query: {
              type: "string",
              description: "Query for MaxSim token-overlap scoring when action is pack",
            },
            keepRatio: {
              type: "number",
              description: "Fraction of chunks to retain (0.05..1.0)",
            },
          },
          required: ["action"],
        },
        execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
          const action = String(params.action ?? "status");
          if (action === "preset" && typeof params.targetId === "string") {
            await controller.switchPreset(params.targetId);
          } else if (action === "model" && typeof params.targetId === "string") {
            await controller.switchModel(params.targetId);
          } else if (action === "sync") {
            await controller.syncAgents();
          } else if (action === "pto") {
            await controller.runPto();
          } else if (action === "pack") {
            const packed = packContextCapsules({
              chunks: (params.chunks as readonly string[] | string | undefined) ?? [],
              query: typeof params.query === "string" ? params.query : undefined,
              keepRatio: typeof params.keepRatio === "number" ? params.keepRatio : 0.25,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(packed, null, 2) }],
              details: packed as unknown as Record<string, unknown>,
            };
          }

          updateUiStatus(ctx);
          const summary = {
            statusBar: formatStatusBarLine(currentState),
            activeModelId: currentState.activeModelId,
            activeTemplateId: currentState.activeTemplateId,
            headers: controller.getActiveHeaders(),
            cliArgs: controller.getResolvedCliArgs(),
          };
          return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
            details: summary,
          };
        },
      });
    },
  };

  return controller;
}

export function registerCapsulePiExtension(
  pi: CapsulePiHostApi,
  options?: CapsulePiExtensionOptions,
): CapsulePiExtensionController {
  const ext = createCapsulePiExtension(options);
  ext.register(pi);
  return ext;
}

export default registerCapsulePiExtension;
