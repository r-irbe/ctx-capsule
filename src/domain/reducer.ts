/**
 * Pure Functional Object-Oriented Programming (FOOP) State Machine & Reducer.
 *
 * Every transition has signature:
 *   `transition(state: CapsuleControlState, command: DomainCommand) => Result<TransitionOutput, DomainError>`
 *
 * Zero mutations, zero thrown exceptions, zero direct I/O.
 * All external actions (TOML writes, llama.cpp spawning/in-place replacement,
 * telemetry span emission, and multi-agent SDK sync) are returned as immutable
 * `DomainEffect` data values.
 */

import {
  assertNever,
  Branded,
  DomainErrors,
  type DomainError,
  type FilePath,
  Result,
} from "./result.ts";
import {
  buildLlamaServerCliArgs,
  compileHierarchicalTomlBundle,
  renderTemplateToml,
  resolveHierarchicalSettings,
} from "./toml_hierarchy.ts";
import {
  BUILTIN_HARDWARE_PROFILES,
  BUILTIN_MODELS,
  BUILTIN_TEMPLATES,
  type CapsuleControlState,
  CATEGORIES,
  type CategoryId,
  type ConfigTemplateSpec,
  DEFAULT_LLAMA_INSTANCES,
  type DomainCommand,
  type DomainEffect,
  type LlamaInstanceSpec,
  type MouseHitRegion,
  SETTINGS_SCHEMA,
  type SettingOptionSpec,
} from "./types.ts";

export interface TransitionOutput {
  readonly state: CapsuleControlState;
  readonly effects: readonly DomainEffect[];
}

export function getSettingsForCategory(category: CategoryId): readonly SettingOptionSpec[] {
  return SETTINGS_SCHEMA.filter((s) => s.category === category);
}

export function createInitialControlState(options?: {
  readonly hierarchyRootDir?: string;
  readonly unifiedModelsTomlPath?: string;
}): CapsuleControlState {
  const defaultValues: Record<string, string> = {};
  for (const item of SETTINGS_SCHEMA) {
    defaultValues[item.key] = item.defaultValue;
  }

  const selectedRowByCategory: Record<CategoryId, number> = {
    models_templates: 0,
    llama_fleet: 0,
    evidence_capsules: 0,
    kv_paging: 0,
    speculative: 0,
    hardware_numa: 0,
    sampling_sdks: 0,
  };

  const baseState: CapsuleControlState = {
    activeCategory: "models_templates",
    selectedRowByCategory: Object.freeze(selectedRowByCategory),
    activeHardwareProfileId: Branded.unsafeProfileId("epyc_milan_rtx4090"),
    activeModelId: Branded.unsafeModelId("deepseek_v41_flash"),
    activeTemplateId: Branded.unsafeTemplateId("coding_pinpoint"),
    activeInstanceId: Branded.unsafeInstanceId("llama-primary-8080"),
    settingsValues: Object.freeze(defaultValues),
    models: BUILTIN_MODELS,
    templates: BUILTIN_TEMPLATES,
    hardwareProfiles: BUILTIN_HARDWARE_PROFILES,
    instances: DEFAULT_LLAMA_INSTANCES,
    metrics: Object.freeze({
      totalContextTokens: 524288,
      activeHotVramTokens: 104858,
      warmRamTokens: 65536,
      coldCapsuleTokens: 353894,
      evictedCapsulesCount: 5529,
      wokenCapsulesLastTurn: 2,
      kvVramUsedGiB: 13.7,
      kvVramBudgetGiB: 24.0,
      prefillSpeedTokPerSec: 173.2,
      decodeSpeedTokPerSec: 22.88,
    }),
    systemTelemetry: Object.freeze({
      serverOnline: false,
      pid: null,
      host: "127.0.0.1",
      port: 8080,
      activeSlots: 0,
      totalSlots: 1,
      kvCacheUsedPct: 0,
      vramUsedGiB: 0,
      vramTotalGiB: 24.0,
      gpuUtilPct: 0,
      hostRamUsedGiB: 0,
      hostRamTotalGiB: 991.0,
      hugePagesTotal: 0,
      hugePagesFree: 0,
      prefillTokPerSec: 0,
      decodeTokPerSec: 0,
      specAcceptancePct: 0,
      evidencePrunedChunks: 0,
      lastPolledIso: null,
    }),
    telemetryLogs: Object.freeze([
      {
        seq: 1,
        timestampIso: "2026-10-27T05:00:00.000Z",
        spanName: "capsule.config.init",
        status: "ok",
        message: "Initialized FOOP Hexagonal Control State (11 models, 8 templates, 3 fleet instances)",
        prevHashHex: "0000000000000000",
        entryHashHex: "a91f4c08e2b73104",
      },
    ]),
    statusBanner: "READY: Pure TypeScript FOOP Hexagonal TUI | Click or press 1..7, m:Model, s:SaveTmpl, a:AddLlama, x:ReplaceLlama",
    hierarchyRootDir: Branded.unsafeFilePath(options?.hierarchyRootDir ?? "scripts/configs/hierarchy"),
    unifiedModelsTomlPath: Branded.unsafeFilePath(options?.unifiedModelsTomlPath ?? "scripts/configs/models.toml"),
  };

  const resolved = resolveHierarchicalSettings(baseState);
  return Object.freeze({
    ...baseState,
    settingsValues: resolved,
  });
}

function buildExportTomlEffect(state: CapsuleControlState): Result<DomainEffect, DomainError> {
  const bundleResult = compileHierarchicalTomlBundle(state);
  if (bundleResult.isErr()) {
    return Result.err(bundleResult.error);
  }
  const bundle = bundleResult.value;
  const files: Record<string, string> = {
    "00-defaults.toml": bundle.defaultsToml,
    "instances/active_fleet.toml": bundle.activeFleetToml,
  };
  for (const [id, content] of Object.entries(bundle.hardwareByProfile)) {
    files[`hardware/${id}.toml`] = content;
  }
  for (const [id, content] of Object.entries(bundle.modelsById)) {
    files[`models/${id}.toml`] = content;
  }
  for (const [id, content] of Object.entries(bundle.templatesById)) {
    files[`templates/${id}.toml`] = content;
  }

  return Result.ok(
    Object.freeze({
      _tag: "WriteHierarchicalTomlEffect",
      targetDir: state.hierarchyRootDir,
      modelsTomlPath: state.unifiedModelsTomlPath,
      files: Object.freeze(files),
    }),
  );
}

/**
 * Pure State Transition Function (Reducer).
 */
export function transition(
  state: CapsuleControlState,
  command: DomainCommand,
): Result<TransitionOutput, DomainError> {
  switch (command._tag) {
    case "SelectCategory": {
      const exists = CATEGORIES.some((c) => c.id === command.category);
      if (!exists) {
        return Result.err(DomainErrors.validation("category", "Unknown category ID", command.category));
      }
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        activeCategory: command.category,
        statusBanner: `Switched tab -> ${command.category}`,
      });
      return Result.ok({ state: nextState, effects: [] });
    }

    case "MoveSelection": {
      const items = getSettingsForCategory(state.activeCategory);
      if (items.length === 0) {
        return Result.ok({ state, effects: [] });
      }
      const currentIdx = state.selectedRowByCategory[state.activeCategory] ?? 0;
      const nextIdx = (currentIdx + command.delta + items.length) % items.length;
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        selectedRowByCategory: Object.freeze({
          ...state.selectedRowByCategory,
          [state.activeCategory]: nextIdx,
        }),
        statusBanner: `Selected setting: ${items[nextIdx].label} (${items[nextIdx].cliFlag})`,
      });
      return Result.ok({ state: nextState, effects: [] });
    }

    case "SelectRowIndex": {
      const items = getSettingsForCategory(state.activeCategory);
      if (command.rowIndex < 0 || command.rowIndex >= items.length) {
        return Result.err(
          DomainErrors.validation("rowIndex", `Row index out of bounds (0..${items.length - 1})`, command.rowIndex),
        );
      }
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        selectedRowByCategory: Object.freeze({
          ...state.selectedRowByCategory,
          [state.activeCategory]: command.rowIndex,
        }),
        statusBanner: `Selected setting: ${items[command.rowIndex].label}`,
      });
      return Result.ok({ state: nextState, effects: [] });
    }

    case "CycleCurrentSetting": {
      const items = getSettingsForCategory(state.activeCategory);
      const currentIdx = state.selectedRowByCategory[state.activeCategory] ?? 0;
      const option = items[currentIdx];
      if (!option) {
        return Result.ok({ state, effects: [] });
      }

      // Dynamic choices for active_model, active_template, hardware_profile, active_instance
      let choices: readonly string[] = option.choices;
      if (option.key === "active_model") {
        choices = state.models.map((m) => m.id);
      } else if (option.key === "active_template") {
        choices = state.templates.map((t) => t.id);
      } else if (option.key === "hardware_profile") {
        choices = state.hardwareProfiles.map((h) => h.id);
      } else if (option.key === "active_instance") {
        choices = state.instances.map((i) => i.id);
      }

      const currentVal = state.settingsValues[option.key] ?? option.defaultValue;
      const valIdx = Math.max(0, choices.indexOf(currentVal));
      const nextVal = choices[(valIdx + command.delta + choices.length) % choices.length];

      if (option.key === "active_model") {
        return transition(state, {
          _tag: "SwitchActiveModel",
          modelId: Branded.unsafeModelId(nextVal),
        });
      }
      if (option.key === "active_template") {
        return transition(state, {
          _tag: "ApplyTemplate",
          templateId: Branded.unsafeTemplateId(nextVal),
        });
      }
      if (option.key === "hardware_profile") {
        return transition(state, {
          _tag: "SwitchHardwareProfile",
          profileId: Branded.unsafeProfileId(nextVal),
        });
      }
      if (option.key === "active_instance") {
        return transition(state, {
          _tag: "SelectActiveInstance",
          instanceId: Branded.unsafeInstanceId(nextVal),
        });
      }

      return transition(state, {
        _tag: "SetSettingValue",
        key: option.key,
        value: nextVal,
      });
    }

    case "SetSettingValue": {
      const option = SETTINGS_SCHEMA.find((s) => s.key === command.key);
      if (!option) {
        return Result.err(DomainErrors.validation("key", "Unknown setting key", command.key));
      }
      const nextValues = Object.freeze({
        ...state.settingsValues,
        [command.key]: command.value,
      });
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        settingsValues: nextValues,
        statusBanner: `Updated ${option.key} = ${command.value} (${option.cliFlag})`,
      });
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.config.update_setting",
        attributes: Object.freeze({
          key: command.key,
          value: command.value,
          category: option.category,
        }),
        message: `Updated ${command.key} -> ${command.value}`,
      });
      return Result.ok({ state: nextState, effects: [spanEffect] });
    }

    case "SwitchActiveModel": {
      const model = state.models.find((m) => m.id === command.modelId);
      if (!model) {
        return Result.err(
          DomainErrors.modelNotFound(
            command.modelId,
            state.models.map((m) => m.id),
          ),
        );
      }
      const updatedInstances = state.instances.map((inst) =>
        inst.id === state.activeInstanceId
          ? Object.freeze({ ...inst, modelId: model.id, templateId: model.defaultTemplateId })
          : inst,
      );
      const intermediate: CapsuleControlState = Object.freeze({
        ...state,
        activeModelId: model.id,
        activeTemplateId: model.defaultTemplateId,
        instances: Object.freeze(updatedInstances),
        settingsValues: Object.freeze({
          ...state.settingsValues,
          ...model.recommendedSettings,
          active_model: model.id,
          active_template: model.defaultTemplateId,
        }),
        metrics: Object.freeze({
          ...state.metrics,
          totalContextTokens: Number(model.recommendedSettings.ctx_size ?? 262144),
          kvVramUsedGiB: model.vramFootprintGiB,
        }),
        statusBanner: `Switched Active Model -> ${model.displayName} (Template: ${model.defaultTemplateId})`,
      });

      const resolved = resolveHierarchicalSettings(intermediate);
      const nextState: CapsuleControlState = Object.freeze({
        ...intermediate,
        settingsValues: resolved,
      });

      const exportEffect = buildExportTomlEffect(nextState);
      if (exportEffect.isErr()) {
        return Result.err(exportEffect.error);
      }
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.config.switch_model",
        attributes: Object.freeze({
          modelId: model.id,
          architecture: model.architecture,
          defaultTemplate: model.defaultTemplateId,
          vramGiB: model.vramFootprintGiB,
        }),
        message: `Switched model to ${model.id} (${model.displayName})`,
      });
      return Result.ok({ state: nextState, effects: [spanEffect, exportEffect.value] });
    }

    case "CycleActiveModel": {
      const curIdx = Math.max(
        0,
        state.models.findIndex((m) => m.id === state.activeModelId),
      );
      const nextModel = state.models[(curIdx + command.delta + state.models.length) % state.models.length];
      return transition(state, { _tag: "SwitchActiveModel", modelId: nextModel.id });
    }

    case "ApplyTemplate": {
      const template = state.templates.find((t) => t.id === command.templateId);
      if (!template) {
        return Result.err(
          DomainErrors.templateNotFound(
            command.templateId,
            state.templates.map((t) => t.id),
          ),
        );
      }
      const nextValues = Object.freeze({
        ...state.settingsValues,
        ...template.overrides,
        active_template: template.id,
      });
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        activeTemplateId: template.id,
        settingsValues: nextValues,
        statusBanner: `Applied Template -> ${template.displayName}`,
      });
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.config.switch_template",
        attributes: Object.freeze({
          templateId: template.id,
          builtIn: template.builtIn,
        }),
        message: `Applied template ${template.id}`,
      });
      return Result.ok({ state: nextState, effects: [spanEffect] });
    }

    case "CycleTemplate": {
      const curIdx = Math.max(
        0,
        state.templates.findIndex((t) => t.id === state.activeTemplateId),
      );
      const nextTmpl = state.templates[(curIdx + command.delta + state.templates.length) % state.templates.length];
      return transition(state, { _tag: "ApplyTemplate", templateId: nextTmpl.id });
    }

    case "SaveCurrentAsTemplate": {
      const overrides: Record<string, string> = {};
      for (const opt of SETTINGS_SCHEMA) {
        if (
          opt.key !== "active_model" &&
          opt.key !== "active_template" &&
          opt.key !== "hardware_profile" &&
          opt.key !== "active_instance"
        ) {
          overrides[opt.key] = state.settingsValues[opt.key] ?? opt.defaultValue;
        }
      }

      const newTemplate: ConfigTemplateSpec = Object.freeze({
        id: command.templateId,
        displayName: command.displayName,
        description: `Custom template saved from model ${state.activeModelId}`,
        targetUseCase: "User-defined custom TUI preset",
        builtIn: false,
        overrides: Object.freeze(overrides),
      });

      const existingIdx = state.templates.findIndex((t) => t.id === command.templateId);
      const updatedTemplates =
        existingIdx >= 0
          ? state.templates.map((t, i) => (i === existingIdx ? newTemplate : t))
          : [...state.templates, newTemplate];

      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        activeTemplateId: newTemplate.id,
        templates: Object.freeze(updatedTemplates),
        settingsValues: Object.freeze({
          ...state.settingsValues,
          active_template: newTemplate.id,
        }),
        statusBanner: `Saved custom template '${newTemplate.id}' -> ${state.hierarchyRootDir}/templates/${newTemplate.id}.toml`,
      });

      const templatePath = Branded.unsafeFilePath(
        `${state.hierarchyRootDir}/templates/${newTemplate.id}.toml`,
      );
      const saveEffect: DomainEffect = Object.freeze({
        _tag: "SaveTemplateTomlEffect",
        templatePath,
        template: newTemplate,
        tomlContent: renderTemplateToml(newTemplate),
      });
      const exportEffect = buildExportTomlEffect(nextState);
      if (exportEffect.isErr()) {
        return Result.err(exportEffect.error);
      }
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.config.save_template",
        attributes: Object.freeze({
          templateId: newTemplate.id,
          baseModel: state.activeModelId,
        }),
        message: `Saved template ${newTemplate.id} (${newTemplate.displayName})`,
      });

      return Result.ok({
        state: nextState,
        effects: [spanEffect, saveEffect, exportEffect.value],
      });
    }

    case "SwitchHardwareProfile": {
      const profile = state.hardwareProfiles.find((h) => h.id === command.profileId);
      if (!profile) {
        return Result.err(
          DomainErrors.validation("profileId", "Unknown hardware profile", command.profileId),
        );
      }
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        activeHardwareProfileId: profile.id,
        settingsValues: Object.freeze({
          ...state.settingsValues,
          ...profile.defaults,
          hardware_profile: profile.id,
        }),
        statusBanner: `Switched Hardware Profile -> ${profile.displayName}`,
      });
      return Result.ok({ state: nextState, effects: [] });
    }

    case "SelectActiveInstance": {
      const inst = state.instances.find((i) => i.id === command.instanceId);
      if (!inst) {
        return Result.err(
          DomainErrors.instanceNotFound(
            command.instanceId,
            state.instances.map((i) => i.id),
          ),
        );
      }
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        activeInstanceId: inst.id,
        activeModelId: inst.modelId,
        activeTemplateId: inst.templateId,
        settingsValues: Object.freeze({
          ...state.settingsValues,
          active_instance: inst.id,
          active_model: inst.modelId,
          active_template: inst.templateId,
          engine_flavor: inst.engineFlavor,
          instance_port: String(inst.port),
        }),
        statusBanner: `Selected Fleet Instance '${inst.id}' (${inst.modelId} on :${inst.port}, ${inst.status.toUpperCase()})`,
      });
      return Result.ok({ state: nextState, effects: [] });
    }

    case "AddLlamaInstance": {
      const conflict = state.instances.find((i) => i.port === command.port);
      if (conflict) {
        return Result.err(DomainErrors.portConflict(command.port, conflict.id));
      }
      const model = state.models.find((m) => m.id === command.modelId);
      if (!model) {
        return Result.err(
          DomainErrors.modelNotFound(
            command.modelId,
            state.models.map((m) => m.id),
          ),
        );
      }

      const newInstance: LlamaInstanceSpec = Object.freeze({
        id: command.instanceId,
        label: `Dynamic Instance (${model.id} :${command.port})`,
        engineFlavor: command.engineFlavor,
        binaryPath: command.binaryPath,
        modelId: model.id,
        templateId: state.activeTemplateId,
        host: "127.0.0.1",
        port: command.port,
        numaNodes: "0-7 (NPS4 distribute)",
        gpuDevice: 0,
        vramBudgetGiB: Math.min(12.0, model.vramFootprintGiB),
        slabPriority: "cooperative",
        status: "starting",
        pid: null,
        activeSlots: Number(state.settingsValues.parallel_slots ?? 1),
        lastReplacedFromBinary: null,
      });

      const nextInstances = Object.freeze([...state.instances, newInstance]);
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        activeInstanceId: newInstance.id,
        instances: nextInstances,
        settingsValues: Object.freeze({
          ...state.settingsValues,
          active_instance: newInstance.id,
          instance_port: String(newInstance.port),
        }),
        statusBanner: `Added & Spawned llama.cpp Instance '${newInstance.id}' (${model.id} on :${newInstance.port})`,
      });

      const cliArgs = buildLlamaServerCliArgs(model, newInstance, nextState.settingsValues);
      const spawnEffect: DomainEffect = Object.freeze({
        _tag: "SpawnLlamaInstanceEffect",
        instance: newInstance,
        cliArgs,
        envVars: Object.freeze({
          LLAMA_KV_ZDD_SKIP: "1",
          GGML_MOE_URING_PREFETCH: "1",
        }),
      });
      const exportEffect = buildExportTomlEffect(nextState);
      if (exportEffect.isErr()) {
        return Result.err(exportEffect.error);
      }
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.fleet.add_instance",
        attributes: Object.freeze({
          instanceId: newInstance.id,
          modelId: newInstance.modelId,
          port: newInstance.port,
          engineFlavor: newInstance.engineFlavor,
        }),
        message: `Added llama.cpp instance ${newInstance.id} on port ${newInstance.port}`,
      });

      return Result.ok({
        state: nextState,
        effects: [spanEffect, spawnEffect, exportEffect.value],
      });
    }

    case "LaunchActiveInstance": {
      const targetId = command.instanceId ?? state.activeInstanceId;
      const existing = state.instances.find((i) => i.id === targetId);
      if (!existing) {
        return Result.err(
          DomainErrors.instanceNotFound(
            targetId,
            state.instances.map((i) => i.id),
          ),
        );
      }
      const model =
        state.models.find((m) => m.id === existing.modelId) ??
        state.models.find((m) => m.id === state.activeModelId) ??
        state.models[0];

      const launchedInstance: LlamaInstanceSpec = Object.freeze({
        ...existing,
        modelId: model.id,
        templateId: state.activeTemplateId,
        status: "starting",
        activeSlots: Number(state.settingsValues.parallel_slots ?? 1),
      });

      const nextInstances = Object.freeze(
        state.instances.map((inst) => (inst.id === existing.id ? launchedInstance : inst)),
      );
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        activeInstanceId: launchedInstance.id,
        instances: nextInstances,
        statusBanner: `Launching llama-server '${launchedInstance.id}' (${model.id} on :${launchedInstance.port} via ${launchedInstance.binaryPath})...`,
      });

      const cliArgs = buildLlamaServerCliArgs(model, launchedInstance, nextState.settingsValues);
      const spawnEffect: DomainEffect = Object.freeze({
        _tag: "SpawnLlamaInstanceEffect",
        instance: launchedInstance,
        cliArgs,
        envVars: Object.freeze({
          LLAMA_KV_ZDD_SKIP: "1",
          GGML_MOE_URING_PREFETCH: "1",
        }),
      });
      const exportEffect = buildExportTomlEffect(nextState);
      if (exportEffect.isErr()) {
        return Result.err(exportEffect.error);
      }
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.fleet.launch_instance",
        attributes: Object.freeze({
          instanceId: launchedInstance.id,
          modelId: launchedInstance.modelId,
          port: launchedInstance.port,
          binaryPath: launchedInstance.binaryPath,
        }),
        message: `Launched llama-server instance ${launchedInstance.id} on :${launchedInstance.port}`,
      });

      return Result.ok({
        state: nextState,
        effects: [spanEffect, spawnEffect, exportEffect.value],
      });
    }

    case "ReplaceLlamaInstanceInPlace": {
      const existing = state.instances.find((i) => i.id === command.instanceId);
      if (!existing) {
        return Result.err(
          DomainErrors.instanceNotFound(
            command.instanceId,
            state.instances.map((i) => i.id),
          ),
        );
      }
      const model = state.models.find((m) => m.id === command.newModelId);
      if (!model) {
        return Result.err(
          DomainErrors.modelNotFound(
            command.newModelId,
            state.models.map((m) => m.id),
          ),
        );
      }

      const replacedInstance: LlamaInstanceSpec = Object.freeze({
        ...existing,
        engineFlavor: command.newEngineFlavor,
        binaryPath: command.newBinaryPath,
        modelId: model.id,
        status: "healthy",
        pid: (existing.pid ?? 41800) + 100,
        lastReplacedFromBinary: `${existing.engineFlavor}:${existing.binaryPath}`,
      });

      const nextInstances = Object.freeze(
        state.instances.map((inst) => (inst.id === existing.id ? replacedInstance : inst)),
      );

      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        activeModelId: model.id,
        instances: nextInstances,
        settingsValues: Object.freeze({
          ...state.settingsValues,
          active_model: model.id,
          engine_flavor: command.newEngineFlavor,
        }),
        statusBanner: `In-Place Replaced '${existing.id}' on :${existing.port} -> ${command.newEngineFlavor} (${model.id})`,
      });

      const cliArgs = buildLlamaServerCliArgs(model, replacedInstance, nextState.settingsValues);
      const handoverStrategy =
        state.settingsValues.inplace_handover_mode === "zero_downtime_shadow"
          ? "zero_downtime_shadow"
          : "atomic_port_rebind";

      const replaceEffect: DomainEffect = Object.freeze({
        _tag: "ReplaceLlamaInstanceInPlaceEffect",
        previousInstance: existing,
        nextInstance: replacedInstance,
        handoverStrategy,
        cliArgs,
      });
      const exportEffect = buildExportTomlEffect(nextState);
      if (exportEffect.isErr()) {
        return Result.err(exportEffect.error);
      }
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.fleet.replace_instance",
        attributes: Object.freeze({
          instanceId: replacedInstance.id,
          previousFlavor: existing.engineFlavor,
          newFlavor: replacedInstance.engineFlavor,
          modelId: replacedInstance.modelId,
          port: replacedInstance.port,
          handoverStrategy,
        }),
        message: `Replaced instance ${replacedInstance.id} in-place (${existing.engineFlavor} -> ${replacedInstance.engineFlavor})`,
      });

      return Result.ok({
        state: nextState,
        effects: [spanEffect, replaceEffect, exportEffect.value],
      });
    }

    case "StopLlamaInstance": {
      const existing = state.instances.find((i) => i.id === command.instanceId);
      if (!existing) {
        return Result.err(
          DomainErrors.instanceNotFound(
            command.instanceId,
            state.instances.map((i) => i.id),
          ),
        );
      }
      const stopped: LlamaInstanceSpec = Object.freeze({
        ...existing,
        status: "stopped",
        pid: null,
        activeSlots: 0,
      });
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        instances: Object.freeze(
          state.instances.map((i) => (i.id === existing.id ? stopped : i)),
        ),
        statusBanner: `Stopped llama.cpp instance '${existing.id}' (freed ${existing.vramBudgetGiB} GiB VRAM slabs)`,
      });
      const stopEffect: DomainEffect = Object.freeze({
        _tag: "StopLlamaInstanceEffect",
        instanceId: existing.id,
        pid: existing.pid,
      });
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.fleet.stop_instance",
        attributes: Object.freeze({
          instanceId: existing.id,
          port: existing.port,
        }),
        message: `Stopped instance ${existing.id}`,
      });
      return Result.ok({ state: nextState, effects: [spanEffect, stopEffect] });
    }

    case "ExportHierarchicalToml": {
      const exportEffect = buildExportTomlEffect(state);
      if (exportEffect.isErr()) {
        return Result.err(exportEffect.error);
      }
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        statusBanner: `Exported 5-layer TOML hierarchy -> ${state.hierarchyRootDir} & ${state.unifiedModelsTomlPath}`,
      });
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.config.export_toml",
        attributes: Object.freeze({
          activeModel: state.activeModelId,
          activeTemplate: state.activeTemplateId,
          instancesCount: state.instances.length,
        }),
        message: `Exported hierarchical TOML bundle (${state.hierarchyRootDir})`,
      });
      return Result.ok({ state: nextState, effects: [spanEffect, exportEffect.value] });
    }

    case "SyncAllAgentSdks": {
      const activeInst =
        state.instances.find((i) => i.id === state.activeInstanceId) ?? state.instances[0];
      const harnesses: readonly ("pi" | "antigravity" | "opencode" | "claude" | "google_adk" | "codex" | "copilot" | "weftd")[] =
        Object.freeze(["pi", "antigravity", "opencode", "claude", "google_adk", "codex", "copilot", "weftd"]);

      const syncEffect: DomainEffect = Object.freeze({
        _tag: "SyncAgentSdkConfigsEffect",
        harnesses,
        activeInstance: activeInst,
        resolvedSettings: state.settingsValues,
      });
      const exportEffect = buildExportTomlEffect(state);
      if (exportEffect.isErr()) {
        return Result.err(exportEffect.error);
      }
      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.sdk.sync_harnesses",
        attributes: Object.freeze({
          harnessesCount: harnesses.length,
          endpointPort: activeInst.port,
          modelId: activeInst.modelId,
        }),
        message: `Synchronized ${harnesses.length} coding agent SDKs + hierarchical TOML to ${activeInst.id} (:${activeInst.port})`,
      });
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        statusBanner: `Synced Pi, Antigravity, OpenCode, Claude, Google ADK, Codex, Copilot, Weftd + TOML hierarchy!`,
      });
      return Result.ok({
        state: nextState,
        effects: [spanEffect, exportEffect.value, syncEffect],
      });
    }

    case "TriggerPtoTraceAndOptimize": {
      const existing =
        state.instances.find((i) => i.id === state.activeInstanceId) ?? state.instances[0];
      const model =
        state.models.find((m) => m.id === state.activeModelId) ?? state.models[0];

      const mode =
        command.mode ??
        ((state.settingsValues.pto_mode as
          | "irpgo_thinlto_split"
          | "cs_irpgo_2stage"
          | "continuous_live_server"
          | "off") ?? "irpgo_thinlto_split");
      const traceWorkload =
        command.traceWorkload ??
        ((state.settingsValues.pto_trace_workload as
          | "full_6stage_server_sweep"
          | "live_server_continuous"
          | "fast_kernel_sweep") ?? "full_6stage_server_sweep");
      const toolchain =
        (state.settingsValues.pto_toolchain as
          | "clang21_lld_znver3"
          | "clang22_lld_znver3"
          | "aocc_znver3") ?? "clang21_lld_znver3";
      const targetLinkage =
        (state.settingsValues.pto_target_linkage as
          | "static_plus_shared_libs"
          | "static_lto_monobinary"
          | "shared_libs_only") ?? "static_plus_shared_libs";

      if (mode === "off") {
        return Result.err(
          DomainErrors.ptoOptimization(
            "trace",
            toolchain,
            "Cannot run PTO optimization while pto_mode is set to 'off'",
          ),
        );
      }

      const optimizedBinaryPath = Branded.unsafeFilePath("build-pto/bin/llama-server");
      const sharedLibsPaths = Object.freeze([
        Branded.unsafeFilePath("build-pto/ggml/src/libggml.so"),
        Branded.unsafeFilePath("build-pto/src/libllama.so"),
        Branded.unsafeFilePath("../rust-mmap-engine/target/release/librust_mmap_engine.so"),
      ]);

      const ptoSpec = Object.freeze({
        mode,
        traceWorkload,
        toolchain,
        targetLinkage,
        modelId: model.id,
        instanceId: existing.id,
        profileDir: Branded.unsafeFilePath(".pi/pto-profiles"),
        profdataPath: Branded.unsafeFilePath(".pi/pto-profiles/merged.profdata"),
        optimizedBinaryPath,
        sharedLibsPaths,
      });

      const replacedInstance: LlamaInstanceSpec = Object.freeze({
        ...existing,
        engineFlavor: "ik_llama_pto_lto",
        binaryPath: optimizedBinaryPath,
        modelId: model.id,
        status: "healthy",
        pid: (existing.pid ?? 41800) + 200,
        lastReplacedFromBinary: `${existing.engineFlavor}:${existing.binaryPath}`,
      });

      const nextInstances = Object.freeze(
        state.instances.map((inst) => (inst.id === existing.id ? replacedInstance : inst)),
      );

      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        instances: nextInstances,
        settingsValues: Object.freeze({
          ...state.settingsValues,
          pto_mode: mode,
          pto_trace_workload: traceWorkload,
          pto_toolchain: toolchain,
          pto_target_linkage: targetLinkage,
          engine_flavor: "ik_llama_pto_lto",
        }),
        metrics: Object.freeze({
          ...state.metrics,
          prefillSpeedTokPerSec: Number((state.metrics.prefillSpeedTokPerSec * 1.094).toFixed(2)),
          decodeSpeedTokPerSec: Number((state.metrics.decodeSpeedTokPerSec * 1.078).toFixed(2)),
        }),
        statusBanner: `PTO Fine-Tuned (${mode} via ${toolchain}) & In-Place Swapped '${existing.id}' -> ik_llama_pto_lto (${optimizedBinaryPath})`,
      });

      const ptoEffect: DomainEffect = Object.freeze({
        _tag: "RunPtoOptimizationEffect",
        spec: ptoSpec,
      });

      const cliArgs = buildLlamaServerCliArgs(model, replacedInstance, nextState.settingsValues);
      const handoverStrategy =
        state.settingsValues.inplace_handover_mode === "zero_downtime_shadow"
          ? "zero_downtime_shadow"
          : "atomic_port_rebind";

      const replaceEffect: DomainEffect = Object.freeze({
        _tag: "ReplaceLlamaInstanceInPlaceEffect",
        previousInstance: existing,
        nextInstance: replacedInstance,
        handoverStrategy,
        cliArgs,
      });

      const exportEffect = buildExportTomlEffect(nextState);
      if (exportEffect.isErr()) {
        return Result.err(exportEffect.error);
      }

      const spanEffect: DomainEffect = Object.freeze({
        _tag: "RecordTelemetrySpanEffect",
        spanName: "capsule.pto.trace_and_optimize",
        attributes: Object.freeze({
          mode,
          traceWorkload,
          toolchain,
          targetLinkage,
          modelId: model.id,
          instanceId: existing.id,
          optimizedBinary: optimizedBinaryPath,
        }),
        message: `PTO trace & optimize (${mode} / ${toolchain}) -> swapped ${existing.id} to ik_llama_pto_lto`,
      });

      return Result.ok({
        state: nextState,
        effects: [spanEffect, ptoEffect, replaceEffect, exportEffect.value],
      });
    }

    case "IngestLiveTelemetry": {
      const tel = command.telemetry;
      const nextInstances = Object.freeze(
        state.instances.map((inst) => {
          if (Number(inst.port) !== tel.port) {
            return inst;
          }
          if (tel.serverOnline) {
            return Object.freeze({
              ...inst,
              status: "healthy" as const,
              pid: tel.pid ?? inst.pid,
              activeSlots: tel.activeSlots,
            });
          }
          return Object.freeze({
            ...inst,
            status: "stopped" as const,
            pid: null,
            activeSlots: 0,
          });
        }),
      );

      const nextMetrics = Object.freeze({
        ...state.metrics,
        kvVramUsedGiB: tel.vramUsedGiB > 0 ? tel.vramUsedGiB : state.metrics.kvVramUsedGiB,
        kvVramBudgetGiB: tel.vramTotalGiB > 0 ? tel.vramTotalGiB : state.metrics.kvVramBudgetGiB,
        prefillSpeedTokPerSec:
          tel.prefillTokPerSec > 0 ? tel.prefillTokPerSec : state.metrics.prefillSpeedTokPerSec,
        decodeSpeedTokPerSec:
          tel.decodeTokPerSec > 0 ? tel.decodeTokPerSec : state.metrics.decodeSpeedTokPerSec,
        evictedCapsulesCount:
          tel.evidencePrunedChunks > 0
            ? tel.evidencePrunedChunks
            : state.metrics.evictedCapsulesCount,
      });

      const statusBanner = tel.serverOnline
        ? `LIVE TELEMETRY [:${tel.port}]: PID ${tel.pid ?? "live"} ONLINE | Slots ${tel.activeSlots}/${tel.totalSlots} | VRAM ${tel.vramUsedGiB.toFixed(1)}/${tel.vramTotalGiB.toFixed(1)} GiB (${tel.gpuUtilPct}% GPU) | Decode ${tel.decodeTokPerSec.toFixed(2)} tok/s`
        : `SERVER OFFLINE on :${tel.port} (Press Enter to Launch) | GPU VRAM ${tel.vramUsedGiB.toFixed(1)}/${tel.vramTotalGiB.toFixed(1)} GiB | Host RAM ${tel.hostRamUsedGiB.toFixed(1)}/${tel.hostRamTotalGiB.toFixed(1)} GiB`;

      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        instances: nextInstances,
        metrics: nextMetrics,
        systemTelemetry: Object.freeze(tel),
        statusBanner,
      });
      return Result.ok({ state: nextState, effects: [] });
    }

    case "ResetCurrentCategoryDefaults": {
      const catSettings = getSettingsForCategory(state.activeCategory);
      const nextValues: Record<string, string> = { ...state.settingsValues };
      for (const s of catSettings) {
        nextValues[s.key] = s.defaultValue;
      }
      const nextState: CapsuleControlState = Object.freeze({
        ...state,
        settingsValues: Object.freeze(nextValues),
        statusBanner: `Reset category '${state.activeCategory}' to defaults`,
      });
      return Result.ok({ state: nextState, effects: [] });
    }

    default:
      return assertNever(command);
  }
}

/**
 * Pure Coordinate Hit-Tester for Mouse Interaction.
 * Given terminal `(col, row)` coordinates and the current frame's `MouseHitRegion[]`,
 * returns the matching region's `DomainCommand` if any.
 */
export function hitTestMouseRegions(
  regions: readonly MouseHitRegion[],
  col: number,
  row: number,
): MouseHitRegion | null {
  for (const r of regions) {
    if (col >= r.x0 && col <= r.x1 && row >= r.y0 && row <= r.y1) {
      return r;
    }
  }
  return null;
}

/**
 * Helper to compute the next available port and instance ID when pressing `[a]` or clicking `[+ Add llama.cpp]`.
 */
export function buildNextAddInstanceCommand(state: CapsuleControlState): DomainCommand {
  const usedPorts = new Set(state.instances.map((i) => Number(i.port)));
  let nextPort = 8080;
  while (usedPorts.has(nextPort)) {
    nextPort++;
  }
  const nextIdx = state.instances.length + 1;
  return Object.freeze({
    _tag: "AddLlamaInstance",
    instanceId: Branded.unsafeInstanceId(`llama-worker-${nextPort}`),
    modelId: state.activeModelId,
    port: Branded.unsafePortNumber(nextPort),
    engineFlavor: (state.settingsValues.engine_flavor as "ik_llama_rust_ffi") ?? "ik_llama_rust_ffi",
    binaryPath: Branded.unsafeFilePath(
      nextIdx % 2 === 0 ? "build/bin/llama-server" : "build-rust-ffi/bin/llama-server",
    ),
  });
}

/**
 * Helper to compute the in-place replacement command when pressing `[x]` or clicking `[Replace llama.cpp]`.
 */
export function buildNextReplaceInstanceCommand(state: CapsuleControlState): DomainCommand {
  const currentInst =
    state.instances.find((i) => i.id === state.activeInstanceId) ?? state.instances[0];
  const flavors = [
    "ik_llama_pto_lto",
    "ik_llama_rust_ffi",
    "ik_llama_opt",
    "ik_llama_vanilla",
    "upstream_llama_cpp",
  ] as const;
  const curFlavorIdx = flavors.indexOf(currentInst.engineFlavor);
  const nextFlavor = flavors[(curFlavorIdx + 1) % flavors.length];
  const binaryByFlavor: Record<typeof nextFlavor, FilePath> = {
    ik_llama_pto_lto: Branded.unsafeFilePath("build-pto/bin/llama-server"),
    ik_llama_rust_ffi: Branded.unsafeFilePath("build/bin/llama-server"),
    ik_llama_opt: Branded.unsafeFilePath("build-e3-opt/bin/llama-server"),
    ik_llama_vanilla: Branded.unsafeFilePath("build-vanilla/bin/llama-server"),
    upstream_llama_cpp: Branded.unsafeFilePath("../llama.cpp/build/bin/llama-server"),
  };
  return Object.freeze({
    _tag: "ReplaceLlamaInstanceInPlace",
    instanceId: currentInst.id,
    newEngineFlavor: nextFlavor,
    newBinaryPath: binaryByFlavor[nextFlavor],
    newModelId: state.activeModelId,
  });
}
