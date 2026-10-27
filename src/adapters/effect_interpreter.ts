/**
 * Hexagonal Effect Interpreter (`EffectInterpreterPort`).
 *
 * Interprets pure `readonly DomainEffect[]` values emitted by the FOOP reducer
 * by dispatching each effect to its corresponding Outbound Port (`TomlConfigRepositoryPort`,
 * `LlamaFleetProcessPort`, `CapsuleTelemetryPort`, `AgentSdkBridgePort`).
 */

import { assertNever, type DomainError, Result } from "../domain/result.ts";
import { compileHierarchicalTomlBundle } from "../domain/toml_hierarchy.ts";
import type { CapsuleControlState, DomainEffect } from "../domain/types.ts";
import type {
  AgentSdkBridgePort,
  CapsuleTelemetryPort,
  EffectExecutionReceipt,
  EffectInterpreterPort,
  LlamaFleetProcessPort,
  PtoOptimizationPort,
  TomlConfigRepositoryPort,
} from "../ports/outbound.ts";
import { ClangLldPtoOptimizationAdapter } from "./pto_adapter.ts";

export interface HexagonalEffectInterpreterPorts {
  readonly tomlRepo: TomlConfigRepositoryPort;
  readonly llamaFleet: LlamaFleetProcessPort;
  readonly telemetry: CapsuleTelemetryPort;
  readonly agentSdks: AgentSdkBridgePort;
  readonly ptoAdapter?: PtoOptimizationPort;
}

export class HexagonalEffectInterpreter implements EffectInterpreterPort {
  private readonly ports: HexagonalEffectInterpreterPorts;
  private readonly ptoAdapter: PtoOptimizationPort;

  constructor(ports: HexagonalEffectInterpreterPorts) {
    this.ports = ports;
    this.ptoAdapter = ports.ptoAdapter ?? new ClangLldPtoOptimizationAdapter({ mode: "dry_run" });
    Object.freeze(this);
  }

  async interpretEffects(
    effects: readonly DomainEffect[],
    currentState: CapsuleControlState,
  ): Promise<Result<readonly EffectExecutionReceipt[], DomainError>> {
    const receipts: EffectExecutionReceipt[] = [];

    for (const effect of effects) {
      switch (effect._tag) {
        case "WriteHierarchicalTomlEffect": {
          const tomlMode = currentState.settingsValues.toml_hierarchy_mode ?? "layered_plus_compiled";
          let compiledModelsToml: string | undefined;
          if (tomlMode !== "layered_only") {
            const bundleRes = compileHierarchicalTomlBundle(currentState);
            if (bundleRes.isErr()) {
              return Result.err(bundleRes.error);
            }
            compiledModelsToml = bundleRes.value.compiledModelsToml;
          }

          const res = await this.ports.tomlRepo.writeHierarchicalBundle(
            effect.targetDir,
            effect.modelsTomlPath,
            effect.files,
            compiledModelsToml,
          );
          if (res.isErr()) {
            return Result.err(res.error);
          }
          receipts.push(Object.freeze({ _tag: "TomlWritten", receipt: res.value }));
          break;
        }

        case "SaveTemplateTomlEffect": {
          const res = await this.ports.tomlRepo.saveTemplateFile(
            effect.templatePath,
            effect.template,
            effect.tomlContent,
          );
          if (res.isErr()) {
            return Result.err(res.error);
          }
          receipts.push(Object.freeze({ _tag: "TemplateSaved", receipt: res.value }));
          break;
        }

        case "SpawnLlamaInstanceEffect": {
          const res = await this.ports.llamaFleet.spawnInstance(
            effect.instance,
            effect.cliArgs,
            effect.envVars,
          );
          if (res.isErr()) {
            return Result.err(res.error);
          }
          receipts.push(Object.freeze({ _tag: "LlamaProcessUpdated", receipt: res.value }));
          break;
        }

        case "ReplaceLlamaInstanceInPlaceEffect": {
          const res = await this.ports.llamaFleet.replaceInstanceInPlace(
            effect.previousInstance,
            effect.nextInstance,
            effect.handoverStrategy,
            effect.cliArgs,
          );
          if (res.isErr()) {
            return Result.err(res.error);
          }
          receipts.push(Object.freeze({ _tag: "LlamaProcessUpdated", receipt: res.value }));
          break;
        }

        case "StopLlamaInstanceEffect": {
          const res = await this.ports.llamaFleet.stopInstance(effect.instanceId, effect.pid);
          if (res.isErr()) {
            return Result.err(res.error);
          }
          receipts.push(Object.freeze({ _tag: "LlamaProcessUpdated", receipt: res.value }));
          break;
        }

        case "SyncAgentSdkConfigsEffect": {
          const res = await this.ports.agentSdks.syncHarnesses(
            effect.harnesses,
            effect.activeInstance,
            effect.resolvedSettings,
          );
          if (res.isErr()) {
            return Result.err(res.error);
          }
          receipts.push(Object.freeze({ _tag: "AgentSdksSynced", receipt: res.value }));
          break;
        }

        case "RunPtoOptimizationEffect": {
          const res = await this.ptoAdapter.runPtoTraceAndOptimize(effect.spec);
          if (res.isErr()) {
            return Result.err(res.error);
          }
          receipts.push(Object.freeze({ _tag: "PtoOptimized", receipt: res.value }));
          break;
        }

        case "RecordTelemetrySpanEffect": {
          const res = await this.ports.telemetry.recordEffectSpan(effect);
          if (res.isErr()) {
            return Result.err(res.error);
          }
          receipts.push(Object.freeze({ _tag: "TelemetryRecorded", entry: res.value }));
          break;
        }

        default:
          return assertNever(effect);
      }
    }

    return Result.ok(Object.freeze(receipts));
  }
}
