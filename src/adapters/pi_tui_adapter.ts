/**
 * Inbound + Outbound Interactive TUI Adapter built on `@earendil-works/pi-tui`.
 *
 * Implements `Component` from `@earendil-works/pi-tui` with full **Mouse + Keyboard**
 * interactivity, zero clipping at 136 columns, and pure FOOP `DomainCommand` dispatch:
 *   - Top bar: Context & Fleet state visualization + VRAM/RAM/Capsule bar +
 *     clickable category tabs `1..7` + clickable action buttons:
 *     `[Switch Model (m)]`, `[Save Template (s)]`, `[+ Add llama.cpp (a)]`,
 *     `[Replace In-Place (x)]`, `[Sync 7 SDKs & TOML (e)]`.
 *   - Left column: Interactive settings list (click row to select, click `<` or `>`
 *     to cycle values, mouse wheel to scroll).
 *   - Right column: Contextual ASCII art diagram, Impact, Pros/Cons, Fit recommendation,
 *     live Fleet table, and live Telemetry span tail.
 */

import {
  type Component,
  Key,
  matchesKey,
  MouseRegion,
  ProcessTerminal,
  TuiAltScreen,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  buildNextAddInstanceCommand,
  buildNextReplaceInstanceCommand,
  getSettingsForCategory,
  hitTestMouseRegions,
  transition,
} from "../domain/reducer.ts";
import { Branded, DomainErrors } from "../domain/result.ts";
import {
  type CapsuleControlState,
  CATEGORIES,
  type DomainCommand,
  type MouseHitRegion,
} from "../domain/types.ts";
import type {
  CapsuleTelemetryPort,
  EffectExecutionReceipt,
  EffectInterpreterPort,
  LiveTelemetryProbePort,
} from "../ports/outbound.ts";

const DEFAULT_WIDTH = 136;
const LEFT_COL_INNER = 54;

function padOrTruncate(text: string, targetWidth: number): string {
  const vis = visibleWidth(text);
  if (vis === targetWidth) {
    return text;
  }
  if (vis < targetWidth) {
    return text + " ".repeat(targetWidth - vis);
  }
  if (targetWidth <= 3) {
    return text.slice(0, targetWidth);
  }
  return text.slice(0, targetWidth - 3) + "...";
}

function wrapTextToWidth(text: string, maxWidth: number): readonly string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return [""];
  }
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (candidate.length <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

export interface FrameRenderSnapshot {
  readonly lines: readonly string[];
  readonly mouseRegions: readonly MouseHitRegion[];
  readonly width: number;
}

/**
 * Pure frame layout & hit-region compiler.
 * Produces exact `width`-column lines and a deterministic coordinate table of
 * `MouseHitRegion[]` for mouse click/wheel dispatch.
 */
export function renderCapsuleFrameSnapshot(
  state: CapsuleControlState,
  requestedWidth = DEFAULT_WIDTH,
): FrameRenderSnapshot {
  const width = Math.max(100, requestedWidth);
  const innerWidth = width - 4;
  const leftWidth = Math.min(LEFT_COL_INNER, Math.floor(innerWidth * 0.42));
  const rightWidth = innerWidth - leftWidth - 3;

  const lines: string[] = [];
  const regions: MouseHitRegion[] = [];

  const pushBoxLine = (content: string): number => {
    const rowIdx = lines.length;
    lines.push(`| ${padOrTruncate(content, innerWidth)} |`);
    return rowIdx;
  };

  const pushDualColumnLine = (left: string, right: string): number => {
    const rowIdx = lines.length;
    const l = padOrTruncate(left, leftWidth);
    const r = padOrTruncate(right, rightWidth);
    lines.push(`| ${l} | ${r} |`);
    return rowIdx;
  };

  const horizBorder = `+${"-".repeat(width - 2)}+`;
  const splitBorder = `+${"-".repeat(leftWidth + 2)}+${"-".repeat(rightWidth + 2)}+`;

  // Row 0: Top border
  lines.push(horizBorder);

  // Row 1: Header title with live server online/offline status
  const activeModel = state.models.find((m) => m.id === state.activeModelId) ?? state.models[0];
  const activeInst =
    state.instances.find((i) => i.id === state.activeInstanceId) ?? state.instances[0];
  const sys = state.systemTelemetry;
  const isOnline = sys.serverOnline || activeInst.status === "healthy";
  const effectivePid = sys.pid ?? activeInst.pid;
  const srvBadge = isOnline
    ? `ONLINE(PID:${effectivePid ?? "live"},${sys.decodeTokPerSec.toFixed(1)}t/s)`
    : "SERVER OFFLINE (Press Enter/g to Launch)";
  pushBoxLine(
    `CTX-CAPSULE FOOP CONTROL PLANE | ${srvBadge} | Model: ${activeModel.id} | Preset: ${state.activeTemplateId}`,
  );

  // Row 2: Live Context & VRAM Tier Bar
  const m = state.metrics;
  const barWidth = 22;
  const hotCells = Math.max(1, Math.round((m.activeHotVramTokens / Math.max(1, m.totalContextTokens)) * barWidth));
  const warmCells = Math.max(1, Math.round((m.warmRamTokens / Math.max(1, m.totalContextTokens)) * barWidth));
  const coldCells = Math.max(0, barWidth - hotCells - warmCells);
  const tierBar = `[${"#".repeat(hotCells)}${"=".repeat(warmCells)}${".".repeat(coldCells)}]`;
  const vramUsed = sys.vramTotalGiB > 0 ? sys.vramUsedGiB : m.kvVramUsedGiB;
  const vramTotal = sys.vramTotalGiB > 0 ? sys.vramTotalGiB : m.kvVramBudgetGiB;
  pushBoxLine(
    `Ctx ${tierBar} ${(m.totalContextTokens / 1024).toFixed(0)}K | Hot:${(m.activeHotVramTokens / 1024).toFixed(0)}K Warm:${(m.warmRamTokens / 1024).toFixed(0)}K Caps:${m.evictedCapsulesCount} | GPU:${vramUsed.toFixed(1)}/${vramTotal.toFixed(0)}GiB(${sys.gpuUtilPct}%) RAM:${sys.hostRamUsedGiB.toFixed(0)}/${sys.hostRamTotalGiB.toFixed(0)}GiB`,
  );

  // Row 3: Separator
  lines.push(horizBorder);

  // Row 4: Clickable Category Tabs 1..7
  let tabLine = "";
  const tabRowIdx = lines.length;
  for (const cat of CATEGORIES) {
    const isSelected = cat.id === state.activeCategory;
    const token = isSelected ? `[ *${cat.shortLabel}* ]` : `[ ${cat.shortLabel} ]`;
    const x0 = 2 + tabLine.length;
    tabLine += token + " ";
    const x1 = 2 + tabLine.length - 2;
    regions.push(
      Object.freeze({
        id: `tab:${cat.id}`,
        x0,
        y0: tabRowIdx,
        x1,
        y1: tabRowIdx,
        command: Object.freeze({ _tag: "SelectCategory", category: cat.id }),
        tooltip: cat.fullTitle,
      }),
    );
  }
  pushBoxLine(tabLine);

  // Row 5: Clickable Action Bar (Launch, Switch Model, Cycle/Save Template, Add llama.cpp, Replace In-Place, PTO, Sync 7 SDKs)
  const actionRowIdx = lines.length;
  const actionSpecs: readonly {
    readonly id: string;
    readonly label: string;
    readonly command: DomainCommand;
    readonly tooltip: string;
  }[] = [
    {
      id: "btn:launch_llama",
      label: "[Launch(g)]",
      command: Object.freeze({ _tag: "LaunchActiveInstance" }),
      tooltip: "Launch active llama-server instance with current model & preset flags",
    },
    {
      id: "btn:switch_model",
      label: "[Model(m)]",
      command: Object.freeze({ _tag: "CycleActiveModel", delta: 1 }),
      tooltip: "Cycle active flagship model checkpoint",
    },
    {
      id: "btn:cycle_template",
      label: "[Preset(t)]",
      command: Object.freeze({ _tag: "CycleTemplate", delta: 1 }),
      tooltip: "Cycle reusable configuration preset template",
    },
    {
      id: "btn:save_template",
      label: "[SaveTmpl(s)]",
      command: Object.freeze({
        _tag: "SaveCurrentAsTemplate",
        templateId: Branded.unsafeTemplateId(`custom_${state.activeModelId}`),
        displayName: `Custom ${state.activeModelId} Preset`,
      }),
      tooltip: "Save current settings as a reusable TOML template",
    },
    {
      id: "btn:add_llama",
      label: "[+Add(a)]",
      command: buildNextAddInstanceCommand(state),
      tooltip: "Spawn an additional llama-server instance on the next free port",
    },
    {
      id: "btn:replace_llama",
      label: "[Replace(x)]",
      command: buildNextReplaceInstanceCommand(state),
      tooltip: "Hot-replace active llama-server binary/flavor in-place",
    },
    {
      id: "act:pto_tune",
      label: "[PTO Tune & Swap (p)]",
      command: Object.freeze({ _tag: "TriggerPtoTraceAndOptimize" }),
      tooltip: "Run Clang-21 IRPGO + ThinLTO + Machine Split & hot-swap to ik_llama_pto_lto",
    },
    {
      id: "btn:sync_sdks",
      label: "[Sync 7 SDKs&TOML(e)]",
      command: Object.freeze({ _tag: "SyncAllAgentSdks" }),
      tooltip: "Export 5-layer TOML hierarchy & synchronize all 7 coding agent SDKs",
    },
  ];

  let actionLine = "";
  for (const act of actionSpecs) {
    const x0 = 2 + actionLine.length;
    actionLine += act.label + " ";
    const x1 = 2 + actionLine.length - 2;
    regions.push(
      Object.freeze({
        id: act.id,
        x0,
        y0: actionRowIdx,
        x1,
        y1: actionRowIdx,
        command: act.command,
        tooltip: act.tooltip,
      }),
    );
  }
  pushBoxLine(actionLine);

  // Row 6: Split column header border
  lines.push(splitBorder);

  // Build Left Column rows (Interactive Settings for active category + Fleet summary)
  const catMeta = CATEGORIES.find((c) => c.id === state.activeCategory) ?? CATEGORIES[0];
  const catSettings = getSettingsForCategory(state.activeCategory);
  const selectedRow = state.selectedRowByCategory[state.activeCategory] ?? 0;
  const activeOption = catSettings[selectedRow] ?? catSettings[0];

  const leftRows: {
    readonly text: string;
    readonly rowIndex?: number;
    readonly prevX0?: number;
    readonly prevX1?: number;
    readonly nextX0?: number;
    readonly nextX1?: number;
  }[] = [];

  leftRows.push({ text: `CATEGORY ${catMeta.index}: ${catMeta.shortLabel} (${catSettings.length} params)` });
  leftRows.push({ text: "-".repeat(leftWidth) });

  for (let i = 0; i < catSettings.length; i++) {
    const opt = catSettings[i];
    const isSel = i === selectedRow;
    const prefix = isSel ? ">> " : "   ";
    const val = state.settingsValues[opt.key] ?? opt.defaultValue;
    const valBlock = `[< ${val} >]`;
    const maxLabelLen = Math.max(10, leftWidth - prefix.length - valBlock.length - 1);
    const labelStr = padOrTruncate(opt.label, maxLabelLen);
    const rowText = `${prefix}${labelStr} ${valBlock}`;
    const bracketStart = 2 + prefix.length + labelStr.length + 1;
    leftRows.push({
      text: rowText,
      rowIndex: i,
      prevX0: bracketStart,
      prevX1: bracketStart + 2,
      nextX0: bracketStart + valBlock.length - 3,
      nextX1: bracketStart + valBlock.length - 1,
    });
  }

  leftRows.push({ text: "" });
  leftRows.push({ text: "ACTIVE LLAMA.CPP FLEET (Click or [a] Add / [x] Replace):" });
  for (const inst of state.instances) {
    const marker = inst.id === state.activeInstanceId ? "*" : " ";
    leftRows.push({
      text: `${marker} ${inst.id} :${inst.port} [${inst.engineFlavor}] (${inst.status.toUpperCase()})`,
    });
  }

  leftRows.push({ text: "" });
  leftRows.push({ text: "5-LAYER HIERARCHICAL TOML OUTPUT:" });
  leftRows.push({ text: `  0: ${state.hierarchyRootDir}/00-defaults.toml` });
  leftRows.push({ text: `  1: ${state.hierarchyRootDir}/hardware/${state.activeHardwareProfileId}.toml` });
  leftRows.push({ text: `  2: ${state.hierarchyRootDir}/models/${state.activeModelId}.toml` });
  leftRows.push({ text: `  3: ${state.hierarchyRootDir}/templates/${state.activeTemplateId}.toml` });
  leftRows.push({ text: `  4: ${state.hierarchyRootDir}/instances/active_fleet.toml` });
  leftRows.push({ text: `  => ${state.unifiedModelsTomlPath}` });

  // Build Right Column rows (ASCII diagram, Impact, Pros/Cons, Fit Rule, Telemetry Tail)
  const rightRows: string[] = [];
  if (activeOption) {
    rightRows.push(`PARAMETER: ${activeOption.label} (${activeOption.cliFlag} / ${activeOption.envVar})`);
    rightRows.push("-".repeat(rightWidth));
    for (const artLine of activeOption.asciiArt) {
      rightRows.push(artLine);
    }
    rightRows.push("");
    for (const w of wrapTextToWidth(`IMPACT: ${activeOption.impact}`, rightWidth)) {
      rightRows.push(w);
    }
    for (const pro of activeOption.pros) {
      rightRows.push(`  [+] ${pro}`);
    }
    for (const con of activeOption.cons) {
      rightRows.push(`  [-] ${con}`);
    }
    for (const f of wrapTextToWidth(activeOption.fitRule, rightWidth)) {
      rightRows.push(f);
    }
  }

  rightRows.push("");
  rightRows.push("PI-TELEMETRY SPAN & SHA-256 HASH-CHAIN TAIL:");
  for (const entry of state.telemetryLogs.slice(-3)) {
    rightRows.push(
      `  #${entry.seq} [${entry.spanName}] ${entry.message} (sha:${entry.entryHashHex.slice(0, 8)})`,
    );
  }

  const bodyRowCount = Math.max(leftRows.length, rightRows.length, 18);
  for (let i = 0; i < bodyRowCount; i++) {
    const lEntry = leftRows[i] ?? { text: "" };
    const rText = rightRows[i] ?? "";
    const y = pushDualColumnLine(lEntry.text, rText);

    if (lEntry.rowIndex !== undefined) {
      const idx = lEntry.rowIndex;
      if (idx === selectedRow && lEntry.prevX0 !== undefined && lEntry.nextX0 !== undefined) {
        regions.push(
          Object.freeze({
            id: `setting_prev:${idx}`,
            x0: lEntry.prevX0,
            y0: y,
            x1: lEntry.prevX1 ?? lEntry.prevX0 + 2,
            y1: y,
            command: Object.freeze({ _tag: "CycleCurrentSetting", delta: -1 }),
            tooltip: "Previous option value",
          }),
        );
        regions.push(
          Object.freeze({
            id: `setting_next:${idx}`,
            x0: lEntry.nextX0,
            y0: y,
            x1: lEntry.nextX1 ?? lEntry.nextX0 + 2,
            y1: y,
            command: Object.freeze({ _tag: "CycleCurrentSetting", delta: 1 }),
            tooltip: "Next option value",
          }),
        );
      }
      regions.push(
        Object.freeze({
          id: `setting_row:${idx}`,
          x0: 2,
          y0: y,
          x1: 2 + leftWidth - 1,
          y1: y,
          command:
            idx === selectedRow
              ? Object.freeze({ _tag: "CycleCurrentSetting", delta: 1 })
              : Object.freeze({ _tag: "SelectRowIndex", rowIndex: idx }),
          tooltip: `Select setting row ${idx}`,
        }),
      );
    }
  }

  // Footer
  lines.push(splitBorder);
  pushBoxLine(`STATUS: ${state.statusBanner}`);
  pushBoxLine(
    "KEYS & MOUSE: Click any Tab/Row/Button | Wheel:Scroll | 1-7:Tab | Up/Down/j/k:Row | Left/Right/Space:Value | m:Model | t:Tmpl | s:SaveTmpl | a:AddLlama | x:ReplaceLlama | e:Export&Sync | q:Quit",
  );
  lines.push(horizBorder);

  return Object.freeze({
    lines: Object.freeze(lines),
    mouseRegions: Object.freeze(regions),
    width,
  });
}

export interface CapsulePiTuiComponentOptions {
  readonly initialState: CapsuleControlState;
  readonly interpreter?: EffectInterpreterPort;
  readonly telemetry?: CapsuleTelemetryPort;
  readonly onRequestRender?: () => void;
  readonly onQuit?: () => void;
}

/**
 * Interactive `@earendil-works/pi-tui` `Component` with both keyboard (`handleInput`)
 * and mouse (`handleMouse`) support, plus optional wrapping inside `MouseRegion`.
 */
export class CapsulePiTuiComponent implements Component {
  private state: CapsuleControlState;
  private lastSnapshot: FrameRenderSnapshot;
  private readonly interpreter?: EffectInterpreterPort;
  private readonly telemetry?: CapsuleTelemetryPort;
  private readonly onRequestRender?: () => void;
  private readonly onQuit?: () => void;
  private readonly executionReceipts: EffectExecutionReceipt[] = [];

  constructor(options: CapsulePiTuiComponentOptions) {
    this.state = options.initialState;
    this.interpreter = options.interpreter;
    this.telemetry = options.telemetry;
    this.onRequestRender = options.onRequestRender;
    this.onQuit = options.onQuit;
    this.lastSnapshot = renderCapsuleFrameSnapshot(this.state, DEFAULT_WIDTH);
  }

  getState(): CapsuleControlState {
    return this.state;
  }

  getLastSnapshot(): FrameRenderSnapshot {
    return this.lastSnapshot;
  }

  getExecutionReceipts(): readonly EffectExecutionReceipt[] {
    return Object.freeze([...this.executionReceipts]);
  }

  asMouseRegionComponent(): MouseRegion {
    return new MouseRegion(this, (event) => this.handleMouse(event));
  }

  dispatchCommand(command: DomainCommand): void {
    const result = transition(this.state, command);
    if (result.isErr()) {
      this.state = Object.freeze({
        ...this.state,
        statusBanner: `ERROR ${DomainErrors.format(result.error)}`,
      });
      this.onRequestRender?.();
      return;
    }

    this.state = result.value.state;
    const effects = result.value.effects;

    if (this.interpreter && effects.length > 0) {
      void this.interpreter.interpretEffects(effects, this.state).then((execRes) => {
        if (execRes.isOk()) {
          this.executionReceipts.push(...execRes.value);
          if (this.telemetry) {
            this.state = Object.freeze({
              ...this.state,
              telemetryLogs: this.telemetry.getRecentEntries(8),
            });
          }
        } else {
          this.state = Object.freeze({
            ...this.state,
            statusBanner: `ADAPTER ERROR: ${DomainErrors.format(execRes.error)}`,
          });
        }
        this.onRequestRender?.();
      });
    }

    this.onRequestRender?.();
  }

  async dispatchCommandAsync(command: DomainCommand): Promise<void> {
    const result = transition(this.state, command);
    if (result.isErr()) {
      this.state = Object.freeze({
        ...this.state,
        statusBanner: `ERROR ${DomainErrors.format(result.error)}`,
      });
      this.onRequestRender?.();
      return;
    }

    this.state = result.value.state;
    const effects = result.value.effects;
    if (this.interpreter && effects.length > 0) {
      const execRes = await this.interpreter.interpretEffects(effects, this.state);
      if (execRes.isOk()) {
        this.executionReceipts.push(...execRes.value);
        if (this.telemetry) {
          this.state = Object.freeze({
            ...this.state,
            telemetryLogs: this.telemetry.getRecentEntries(8),
          });
        }
      } else {
        this.state = Object.freeze({
          ...this.state,
          statusBanner: `ADAPTER ERROR: ${DomainErrors.format(execRes.error)}`,
        });
      }
    }
    this.onRequestRender?.();
  }

  render(width: number): string[] {
    this.lastSnapshot = renderCapsuleFrameSnapshot(this.state, width || DEFAULT_WIDTH);
    return [...this.lastSnapshot.lines];
  }

  handleInput(data: string): void {
    if (data === "q" || data === "Q" || matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onQuit?.();
      return;
    }

    if (data >= "1" && data <= "7") {
      const idx = Number(data) - 1;
      const cat = CATEGORIES[idx];
      if (cat) {
        this.dispatchCommand({ _tag: "SelectCategory", category: cat.id });
      }
      return;
    }

    if (matchesKey(data, Key.tab)) {
      const curIdx = CATEGORIES.findIndex((c) => c.id === this.state.activeCategory);
      const nextCat = CATEGORIES[(curIdx + 1) % CATEGORIES.length];
      this.dispatchCommand({ _tag: "SelectCategory", category: nextCat.id });
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") {
      this.dispatchCommand({ _tag: "MoveSelection", delta: -1 });
      return;
    }

    if (matchesKey(data, Key.down) || data === "j") {
      this.dispatchCommand({ _tag: "MoveSelection", delta: 1 });
      return;
    }

    if (matchesKey(data, Key.left) || data === "h") {
      this.dispatchCommand({ _tag: "CycleCurrentSetting", delta: -1 });
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.state.activeCategory === "llama_fleet" || !this.state.systemTelemetry.serverOnline) {
        this.dispatchCommand({ _tag: "LaunchActiveInstance" });
      } else {
        this.dispatchCommand({ _tag: "CycleCurrentSetting", delta: 1 });
      }
      return;
    }

    if (matchesKey(data, Key.right) || data === "l" || matchesKey(data, Key.space)) {
      this.dispatchCommand({ _tag: "CycleCurrentSetting", delta: 1 });
      return;
    }

    if (data === "g" || data === "G") {
      this.dispatchCommand({ _tag: "LaunchActiveInstance" });
      return;
    }

    if (data === "m" || data === "M") {
      this.dispatchCommand({ _tag: "CycleActiveModel", delta: 1 });
      return;
    }

    if (data === "t" || data === "T") {
      this.dispatchCommand({ _tag: "CycleTemplate", delta: 1 });
      return;
    }

    if (data === "s" || data === "S") {
      this.dispatchCommand({
        _tag: "SaveCurrentAsTemplate",
        templateId: Branded.unsafeTemplateId(`custom_${this.state.activeModelId}`),
        displayName: `Custom ${this.state.activeModelId} Preset`,
      });
      return;
    }

    if (data === "a" || data === "A") {
      this.dispatchCommand(buildNextAddInstanceCommand(this.state));
      return;
    }

    if (data === "x" || data === "X") {
      this.dispatchCommand(buildNextReplaceInstanceCommand(this.state));
      return;
    }

    if (data === "p" || data === "P") {
      this.dispatchCommand({ _tag: "TriggerPtoTraceAndOptimize" });
      return;
    }

    if (data === "e" || data === "E") {
      this.dispatchCommand({ _tag: "SyncAllAgentSdks" });
      return;
    }

    if (data === "r" || data === "R") {
      this.dispatchCommand({ _tag: "ResetCurrentCategoryDefaults" });
      return;
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      const delta = (event.wheelDelta ?? 1) > 0 ? 1 : -1;
      this.dispatchCommand({ _tag: "MoveSelection", delta });
      return { handled: true, render: true };
    }

    if (event.type === "click" || event.type === "press") {
      const hit = hitTestMouseRegions(this.lastSnapshot.mouseRegions, event.x, event.y);
      if (hit) {
        if (event.button === "right" && hit.command._tag === "CycleCurrentSetting") {
          this.dispatchCommand({ _tag: "CycleCurrentSetting", delta: -1 });
        } else {
          this.dispatchCommand(hit.command);
        }
        return { handled: true, render: true };
      }
    }

    return undefined;
  }

  invalidate(): void {
    this.lastSnapshot = renderCapsuleFrameSnapshot(this.state, this.lastSnapshot.width);
  }
}

/**
 * Launches the fullscreen interactive `@earendil-works/pi-tui` `TuiAltScreen` session
 * with mouse tracking enabled (`mouse: true`).
 */
export async function runInteractivePiTuiSession(options: {
  readonly initialState: CapsuleControlState;
  readonly interpreter: EffectInterpreterPort;
  readonly telemetry: CapsuleTelemetryPort;
  readonly liveTelemetry?: LiveTelemetryProbePort;
}): Promise<CapsuleControlState> {
  return new Promise<CapsuleControlState>((resolve) => {
    const terminal = new ProcessTerminal();
    let tui: TuiAltScreen | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const component = new CapsulePiTuiComponent({
      initialState: options.initialState,
      interpreter: options.interpreter,
      telemetry: options.telemetry,
      onRequestRender: () => {
        tui?.requestRender();
      },
      onQuit: () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        tui?.stop();
        resolve(component.getState());
      },
    });

    const probeOnce = async (): Promise<void> => {
      if (!options.liveTelemetry) return;
      const st = component.getState();
      const activeInst =
        st.instances.find((i) => i.id === st.activeInstanceId) ?? st.instances[0];
      const probeRes = await options.liveTelemetry.probeSystemTelemetry(
        activeInst.host,
        activeInst.port,
        activeInst.pid,
      );
      if (probeRes.isOk()) {
        component.dispatchCommand({
          _tag: "IngestLiveTelemetry",
          telemetry: probeRes.value,
        });
      }
    };

    tui = new TuiAltScreen(terminal, false, undefined, {
      mouse: true,
      wheelScrollLines: 1,
    });
    tui.setLayoutRoot(component.asMouseRegionComponent());
    tui.setFocus(component);
    tui.addInputListener((data) => {
      component.handleInput(data);
      return { consume: true };
    });
    tui.start();
    void probeOnce();
    if (options.liveTelemetry) {
      pollTimer = setInterval(() => {
        void probeOnce();
      }, 2500);
    }
  });
}
