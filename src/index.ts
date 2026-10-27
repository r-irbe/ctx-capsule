/**
 * Pure TypeScript FOOP Hexagonal `ctx-capsule` Control Plane, TUI,
 * 5-Layer Hierarchical TOML Builder, In-Place `llama.cpp` Fleet Manager,
 * Live Hardware/Server Telemetry Probe, Native Pi SDK Extension, Universal MCP Server,
 * and Standardized Multi-Agent Bootstrap CLI.
 */

export * from "./domain/result.ts";
export * from "./domain/types.ts";
export * from "./domain/toml_hierarchy.ts";
export * from "./domain/reducer.ts";
export * from "./domain/evidence_packer.ts";
export * from "./ports/outbound.ts";
export * from "./adapters/toml_fs_adapter.ts";
export * from "./adapters/llama_process_adapter.ts";
export * from "./adapters/telemetry_adapter.ts";
export * from "./adapters/live_telemetry_adapter.ts";
export * from "./adapters/agent_sdk_adapter.ts";
export * from "./adapters/pto_adapter.ts";
export * from "./adapters/effect_interpreter.ts";
export * from "./adapters/pi_tui_adapter.ts";
export * from "./integrations/pi_sdk_extension.ts";
export * from "./integrations/agent_bootstrap.ts";
export * from "./mcp/ctx_capsule_mcp_server.ts";

import { MultiAgentSdkBridgeAdapter } from "./adapters/agent_sdk_adapter.ts";
import { HexagonalEffectInterpreter } from "./adapters/effect_interpreter.ts";
import { HttpNvidiaSmiTelemetryAdapter } from "./adapters/live_telemetry_adapter.ts";
import { LlamaFleetProcessAdapter } from "./adapters/llama_process_adapter.ts";
import {
  CapsulePiTuiComponent,
  renderCapsuleFrameSnapshot,
  runInteractivePiTuiSession,
} from "./adapters/pi_tui_adapter.ts";
import { ClangLldPtoOptimizationAdapter } from "./adapters/pto_adapter.ts";
import { PiCapsuleTelemetryAdapter } from "./adapters/telemetry_adapter.ts";
import { FileSystemTomlConfigAdapter } from "./adapters/toml_fs_adapter.ts";
import {
  buildNextAddInstanceCommand,
  buildNextReplaceInstanceCommand,
  createInitialControlState,
} from "./domain/reducer.ts";
import { Branded, DomainErrors } from "./domain/result.ts";
import {
  type CapsuleControlState,
  type LlamaEngineFlavor,
  type PtoMode,
  SETTINGS_SCHEMA,
} from "./domain/types.ts";
import {
  parseBootstrapAgentsList,
  runAgentBootstrapInit,
} from "./integrations/agent_bootstrap.ts";

export interface CapsuleHexagonalRuntimeOptions {
  readonly workspaceRoot?: string;
  readonly hierarchyRootDir?: string;
  readonly unifiedModelsTomlPath?: string;
  readonly telemetryJsonlPath?: string | null;
  readonly sdkOutputDir?: string | null;
  readonly processMode?: "dry_run" | "live";
}

export interface CapsuleHexagonalRuntime {
  readonly initialState: CapsuleControlState;
  readonly tomlRepo: FileSystemTomlConfigAdapter;
  readonly llamaFleet: LlamaFleetProcessAdapter;
  readonly telemetry: PiCapsuleTelemetryAdapter;
  readonly liveTelemetry: HttpNvidiaSmiTelemetryAdapter;
  readonly agentSdks: MultiAgentSdkBridgeAdapter;
  readonly ptoAdapter: ClangLldPtoOptimizationAdapter;
  readonly interpreter: HexagonalEffectInterpreter;
  readonly createTuiComponent: (overrideInitialState?: CapsuleControlState) => CapsulePiTuiComponent;
}

export function createCapsuleHexagonalRuntime(
  options?: CapsuleHexagonalRuntimeOptions,
): CapsuleHexagonalRuntime {
  const initialState = createInitialControlState({
    hierarchyRootDir: options?.hierarchyRootDir,
    unifiedModelsTomlPath: options?.unifiedModelsTomlPath,
  });

  const tomlRepo = new FileSystemTomlConfigAdapter({
    workspaceRoot: options?.workspaceRoot,
  });

  const llamaFleet = new LlamaFleetProcessAdapter({
    mode: options?.processMode ?? "dry_run",
    workspaceRoot: options?.workspaceRoot,
  });

  const telemetry = new PiCapsuleTelemetryAdapter({
    jsonlFilePath: options?.telemetryJsonlPath ?? null,
  });

  const liveTelemetry = new HttpNvidiaSmiTelemetryAdapter();

  const agentSdks = new MultiAgentSdkBridgeAdapter({
    outputDir: options?.sdkOutputDir ?? null,
  });

  const ptoAdapter = new ClangLldPtoOptimizationAdapter({
    mode: options?.processMode ?? "dry_run",
    workspaceRoot: options?.workspaceRoot,
  });

  const interpreter = new HexagonalEffectInterpreter({
    tomlRepo,
    llamaFleet,
    telemetry,
    agentSdks,
    ptoAdapter,
  });

  return Object.freeze({
    initialState,
    tomlRepo,
    llamaFleet,
    telemetry,
    liveTelemetry,
    agentSdks,
    ptoAdapter,
    interpreter,
    createTuiComponent: (overrideInitialState?: CapsuleControlState) =>
      new CapsulePiTuiComponent({
        initialState: overrideInitialState ?? initialState,
        interpreter,
        telemetry,
      }),
  });
}

export interface CapsuleCliOptions {
  readonly argv: readonly string[];
  readonly workspaceRoot?: string;
  readonly stdout?: (line: string) => void;
  readonly processMode?: "dry_run" | "live";
}

export const CAPSULE_CLI_HELP = [
  "ctx-capsule control plane commands:",
  "  ctx-capsule [status]               probe live llama-server + GPU/RAM telemetry and render status frame",
  "  ctx-capsule init [options]         scaffold .ctx-capsule/ & wire coding agents (--agents pi,claude,antigravity,opencode,codex,copilot,weftd)",
  "  ctx-capsule tui                    launch interactive fullscreen @earendil-works/pi-tui control plane",
  "  ctx-capsule launch [modelId]       launch active llama-server instance with compiled CLI flags",
  "  ctx-capsule stop [instanceId]      stop a running llama-server instance",
  "  ctx-capsule preset <templateId>    apply a preset template (e.g. ds41-1017-np1-512k-max-speed) & export TOML",
  "  ctx-capsule tune <key=val> [...]   set one or more runtime parameters (e.g. thinking_effort=high_analytical)",
  "  ctx-capsule pto [mode]             run Clang-21 IRPGO + ThinLTO + Machine Split & hot-swap to ik_llama_pto_lto",
  "  ctx-capsule export-toml            compile & write 5-layer hierarchical TOML + sync agent SDKs",
  "  ctx-capsule telemetry              probe live /health, /slots, /metrics, nvidia-smi, and /proc/meminfo",
  "  ctx-capsule help                   print this command reference",
].join("\n");

/**
 * Pure CLI & Interactive TUI entrypoint supporting subcommands (`init`, `status`, `tui`,
 * `launch`, `stop`, `preset`, `tune`, `pto`, `export-toml`, `telemetry`, `help`)
 * and flags (`--render-once`, `--print-frame`, `--export-toml`, `--switch-model`, `--model`,
 * `--template`, `--port`, `--save-template`, `--add-instance`, `--replace-instance`,
 * `--pto-trace`, `--pto-optimize`, `--sync-sdks`, `--tab`, `--live`, `--dry-run`).
 */
export async function runCapsuleCli(options: CapsuleCliOptions): Promise<number> {
  const args = [...options.argv];
  const out = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  if (args[0] === "init") {
    let targetDir = workspaceRoot;
    let rawAgents: string | undefined;
    let presetId: string | undefined;
    let modelId: string | undefined;
    let port: number | undefined;

    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if ((a === "--target" || a === "-C") && args[i + 1]) {
        targetDir = args[++i];
      } else if (a === "--agents" && args[i + 1]) {
        rawAgents = args[++i];
      } else if ((a === "--preset" || a === "--template") && args[i + 1]) {
        presetId = args[++i];
      } else if ((a === "--model" || a === "--switch-model") && args[i + 1]) {
        modelId = args[++i];
      } else if (a === "--port" && args[i + 1]) {
        port = Number(args[++i]);
      }
    }

    const agents = parseBootstrapAgentsList(rawAgents);
    const initRes = await runAgentBootstrapInit({
      targetDir,
      agents,
      presetId,
      modelId,
      port,
    });
    if (initRes.isErr()) {
      out(`ERROR: ${DomainErrors.format(initRes.error)}`);
      return 1;
    }
    out(JSON.stringify(initRes.value, null, 2));
    return 0;
  }

  const explicitLive = args.includes("--live") || args[0] === "launch" || args[0] === "stop";
  const explicitDryRun = args.includes("--dry-run");
  const mode: "dry_run" | "live" =
    options.processMode ?? (explicitDryRun ? "dry_run" : explicitLive ? "live" : "dry_run");

  const hierarchyRootDir = Branded.unsafeFilePath("scripts/configs/hierarchy");
  const runtime = createCapsuleHexagonalRuntime({
    workspaceRoot,
    hierarchyRootDir,
    unifiedModelsTomlPath: "scripts/configs/models.toml",
    telemetryJsonlPath: ".pi/harness-bridge/ctx-capsule-telemetry.jsonl",
    sdkOutputDir: "tools/ctx-capsule/exports/sdks",
    processMode: mode,
  });

  // Load any saved templates from disk before creating the TUI component
  let hydratedInitialState = runtime.initialState;
  const savedTemplatesRes = await runtime.tomlRepo.loadSavedTemplates(hierarchyRootDir);
  if (savedTemplatesRes.isOk() && savedTemplatesRes.value.length > 0) {
    const existingIds = new Set(hydratedInitialState.templates.map((t) => t.id));
    const mergedTemplates = [
      ...hydratedInitialState.templates,
      ...savedTemplatesRes.value.filter((t) => !existingIds.has(t.id)),
    ];
    hydratedInitialState = Object.freeze({
      ...hydratedInitialState,
      templates: Object.freeze(mergedTemplates),
    });
  }

  const component = runtime.createTuiComponent(hydratedInitialState);
  let renderOnce = false;
  let forceInteractiveTui = false;
  let nonInteractiveActionTaken = false;
  let probeTelemetryBeforeRender = false;

  const probeAndIngestLive = async (): Promise<void> => {
    const st = component.getState();
    const activeInst =
      st.instances.find((inst) => inst.id === st.activeInstanceId) ?? st.instances[0];
    const probeRes = await runtime.liveTelemetry.probeSystemTelemetry(
      activeInst.host,
      activeInst.port,
      activeInst.pid,
    );
    if (probeRes.isOk()) {
      await component.dispatchCommandAsync({
        _tag: "IngestLiveTelemetry",
        telemetry: probeRes.value,
      });
    }
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--live" || arg === "--dry-run") {
      continue;
    } else if (arg === "help" || arg === "--help" || arg === "-h") {
      out(CAPSULE_CLI_HELP);
      return 0;
    } else if (arg === "status") {
      probeTelemetryBeforeRender = true;
      renderOnce = true;
      nonInteractiveActionTaken = true;
    } else if (arg === "tui") {
      forceInteractiveTui = true;
    } else if (arg === "telemetry") {
      await probeAndIngestLive();
      const sys = component.getState().systemTelemetry;
      out(JSON.stringify(sys, null, 2));
      return 0;
    } else if (arg === "launch") {
      const maybeModel = args[i + 1];
      if (maybeModel && !maybeModel.startsWith("-")) {
        i++;
        await component.dispatchCommandAsync({
          _tag: "SwitchActiveModel",
          modelId: Branded.unsafeModelId(maybeModel),
        });
      }
      await component.dispatchCommandAsync({ _tag: "LaunchActiveInstance" });
      probeTelemetryBeforeRender = true;
      renderOnce = true;
      nonInteractiveActionTaken = true;
    } else if (arg === "stop") {
      const maybeInst = args[i + 1];
      const st = component.getState();
      const targetId =
        maybeInst && !maybeInst.startsWith("-")
          ? Branded.unsafeInstanceId(args[++i])
          : st.activeInstanceId;
      await component.dispatchCommandAsync({
        _tag: "StopLlamaInstance",
        instanceId: targetId,
      });
      renderOnce = true;
      nonInteractiveActionTaken = true;
    } else if ((arg === "preset" || arg === "--template" || arg === "--preset") && args[i + 1]) {
      const presetId = Branded.unsafeTemplateId(args[++i]);
      await component.dispatchCommandAsync({
        _tag: "ApplyTemplate",
        templateId: presetId,
      });
      if (arg === "preset") {
        await component.dispatchCommandAsync({ _tag: "SyncAllAgentSdks" });
      }
      renderOnce = true;
      nonInteractiveActionTaken = true;
    } else if (arg === "tune") {
      while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        const kv = args[++i];
        const eqIdx = kv.indexOf("=");
        if (eqIdx > 0) {
          const k = kv.slice(0, eqIdx).trim();
          const v = kv.slice(eqIdx + 1).trim();
          const schemaIdx = SETTINGS_SCHEMA.findIndex((s) => s.key === k);
          if (schemaIdx >= 0) {
            const opt = SETTINGS_SCHEMA[schemaIdx];
            await component.dispatchCommandAsync({
              _tag: "SelectCategory",
              category: opt.category,
            });
            const catSettings = SETTINGS_SCHEMA.filter((s) => s.category === opt.category);
            const rowIdx = catSettings.findIndex((s) => s.key === k);
            if (rowIdx >= 0) {
              await component.dispatchCommandAsync({
                _tag: "SelectRowIndex",
                rowIndex: rowIdx,
              });
              await component.dispatchCommandAsync({
                _tag: "SetSettingValue",
                key: k,
                value: v,
              });
            }
          }
        }
      }
      await component.dispatchCommandAsync({ _tag: "ExportHierarchicalToml" });
      await component.dispatchCommandAsync({ _tag: "SyncAllAgentSdks" });
      renderOnce = true;
      nonInteractiveActionTaken = true;
    } else if (arg === "pto") {
      const maybeMode = args[i + 1];
      let ptoMode: PtoMode | undefined;
      if (maybeMode && !maybeMode.startsWith("-")) {
        i++;
        ptoMode = maybeMode as PtoMode;
      }
      await component.dispatchCommandAsync({
        _tag: "TriggerPtoTraceAndOptimize",
        mode: ptoMode,
      });
      renderOnce = true;
      nonInteractiveActionTaken = true;
    } else if (arg === "export-toml" || arg === "export") {
      await component.dispatchCommandAsync({ _tag: "ExportHierarchicalToml" });
      await component.dispatchCommandAsync({ _tag: "SyncAllAgentSdks" });
      renderOnce = true;
      nonInteractiveActionTaken = true;
    } else if (arg === "--render-once" || arg === "--print-frame") {
      renderOnce = true;
      nonInteractiveActionTaken = true;
    } else if (arg === "--tab" && args[i + 1]) {
      const tabIdx = Math.max(1, Math.min(7, Number(args[++i]))) - 1;
      const categories = [
        "models_templates",
        "llama_fleet",
        "evidence_capsules",
        "kv_paging",
        "speculative",
        "hardware_numa",
        "sampling_sdks",
      ] as const;
      await component.dispatchCommandAsync({
        _tag: "SelectCategory",
        category: categories[tabIdx],
      });
    } else if ((arg === "--switch-model" || arg === "--model") && args[i + 1]) {
      const modelId = Branded.unsafeModelId(args[++i]);
      await component.dispatchCommandAsync({
        _tag: "SwitchActiveModel",
        modelId,
      });
      nonInteractiveActionTaken = true;
    } else if (arg === "--port" && args[i + 1]) {
      const portStr = args[++i];
      await component.dispatchCommandAsync({
        _tag: "SetSettingValue",
        key: "instance_port",
        value: portStr,
      });
      nonInteractiveActionTaken = true;
    } else if (arg === "--save-template" && args[i + 1]) {
      const rawId = args[++i];
      await component.dispatchCommandAsync({
        _tag: "SaveCurrentAsTemplate",
        templateId: Branded.unsafeTemplateId(rawId),
        displayName: `Custom Template (${rawId})`,
      });
      nonInteractiveActionTaken = true;
    } else if (arg === "--add-instance") {
      const nextCmd = buildNextAddInstanceCommand(component.getState());
      await component.dispatchCommandAsync(nextCmd);
      nonInteractiveActionTaken = true;
    } else if (arg === "--replace-instance") {
      const maybeFlavor = args[i + 1];
      if (maybeFlavor && !maybeFlavor.startsWith("--")) {
        i++;
        const st = component.getState();
        await component.dispatchCommandAsync({
          _tag: "ReplaceLlamaInstanceInPlace",
          instanceId: st.activeInstanceId,
          newEngineFlavor: maybeFlavor as LlamaEngineFlavor,
          newBinaryPath: Branded.unsafeFilePath("build/bin/llama-server"),
          newModelId: st.activeModelId,
        });
      } else {
        await component.dispatchCommandAsync(buildNextReplaceInstanceCommand(component.getState()));
      }
      nonInteractiveActionTaken = true;
    } else if (arg === "--pto-trace" || arg === "--pto-optimize") {
      const maybeMode = args[i + 1];
      let ptoMode: PtoMode | undefined;
      if (maybeMode && !maybeMode.startsWith("--")) {
        i++;
        ptoMode = maybeMode as PtoMode;
      }
      await component.dispatchCommandAsync({
        _tag: "TriggerPtoTraceAndOptimize",
        mode: ptoMode,
      });
      nonInteractiveActionTaken = true;
    } else if (arg === "--export-toml") {
      await component.dispatchCommandAsync({ _tag: "ExportHierarchicalToml" });
      nonInteractiveActionTaken = true;
    } else if (arg === "--sync-sdks") {
      await component.dispatchCommandAsync({ _tag: "SyncAllAgentSdks" });
      nonInteractiveActionTaken = true;
    }
  }

  if (probeTelemetryBeforeRender) {
    await probeAndIngestLive();
  }

  if (!forceInteractiveTui && (renderOnce || nonInteractiveActionTaken)) {
    const snap = renderCapsuleFrameSnapshot(component.getState(), 136);
    for (const line of snap.lines) {
      out(line);
    }
    return 0;
  }

  await runInteractivePiTuiSession({
    initialState: component.getState(),
    interpreter: runtime.interpreter,
    telemetry: runtime.telemetry,
    liveTelemetry: runtime.liveTelemetry,
  });
  return 0;
}
