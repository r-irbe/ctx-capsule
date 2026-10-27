/**
 * Hexagonal Architecture Outbound Port Interfaces for `ctx-capsule`.
 *
 * All I/O boundaries (filesystem TOML hierarchy, `llama-server` process management,
 * `@earendil-works/pi-telemetry` span recording, and 7-agent SDK configuration sync)
 * are modeled as pure interfaces returning `Result<T, DomainError>` or
 * `Promise<Result<T, DomainError>>`. Zero uncaught exceptions cross port boundaries.
 */

import type { DomainError, FilePath, InstanceId, Result } from "../domain/result.ts";
import type { HierarchicalTomlBundle } from "../domain/toml_hierarchy.ts";
import type {
  CapsuleControlState,
  ConfigTemplateSpec,
  DomainEffect,
  LlamaInstanceSpec,
  PtoOptimizationReceipt,
  PtoTraceAndBuildSpec,
  SystemTelemetry,
  TelemetryLogEntry,
} from "../domain/types.ts";

export type SupportedAgentHarness =
  | "pi"
  | "antigravity"
  | "opencode"
  | "claude"
  | "google_adk"
  | "codex"
  | "copilot"
  | "weftd";

export interface TomlWriteReceipt {
  readonly hierarchyRootDir: FilePath;
  readonly modelsTomlPath: FilePath;
  readonly writtenFiles: readonly string[];
  readonly totalBytesWritten: number;
}

export interface TemplateSaveReceipt {
  readonly templateId: string;
  readonly filePath: FilePath;
  readonly bytesWritten: number;
}

export interface TomlConfigRepositoryPort {
  writeHierarchicalBundle(
    targetDir: FilePath,
    modelsTomlPath: FilePath,
    files: Readonly<Record<string, string>>,
    compiledModelsToml?: string,
  ): Promise<Result<TomlWriteReceipt, DomainError>>;

  saveTemplateFile(
    templatePath: FilePath,
    template: ConfigTemplateSpec,
    tomlContent: string,
  ): Promise<Result<TemplateSaveReceipt, DomainError>>;

  loadSavedTemplates(
    hierarchyRootDir: FilePath,
  ): Promise<Result<readonly ConfigTemplateSpec[], DomainError>>;

  exportFullStateBundle(
    state: CapsuleControlState,
  ): Promise<Result<{ readonly bundle: HierarchicalTomlBundle; readonly receipt: TomlWriteReceipt }, DomainError>>;
}

export interface LlamaProcessReceipt {
  readonly instanceId: InstanceId;
  readonly operation: "spawn" | "replace" | "stop" | "healthcheck";
  readonly mode: "dry_run" | "live";
  readonly pid: number | null;
  readonly port: number;
  readonly binaryPath: string;
  readonly commandLine: string;
  readonly healthy: boolean;
  readonly handoverStrategy?: "atomic_port_rebind" | "zero_downtime_shadow";
}

export interface LlamaFleetProcessPort {
  spawnInstance(
    instance: LlamaInstanceSpec,
    cliArgs: readonly string[],
    envVars: Readonly<Record<string, string>>,
  ): Promise<Result<LlamaProcessReceipt, DomainError>>;

  replaceInstanceInPlace(
    previousInstance: LlamaInstanceSpec,
    nextInstance: LlamaInstanceSpec,
    handoverStrategy: "atomic_port_rebind" | "zero_downtime_shadow",
    cliArgs: readonly string[],
  ): Promise<Result<LlamaProcessReceipt, DomainError>>;

  stopInstance(
    instanceId: InstanceId,
    pid: number | null,
  ): Promise<Result<LlamaProcessReceipt, DomainError>>;

  probeHealth(
    host: string,
    port: number,
    instanceId: InstanceId,
  ): Promise<Result<LlamaProcessReceipt, DomainError>>;
}

export interface CapsuleTelemetryPort {
  recordEffectSpan(
    effect: Extract<DomainEffect, { readonly _tag: "RecordTelemetrySpanEffect" }>,
  ): Promise<Result<TelemetryLogEntry, DomainError>>;

  getRecentEntries(limit?: number): readonly TelemetryLogEntry[];

  verifyHashChain(): Result<boolean, DomainError>;
}

export interface AgentSdkSyncArtifact {
  readonly harness: SupportedAgentHarness;
  readonly sdkPackageName: string;
  readonly configFilePath: string;
  readonly endpointUrl: string;
  readonly modelId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadPreview: string;
}

export interface AgentSdkSyncReceipt {
  readonly syncedHarnesses: readonly SupportedAgentHarness[];
  readonly artifacts: readonly AgentSdkSyncArtifact[];
  readonly outputDir: string;
}

export interface AgentSdkBridgePort {
  syncHarnesses(
    harnesses: readonly SupportedAgentHarness[],
    activeInstance: LlamaInstanceSpec,
    resolvedSettings: Readonly<Record<string, string>>,
  ): Promise<Result<AgentSdkSyncReceipt, DomainError>>;
}

export interface PtoOptimizationPort {
  runPtoTraceAndOptimize(
    spec: PtoTraceAndBuildSpec,
  ): Promise<Result<PtoOptimizationReceipt, DomainError>>;
}

export interface LiveTelemetryProbePort {
  probeSystemTelemetry(
    host: string,
    port: number,
    pidHint?: number | null,
  ): Promise<Result<SystemTelemetry, DomainError>>;
}

export type EffectExecutionReceipt =
  | { readonly _tag: "TomlWritten"; readonly receipt: TomlWriteReceipt }
  | { readonly _tag: "TemplateSaved"; readonly receipt: TemplateSaveReceipt }
  | { readonly _tag: "LlamaProcessUpdated"; readonly receipt: LlamaProcessReceipt }
  | { readonly _tag: "AgentSdksSynced"; readonly receipt: AgentSdkSyncReceipt }
  | { readonly _tag: "PtoOptimized"; readonly receipt: PtoOptimizationReceipt }
  | { readonly _tag: "TelemetryRecorded"; readonly entry: TelemetryLogEntry };

export interface EffectInterpreterPort {
  interpretEffects(
    effects: readonly DomainEffect[],
    currentState: CapsuleControlState,
  ): Promise<Result<readonly EffectExecutionReceipt[], DomainError>>;
}
