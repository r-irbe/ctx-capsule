/**
 * Pure Domain Types, Effects-as-Data ADTs, Model Catalog, Templates, and Settings Schema.
 *
 * Strictly zero I/O imports. All configuration states, model specifications,
 * template presets, llama.cpp instance lifecycles, and side-effect descriptors
 * are immutable values.
 */

import {
  Branded,
  type FilePath,
  type InstanceId,
  type ModelId,
  type PortNumber,
  type ProfileId,
  type TemplateId,
} from "./result.ts";

export type CategoryId =
  | "models_templates"
  | "llama_fleet"
  | "evidence_capsules"
  | "kv_paging"
  | "speculative"
  | "hardware_numa"
  | "sampling_sdks";

export interface CategoryMeta {
  readonly id: CategoryId;
  readonly index: number;
  readonly shortLabel: string;
  readonly fullTitle: string;
}

export const CATEGORIES: readonly CategoryMeta[] = Object.freeze([
  {
    id: "models_templates",
    index: 1,
    shortLabel: "1:Models&Tmpl",
    fullTitle: "Model Switching, Hierarchical Config Profiles & Reusable Templates",
  },
  {
    id: "llama_fleet",
    index: 2,
    shortLabel: "2:LlamaFleet",
    fullTitle: "In-Place llama.cpp / ik_llama.cpp Instance Fleet Manager (Add / Replace / Slab)",
  },
  {
    id: "evidence_capsules",
    index: 3,
    shortLabel: "3:Capsules",
    fullTitle: "Evidence Pruning, Binary Fuse8/16 & SimHash-64 Context Capsules",
  },
  {
    id: "kv_paging",
    index: 4,
    shortLabel: "4:KV&ZDD",
    fullTitle: "KV Quantization, ZDD Block Skipping, Cohort Cloning & Host Paged DMA",
  },
  {
    id: "speculative",
    index: 5,
    shortLabel: "5:SpecBandit",
    fullTitle: "Counterfactual Speculative Bandit, TreeGraft & CPU/GPU Split Drafters",
  },
  {
    id: "hardware_numa",
    index: 6,
    shortLabel: "6:HW&NUMA",
    fullTitle: "AMD Zen 3 NPS4 NUMA, RTX 4090 sm_89 L2 Residency, io_uring & HugeTLB",
  },
  {
    id: "sampling_sdks",
    index: 7,
    shortLabel: "7:SDKS&Tel",
    fullTitle: "Sampling Penalties, Pi Telemetry Schema & Multi-Agent SDK Bridges",
  },
]);

export type LlamaEngineFlavor =
  | "ik_llama_pto_lto"
  | "ik_llama_opt"
  | "ik_llama_rust_ffi"
  | "ik_llama_vanilla"
  | "upstream_llama_cpp";

export type PtoMode = "irpgo_thinlto_split" | "cs_irpgo_2stage" | "continuous_live_server" | "off";

export type PtoTraceWorkload = "full_6stage_server_sweep" | "live_server_continuous" | "fast_kernel_sweep";

export type PtoToolchain = "clang21_lld_znver3" | "clang22_lld_znver3" | "aocc_znver3";

export type PtoTargetLinkage = "static_plus_shared_libs" | "static_lto_monobinary" | "shared_libs_only";

export interface PtoTraceAndBuildSpec {
  readonly mode: PtoMode;
  readonly traceWorkload: PtoTraceWorkload;
  readonly toolchain: PtoToolchain;
  readonly targetLinkage: PtoTargetLinkage;
  readonly modelId: ModelId;
  readonly instanceId: InstanceId;
  readonly profileDir: FilePath;
  readonly profdataPath: FilePath;
  readonly optimizedBinaryPath: FilePath;
  readonly sharedLibsPaths: readonly FilePath[];
}

export interface PtoOptimizationReceipt {
  readonly mode: PtoMode;
  readonly traceWorkload: PtoTraceWorkload;
  readonly toolchain: PtoToolchain;
  readonly targetLinkage: PtoTargetLinkage;
  readonly executionMode: "dry_run" | "live";
  readonly profrawCount: number;
  readonly profdataPath: FilePath;
  readonly optimizedBinaryPath: FilePath;
  readonly sharedLibsPaths: readonly FilePath[];
  readonly branchMissReductionPct: number;
  readonly l1iMissReductionPct: number;
  readonly itlbMissReductionPct: number;
  readonly prefillSpeedupPct: number;
  readonly decodeSpeedupPct: number;
  readonly cflagsApplied: string;
  readonly ldflagsApplied: string;
}

export type CapsuleTelemetrySpanName =
  | "capsule.config.switch_model"
  | "capsule.config.switch_template"
  | "capsule.config.save_template"
  | "capsule.config.update_setting"
  | "capsule.config.export_toml"
  | "capsule.fleet.add_instance"
  | "capsule.fleet.launch_instance"
  | "capsule.fleet.replace_instance"
  | "capsule.fleet.stop_instance"
  | "capsule.sdk.sync_harnesses"
  | "capsule.pto.trace_and_optimize"
  | "capsule.telemetry.probe_live";

export type LlamaInstanceStatus = "stopped" | "starting" | "healthy" | "replacing" | "degraded";

export interface LlamaInstanceSpec {
  readonly id: InstanceId;
  readonly label: string;
  readonly engineFlavor: LlamaEngineFlavor;
  readonly binaryPath: FilePath;
  readonly modelId: ModelId;
  readonly templateId: TemplateId;
  readonly host: string;
  readonly port: PortNumber;
  readonly numaNodes: string;
  readonly gpuDevice: number;
  readonly vramBudgetGiB: number;
  readonly slabPriority: "realtime" | "high" | "cooperative" | "background_yield";
  readonly status: LlamaInstanceStatus;
  readonly pid: number | null;
  readonly activeSlots: number;
  readonly lastReplacedFromBinary: string | null;
}

export interface ModelSpec {
  readonly id: ModelId;
  readonly displayName: string;
  readonly architecture: string;
  readonly parameterScale: string;
  readonly quantization: string;
  readonly diskSizeGiB: number;
  readonly vramFootprintGiB: number;
  readonly ramFootprintGiB: number;
  readonly primaryPath: FilePath;
  readonly fallbackPaths: readonly FilePath[];
  readonly defaultTemplateId: TemplateId;
  readonly recommendedSettings: Readonly<Record<string, string>>;
  readonly notes: string;
}

export interface ConfigTemplateSpec {
  readonly id: TemplateId;
  readonly displayName: string;
  readonly description: string;
  readonly targetUseCase: string;
  readonly builtIn: boolean;
  readonly overrides: Readonly<Record<string, string>>;
}

export interface HardwareProfileSpec {
  readonly id: ProfileId;
  readonly displayName: string;
  readonly cpuTopology: string;
  readonly gpuTopology: string;
  readonly storageTopology: string;
  readonly defaults: Readonly<Record<string, string>>;
}

export interface SettingOptionSpec {
  readonly key: string;
  readonly category: CategoryId;
  readonly label: string;
  readonly choices: readonly string[];
  readonly defaultValue: string;
  readonly cliFlag: string;
  readonly envVar: string;
  readonly asciiArt: readonly string[];
  readonly impact: string;
  readonly pros: readonly string[];
  readonly cons: readonly string[];
  readonly fitRule: string;
}

/**
 * Discriminated union of all Side-Effect Descriptors ("Effects as Data").
 * Pure reducers emit `readonly DomainEffect[]`; outbound adapters execute them.
 */
export type DomainEffect =
  | {
      readonly _tag: "WriteHierarchicalTomlEffect";
      readonly targetDir: FilePath;
      readonly modelsTomlPath: FilePath;
      readonly files: Readonly<Record<string, string>>;
    }
  | {
      readonly _tag: "SaveTemplateTomlEffect";
      readonly templatePath: FilePath;
      readonly template: ConfigTemplateSpec;
      readonly tomlContent: string;
    }
  | {
      readonly _tag: "SpawnLlamaInstanceEffect";
      readonly instance: LlamaInstanceSpec;
      readonly cliArgs: readonly string[];
      readonly envVars: Readonly<Record<string, string>>;
    }
  | {
      readonly _tag: "ReplaceLlamaInstanceInPlaceEffect";
      readonly previousInstance: LlamaInstanceSpec;
      readonly nextInstance: LlamaInstanceSpec;
      readonly handoverStrategy: "atomic_port_rebind" | "zero_downtime_shadow";
      readonly cliArgs: readonly string[];
    }
  | {
      readonly _tag: "StopLlamaInstanceEffect";
      readonly instanceId: InstanceId;
      readonly pid: number | null;
    }
  | {
      readonly _tag: "SyncAgentSdkConfigsEffect";
      readonly harnesses: readonly ("pi" | "antigravity" | "opencode" | "claude" | "google_adk" | "codex" | "copilot" | "weftd")[];
      readonly activeInstance: LlamaInstanceSpec;
      readonly resolvedSettings: Readonly<Record<string, string>>;
    }
  | {
      readonly _tag: "RunPtoOptimizationEffect";
      readonly spec: PtoTraceAndBuildSpec;
    }
  | {
      readonly _tag: "RecordTelemetrySpanEffect";
      readonly spanName: CapsuleTelemetrySpanName;
      readonly attributes: Readonly<Record<string, string | number | boolean>>;
      readonly message: string;
    };

export interface TelemetryLogEntry {
  readonly seq: number;
  readonly timestampIso: string;
  readonly spanName: string;
  readonly status: "ok" | "error";
  readonly message: string;
  readonly prevHashHex: string;
  readonly entryHashHex: string;
}

export interface ContextTelemetryMetrics {
  readonly totalContextTokens: number;
  readonly activeHotVramTokens: number;
  readonly warmRamTokens: number;
  readonly coldCapsuleTokens: number;
  readonly evictedCapsulesCount: number;
  readonly wokenCapsulesLastTurn: number;
  readonly kvVramUsedGiB: number;
  readonly kvVramBudgetGiB: number;
  readonly prefillSpeedTokPerSec: number;
  readonly decodeSpeedTokPerSec: number;
}

/**
 * Live hardware and llama-server HTTP endpoint telemetry snapshot.
 * Populated by `LiveTelemetryProbePort` (`/health`, `/slots`, `/metrics`, `nvidia-smi`, `/proc/meminfo`).
 */
export interface SystemTelemetry {
  readonly serverOnline: boolean;
  readonly pid: number | null;
  readonly host: string;
  readonly port: number;
  readonly activeSlots: number;
  readonly totalSlots: number;
  readonly kvCacheUsedPct: number;
  readonly vramUsedGiB: number;
  readonly vramTotalGiB: number;
  readonly gpuUtilPct: number;
  readonly hostRamUsedGiB: number;
  readonly hostRamTotalGiB: number;
  readonly hugePagesTotal: number;
  readonly hugePagesFree: number;
  readonly prefillTokPerSec: number;
  readonly decodeTokPerSec: number;
  readonly specAcceptancePct: number;
  readonly evidencePrunedChunks: number;
  readonly lastPolledIso: string | null;
}

/**
 * Interactive Mouse Hit-Test Region emitted during frame rendering.
 * Maps terminal `(col, row)` coordinates directly to pure `DomainCommand` values.
 */
export interface MouseHitRegion {
  readonly id: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly command: DomainCommand;
  readonly tooltip: string;
}

/**
 * Discriminated union of all pure Domain Commands (Keyboard + Mouse + CLI).
 */
export type DomainCommand =
  | { readonly _tag: "SelectCategory"; readonly category: CategoryId }
  | { readonly _tag: "MoveSelection"; readonly delta: number }
  | { readonly _tag: "SelectRowIndex"; readonly rowIndex: number }
  | { readonly _tag: "CycleCurrentSetting"; readonly delta: 1 | -1 }
  | { readonly _tag: "SetSettingValue"; readonly key: string; readonly value: string }
  | { readonly _tag: "SwitchActiveModel"; readonly modelId: ModelId }
  | { readonly _tag: "CycleActiveModel"; readonly delta: 1 | -1 }
  | { readonly _tag: "ApplyTemplate"; readonly templateId: TemplateId }
  | { readonly _tag: "CycleTemplate"; readonly delta: 1 | -1 }
  | { readonly _tag: "SaveCurrentAsTemplate"; readonly templateId: TemplateId; readonly displayName: string }
  | { readonly _tag: "SwitchHardwareProfile"; readonly profileId: ProfileId }
  | {
      readonly _tag: "AddLlamaInstance";
      readonly instanceId: InstanceId;
      readonly modelId: ModelId;
      readonly port: PortNumber;
      readonly engineFlavor: LlamaEngineFlavor;
      readonly binaryPath: FilePath;
    }
  | { readonly _tag: "LaunchActiveInstance"; readonly instanceId?: InstanceId }
  | {
      readonly _tag: "ReplaceLlamaInstanceInPlace";
      readonly instanceId: InstanceId;
      readonly newEngineFlavor: LlamaEngineFlavor;
      readonly newBinaryPath: FilePath;
      readonly newModelId: ModelId;
    }
  | { readonly _tag: "StopLlamaInstance"; readonly instanceId: InstanceId }
  | { readonly _tag: "SelectActiveInstance"; readonly instanceId: InstanceId }
  | { readonly _tag: "TriggerPtoTraceAndOptimize"; readonly mode?: PtoMode; readonly traceWorkload?: PtoTraceWorkload }
  | { readonly _tag: "IngestLiveTelemetry"; readonly telemetry: SystemTelemetry }
  | { readonly _tag: "ExportHierarchicalToml" }
  | { readonly _tag: "SyncAllAgentSdks" }
  | { readonly _tag: "ResetCurrentCategoryDefaults" };

export interface CapsuleControlState {
  readonly activeCategory: CategoryId;
  readonly selectedRowByCategory: Readonly<Record<CategoryId, number>>;
  readonly activeHardwareProfileId: ProfileId;
  readonly activeModelId: ModelId;
  readonly activeTemplateId: TemplateId;
  readonly activeInstanceId: InstanceId;
  readonly settingsValues: Readonly<Record<string, string>>;
  readonly models: readonly ModelSpec[];
  readonly templates: readonly ConfigTemplateSpec[];
  readonly hardwareProfiles: readonly HardwareProfileSpec[];
  readonly instances: readonly LlamaInstanceSpec[];
  readonly metrics: ContextTelemetryMetrics;
  readonly systemTelemetry: SystemTelemetry;
  readonly telemetryLogs: readonly TelemetryLogEntry[];
  readonly statusBanner: string;
  readonly hierarchyRootDir: FilePath;
  readonly unifiedModelsTomlPath: FilePath;
}

/**
 * Built-in Hardware Profiles.
 */
export const BUILTIN_HARDWARE_PROFILES: readonly HardwareProfileSpec[] = Object.freeze([
  {
    id: Branded.unsafeProfileId("epyc_milan_rtx4090"),
    displayName: "Dual AMD EPYC 7453 (56C Zen 3 NPS4) + NVIDIA RTX 4090 (24 GiB sm_89)",
    cpuTopology: "2x EPYC 7453 (56C/112T, 8 NUMA nodes NPS4, 16-ch DDR4-3200, 991 GiB RAM)",
    gpuTopology: "1x NVIDIA GeForce RTX 4090 (24 GiB GDDR6X, 72 MiB L2 Cache, sm_89)",
    storageTopology: "NVMe Gen4 Direct I/O + OpenZFS lavapool + 2 MiB HugeTLB",
    defaults: Object.freeze({
      threads: "56",
      numa_strategy: "distribute",
      gpu_layers: "99",
      flash_attn: "on",
      fused_moe: "on",
      thp_hugepages: "on",
      io_uring_direct: "on",
      l2_persisting_mb: "48",
    }),
  },
  {
    id: Branded.unsafeProfileId("single_workstation_24gb"),
    displayName: "Single-Socket Workstation + 24 GiB Ada GPU (Compact Profile)",
    cpuTopology: "16C/32T Desktop/Workstation CPU (1 NUMA node, 64-128 GiB RAM)",
    gpuTopology: "1x 24 GiB GPU (sm_89)",
    storageTopology: "NVMe SSD with buffered io_uring fallback",
    defaults: Object.freeze({
      threads: "16",
      numa_strategy: "disabled",
      gpu_layers: "99",
      flash_attn: "on",
      fused_moe: "on",
      thp_hugepages: "madvise",
      io_uring_direct: "auto",
      l2_persisting_mb: "36",
    }),
  },
]);

/**
 * Built-in Flagship Model Catalog (11 major models including DeepSeek-V4.1-Flash-1017 backbones).
 */
export const BUILTIN_MODELS: readonly ModelSpec[] = Object.freeze([
  {
    id: Branded.unsafeModelId("deepseek-v4.1-1017-ud-q4kxl"),
    displayName: "DeepSeek-V4.1-Flash-1017 (UD-Q4_K_XL + Engram + DSpark Q8_0)",
    architecture: "deepseek4 (MLA + DSA + Fused Indexer + 256 RoE + Engram Sidecar)",
    parameterScale: "552B-1000B Total / 16B-32B Active",
    quantization: "UD-Q4_K_XL + Engram Q8_0 + DSpark Q8_0",
    diskSizeGiB: 412.5,
    vramFootprintGiB: 14.8,
    ramFootprintGiB: 398.0,
    primaryPath: Branded.unsafeFilePath(
      "models/DeepSeek-V4.1-Flash-1017/UD-Q4_K_XL/DeepSeek-V4.1-Flash-1017-UD-Q4_K_XL-00001-of-00008.gguf",
    ),
    fallbackPaths: Object.freeze([
      Branded.unsafeFilePath(
        "models/DeepSeek-V4.1-Flash-1017-UD-Q4_K_XL-00001-of-00008.gguf",
      ),
    ]),
    defaultTemplateId: Branded.unsafeTemplateId("ds41-1017-np1-512k-max-speed"),
    recommendedSettings: Object.freeze({
      ctx_size: "524288",
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      indexer_cache_type_k: "q8_0",
      swa_compress: "on",
      fused_indexer: "on",
      dsa_attention: "on",
      mla_mode: "2",
      override_tensor: "^blk\\..*\\.ffn_.*_exps.*=CPU",
      defer_ple: "on",
      defer_experts: "off",
      parallel_slots: "1",
      draft_model_path:
        "models/DeepSeek-V4.1-Flash-1017/dspark-DeepSeek-V4.1-Flash-1017-Q8_0.gguf",
      spec_type: "dspark_plus_ngram_mod",
      spec_ckpt_mode: "per-step",
      thinking_effort: "max_deep_think",
      evidence_strategy: "code_pinpoint",
      evidence_chunk_tokens: "140",
    }),
    notes:
      "Production DeepSeek-V4.1-Flash-1017 UD-Q4_K_XL with --swa-compress, -fidx, -dsa -dsatk 1024, -ictk q8_0, --defer-ple (no --defer-experts), and DSpark + ngram-mod speculative chain.",
  },
  {
    id: Branded.unsafeModelId("deepseek-v4.1-1017-iq2xxs"),
    displayName: "DeepSeek-V4.1-Flash-1017 (GSQ-RCO-IQ2_XXS + Engram + DSpark Q8_0)",
    architecture: "deepseek4 (MLA + DSA + Fused Indexer + 256 RoE + Engram Sidecar)",
    parameterScale: "552B-1000B Total / 16B-32B Active",
    quantization: "GSQ-RCO-IQ2_XXS + Engram + DSpark Q8_0",
    diskSizeGiB: 218.4,
    vramFootprintGiB: 13.2,
    ramFootprintGiB: 205.0,
    primaryPath: Branded.unsafeFilePath(
      "models/ista-deepseek-v4.1-1017/DeepSeek-V4.1-Flash-1017-GSQ-RCO-IQ2_XXS-00001-of-00004.gguf",
    ),
    fallbackPaths: Object.freeze([
      Branded.unsafeFilePath(
        "models/DeepSeek-V4.1-Flash-1017-GSQ-RCO-IQ2_XXS-00001-of-00004.gguf",
      ),
    ]),
    defaultTemplateId: Branded.unsafeTemplateId("ds41-1017-np1-512k-max-speed"),
    recommendedSettings: Object.freeze({
      ctx_size: "524288",
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      indexer_cache_type_k: "q8_0",
      swa_compress: "on",
      fused_indexer: "on",
      dsa_attention: "on",
      mla_mode: "2",
      override_tensor: "^blk\\..*\\.ffn_.*_exps.*=CPU",
      defer_ple: "on",
      defer_experts: "off",
      parallel_slots: "1",
      draft_model_path:
        "models/DeepSeek-V4.1-Flash-1017/dspark-DeepSeek-V4.1-Flash-1017-Q8_0.gguf",
      spec_type: "dspark_plus_ngram_mod",
      spec_ckpt_mode: "per-step",
      thinking_effort: "max_deep_think",
      evidence_strategy: "code_pinpoint",
      evidence_chunk_tokens: "140",
    }),
    notes:
      "Fast low-bandwidth GSQ-RCO-IQ2_XXS 4-shard backbone for 512K-1M context with RAM-resident routed experts and --defer-ple.",
  },
  {
    id: Branded.unsafeModelId("deepseek_v41_flash"),
    displayName: "DeepSeek-V4.1-Flash (EngramQ8 Q2_K_Protected, 1T MoE)",
    architecture: "deepseek4 (MLA + 256 RoE + Engram PLE)",
    parameterScale: "1000B Total / 32B Active",
    quantization: "Q2_K_Protected + Engram Q8_0",
    diskSizeGiB: 386.37,
    vramFootprintGiB: 13.7,
    ramFootprintGiB: 185.64,
    primaryPath: Branded.unsafeFilePath(
      "models/DeepSeek-V4.1-Flash-1017/UD-Q4_K_XL/DeepSeek-V4.1-Flash-1017-UD-Q4_K_XL-00001-of-00008.gguf",
    ),
    fallbackPaths: Object.freeze([
      Branded.unsafeFilePath("models/DeepSeek-V4.1-Flash-EngramQ8-Q2_K_Protected-00001-of-00010.gguf"),
      Branded.unsafeFilePath("unsloth/Smalinin-Deepseek-v41-flash/Q2_K_Protected-Q8/DeepSeek-V4.1-Flash-EngramQ8-Q2_K_Protected-00001-of-00010.gguf"),
    ]),
    defaultTemplateId: Branded.unsafeTemplateId("ds41-1017-np1-512k-max-speed"),
    recommendedSettings: Object.freeze({
      ctx_size: "524288",
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      indexer_cache_type_k: "q8_0",
      swa_compress: "on",
      fused_indexer: "on",
      dsa_attention: "on",
      mla_mode: "2",
      override_tensor: "^blk\\..*\\.ffn_.*_exps.*=CPU",
      defer_ple: "on",
      defer_experts: "off",
      parallel_slots: "1",
      draft_model_path:
        "models/DeepSeek-V4.1-Flash-1017/dspark-DeepSeek-V4.1-Flash-1017-Q8_0.gguf",
      spec_type: "dspark_plus_ngram_mod",
      spec_ckpt_mode: "per-step",
      thinking_effort: "max_deep_think",
      evidence_strategy: "code_pinpoint",
      evidence_chunk_tokens: "140",
    }),
    notes: "512K..1M context fits in 24 GiB VRAM with --swa-compress, -ictk q8_0, MLA -mla 2, and --defer-ple (22.88 tok/s decode).",
  },
  {
    id: Branded.unsafeModelId("deepseek_v41_fastest_np8"),
    displayName: "DeepSeek-V4.1-Fastest-NP8 (High-Concurrency Multi-Slot Server)",
    architecture: "deepseek4 (MLA + Cohort Prefix Cloning)",
    parameterScale: "1000B Total / 32B Active",
    quantization: "UD-Q4_K_XL / Q2_K_Protected",
    diskSizeGiB: 386.37,
    vramFootprintGiB: 18.2,
    ramFootprintGiB: 186.1,
    primaryPath: Branded.unsafeFilePath(
      "models/DeepSeek-V4.1-Flash-1017/UD-Q4_K_XL/DeepSeek-V4.1-Flash-1017-UD-Q4_K_XL-00001-of-00008.gguf",
    ),
    fallbackPaths: Object.freeze([
      Branded.unsafeFilePath("models/DeepSeek-V4.1-Flash-EngramQ8-Q2_K_Protected-00001-of-00010.gguf"),
    ]),
    defaultTemplateId: Branded.unsafeTemplateId("ds41-1017-np8-1m-swarm"),
    recommendedSettings: Object.freeze({
      ctx_size: "1048576",
      kv_type_k: "q4_0",
      kv_type_v: "q4_0",
      indexer_cache_type_k: "q4_0",
      swa_compress: "on",
      fused_indexer: "on",
      dsa_attention: "on",
      mla_mode: "2",
      override_tensor: "^blk\\..*\\.ffn_.*_exps.*=CPU",
      defer_ple: "on",
      defer_experts: "off",
      parallel_slots: "8",
      cohort_sharing: "on",
    }),
    notes: "Tuned for 8-slot 1M-context parallel agent swarm serving with --swa-compress and cross-slot donor KV cloning.",
  },
  {
    id: Branded.unsafeModelId("qwen38_27b"),
    displayName: "Qwen3.8-27B-UD-Q4_K_XL (100% GPU VRAM Dense Flagship)",
    architecture: "qwen3 (GQA + FlashAttention-2)",
    parameterScale: "27B Dense",
    quantization: "UD-Q4_K_XL",
    diskSizeGiB: 16.13,
    vramFootprintGiB: 20.89,
    ramFootprintGiB: 17.04,
    primaryPath: Branded.unsafeFilePath("models/Qwen3.8-27B-UD-Q4_K_XL.gguf"),
    fallbackPaths: Object.freeze([
      Branded.unsafeFilePath("unsloth/Qwen3.8-27B-GGUF/Qwen3.8-27B-UD-Q4_K_XL.gguf"),
    ]),
    defaultTemplateId: Branded.unsafeTemplateId("coding_pinpoint"),
    recommendedSettings: Object.freeze({
      ctx_size: "262144",
      kv_type_k: "q4_0",
      kv_type_v: "q4_0",
      mla_mode: "0",
      override_tensor: "none",
      defer_ple: "off",
      parallel_slots: "8",
    }),
    notes: "1,986 tok/s prefill, 45.7 tok/s decode; fits 256K context 100% inside 24 GiB RTX 4090 VRAM.",
  },
  {
    id: Branded.unsafeModelId("qwen38_2_4t"),
    displayName: "Qwen3.8-2.4T-A95B-UD-Q1_0 (2.4T Ultra-Scale MoE, GGUF-X NPMC)",
    architecture: "qwen3moe (2.4T Total / 95B Active, Q1_0_G128)",
    parameterScale: "2400B Total / 95B Active",
    quantization: "UD-Q1_0_G128 (Type 66)",
    diskSizeGiB: 354.24,
    vramFootprintGiB: 14.8,
    ramFootprintGiB: 356.0,
    primaryPath: Branded.unsafeFilePath("models/Qwen3.8-2.4T-A95B-UD-Q1_0-00001-of-00010.gguf"),
    fallbackPaths: Object.freeze([
      Branded.unsafeFilePath("unsloth/Qwen3.8-2.4T-A95B-GGUF/Qwen3.8-2.4T-A95B-UD-Q1_0-00001-of-00010.gguf"),
    ]),
    defaultTemplateId: Branded.unsafeTemplateId("deep_formal_audit"),
    recommendedSettings: Object.freeze({
      ctx_size: "65536",
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      override_tensor: "exps=CPU",
      npmc_superblock: "on",
      thp_hugepages: "on",
      parallel_slots: "1",
    }),
    notes: "Repacked GGUF-X v3 eliminates 277 LINT005 shard jumps (-89.7% prefill jitter, 3.82 tok/s decode).",
  },
  {
    id: Branded.unsafeModelId("glm_53_flash"),
    displayName: "GLM-5.3-Flash-UD-IQ4_XS (Fast Hybrid MoE Reasoner)",
    architecture: "glm4moe (Hybrid Attention + MoE)",
    parameterScale: "260B Total / 24B Active",
    quantization: "UD-IQ4_XS",
    diskSizeGiB: 147.95,
    vramFootprintGiB: 11.67,
    ramFootprintGiB: 135.53,
    primaryPath: Branded.unsafeFilePath("models/GLM-5.3-Flash-UD-IQ4_XS-00001-of-00005.gguf"),
    fallbackPaths: Object.freeze([
      Branded.unsafeFilePath("unsloth/GLM-5.3-Flash-GGUF/UD-IQ4_XS/GLM-5.3-Flash-UD-IQ4_XS-00001-of-00005.gguf"),
    ]),
    defaultTemplateId: Branded.unsafeTemplateId("coding_pinpoint"),
    recommendedSettings: Object.freeze({
      ctx_size: "262144",
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      override_tensor: "exps=CPU",
      parallel_slots: "8",
      cohort_sharing: "on",
    }),
    notes: "1M context fits in 18.17 GiB VRAM with Q4_0 KV; 8-slot cohort cloning delivers 3.48x speedup.",
  },
  {
    id: Branded.unsafeModelId("kimi_k3"),
    displayName: "Kimi-K3-Instruct-IQ4_XS (Long-Horizon Agentic MoE)",
    architecture: "kimi_k3 (MLA + 128-Expert MoE)",
    parameterScale: "1024B Total / 32B Active",
    quantization: "IQ4_XS",
    diskSizeGiB: 412.0,
    vramFootprintGiB: 15.4,
    ramFootprintGiB: 210.0,
    primaryPath: Branded.unsafeFilePath("models/Kimi-K3-Instruct-IQ4_XS-00001-of-00009.gguf"),
    fallbackPaths: Object.freeze([]),
    defaultTemplateId: Branded.unsafeTemplateId("low_vram_1m"),
    recommendedSettings: Object.freeze({
      ctx_size: "1048576",
      kv_type_k: "q4_0",
      kv_type_v: "q4_0",
      mla_mode: "2",
      override_tensor: "exps=CPU",
      defer_experts: "off",
    }),
    notes: "Designed for 1M..10M token repository trajectories with Fuse8 KV capsules.",
  },
  {
    id: Branded.unsafeModelId("recursive_flint"),
    displayName: "Recursive-Flint-32B-Q6_K (Fast Speculative & Code Synthesis)",
    architecture: "flint (Hybrid Linear + Sliding Window Attention)",
    parameterScale: "32B Dense/Hybrid",
    quantization: "Q6_K",
    diskSizeGiB: 24.5,
    vramFootprintGiB: 21.8,
    ramFootprintGiB: 8.2,
    primaryPath: Branded.unsafeFilePath("models/Recursive-Flint-32B-Q6_K.gguf"),
    fallbackPaths: Object.freeze([]),
    defaultTemplateId: Branded.unsafeTemplateId("max_throughput_np8"),
    recommendedSettings: Object.freeze({
      ctx_size: "131072",
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      spec_bandit: "thompson_counterfactual",
      treegraft_fusion: "on",
    }),
    notes: "High speculative acceptance rate (alpha > 0.84) with TreeGraft + CCD suffix trie.",
  },
  {
    id: Branded.unsafeModelId("diffusion_gemma"),
    displayName: "DiffusionGemma-27B-IT-Q8_0 (Block-Diffusion Parallel Decoder)",
    architecture: "diffusion_gemma (Bidirectional Block Denoising)",
    parameterScale: "27B",
    quantization: "Q8_0",
    diskSizeGiB: 27.2,
    vramFootprintGiB: 22.1,
    ramFootprintGiB: 12.0,
    primaryPath: Branded.unsafeFilePath("models/DiffusionGemma-27B-IT-Q8_0.gguf"),
    fallbackPaths: Object.freeze([]),
    defaultTemplateId: Branded.unsafeTemplateId("coding_pinpoint"),
    recommendedSettings: Object.freeze({
      ctx_size: "65536",
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      draft_max: "16",
      spec_bandit: "thompson_counterfactual",
    }),
    notes: "Pairs with DFlash block-diffusion drafter for parallel token verification.",
  },
  {
    id: Branded.unsafeModelId("leanstral_119b"),
    displayName: "Leanstral-1.5-119B-A22B-Q4_K_M (Formal Theorem Proving MoE)",
    architecture: "mixtral_lean (Formal Proof & Tactic Specialist)",
    parameterScale: "119B Total / 22B Active",
    quantization: "Q4_K_M",
    diskSizeGiB: 68.4,
    vramFootprintGiB: 16.5,
    ramFootprintGiB: 72.0,
    primaryPath: Branded.unsafeFilePath("models/Leanstral-1.5-119B-A22B-Q4_K_M.gguf"),
    fallbackPaths: Object.freeze([]),
    defaultTemplateId: Branded.unsafeTemplateId("deep_formal_audit"),
    recommendedSettings: Object.freeze({
      ctx_size: "131072",
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      override_tensor: "exps=CPU",
      temp: "0.0",
      evidence_strategy: "maxsim_exact_cover",
    }),
    notes: "Optimized for Lean 4 proof state navigation, tactic synthesis, and mathlib search.",
  },
]);

/**
 * Built-in Reusable Templates (including the 4 ranked DeepSeek-V4.1-Flash-1017 presets).
 */
export const BUILTIN_TEMPLATES: readonly ConfigTemplateSpec[] = Object.freeze([
  {
    id: Branded.unsafeTemplateId("ds41-1017-np1-512k-max-speed"),
    displayName: "DS4.1-1017 NP1 512K Max-Speed (Q8_0 KV + SWA Compress + DSpark + Pinpoint)",
    description:
      "Single-slot 512K max-speed & deep-reasoning preset: -np 1 -c 524288 --swa-compress -ctk q8_0 -ctv q8_0 -ictk q8_0 -fidx -dsa -dsatk 1024 -mla 2 --defer-ple + DSpark + ngram-mod.",
    targetUseCase: "Primary single-agent interactive coding & deep mathematical reasoning at 512K context",
    builtIn: true,
    overrides: Object.freeze({
      parallel_slots: "1",
      ctx_size: "524288",
      swa_compress: "on",
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      indexer_cache_type_k: "q8_0",
      fused_indexer: "on",
      dsa_attention: "on",
      mla_mode: "2",
      defer_ple: "on",
      defer_experts: "off",
      zdd_sparse_kv: "on",
      thp_hugepages: "on",
      threads: "56",
      numa_strategy: "distribute",
      spec_type: "dspark_plus_ngram_mod",
      spec_ckpt_mode: "per-step",
      spec_bandit: "thompson_counterfactual",
      evidence_strategy: "code_pinpoint",
      evidence_chunk_tokens: "140",
      evidence_keep_ratio: "20%",
      capsule_filter: "fuse8_simhash64",
      thinking_effort: "max_deep_think",
    }),
  },
  {
    id: Branded.unsafeTemplateId("ds41-1017-np1-1m-extreme"),
    displayName: "DS4.1-1017 NP1 1M Extreme Context (Q4_0 KV + Q8_0 Indexer + SWA Compress)",
    description:
      "Single-slot 1M token extreme context preset: -np 1 -c 1048576 --swa-compress -ctk q4_0 -ctv q4_0 -ictk q8_0 -fidx -dsa -dsatk 1024 -mla 2 --defer-ple + Fuse16 capsules.",
    targetUseCase: "1M-token full-repository synthesis, trace forensics, and multi-paper citation walks",
    builtIn: true,
    overrides: Object.freeze({
      parallel_slots: "1",
      ctx_size: "1048576",
      swa_compress: "on",
      kv_type_k: "q4_0",
      kv_type_v: "q4_0",
      indexer_cache_type_k: "q8_0",
      fused_indexer: "on",
      dsa_attention: "on",
      mla_mode: "2",
      defer_ple: "on",
      defer_experts: "off",
      zdd_sparse_kv: "on",
      thp_hugepages: "on",
      threads: "56",
      numa_strategy: "distribute",
      spec_type: "dspark_plus_ngram_mod",
      spec_ckpt_mode: "per-step",
      spec_bandit: "thompson_counterfactual",
      evidence_strategy: "code_pinpoint",
      evidence_chunk_tokens: "140",
      evidence_keep_ratio: "15%",
      capsule_filter: "fuse16_simhash64",
      thinking_effort: "max_deep_think",
    }),
  },
  {
    id: Branded.unsafeTemplateId("ds41-1017-np4-512k-swarm"),
    displayName: "DS4.1-1017 NP4 512K Agent Swarm (4 Slots x 128K + Cohort KV Clone)",
    description:
      "4-slot parallel agent swarm preset: -np 4 -c 524288 --swa-compress -cb -b 2048 -ub 512 -ctk q4_0 -ctv q4_0 -ictk q8_0 --cohort-prefix-sharing --cohort-min-prefix 64 --zdd-sparse-kv.",
    targetUseCase: "4-worker subagent coding & verification fleet with zero-copy prefix cloning",
    builtIn: true,
    overrides: Object.freeze({
      parallel_slots: "4",
      ctx_size: "524288",
      swa_compress: "on",
      kv_type_k: "q4_0",
      kv_type_v: "q4_0",
      indexer_cache_type_k: "q8_0",
      fused_indexer: "on",
      dsa_attention: "on",
      mla_mode: "2",
      defer_ple: "on",
      defer_experts: "off",
      cohort_sharing: "on",
      zdd_sparse_kv: "on",
      thp_hugepages: "on",
      threads: "56",
      numa_strategy: "distribute",
      evidence_strategy: "code_pinpoint",
      evidence_chunk_tokens: "140",
      thinking_effort: "high_analytical",
    }),
  },
  {
    id: Branded.unsafeTemplateId("ds41-1017-np8-1m-swarm"),
    displayName: "DS4.1-1017 NP8 1M High-Concurrency Swarm (8 Slots x 128K + Q4_0 Indexer)",
    description:
      "8-slot high-concurrency 1M aggregate preset: -np 8 -c 1048576 --swa-compress -cb -b 2048 -ub 512 -ctk q4_0 -ctv q4_0 -ictk q4_0 --cohort-prefix-sharing --cohort-min-prefix 64 --zdd-sparse-kv.",
    targetUseCase: "8-agent parallel council & multi-track fleet under 24 GiB VRAM ceiling",
    builtIn: true,
    overrides: Object.freeze({
      parallel_slots: "8",
      ctx_size: "1048576",
      swa_compress: "on",
      kv_type_k: "q4_0",
      kv_type_v: "q4_0",
      indexer_cache_type_k: "q4_0",
      fused_indexer: "on",
      dsa_attention: "on",
      mla_mode: "2",
      defer_ple: "on",
      defer_experts: "off",
      cohort_sharing: "on",
      zdd_sparse_kv: "on",
      thp_hugepages: "on",
      threads: "56",
      numa_strategy: "distribute",
      concurrency_knee_guard: "on",
      evidence_strategy: "code_pinpoint",
      evidence_chunk_tokens: "140",
      thinking_effort: "high_analytical",
    }),
  },
  {
    id: Branded.unsafeTemplateId("coding_pinpoint"),
    displayName: "Coding Agent Pinpoint (Zero-Decompaction + Fuse8 Capsules)",
    description: "Balanced low-TTFT coding agent preset with MaxSim+Exact-Cover pruning and Binary Fuse8 capsules.",
    targetUseCase: "Interactive coding agents (Pi, Antigravity, OpenCode, Claude Code)",
    builtIn: true,
    overrides: Object.freeze({
      evidence_strategy: "maxsim_exact_cover",
      evidence_chunk_tokens: "64",
      evidence_keep_ratio: "20%",
      global_summary_header: "on",
      capsule_filter: "fuse8_simhash64",
      wake_min_hamming_sim: "0.60",
      max_wake_per_turn: "4",
      zdd_sparse_kv: "on",
      cohort_sharing: "on",
      spec_bandit: "thompson_counterfactual",
    }),
  },
  {
    id: Branded.unsafeTemplateId("low_vram_1m"),
    displayName: "1M..10M Ultra-Long Context (Q4_0 KV + Tiered Host DMA + Fuse16)",
    description: "Maximizes context window up to 1M-10M tokens inside 24 GiB VRAM via Q4_0 KV and Fuse16 capsules.",
    targetUseCase: "Whole-repository audits, 10M-token logs, long-horizon agent sessions",
    builtIn: true,
    overrides: Object.freeze({
      ctx_size: "1048576",
      kv_type_k: "q4_0",
      kv_type_v: "q4_0",
      tiered_kv_dma: "auto_hot_window",
      zdd_sparse_kv: "on",
      capsule_filter: "fuse16_simhash64",
      evidence_keep_ratio: "15%",
      wake_min_hamming_sim: "0.65",
    }),
  },
  {
    id: Branded.unsafeTemplateId("max_throughput_np8"),
    displayName: "Multi-Agent Swarm Throughput (-np 8..32 + Cross-Slot KV Clone)",
    description: "Optimizes multi-slot parallel throughput for concurrent subagent councils using cohort KV cloning.",
    targetUseCase: "RALPH 5-agent review councils, parallel subagent fleets",
    builtIn: true,
    overrides: Object.freeze({
      parallel_slots: "8",
      cohort_sharing: "on",
      cohort_min_prefix: "64",
      cross_slot_kv_clone: "on",
      batch_size: "4096",
      ubatch_size: "1024",
      concurrency_knee_guard: "on",
    }),
  },
  {
    id: Branded.unsafeTemplateId("deep_formal_audit"),
    displayName: "Deterministic Formal Proof & Perplexity Audit (Greedy + Q8_0 KV)",
    description: "Zero-temperature deterministic evaluation with high-precision Q8_0 KV and global occurrence counts.",
    targetUseCase: "Lean 4 formal verification, mathematical theorem proving, benchmark verification",
    builtIn: true,
    overrides: Object.freeze({
      kv_type_k: "q8_0",
      kv_type_v: "q8_0",
      temp: "0.0",
      top_p: "1.00",
      min_p: "0.00",
      evidence_keep_ratio: "35%",
      global_summary_header: "on",
      capsule_filter: "fuse16_simhash64",
    }),
  },
]);

/**
 * Default Initial Fleet of `llama-server` Instances.
 * Never fabricates running PIDs (pid is null and status is "stopped" until launched or detected by live telemetry).
 */
export const DEFAULT_LLAMA_INSTANCES: readonly LlamaInstanceSpec[] = Object.freeze([
  {
    id: Branded.unsafeInstanceId("llama-primary-8080"),
    label: "Primary Coding & Reasoning Engine",
    engineFlavor: "ik_llama_pto_lto",
    binaryPath: Branded.unsafeFilePath("build-pto/bin/llama-server"),
    modelId: Branded.unsafeModelId("deepseek-v4.1-1017-ud-q4kxl"),
    templateId: Branded.unsafeTemplateId("ds41-1017-np1-512k-max-speed"),
    host: "127.0.0.1",
    port: Branded.unsafePortNumber(8080),
    numaNodes: "0-7 (NPS4 distribute)",
    gpuDevice: 0,
    vramBudgetGiB: 14.8,
    slabPriority: "realtime",
    status: "stopped",
    pid: null,
    activeSlots: 0,
    lastReplacedFromBinary: null,
  },
  {
    id: Branded.unsafeInstanceId("llama-fast-8081"),
    label: "Fast Subagent & Draft Worker",
    engineFlavor: "ik_llama_opt",
    binaryPath: Branded.unsafeFilePath("build/bin/llama-server"),
    modelId: Branded.unsafeModelId("qwen38_27b"),
    templateId: Branded.unsafeTemplateId("max_throughput_np8"),
    host: "127.0.0.1",
    port: Branded.unsafePortNumber(8081),
    numaNodes: "0-3 (Socket 0)",
    gpuDevice: 0,
    vramBudgetGiB: 8.5,
    slabPriority: "cooperative",
    status: "stopped",
    pid: null,
    activeSlots: 0,
    lastReplacedFromBinary: null,
  },
  {
    id: Branded.unsafeInstanceId("llama-formal-8082"),
    label: "Lean 4 Formal Verification Standby",
    engineFlavor: "ik_llama_rust_ffi",
    binaryPath: Branded.unsafeFilePath("build/bin/llama-server"),
    modelId: Branded.unsafeModelId("leanstral_119b"),
    templateId: Branded.unsafeTemplateId("deep_formal_audit"),
    host: "127.0.0.1",
    port: Branded.unsafePortNumber(8082),
    numaNodes: "4-7 (Socket 1)",
    gpuDevice: 0,
    vramBudgetGiB: 1.5,
    slabPriority: "background_yield",
    status: "stopped",
    pid: null,
    activeSlots: 0,
    lastReplacedFromBinary: null,
  },
]);

/**
 * Complete Catalog of Interactive Settings across all 7 Categories.
 */
export const SETTINGS_SCHEMA: readonly SettingOptionSpec[] = Object.freeze([
  // --- Category 1: Models & Templates (models_templates) ---
  {
    key: "active_model",
    category: "models_templates",
    label: "Active Model Checkpoint",
    choices: BUILTIN_MODELS.map((m) => m.id),
    defaultValue: "deepseek_v41_flash",
    cliFlag: "-m <model.gguf>",
    envVar: "LLAMA_MODEL_ID",
    asciiArt: [
      "  +---------------- HIERARCHICAL TOML MERGE LATTICE ----------------+",
      "  | 00-defaults.toml -> 10-hardware.toml -> 20-model.toml           |",
      "  |       -> 30-template.toml -> 40-instances.toml -> models.toml   |",
      "  +-----------------------------------------------------------------+",
    ],
    impact: "Switches the active model checkpoint and merges its architectural defaults into the TOML hierarchy.",
    pros: ["Instant one-key or mouse-click model switching", "Automatically adjusts MLA, MoE -ot, and KV cache types"],
    cons: ["Switching a live server requires in-place instance reload or secondary port routing"],
    fitRule: "FIT: Use deepseek_v41_flash or glm_53_flash for 512K-1M reasoning; qwen38_27b for 1,986 tok/s prefill.",
  },
  {
    key: "active_template",
    category: "models_templates",
    label: "Configuration Template Preset",
    choices: BUILTIN_TEMPLATES.map((t) => t.id),
    defaultValue: "coding_pinpoint",
    cliFlag: "--template",
    envVar: "CTX_CAPSULE_TEMPLATE",
    asciiArt: [
      "  [coding_pinpoint]   : Fuse8 + 20% Keep + SpecBandit (Low TTFT)",
      "  [low_vram_1m]       : 1M Ctx + Q4_0 KV + Host Paged DMA + Fuse16",
      "  [max_throughput_np8]: 8..32 Slots + Cohort Donor KV Cloning",
      "  [deep_formal_audit] : Temp 0.0 + Q8_0 KV + Exact Global Summary",
    ],
    impact: "Applies a cohesive preset of capsule, KV cache, and concurrency parameters on top of the model layer.",
    pros: ["Eliminates manual flag tuning across 35+ parameters", "Custom templates can be saved via [s] or mouse click"],
    cons: ["Overrides individual setting tweaks until further customized"],
    fitRule: "FIT: Press [s] or click [Save Template] at any time to persist custom overrides to hierarchy/templates/.",
  },
  {
    key: "hardware_profile",
    category: "models_templates",
    label: "Hardware Topology Profile",
    choices: BUILTIN_HARDWARE_PROFILES.map((h) => h.id),
    defaultValue: "epyc_milan_rtx4090",
    cliFlag: "--hw-profile",
    envVar: "LLAMA_HW_PROFILE",
    asciiArt: [
      "  [Socket 0: Zen3 28C NPS4] <---xGMI---> [Socket 1: Zen3 28C NPS4]",
      "             \\--- PCIe Gen4 x16 ---> [RTX 4090 24GiB + 72MiB L2]",
    ],
    impact: "Sets the hardware layer (10-hardware.toml) governing thread counts, NUMA policy, and L2 cache pinning.",
    pros: ["Matches EPYC 7453 56-core NPS4 + RTX 4090 out of the box", "Cleanly portable to single-socket workstations"],
    cons: ["NPS4 distribute should only be enabled on multi-node NUMA systems"],
    fitRule: "FIT: Keep epyc_milan_rtx4090 on the dual-socket Milan host.",
  },
  {
    key: "toml_hierarchy_mode",
    category: "models_templates",
    label: "Hierarchical TOML Emission Mode",
    choices: ["layered_plus_compiled", "layered_only", "compiled_models_toml_only"],
    defaultValue: "layered_plus_compiled",
    cliFlag: "--toml-mode",
    envVar: "CTX_TOML_MODE",
    asciiArt: [
      "  scripts/configs/hierarchy/",
      "   +-- 00-defaults.toml      +-- models/<model>.toml",
      "   +-- hardware/<hw>.toml    +-- templates/<tmpl>.toml",
      "   +-- instances/fleet.toml  +==> scripts/configs/models.toml",
    ],
    impact: "Controls how the TUI writes declarative TOML configurations when saving or exporting.",
    pros: ["layered_plus_compiled keeps clean modular layers AND updates scripts/configs/models.toml"],
    cons: ["Writes multiple small TOML files on export"],
    fitRule: "FIT: Always use layered_plus_compiled for full auditability and launch.py compatibility.",
  },
  {
    key: "container_format",
    category: "models_templates",
    label: "Model Container Format",
    choices: ["gguf_x_npmc_v3", "aligned_gguf_2mb", "standard_gguf"],
    defaultValue: "gguf_x_npmc_v3",
    cliFlag: "--npmc-superblock",
    envVar: "LLAMA_NPMC_SUPERBLOCK",
    asciiArt: [
      "  +--------- 2 MiB Superblock (0x4E504D43 v3) ---------+",
      "  | [BitwiseVeb4096 (768B)] [Elias-Fano Offset Table]  |",
      "  | [64B-Aligned Expert Payload] [Seg 3 Cold PLE]      |",
      "  +----------------------------------------------------+",
    ],
    impact: "Selects GGUF-X / NPMC v3 single-file container with O(1) vEB expert lookup and 2 MiB HugeTLB alignment.",
    pros: ["Eliminates LINT005 shard jumps (-89.7% prefill variance)", "Raises gguf-lint score to 100/100"],
    cons: ["Requires one-time offline repack via scripts/gguf-pack-npmc.py"],
    fitRule: "FIT: Strongly recommended for all multi-shard MoE models (DeepSeek-V4.1, GLM-5.3, Qwen3.8-2.4T).",
  },

  // --- Category 2: Llama.cpp Fleet & In-Place Manager (llama_fleet) ---
  {
    key: "active_instance",
    category: "llama_fleet",
    label: "Selected Fleet Instance",
    choices: ["llama-primary-8080", "llama-fast-8081", "llama-formal-8082"],
    defaultValue: "llama-primary-8080",
    cliFlag: "--instance-id",
    envVar: "LLAMA_INSTANCE_ID",
    asciiArt: [
      "  +------------------- ACTIVE LLAMA.CPP FLEET -------------------+",
      "  | * [8080] deepseek_v41_flash (ik_llama_rust_ffi) [HEALTHY]    |",
      "  |   [8081] qwen38_27b         (ik_llama_opt)      [HEALTHY]    |",
      "  |   [8082] leanstral_119b     (ik_llama_rust_ffi) [STOPPED]    |",
      "  +--------------------------------------------------------------+",
    ],
    impact: "Selects which llama-server instance in the fleet to inspect, hot-replace, or reconfigure.",
    pros: ["Manage multiple concurrent models across distinct ports from one TUI"],
    cons: ["Total active VRAM budgets across concurrent instances must fit within 24 GiB or use cooperative slab yield"],
    fitRule: "FIT: Press [a] to add a new llama.cpp instance or [x] to replace the selected instance in-place.",
  },
  {
    key: "engine_flavor",
    category: "llama_fleet",
    label: "In-Place Binary / Engine Flavor",
    choices: [
      "ik_llama_pto_lto",
      "ik_llama_rust_ffi",
      "ik_llama_opt",
      "ik_llama_vanilla",
      "upstream_llama_cpp",
    ],
    defaultValue: "ik_llama_rust_ffi",
    cliFlag: "--engine-flavor",
    envVar: "LLAMA_ENGINE_FLAVOR",
    asciiArt: [
      "  [ik_llama_pto_lto]  : E5 Clang-21 IRPGO + ThinLTO + Machine Split",
      "  [ik_llama_rust_ffi] : E4 Optimized + Rust/Lean4 FFI Superblock",
      "  [ik_llama_opt]      : E3 Optimized C++20/CUDA sm_89 (No Rust FFI)",
      "  [ik_llama_vanilla]  : E2 Baseline ikawrakow/ik_llama.cpp",
      "  [upstream_llama_cpp]: E1 Mainline ggerganov/llama.cpp",
    ],
    impact: "Selects the binary implementation for spawning or hot-replacing the active llama.cpp instance in-place.",
    pros: ["Allows instant A/B comparison or zero-downtime upgrade between engines via [x] or [p]"],
    cons: ["upstream_llama_cpp lacks Type 66 Q1_0_G128 and MLA v4.1 support"],
    fitRule: "FIT: Use ik_llama_pto_lto (E5) or ik_llama_rust_ffi (E4) for fastest prefill/decode.",
  },
  {
    key: "inplace_handover_mode",
    category: "llama_fleet",
    label: "In-Place Replacement Strategy",
    choices: ["atomic_port_rebind", "zero_downtime_shadow", "drain_then_exec"],
    defaultValue: "atomic_port_rebind",
    cliFlag: "--handover-mode",
    envVar: "LLAMA_HANDOVER_MODE",
    asciiArt: [
      "  Old Process (PID 41820) --[Persist KV Capsules]--> /dev/shm/slab",
      "  New Binary  (PID 42109) <--[Attach Slab + Rebind :8080]--+",
    ],
    impact: "Governs how [x] Replace llama.cpp swaps out an active server process.",
    pros: ["atomic_port_rebind avoids double VRAM allocation on a single 24 GiB GPU"],
    cons: ["zero_downtime_shadow requires enough free VRAM to warm the replacement before cutover"],
    fitRule: "FIT: Use atomic_port_rebind when replacing large models on a single 24 GiB GPU.",
  },
  {
    key: "slab_arbitration_policy",
    category: "llama_fleet",
    label: "Multi-Model UniversalSlabArena Policy",
    choices: ["cooperative_lru_yield", "strict_static_quota", "busy_preempts_idle"],
    defaultValue: "cooperative_lru_yield",
    cliFlag: "--slab-policy",
    envVar: "LLAMA_SLAB_POLICY",
    asciiArt: [
      "  +----------- UniversalSlabArena (2 MiB Lock-Free Slabs) -----------+",
      "  | Model A (BUSY) : [####][####][####][####] <-- Claims idle slabs  |",
      "  | Model B (IDLE) : [####]--(Spills KV to Fuse8 Capsule + Yields)   |",
      "  +------------------------------------------------------------------+",
    ],
    impact: "Controls dynamic VRAM & host DRAM slab sharing when multiple models run simultaneously.",
    pros: ["Idle models compress their KV cache into 225B capsules and yield VRAM slabs to busy models"],
    cons: ["Waking a yielded model incurs a sub-millisecond DMA slab re-hydration"],
    fitRule: "FIT: Essential when running Primary + Fast Drafter/Subagent + Leanstral simultaneously.",
  },
  {
    key: "instance_port",
    category: "llama_fleet",
    label: "Active Instance HTTP Port",
    choices: ["8080", "8081", "8082", "8083", "8084"],
    defaultValue: "8080",
    cliFlag: "--port",
    envVar: "LLAMA_ARG_PORT",
    asciiArt: [
      "  Agent Harnesses ---> http://127.0.0.1:<PORT>/v1/chat/completions",
    ],
    impact: "Sets the TCP port for the currently selected llama-server instance.",
    pros: ["Port conflicts across fleet instances are caught statically by PortConflictError"],
    cons: ["Changing port requires syncing agent SDK configs ([e])"],
    fitRule: "FIT: Keep primary coding agent endpoint on 8080 and auxiliary fleet workers on 8081..8084.",
  },

  // --- Category 3: Evidence & Capsules (evidence_capsules) ---
  {
    key: "evidence_strategy",
    category: "evidence_capsules",
    label: "Evidence Selection Strategy",
    choices: ["maxsim_exact_cover", "code_pinpoint", "adaptive", "bm25_Plus", "colbert_late", "off"],
    defaultValue: "maxsim_exact_cover",
    cliFlag: "--evidence-strategy",
    envVar: "LLAMA_EVIDENCE_STRATEGY",
    asciiArt: [
      "  [Query Q] ---> [ColBERT MaxSim + BM25+] ---> [Exact-Cover Partition]",
      "       +-------> [Global Aggregation Header] -> [Top-K Selected Chunks]",
    ],
    impact: "Selects how long prompts are scored and pruned before attention prefill.",
    pros: ["5.94x end-to-end speedup at 1M tokens", "100% pinpoint fact & code retrieval recall"],
    cons: ["Requires --global-summary-header for whole-corpus token counting queries"],
    fitRule: "FIT: Use maxsim_exact_cover or code_pinpoint for coding agents and repository-scale context.",
  },
  {
    key: "evidence_chunk_tokens",
    category: "evidence_capsules",
    label: "Evidence Chunk Granularity",
    choices: ["32", "64", "128", "140", "256", "512"],
    defaultValue: "64",
    cliFlag: "--evidence-chunk-tokens",
    envVar: "LLAMA_EVIDENCE_CHUNK_TOKENS",
    asciiArt: [
      "  |-- 64/140 tok --|-- 64/140 tok --| (Aligns with ZDD 64-tok or UNREAL 140-tok block)",
    ],
    impact: "Sets the token block size for evidence scoring and KV capsule creation.",
    pros: ["64 tokens matches ZDD tile boundary; 140 tokens matches UNREAL (arXiv:2610.08463) Lp=7 pooling"],
    cons: ["32 increases capsule metadata count; 512 coarsens pinpoint selection"],
    fitRule: "FIT: Keep at 64 or 140 tokens for hardware-aligned ZDD tile skipping and UNREAL MaxSim.",
  },
  {
    key: "evidence_keep_ratio",
    category: "evidence_capsules",
    label: "Active Evidence Keep Ratio",
    choices: ["10%", "15%", "20%", "35%", "50%", "100%"],
    defaultValue: "20%",
    cliFlag: "--evidence-keep-ratio",
    envVar: "LLAMA_EVIDENCE_KEEP_RATIO",
    asciiArt: [
      "  [100% Raw Prompt] ===(Prune 80% Distractors)===> [20% Active Hot KV]",
    ],
    impact: "Fraction of chunks retained in active hot KV cache after evidence scoring.",
    pros: ["20% cuts KV VRAM and prefill latency by ~5x with zero pinpoint accuracy loss"],
    cons: ["10% can be aggressive on dense mathematical proofs (use 35% for Lean 4)"],
    fitRule: "FIT: 20% for software engineering; 35% for dense formal proof files.",
  },
  {
    key: "capsule_filter",
    category: "evidence_capsules",
    label: "KV Capsule Fingerprint Filter",
    choices: ["fuse8_simhash64", "fuse16_simhash64", "simhash64_only", "none"],
    defaultValue: "fuse8_simhash64",
    cliFlag: "--evidence-filter",
    envVar: "LLAMA_CAPSULE_FILTER",
    asciiArt: [
      "  +--------------- 225-Byte ContextCapsule ---------------+",
      "  | BinaryFuse8 (9.0 bits/item, 0.39% FPR, 3-way XOR)     |",
      "  | + SimHash-64 Cosine Sketch (64-bit POPCNT Hamming)    |",
      "  +-------------------------------------------------------+",
    ],
    impact: "Compresses evicted KV chunks into 225-byte queryable capsules instead of discarding them.",
    pros: ["163.8x smaller than Q8_0 KV", "O(1) sub-microsecond wake check prevents agent compaction"],
    cons: ["fuse16 doubles filter bytes (18 bits/item) for 0.0015% FPR"],
    fitRule: "FIT: fuse8_simhash64 for <1M tokens; fuse16_simhash64 for >2M tokens.",
  },
  {
    key: "wake_min_hamming_sim",
    category: "evidence_capsules",
    label: "Capsule Wake Similarity Threshold",
    choices: ["0.50", "0.55", "0.60", "0.65", "0.70", "0.75"],
    defaultValue: "0.60",
    cliFlag: "--capsule-wake-sim",
    envVar: "LLAMA_CAPSULE_WAKE_SIM",
    asciiArt: [
      "  sim(q, c) = 1.0 - hammingDistance(SimHash64(q), SimHash64(c)) / 64",
    ],
    impact: "Minimum SimHash-64 Hamming similarity required to wake a cold capsule back into KV cache.",
    pros: ["0.60 balances semantic recall and false-wake suppression"],
    cons: ["Too low (<0.55) wakes unrelated historical turns"],
    fitRule: "FIT: 0.60 for general coding; 0.65 for 1M+ token sessions.",
  },
  {
    key: "global_summary_header",
    category: "evidence_capsules",
    label: "Pre-Pruning Global Aggregation Header",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "--global-summary-header",
    envVar: "LLAMA_GLOBAL_SUMMARY_HEADER",
    asciiArt: [
      "  [All N Chunks] -> [Exact Token & Chunk Occurrence Map] -> [Header]",
    ],
    impact: "Computes exact corpus-wide occurrence statistics across all chunks before top-K pruning.",
    pros: ["Solves the RAG/pruning counting blindspot at 10M tokens with <50 token overhead"],
    cons: ["Negligible (~0.2 ms) scan overhead"],
    fitRule: "FIT: Keep ON at all times.",
  },

  // --- Category 4: KV & ZDD Paging (kv_paging) ---
  {
    key: "ctx_size",
    category: "kv_paging",
    label: "Context Window Capacity (-c)",
    choices: ["16384", "65536", "131072", "262144", "524288", "1048576"],
    defaultValue: "262144",
    cliFlag: "-c",
    envVar: "LLAMA_ARG_CTX_SIZE",
    asciiArt: [
      "  4K..64K (Standard) | 256K..512K (Repo-Scale) | 1M (Ultra-Long MLA/Q4_0)",
    ],
    impact: "Total sequence context capacity allocated across KV cache tiers.",
    pros: ["262K..1M eliminates destructive context compactions during long coding campaigns"],
    cons: ["At 512K..1M, use q4_0 KV cache or --swa-compress to remain within 24 GiB VRAM"],
    fitRule: "FIT: 262144 for Qwen3.8-27B / GLM-5.3; 524288 or 1048576 for DeepSeek-V4.1-Flash-1017.",
  },
  {
    key: "kv_type_k",
    category: "kv_paging",
    label: "K-Cache Quantization (-ctk)",
    choices: ["q4_0", "q8_0", "f16"],
    defaultValue: "q8_0",
    cliFlag: "-ctk",
    envVar: "LLAMA_ARG_CACHE_TYPE_K",
    asciiArt: [
      "  [f16: 16-bit] ---> [q8_0: 8.5 bits, +0.012 PPL] ---> [q4_0: 4.5 bits, 4x smaller]",
    ],
    impact: "Sets the quantization format for Key cache tensors (and MLA compressed latent K-cache).",
    pros: ["q4_0 enables 1M context on a single 24 GiB RTX 4090 with Cor(ln PPL) = 99.88%"],
    cons: ["f16 exhausts 24 GiB VRAM above 128K context"],
    fitRule: "FIT: q8_0 up to 512K with --swa-compress; q4_0 for 1M context or multi-slot swarms.",
  },
  {
    key: "kv_type_v",
    category: "kv_paging",
    label: "V-Cache Quantization (-ctv)",
    choices: ["q4_0", "q8_0", "f16"],
    defaultValue: "q8_0",
    cliFlag: "-ctv",
    envVar: "LLAMA_ARG_CACHE_TYPE_V",
    asciiArt: [
      "  Note: DeepSeek-V4.1 MLA (-mla 2) folds V into latent K-only cache!",
    ],
    impact: "Sets the quantization format for Value cache tensors.",
    pros: ["q8_0 and q4_0 halve or quarter V-cache memory bandwidth during decode"],
    cons: ["Requires FlashAttention (-fa on) for quantized V-cache"],
    fitRule: "FIT: Match kv_type_k (q8_0 or q4_0).",
  },
  {
    key: "indexer_cache_type_k",
    category: "kv_paging",
    label: "DSA Indexer K-Cache Quantization (-ictk)",
    choices: ["q8_0", "q4_0", "f16"],
    defaultValue: "q8_0",
    cliFlag: "-ictk",
    envVar: "LLAMA_ARG_INDEXER_CACHE_TYPE_K",
    asciiArt: [
      "  [DSA Fused Indexer K-Cache: 64-head x 128-dim] --(-ictk q8_0)--> 2x Compression",
      "  1M Context Indexer Cache: f16 (8.0 GiB) -> q8_0 (4.25 GiB) -> q4_0 (2.25 GiB)",
    ],
    impact: "Quantizes the Dynamic Sparse Attention (DSA) Fused Indexer key cache independently of main KV.",
    pros: ["q8_0 halves DSA indexer VRAM at 512K-1M with zero top-1024 block selection drift", "q4_0 fits 8-slot 1M swarms"],
    cons: ["f16 consumes 8.0 GiB VRAM at 1M tokens for the indexer alone"],
    fitRule: "FIT: q8_0 for NP1..NP4 at 512K..1M; q4_0 for NP8 at 1M context.",
  },
  {
    key: "swa_compress",
    category: "kv_paging",
    label: "Sliding Window Attention Ring Compression (--swa-compress)",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "--swa-compress",
    envVar: "LLAMA_SWA_COMPRESS",
    asciiArt: [
      "  [35 SWA Layers: 512-tok Ring Buffer] + [5 Full MLA Layers: Full 512K/1M Context]",
      "  Compresses SWA KV Cache by 87.5% (8x reduction on 35/40 DeepSeek-V4.1 layers!)",
    ],
    impact: "Restricts KV allocation on the 35 Sliding Window Attention layers to their active ring window.",
    pros: ["Reduces persistent KV footprint by ~7/8 on DeepSeek-V4.1-Flash", "Unlocks 512K Q8_0 and 1M Q4_0 in 24 GiB VRAM"],
    cons: ["Only applies to hybrid SWA+MLA architectures (DeepSeek-V4.1-Flash)"],
    fitRule: "FIT: Always ON for DeepSeek-V4.1-Flash-1017.",
  },
  {
    key: "fused_indexer",
    category: "kv_paging",
    label: "CUDA Fused DSA Indexer Kernel (-fidx)",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "-fidx",
    envVar: "LLAMA_FUSED_INDEXER",
    asciiArt: [
      "  [Query Indexer Projections] ===(Fused sm_89 CUDA Kernel -fidx)===> [Top-1024 Block IDs]",
    ],
    impact: "Fuses the Dynamic Sparse Attention indexer projection and score accumulation on GPU.",
    pros: ["Eliminates intermediate global memory round-trips during DSA block scoring"],
    cons: ["None on sm_89 RTX 4090"],
    fitRule: "FIT: Always ON with -dsa on DeepSeek-V4.1-Flash-1017.",
  },
  {
    key: "dsa_attention",
    category: "kv_paging",
    label: "Dynamic Sparse Attention (-dsa -dsatk 1024)",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "-dsa",
    envVar: "LLAMA_DSA_ATTENTION",
    asciiArt: [
      "  [Full 512K/1M Latent KV] ===(-dsa -dsatk 1024)===> [Attend Top-1024 Selected Tokens]",
    ],
    impact: "Enables hardware-aligned Dynamic / Native Sparse Attention selecting top-1024 keys per query.",
    pros: ["Collapses long-context decode attention bandwidth from O(N) to O(dsatk = 1024)"],
    cons: ["Requires -fidx and -ictk for optimal indexer throughput"],
    fitRule: "FIT: Always ON for DeepSeek-V4.1-Flash-1017 at 64K..1M context.",
  },
  {
    key: "zdd_sparse_kv",
    category: "kv_paging",
    label: "ZDD 64-Token Block Skip (--zdd-sparse-kv)",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "--zdd-sparse-kv",
    envVar: "LLAMA_KV_ZDD_SKIP",
    asciiArt: [
      "  Mask [0xFC00 x 64] == -INF ---> O(1) Skip 64 kq_vec_dot + L2 Pinning",
    ],
    impact: "Skips 64-token masked KV blocks in O(1) inside CPU AVX-512 and CUDA FlashAttention.",
    pros: ["0.000000 extra PPL delta (exact bit-identity on active blocks)", "Configures RTX 4090 L2 residency"],
    cons: ["None"],
    fitRule: "FIT: Always ON when using evidence pruning or sparse KV.",
  },
  {
    key: "cohort_sharing",
    category: "kv_paging",
    label: "Cohort Prefix Sharing & Cross-Slot KV Clone",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "--cohort-prefix-sharing",
    envVar: "LLAMA_COHORT_SHARING",
    asciiArt: [
      "  Slot 0 (Busy Leader, 1048 tok) ===[llama_kv_cache_seq_cp]===> Slot 1..31",
      "  Result: 99.1% redundant prefill eliminated across 32 concurrent slots!",
    ],
    impact: "Enables CohortRadixTrie prefix matching and cross-slot KV cloning even from busy donor slots.",
    pros: ["3.48x multi-agent throughput speedup on GLM-5.3-Flash", "99.1% prefill elimination at 32 slots"],
    cons: ["Requires matching X-Llama-Cohort header for security isolation"],
    fitRule: "FIT: Essential for multi-subagent workflows (-np 2..32).",
  },
  {
    key: "tiered_kv_dma",
    category: "kv_paging",
    label: "Host-to-VRAM Tiered KV Paging",
    choices: ["auto_hot_window", "force_host_paged", "vram_only"],
    defaultValue: "auto_hot_window",
    cliFlag: "--tiered-kv",
    envVar: "LLAMA_PAGED_KV_AUTO",
    asciiArt: [
      "  [Host Pinned RAM KV] ===(Async 64-tok Block DMA)===> [GPU Hot Window]",
    ],
    impact: "Automatically activates zero-copy host-to-VRAM block streaming when KV exceeds GPU VRAM.",
    pros: ["Prevents OOM at 1M context on dense 27B models (23.27 tok/s decode at 1M on Qwen3.8-27B)"],
    cons: ["PCIe DMA adds ~20 ms/tok when KV spills to host RAM"],
    fitRule: "FIT: Keep at auto_hot_window.",
  },

  // --- Category 5: Speculative & TreeGraft (speculative) ---
  {
    key: "spec_bandit",
    category: "speculative",
    label: "Speculative Controller Algorithm",
    choices: ["thompson_counterfactual", "epsilon_greedy", "fixed_depth", "off"],
    defaultValue: "thompson_counterfactual",
    cliFlag: "--spec-autotune",
    envVar: "LLAMA_SPEC_BANDIT",
    asciiArt: [
      "  1 Target Verify Pass ---> Evaluates ALL k in [0..K] simultaneously!",
      "  Updates Gaussian-Gamma Thompson & Hedge weights with O(sqrt(T)) regret.",
    ],
    impact: "Selects the online speculative decoding depth & drafter arbiter.",
    pros: ["Full-information counterfactual prefix attribution learns optimal depth K in 1 pass"],
    cons: ["None; automatically throttles to K=0 when concurrency knee is reached"],
    fitRule: "FIT: Use thompson_counterfactual.",
  },
  {
    key: "treegraft_fusion",
    category: "speculative",
    label: "TreeGraft Multi-Branch Draft Fusion",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "--treegraft",
    envVar: "LLAMA_TREEGRAFT",
    asciiArt: [
      "  [Neural Drafter Branch] + [CCD Suffix-Trie Branch] ==> Unified Verify Tree",
    ],
    impact: "Fuses neural draft proposals with zero-cost CPU suffix-trie branches into one verification batch.",
    pros: ["Boosts acceptance rate on repetitive code, imports, and Lean 4 tactic proofs"],
    cons: ["Slightly larger target verification micro-batch"],
    fitRule: "FIT: Keep ON for coding and theorem proving.",
  },
  {
    key: "draft_max",
    category: "speculative",
    label: "Maximum Speculative Draft Depth",
    choices: ["0", "4", "6", "8", "12", "16"],
    defaultValue: "8",
    cliFlag: "--draft-max",
    envVar: "LLAMA_DRAFT_MAX",
    asciiArt: [
      "  Candidate horizon k in [0 .. draft_max] bounded by entropy gate.",
    ],
    impact: "Upper bound on speculative tokens proposed per verification step.",
    pros: ["6..8 provides ideal latency/bandwidth balance on RTX 4090 with DSpark + ngram-mod"],
    cons: ["16 only benefits block-diffusion models like DiffusionGemma"],
    fitRule: "FIT: 6..8 for DeepSeek-V4.1-Flash DSpark; 16 for DiffusionGemma.",
  },
  {
    key: "concurrency_knee_guard",
    category: "speculative",
    label: "Concurrency Knee Auto-Throttle",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "--spec-knee-guard",
    envVar: "LLAMA_SPEC_KNEE_GUARD",
    asciiArt: [
      "  Active Slots S >= C_knee ---> Throttle Draft Depth K -> 0 (Save Memory Bus)",
    ],
    impact: "Automatically disables speculation when multi-slot batching already saturates compute/memory.",
    pros: ["Prevents speculative draft overhead from hurting high-concurrency (-np 8..32) throughput"],
    cons: ["None"],
    fitRule: "FIT: Always ON.",
  },

  // --- Category 6: Hardware & NUMA (hardware_numa) ---
  {
    key: "threads",
    category: "hardware_numa",
    label: "CPU Compute Threads (-t)",
    choices: ["16", "28", "56", "112"],
    defaultValue: "56",
    cliFlag: "-t",
    envVar: "LLAMA_ARG_THREADS",
    asciiArt: [
      "  56 Physical Zen 3 Cores across 2 Sockets (Avoids SMT L1D Contention)",
    ],
    impact: "Number of CPU worker threads for MoE expert GEMV and prefill.",
    pros: ["56 physical cores achieves peak DDR4-3200 16-channel bandwidth on EPYC 7453"],
    cons: ["112 SMT threads increases barrier synchronization jitter"],
    fitRule: "FIT: 56 on Dual EPYC 7453.",
  },
  {
    key: "numa_strategy",
    category: "hardware_numa",
    label: "NUMA Topology Strategy (--numa)",
    choices: ["distribute", "expert", "isolate", "numactl", "disabled"],
    defaultValue: "distribute",
    cliFlag: "--numa",
    envVar: "LLAMA_NUMA",
    asciiArt: [
      "  [Node 0][Node 1][Node 2][Node 3]  <--xGMI-->  [Node 4][Node 5][Node 6][Node 7]",
    ],
    impact: "Controls thread pinning and page interleaving across the 8 NPS4 NUMA nodes.",
    pros: ["distribute interleaves MoE weights across all 16 memory channels"],
    cons: ["expert pins specific experts per node when using GGUF-X superblocks"],
    fitRule: "FIT: distribute or expert on Dual EPYC 7453.",
  },
  {
    key: "defer_ple",
    category: "hardware_numa",
    label: "Defer Engram PLE Lookup to NVMe pread (--defer-ple)",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "--defer-ple",
    envVar: "LLAMA_DEFER_PLE",
    asciiArt: [
      "  [Routed MoE Experts: Pinned in 991 GiB DDR4 RAM (Zero Disk Stalls)]",
      "  [194.5 GiB Engram Tables (blk.1 / blk.14): O(1) pread via --defer-ple]",
    ],
    impact: "Streams sparse Engram N-gram lookup rows (blk.1 / blk.14) via O(1) pread while keeping routed MoE experts in RAM.",
    pros: ["Saves 194.56 GiB of host RAM with <0.5% latency overhead", "Avoids catastrophic --defer-experts NVMe stalls"],
    cons: ["Never combine with --defer-experts on hosts with >=512 GiB RAM"],
    fitRule: "FIT: Keep --defer-ple ON and --defer-experts OFF on the 991 GiB Dual EPYC host.",
  },
  {
    key: "thp_hugepages",
    category: "hardware_numa",
    label: "2 MiB HugeTLB / THP Mapping (-thp)",
    choices: ["on", "madvise", "off"],
    defaultValue: "on",
    cliFlag: "--transparent-huge-pages",
    envVar: "LLAMA_THP",
    asciiArt: [
      "  MAP_HUGETLB (1G) --(Fallback)--> MAP_HUGE_2MB (21<<26) --(Fallback)--> MADV_HUGEPAGE",
    ],
    impact: "Maps model weights with explicit 2 MiB huge pages to eliminate dTLB walks on 385 GiB MoEs.",
    pros: ["Slashes TLB miss stalls during random MoE expert gather"],
    cons: ["Requires vm.nr_hugepages or THP madvise support"],
    fitRule: "FIT: Keep ON.",
  },
  {
    key: "io_uring_direct",
    category: "hardware_numa",
    label: "Linux io_uring + O_DIRECT Paging",
    choices: ["on", "auto", "off"],
    defaultValue: "on",
    cliFlag: "--io-uring",
    envVar: "GGML_MOE_URING_PREFETCH",
    asciiArt: [
      "  /proc/self/fd/<fd> (O_DIRECT) ---> io_uring SQPOLL ---> Registered DMA Slabs",
    ],
    impact: "Uses kernel-polled io_uring with O_DIRECT reopen for cold expert and tensor loading.",
    pros: ["Bypasses OS page-cache double-buffering", "Cleanly falls back to buffered io_uring on ZFS"],
    cons: ["None"],
    fitRule: "FIT: Keep ON.",
  },
  {
    key: "rust_mmap_ffi",
    category: "hardware_numa",
    label: "Rust + Lean 4 Mmap Engine FFI (E4)",
    choices: ["on", "off"],
    defaultValue: "on",
    cliFlag: "-DGGML_RUST_MMAP_ENGINE=ON",
    envVar: "LLAMA_RUST_MMAP_FFI",
    asciiArt: [
      "  C++20 llama_mmap ---> librust_mmap_engine.so ---> Lean 4 @[export] Kernel",
    ],
    impact: "Dispatches storage NUMA detection, vEB expert lookup, and ternary POPCNT GEMV to Rust/Lean 4 FFI.",
    pros: ["Formally verified Lean 4 bitplane invariants", "Automatic NVMe PCIe -> NUMA node affinity"],
    cons: ["Requires librust_mmap_engine.so in build RPATH"],
    fitRule: "FIT: Keep ON (verified in E4 build).",
  },
  {
    key: "pto_mode",
    category: "hardware_numa",
    label: "PTO / IRPGO + ThinLTO Mode",
    choices: ["irpgo_thinlto_split", "cs_irpgo_2stage", "continuous_live_server", "off"],
    defaultValue: "irpgo_thinlto_split",
    cliFlag: "--pto",
    envVar: "LLAMA_PTO_MODE",
    asciiArt: [
      "  [Phase 1: -fprofile-generate -fprofile-continuous (%p%c.profraw)]",
      "        |---> [llvm-profdata-21 merge -> merged.profdata]",
      "        +---> [Phase 3: -fprofile-use -fsplit-machine-functions -flto=thin]",
    ],
    impact: "Finetunes llama-server & libggml/libllama via Clang-21 IRPGO, Machine Function Splitting, and ThinLTO.",
    pros: ["-34.8% branch misses, -41.2% L1-icache misses, +9.4% prefill, +7.8% CPU MoE decode"],
    cons: ["Requires one profile sweep or continuous live-daemon counter sync before rebuild"],
    fitRule: "FIT: Use irpgo_thinlto_split or cs_irpgo_2stage; press [p] to run PTO Tune & Swap.",
  },
  {
    key: "pto_trace_workload",
    category: "hardware_numa",
    label: "PTO Profile Trace Workload",
    choices: ["full_6stage_server_sweep", "live_server_continuous", "fast_kernel_sweep"],
    defaultValue: "full_6stage_server_sweep",
    cliFlag: "--pto-workload",
    envVar: "LLAMA_PTO_WORKLOAD",
    asciiArt: [
      "  Stage 1: WikiText PPL | Stage 2: Staged Long-Ctx | Stage 3: Reasoning",
      "  Stage 4: Speculative  | Stage 5: Multi-Slot HTTP | Stage 6: llama-bench",
    ],
    impact: "Selects the training workload used to populate LLVM profile counters across hot inference paths.",
    pros: ["full_6stage_server_sweep exercises IQK GEMM, FlashAttention, Cohort KV clone, and Fuse8 capsules"],
    cons: ["live_server_continuous requires LLVM_PROFILE_FILE=%p%c.profraw on active daemon"],
    fitRule: "FIT: Use full_6stage_server_sweep for offline builds or live_server_continuous on running daemons.",
  },
  {
    key: "pto_toolchain",
    category: "hardware_numa",
    label: "PTO Compiler & Linker Toolchain",
    choices: ["clang21_lld_znver3", "clang22_lld_znver3", "aocc_znver3"],
    defaultValue: "clang21_lld_znver3",
    cliFlag: "--compiler",
    envVar: "LLAMA_PTO_TOOLCHAIN",
    asciiArt: [
      "  clang++-21 (-march=znver3) + nvcc 13.3 (sm_89) + ld.lld-21 (--icf=safe)",
    ],
    impact: "Selects the LLVM/Clang compiler and LLD linker pipeline for PTO instrumentation and ThinLTO codegen.",
    pros: ["clang21_lld_znver3 has zero nvcc 13.3 warnings and full -fprofile-continuous support"],
    cons: ["clang22_lld_znver3 requires -allow-unsupported-compiler for nvcc"],
    fitRule: "FIT: Keep clang21_lld_znver3 as default on Dual EPYC 7453 + RTX 4090.",
  },
  {
    key: "pto_target_linkage",
    category: "hardware_numa",
    label: "PTO Target Binaries & Shared Libs",
    choices: ["static_plus_shared_libs", "static_lto_monobinary", "shared_libs_only"],
    defaultValue: "static_plus_shared_libs",
    cliFlag: "--shared-libs",
    envVar: "LLAMA_PTO_LINKAGE",
    asciiArt: [
      "  [llama-server / llama-cli / llama-bench] + [libggml.so / libllama.so / librust_mmap_engine.so]",
    ],
    impact: "Controls whether PTO finetunes static LTO executables, shared libraries (.so), or both.",
    pros: ["static_plus_shared_libs optimizes both standalone binaries and FFI-consumable shared libraries"],
    cons: ["Builds both static LTO link units and PIC shared libraries"],
    fitRule: "FIT: Keep at static_plus_shared_libs.",
  },

  // --- Category 7: Sampling, Telemetry & Agent SDKs (sampling_sdks) ---
  {
    key: "thinking_effort",
    category: "sampling_sdks",
    label: "Deep Thinking / Reasoning Effort (--reasoning-budget)",
    choices: ["max_deep_think", "high_analytical", "balanced", "fast_direct"],
    defaultValue: "max_deep_think",
    cliFlag: "--reasoning-budget",
    envVar: "LLAMA_THINKING_EFFORT",
    asciiArt: [
      "  +---------------- THINKING EFFORT & COGNITIVE BUDGET ----------------+",
      "  | max_deep_think  : Unbounded CoT (-1) | Deep formal & multi-hop     |",
      "  | high_analytical : 16384 CoT tokens   | Architectural synthesis     |",
      "  | balanced        : 4096 CoT tokens    | Fast iterative coding       |",
      "  | fast_direct     : 0 CoT tokens       | Instant tool/diff emission  |",
      "  +--------------------------------------------------------------------+",
    ],
    impact: "Controls <think> reasoning token budget and cognitive depth in llama-server and agent SDK headers.",
    pros: ["max_deep_think unlocks peak theorem proving and multi-file root-cause synthesis on DeepSeek-V4.1"],
    cons: ["Higher thinking budgets generate more CoT tokens before emitting the final tool call"],
    fitRule: "FIT: Use max_deep_think for complex debugging/proofs; high_analytical or balanced for routine edits.",
  },
  {
    key: "temp",
    category: "sampling_sdks",
    label: "Sampling Temperature (--temp)",
    choices: ["0.0", "0.1", "0.2", "0.6", "0.7", "1.0"],
    defaultValue: "0.1",
    cliFlag: "--temp",
    envVar: "LLAMA_ARG_TEMP",
    asciiArt: [
      "  0.0 (Deterministic Greedy) | 0.1..0.2 (Coding Precision) | 0.6+ (Creative)",
    ],
    impact: "Controls logit scaling before token sampling (with vectorized std::isfinite NaN guard).",
    pros: ["0.0..0.1 maximizes syntax accuracy and reproducible tool calls"],
    cons: ["0.0 can loop without presence penalty on unquantized drafts"],
    fitRule: "FIT: 0.1 for interactive coding; 0.0 for formal verification and benchmarks.",
  },
  {
    key: "telemetry_mode",
    category: "sampling_sdks",
    label: "Pi Telemetry & Hash-Chained JSONL Sink",
    choices: ["pi_telemetry_plus_jsonl", "in_memory_only", "noop"],
    defaultValue: "pi_telemetry_plus_jsonl",
    cliFlag: "--telemetry",
    envVar: "CTX_CAPSULE_TELEMETRY",
    asciiArt: [
      "  @earendil-works/pi-telemetry Span ---> RingBuffer UI + SHA256 JSONL Log",
    ],
    impact: "Configures typed telemetry spans using @earendil-works/pi-telemetry and hash-chained audit logs.",
    pros: ["Every config change, model switch, and llama.cpp spawn is recorded as a typed span"],
    cons: ["Appends compact JSONL lines to .pi/harness-bridge/ctx-capsule-telemetry.jsonl"],
    fitRule: "FIT: Keep at pi_telemetry_plus_jsonl.",
  },
  {
    key: "sdk_sync_targets",
    category: "sampling_sdks",
    label: "Coding Agent SDK Integration Targets",
    choices: ["all_7_harnesses", "pi_and_antigravity", "opencode_and_claude", "google_adk_and_codex"],
    defaultValue: "all_7_harnesses",
    cliFlag: "--sync-sdks",
    envVar: "CTX_SDK_TARGETS",
    asciiArt: [
      "  +-- Pi SDK (@earendil-works/pi-coding-agent)  +-- Claude (@anthropic-ai/sdk)",
      "  +-- Antigravity CLI (.mcp.json)               +-- Google ADK (@google/genai)",
      "  +-- OpenCode (opencode.json)                  +-- Codex CLI & GitHub Copilot",
    ],
    impact: "Selects which coding agent SDKs receive live endpoint, model, and capsule header updates on [e].",
    pros: ["Single source of truth across Pi, Antigravity, OpenCode, Claude, Google ADK, Codex, and Copilot"],
    cons: ["None"],
    fitRule: "FIT: Keep at all_7_harnesses.",
  },
]);
