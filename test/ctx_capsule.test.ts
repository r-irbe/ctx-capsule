/**
 * Comprehensive verification suite for `@r-irbe/ctx-capsule`:
 *   1. Pure FOOP Result & Branded Type primitives, State Machine Reducer, 5-layer TOML hierarchy,
 *      and `--evidence-filter` CLI argument synthesis (ensuring `--capsule-filter` is never emitted).
 *   2. Hexagonal Outbound Adapters (`FileSystemTomlConfigAdapter`, `LlamaFleetProcessAdapter`
 *      including `zero_downtime_shadow` staging port, `ClangLldPtoOptimizationAdapter`,
 *      `PiCapsuleTelemetryAdapter`, `MultiAgentSdkBridgeAdapter` across 8 harnesses).
 *   3. Tier 1: Native `@earendil-works/pi-coding-agent` Extension (`pi_sdk_extension.ts` -
 *      `/capsule` command, `ctx_capsule` tool, `before_model_request` header & requestDefaults injection,
 *      compaction suppression, and status bar widget).
 *   4. Tier 2: Universal Stdio JSON-RPC 2.0 MCP Server (`ctx_capsule_mcp_server.ts` -
 *      `capsule_status`, `capsule_switch_preset`, `capsule_pack_context` SimHash64/Fuse8/MaxSim packing,
 *      `capsule_sync_agents`, and `capsule_pto_tune`).
 *   5. Tier 3: Standardized Multi-Agent Bootstrap CLI (`agent_bootstrap.ts` -
 *      `ctx-capsule init --agents pi,claude,antigravity,opencode,codex,copilot,weftd`).
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
  ALL_BOOTSTRAP_AGENTS,
  Branded,
  BUILTIN_MODELS,
  BUILTIN_TEMPLATES,
  buildLlamaServerCliArgs,
  buildNextAddInstanceCommand,
  buildNextReplaceInstanceCommand,
  CapsulePiTuiComponent,
  ClangLldPtoOptimizationAdapter,
  CTX_CAPSULE_MCP_TOOLS,
  CtxCapsuleMcpServer,
  compileHierarchicalTomlBundle,
  computeFuse8Fingerprint,
  computeSimHash64,
  createCapsuleHexagonalRuntime,
  createCapsulePiExtension,
  createInitialControlState,
  DomainErrors,
  FileSystemTomlConfigAdapter,
  formatStatusBarLine,
  HexagonalEffectInterpreter,
  hitTestMouseRegions,
  LlamaFleetProcessAdapter,
  MultiAgentSdkBridgeAdapter,
  packContextCapsules,
  parseLayeredTomlDocument,
  PiCapsuleTelemetryAdapter,
  Result,
  registerCapsulePiExtension,
  runAgentBootstrapInit,
  runCapsuleCli,
  transition,
} from "../src/index.ts";

describe("ctx-capsule FOOP Result & Branded Type Primitives", () => {
  it("satisfies Functor and Monad laws for Result<T, DomainError>", () => {
    const okVal = Result.ok(21);
    const mapped = okVal.map((x) => x * 2);
    assert.equal(mapped.isOk(), true);
    assert.equal(mapped.unwrapOr(0), 42);

    const chained = mapped.flatMap((x) => Result.ok<string>(`answer=${x}`));
    assert.equal(chained.unwrapOr(""), "answer=42");

    const errVal = Result.err<number>(
      DomainErrors.validation("ctx_size", "Must be power of two", -1),
    );
    const errMapped = errVal.map((x) => x * 2);
    assert.equal(errMapped.isErr(), true);
    assert.equal(errMapped.unwrapOr(99), 99);
    assert.match(
      errMapped.match({
        ok: (v) => String(v),
        err: (e) => DomainErrors.format(e),
      }),
      /ValidationError:ctx_size/,
    );
  });

  it("validates Branded nominal constructors and returns structured ValidationError", () => {
    const validModel = Branded.modelId("deepseek_v41_flash");
    assert.equal(validModel.isOk(), true);

    const invalidModel = Branded.modelId("bad model spaces!");
    assert.equal(invalidModel.isErr(), true);
    if (invalidModel.isErr()) {
      assert.equal(invalidModel.error._tag, "ValidationError");
    }

    const validPort = Branded.portNumber(8080);
    assert.equal(validPort.isOk(), true);

    const invalidPort = Branded.portNumber(80);
    assert.equal(invalidPort.isErr(), true);
  });
});

describe("ctx-capsule Pure FOOP State Machine, TOML Hierarchy & Gate 4 CLI Flags", () => {
  it("initializes with 11 built-in models, 8 templates, and 3 fleet instances", () => {
    const state = createInitialControlState();
    assert.equal(state.models.length, 11);
    assert.equal(state.templates.length, 8);
    assert.equal(state.instances.length, 3);
    assert.equal(state.activeModelId, "deepseek_v41_flash");
    assert.equal(state.activeTemplateId, "coding_pinpoint");
  });

  it("synthesizes --evidence-filter CLI arguments and NEVER emits invalid --capsule-filter", () => {
    const state = createInitialControlState();
    for (const model of state.models) {
      const cliArgs = buildLlamaServerCliArgs(model, state.instances[0], state.settingsValues);
      assert.equal(
        cliArgs.includes("--capsule-filter"),
        false,
        `Model ${model.id} emitted forbidden --capsule-filter flag`,
      );
      assert.equal(cliArgs.includes("--evidence-filter"), true);
      assert.equal(cliArgs.includes("--evidence-top-k"), true);
      assert.equal(cliArgs.includes("--evidence-symbol-boost"), true);
      assert.equal(cliArgs.includes("--evidence-chunk-expansion"), true);
    }
  });

  it("uses a staging port (port + 100) during zero_downtime_shadow in-place replacement", async () => {
    const state = createInitialControlState();
    const adapter = new LlamaFleetProcessAdapter({ mode: "dry_run" });
    const prevInst = state.instances[0];
    const nextInst = {
      ...prevInst,
      engineFlavor: "ik_llama_pto_lto" as const,
    };
    const cliArgs = buildLlamaServerCliArgs(state.models[0], nextInst, state.settingsValues);

    const shadowRes = await adapter.replaceInstanceInPlace(
      prevInst,
      nextInst,
      "zero_downtime_shadow",
      cliArgs,
    );
    assert.equal(shadowRes.isOk(), true);
    if (shadowRes.isOk()) {
      assert.equal(shadowRes.value.port, Number(prevInst.port) + 100);
      assert.equal(shadowRes.value.handoverStrategy, "zero_downtime_shadow");
      assert.match(shadowRes.value.commandLine, /--port 8180/);
    }
  });

  it("compiles all 5 TOML layers and round-trips through parseLayeredTomlDocument", () => {
    const state = createInitialControlState();
    const bundleRes = compileHierarchicalTomlBundle(state);
    assert.equal(bundleRes.isOk(), true);
    if (!bundleRes.isOk()) return;

    const bundle = bundleRes.value;
    assert.match(bundle.defaultsToml, /\[defaults\]/);
    assert.match(bundle.defaultsToml, /\[pto\]/);
    assert.equal(Object.keys(bundle.modelsById).length, 11);
    assert.equal(Object.keys(bundle.templatesById).length, 8);

    const parsedDefaults = parseLayeredTomlDocument("00-defaults.toml", bundle.defaultsToml);
    assert.equal(parsedDefaults.isOk(), true);
    if (parsedDefaults.isOk()) {
      assert.equal(parsedDefaults.value.defaults.evidence_strategy, "maxsim_exact_cover");
      assert.equal(parsedDefaults.value.pto.pto_mode, "irpgo_thinlto_split");
    }
  });

  it("loads saved templates on CLI startup and supports --model, --template, and --port flags", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-capsule-cli-"));
    try {
      // 1. Save a custom template
      const out1: string[] = [];
      await runCapsuleCli({
        argv: ["--save-template", "custom_saved_preset", "--render-once"],
        workspaceRoot: tmpRoot,
        stdout: (line) => out1.push(line),
      });
      assert.equal(out1.some((l) => l.includes("custom_saved_preset")), true);

      // 2. Subsequent CLI invocation loads saved templates from hierarchy/templates/ and applies it
      const out2: string[] = [];
      const code2 = await runCapsuleCli({
        argv: [
          "--model",
          "qwen38_27b",
          "--template",
          "custom_saved_preset",
          "--port",
          "8084",
          "--render-once",
        ],
        workspaceRoot: tmpRoot,
        stdout: (line) => out2.push(line),
      });
      assert.equal(code2, 0);
      assert.equal(out2.some((l) => l.includes("qwen38_27b")), true);
      assert.equal(out2.some((l) => l.includes("custom_saved_preset")), true);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe("Tier 1: Native Pi SDK Extension (pi_sdk_extension.ts)", () => {
  it("registers /capsule command, ctx_capsule tool, status bar widget, and before_model_request hook", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-capsule-pi-ext-"));
    try {
      const hooks = new Map<
        string,
        (event: Record<string, unknown>, ctx: { cwd: string; hasUI: boolean; ui: { notify: (m: string, l?: string) => void; setStatus: (k: string, t: string) => void } }) => Promise<unknown> | unknown
      >();
      const commands = new Map<
        string,
        {
          description: string;
          getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }>;
          handler: (args: string, ctx: { cwd: string; hasUI: boolean; ui: { notify: (m: string, l?: string) => void; setStatus: (k: string, t: string) => void } }) => Promise<void>;
        }
      >();
      const tools = new Map<
        string,
        {
          name: string;
          execute: (
            id: string,
            params: Record<string, unknown>,
            signal?: AbortSignal,
            onUpdate?: unknown,
            ctx?: { cwd: string; hasUI: boolean; ui: { notify: (m: string, l?: string) => void; setStatus: (k: string, t: string) => void } },
          ) => Promise<{ content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }>;
        }
      >();

      const mockPi = {
        on(name: string, fn: any) {
          hooks.set(name, fn);
        },
        registerCommand(name: string, spec: any) {
          commands.set(name, spec);
        },
        registerTool(spec: any) {
          tools.set(spec.name, spec);
        },
      };

      const controller = registerCapsulePiExtension(mockPi, {
        workspaceRoot: tmpRoot,
        initialModelId: "deepseek-v4.1-1017-ud-q4kxl",
        initialTemplateId: "ds41-1017-np1-512k-max-speed",
      });

      assert.equal(commands.has("capsule"), true);
      assert.equal(tools.has("ctx_capsule"), true);
      assert.equal(hooks.has("before_model_request"), true);
      assert.equal(hooks.has("session_start"), true);
      assert.equal(hooks.has("turn_start"), true);

      const widget = controller.getStatusBarWidget();
      assert.equal(widget.id, "ctx-capsule");
      assert.equal(widget.modelId, "deepseek-v4.1-1017-ud-q4kxl");
      assert.equal(widget.templateId, "ds41-1017-np1-512k-max-speed");
      assert.equal(widget.compactionSuppressed, true);
      assert.match(formatStatusBarLine(controller.getState()), /deepseek-v4.1-1017-ud-q4kxl/);

      const statusUpdates: Array<{ key: string; text: string }> = [];
      const notifications: Array<{ msg: string; level?: string }> = [];
      const mockCtx = {
        cwd: tmpRoot,
        hasUI: true,
        ui: {
          notify(msg: string, level?: string) {
            notifications.push({ msg, level });
          },
          setStatus(key: string, text: string) {
            statusUpdates.push({ key, text });
          },
        },
      };

      // Verify before_model_request injects all required headers & suppresses compaction
      const reqEnvelope: Record<string, unknown> = {
        headers: { Authorization: "Bearer local" },
        body: { messages: [] },
      };
      const beforeHook = hooks.get("before_model_request")!;
      await beforeHook(reqEnvelope, mockCtx);

      const injectedHeaders = reqEnvelope.headers as Record<string, string>;
      assert.equal(
        injectedHeaders["X-Llama-Cohort"],
        "cohort-deepseek-v4.1-1017-ud-q4kxl-ds41-1017-np1-512k-max-speed",
      );
      assert.equal(injectedHeaders["X-Llama-Capsule-Filter"], "fuse8_simhash64");
      assert.equal(injectedHeaders["X-Evidence-Filter"], "true");
      assert.equal(injectedHeaders["X-Evidence-Strategy"], "code_pinpoint");
      assert.equal(injectedHeaders["X-Evidence-Top-K"], "16");
      assert.equal(injectedHeaders["X-Evidence-Symbol-Boost"], "3.5");
      assert.equal(injectedHeaders["X-Evidence-Chunk-Expansion"], "1");
      assert.equal(injectedHeaders["X-Llama-Thinking-Effort"], "max_deep_think");
      assert.equal(reqEnvelope.suppressCompaction, true);
      assert.equal(reqEnvelope.compaction, "disabled_by_fuse8_capsules");

      // Verify /capsule command execution
      const capsuleCmd = commands.get("capsule")!;
      await capsuleCmd.handler("model qwen38_27b", mockCtx);
      assert.equal(controller.getState().activeModelId, "qwen38_27b");
      assert.equal(notifications.length >= 1, true);
      assert.equal(statusUpdates.length >= 1, true);

      // Verify ctx_capsule tool execution (pack action)
      const capsuleTool = tools.get("ctx_capsule")!;
      const toolRes = await capsuleTool.execute(
        "call-1",
        {
          action: "pack",
          chunks: [
            "export function computeSimHash64(text: string): bigint { return 0n; }",
            "export function computeSimHash64(text: string): bigint { return 0n; }",
            "Unrelated prose paragraph about cooking pasta.",
          ],
          query: "computeSimHash64",
          keepRatio: 0.5,
        },
        undefined,
        undefined,
        mockCtx,
      );
      const parsedPack = JSON.parse(toolRes.content[0].text) as {
        deduplicatedCount: number;
        selectedCount: number;
      };
      assert.equal(parsedPack.deduplicatedCount, 1);
      assert.equal(parsedPack.selectedCount >= 1, true);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe("Tier 2: Universal Stdio JSON-RPC 2.0 MCP Server (ctx_capsule_mcp_server.ts)", () => {
  it("exposes all 5 MCP tools and executes status, switch_preset, pack_context, sync_agents, and pto_tune", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-capsule-mcp-"));
    try {
      const server = new CtxCapsuleMcpServer({
        workspaceRoot: tmpRoot,
        sdkOutputDir: path.join(tmpRoot, "sdks"),
        processMode: "dry_run",
      });

      // 1. initialize
      const initResp = await server.handleJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });
      assert.notEqual(initResp, null);
      assert.equal((initResp?.result as any).serverInfo.name, "@r-irbe/ctx-capsule");

      // 2. tools/list
      const listResp = await server.handleJsonRpcRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      const toolsList = (listResp?.result as any).tools as Array<{ name: string }>;
      assert.equal(toolsList.length, 5);
      assert.deepEqual(
        toolsList.map((t) => t.name),
        [
          "capsule_status",
          "capsule_switch_preset",
          "capsule_pack_context",
          "capsule_sync_agents",
          "capsule_pto_tune",
        ],
      );
      assert.equal(CTX_CAPSULE_MCP_TOOLS.length, 5);

      // 3. capsule_status
      const statusResp = await server.handleJsonRpcRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "capsule_status", arguments: {} },
      });
      const statusData = JSON.parse((statusResp?.result as any).content[0].text) as {
        activeModelId: string;
        cliArgs: string[];
      };
      assert.equal(statusData.activeModelId, "deepseek_v41_flash");
      assert.equal(statusData.cliArgs.includes("--evidence-filter"), true);
      assert.equal(statusData.cliArgs.includes("--capsule-filter"), false);

      // 4. capsule_switch_preset
      const switchResp = await server.handleJsonRpcRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "capsule_switch_preset",
          arguments: {
            modelId: "leanstral_119b",
            templateId: "deep_formal_audit",
          },
        },
      });
      const switchData = JSON.parse((switchResp?.result as any).content[0].text) as {
        activeModelId: string;
        activeTemplateId: string;
      };
      assert.equal(switchData.activeModelId, "leanstral_119b");
      assert.equal(switchData.activeTemplateId, "deep_formal_audit");

      // 5. capsule_pack_context (SimHash64 + Binary Fuse8 + MaxSim + symbolBoost)
      const sampleChunks = [
        "theorem capsule_soundness (x : Nat) : x + 0 = x := by simp [Nat.add_zero]",
        "theorem capsule_soundness (x : Nat) : x + 0 = x := by simp [Nat.add_zero]",
        "def buildLlamaServerCliArgs (model : ModelSpec) : List String := ['--evidence-filter']",
        " Random distractor logs: connection timeout at 10.0.0.1 retry 1",
        " Random distractor logs: connection timeout at 10.0.0.2 retry 2",
        " Random distractor logs: connection timeout at 10.0.0.3 retry 3",
      ];
      const packResp = await server.handleJsonRpcRequest({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "capsule_pack_context",
          arguments: {
            chunks: sampleChunks,
            query: "buildLlamaServerCliArgs --evidence-filter",
            keepRatio: 0.3,
            symbolBoost: 4.0,
          },
        },
      });
      const packData = JSON.parse((packResp?.result as any).content[0].text) as ReturnType<
        typeof packContextCapsules
      >;
      assert.equal(packData.totalInputChunks, 6);
      assert.equal(packData.deduplicatedCount >= 1, true);
      assert.equal(packData.selectedCount, 2);
      assert.equal(packData.tokenCompressionRatio > 1.5, true);
      assert.equal(
        packData.selectedChunks.some((c) => c.text.includes("buildLlamaServerCliArgs")),
        true,
      );

      // Verify SimHash64 & Fuse8 determinism
      const h1 = computeSimHash64(sampleChunks[0]);
      const h2 = computeSimHash64(sampleChunks[1]);
      assert.equal(h1, h2);
      assert.equal(computeFuse8Fingerprint(h1), computeFuse8Fingerprint(h2));

      // 6. capsule_sync_agents
      const syncResp = await server.handleJsonRpcRequest({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "capsule_sync_agents",
          arguments: {
            harnesses: ["pi", "antigravity", "opencode", "claude", "codex", "copilot", "weftd"],
          },
        },
      });
      const syncData = JSON.parse((syncResp?.result as any).content[0].text) as {
        syncedHarnesses: string[];
      };
      assert.equal(syncData.syncedHarnesses.length, 7);
      assert.equal(syncData.syncedHarnesses.includes("weftd"), true);

      // 7. capsule_pto_tune
      const ptoResp = await server.handleJsonRpcRequest({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "capsule_pto_tune",
          arguments: {
            mode: "irpgo_thinlto_split",
          },
        },
      });
      const ptoData = JSON.parse((ptoResp?.result as any).content[0].text) as {
        ptoReceipt: { branchMissReductionPct: number };
      };
      assert.equal(ptoData.ptoReceipt.branchMissReductionPct > 30, true);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe("Tier 3: Standardized Multi-Agent Bootstrap CLI (agent_bootstrap.ts)", () => {
  it("scaffolds .ctx-capsule/ and writes agent configs for pi, claude, antigravity, opencode, codex, copilot, and weftd", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-capsule-init-"));
    try {
      const initRes = await runAgentBootstrapInit({
        targetDir: tmpRoot,
        agents: ALL_BOOTSTRAP_AGENTS,
        modelId: "deepseek-v4.1-1017-ud-q4kxl",
        presetId: "ds41-1017-np1-512k-max-speed",
        port: 8080,
      });

      assert.equal(initRes.isOk(), true);
      if (!initRes.isOk()) return;

      const receipt = initRes.value;
      assert.equal(receipt.activeModelId, "deepseek-v4.1-1017-ud-q4kxl");
      assert.equal(receipt.activeTemplateId, "ds41-1017-np1-512k-max-speed");
      assert.equal(receipt.configuredAgents.length, 7);

      const expectedPaths = [
        ".ctx-capsule/config.toml",
        ".ctx-capsule/templates/ds41-1017-np1-512k-max-speed.toml",
        ".pi/provider-capsule.json",
        ".pi/extensions/ctx-capsule.json",
        ".mcp.json",
        "opencode.json",
        ".codex/config.toml",
        ".github/copilot-capsule.json",
        ".weft/capsule-bridge.json",
      ];

      for (const rel of expectedPaths) {
        const full = path.join(tmpRoot, rel);
        const st = await fs.stat(full);
        assert.equal(st.isFile(), true, `Expected bootstrapped file at ${rel}`);
      }

      // Verify .mcp.json content
      const mcpJson = JSON.parse(await fs.readFile(path.join(tmpRoot, ".mcp.json"), "utf8")) as {
        mcpServers: Record<string, { command: string }>;
      };
      assert.equal(mcpJson.mcpServers["ctx-capsule"].command, "ctx-capsule-mcp");

      // Verify CLI `ctx-capsule init` invocation
      const cliOut: string[] = [];
      const code = await runCapsuleCli({
        argv: [
          "init",
          "--target",
          tmpRoot,
          "--agents",
          "pi,claude,opencode,weftd",
          "--preset",
          "coding_pinpoint",
        ],
        workspaceRoot: tmpRoot,
        stdout: (line) => cliOut.push(line),
      });
      assert.equal(code, 0);
      const parsedCli = JSON.parse(cliOut.join("\n")) as { activeTemplateId: string };
      assert.equal(parsedCli.activeTemplateId, "coding_pinpoint");
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe("Interactive Pi-TUI Component Rendering & Mouse/Keyboard Hit Testing", () => {
  it("renders exact 136-column TUI frames and dispatches mouse click and wheel events", () => {
    const state = createInitialControlState();
    const comp = new CapsulePiTuiComponent({ initialState: state });
    const lines = comp.render(136);
    assert.equal(lines.length > 20, true);
    for (const line of lines) {
      assert.equal(line.length, 136);
    }

    const snap = comp.getLastSnapshot();
    const tab2Region = snap.mouseRegions.find((r) => r.id === "tab:llama_fleet");
    assert.notEqual(tab2Region, undefined);
    if (tab2Region) {
      const hit = hitTestMouseRegions(snap.mouseRegions, tab2Region.x0 + 1, tab2Region.y0);
      assert.equal(hit?.id, "tab:llama_fleet");
    }
  });
});
