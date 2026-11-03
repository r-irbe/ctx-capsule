/**
 * Inbound + Outbound Interactive TUI Adapter built on `@earendil-works/pi-tui`.
 *
 * Implements `Component` from `@earendil-works/pi-tui` using the native widget
 * layout system (`VStack`, `HStack`, `Box`, `SettingsList`, `Text`, `TruncatedText`)
 * and native ANSI/RGB styling (`styleText`, `indexedColor`) with:
 *   - Full **Mouse + Keyboard** interactivity
 *   - Responsive layout: side-by-side `HStack` at `>= 106` columns (default 136),
 *     or stacked `VStack` at `< 106` columns (down to 78 columns for Pi overlay modals)
 *   - Rounded Unicode borders (`\u256D\u2500\u256E\u2502\u2570\u256F\u251C\u2524`) with 7-bit ASCII source (`INV-001`)
 *   - Live per-option AND per-variant explanation callouts (`ACTIVE VARIANT [< value >]`)
 *   - Native `@earendil-works/pi-tui` `Image` (Kitty/Ghostty APC + iTerm2 OSC) inline PNG diagram support (`v`)
 *   - Comprehensive Help, Architecture & Keyboard/Mouse Reference Modal (`?`)
 *   - Pure FOOP `DomainCommand` dispatch
 */

import {
  Box,
  type Component,
  HStack,
  indexedColor,
  Key,
  matchesKey,
  MouseRegion,
  ProcessTerminal,
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
  styleText,
  Text,
  TruncatedText,
  TuiAltScreen,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  VStack,
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
import { resolveHierarchicalSettings } from "../domain/toml_hierarchy.ts";
import {
  type CapsuleControlState,
  CATEGORIES,
  type CategoryId,
  type DomainCommand,
  type MouseHitRegion,
  type SettingOptionSpec,
} from "../domain/types.ts";
import type {
  CapsuleTelemetryPort,
  EffectExecutionReceipt,
  EffectInterpreterPort,
  LiveTelemetryProbePort,
} from "../ports/outbound.ts";
import {
  createCategoryPiTuiImage,
  getCategoryDiagramAsset,
  resolveActiveImageProtocol,
} from "./terminal_diagram_generator.ts";

const DEFAULT_WIDTH = 136;
const MIN_WIDTH = 78;
const STACKED_BREAKPOINT = 106;
const LEFT_COL_INNER = 54;

const B_TL = "\u256D"; // top-left rounded corner
const B_TR = "\u256E"; // top-right rounded corner
const B_BL = "\u2570"; // bottom-left rounded corner
const B_BR = "\u256F"; // bottom-right rounded corner
const B_H = "\u2500"; // horizontal bar
const B_V = "\u2502"; // vertical bar
const B_LT = "\u251C"; // left tee
const B_RT = "\u2524"; // right tee
const BLK_FULL = "\u2588"; // full block
const BLK_LIGHT = "\u2591"; // light shade block
const BULLET = "\u25CF"; // solid bullet

const COLOR_MODE = "256color" as const;
const fgCyan = (s: string): string => styleText(s, { fg: indexedColor(81), bold: true }, COLOR_MODE);
const fgGreen = (s: string): string => styleText(s, { fg: indexedColor(114), bold: true }, COLOR_MODE);
const fgYellow = (s: string): string => styleText(s, { fg: indexedColor(221), bold: true }, COLOR_MODE);
const fgRed = (s: string): string => styleText(s, { fg: indexedColor(203), bold: true }, COLOR_MODE);
const fgMagenta = (s: string): string => styleText(s, { fg: indexedColor(177), bold: true }, COLOR_MODE);
const fgWhiteBold = (s: string): string => styleText(s, { fg: indexedColor(255), bold: true }, COLOR_MODE);
const fgMuted = (s: string): string => styleText(s, { fg: indexedColor(246) }, COLOR_MODE);
const fgDim = (s: string): string => styleText(s, { fg: indexedColor(242) }, COLOR_MODE);
const bgActiveTab = (s: string): string =>
  styleText(s, { fg: indexedColor(232), bg: indexedColor(81), bold: true }, COLOR_MODE);
const bgActiveRow = (s: string): string =>
  styleText(s, { fg: indexedColor(255), bg: indexedColor(237), bold: true }, COLOR_MODE);
const bgButton = (s: string): string =>
  styleText(s, { fg: indexedColor(252), bg: indexedColor(236) }, COLOR_MODE);
const borderTone = (s: string): string => styleText(s, { fg: indexedColor(67) }, COLOR_MODE);

function padOrTruncate(text: string, targetWidth: number): string {
  const vis = visibleWidth(text);
  if (vis === targetWidth) {
    return text;
  }
  if (vis < targetWidth) {
    return text + " ".repeat(targetWidth - vis);
  }
  return truncateToWidth(text, targetWidth);
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
    if (visibleWidth(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

class FixedLinesWidget implements Component {
  private readonly lines: readonly string[];

  constructor(lines: readonly string[]) {
    this.lines = lines;
  }

  render(width: number): string[] {
    return this.lines.map((line) => padOrTruncate(line, width));
  }

  invalidate(): void {}
}

function createPiTuiSettingsListTheme(): SettingsListTheme {
  return {
    label: (text: string, selected: boolean) =>
      selected ? fgCyan(text) : styleText(text, { fg: indexedColor(252) }, COLOR_MODE),
    value: (text: string, selected: boolean) =>
      selected ? fgYellow(`< ${text} >`) : fgMuted(`< ${text} >`),
    description: (text: string) => fgDim(text),
    cursor: fgCyan("> "),
    hint: (text: string) => fgDim(text),
  };
}

/**
 * Builds a native `@earendil-works/pi-tui` `SettingsList` widget for the active category.
 */
export function createCategorySettingsListWidget(
  state: CapsuleControlState,
  onSelectValue?: (key: string, nextValue: string) => void,
  onClose?: () => void,
): SettingsList {
  const catSettings = getSettingsForCategory(state.activeCategory);
  const items: SettingItem[] = catSettings.map((opt) => ({
    id: opt.key,
    label: `${opt.label} (${opt.cliFlag})`,
    description: `${opt.impact} [Env: ${opt.envVar}]`,
    currentValue: state.settingsValues[opt.key] ?? opt.defaultValue,
    values: [...opt.choices],
  }));

  return new SettingsList(
    items,
    Math.min(12, Math.max(6, items.length + 2)),
    createPiTuiSettingsListTheme(),
    (id, newValue) => {
      onSelectValue?.(id, newValue);
    },
    () => {
      onClose?.();
    },
  );
}

/**
 * Renders the native `@earendil-works/pi-tui` `Image` lines for a category's
 * PNG architectural schematic when terminal image capabilities (`kitty` or `iterm2`)
 * are enabled.
 */
export function renderCategoryGraphicalPreview(
  category: CategoryId,
  width = 48,
): {
  readonly protocol: "kitty" | "iterm2" | null;
  readonly assetTitle: string;
  readonly imageId: number;
  readonly lines: readonly string[];
} {
  const asset = getCategoryDiagramAsset(category);
  const protocol = resolveActiveImageProtocol("graphical_image");
  const clampedWidth = Math.max(24, Math.min(64, width));
  const img = createCategoryPiTuiImage(category, clampedWidth, 8);
  const lines = img.render(clampedWidth);
  return Object.freeze({
    protocol,
    assetTitle: asset.title,
    imageId: asset.imageId,
    lines: Object.freeze(lines),
  });
}

/**
 * Renders a compact 6-line status card suitable for `ctx.ui.notify(...)` in Pi
 * without flooding the chat transcript with a 35-line full TUI frame.
 */
export function renderCompactCapsuleStatusCard(state: CapsuleControlState): string {
  const activeModel =
    state.models.find((m) => m.id === state.activeModelId) ?? state.models[0];
  const activeInst =
    state.instances.find((i) => i.id === state.activeInstanceId) ?? state.instances[0];
  const resolved = resolveHierarchicalSettings(state);
  const sys = state.systemTelemetry;
  const statusTag = sys.serverOnline
    ? `ONLINE (PID ${sys.pid ?? activeInst.pid ?? "-"}, ${sys.prefillTokPerSec.toFixed(0)} pf / ${sys.decodeTokPerSec.toFixed(1)} dec tok/s)`
    : "OFFLINE (run /capsule launch or press g in /capsule tui)";

  return [
    `ctx-capsule | ${activeModel.displayName} (${activeModel.quantization}) | ${statusTag}`,
    `Preset: ${state.activeTemplateId} | Port: ${activeInst.host}:${activeInst.port} | Engine: ${activeInst.engineFlavor}`,
    `Context: ${resolved.ctx_size ?? "524288"} tok | Slots: -np ${resolved.parallel_slots ?? "1"} | KV: -ctk ${resolved.kv_type_k ?? "q8_0"} -ctv ${resolved.kv_type_v ?? "q8_0"} -ictk ${resolved.indexer_cache_type_k ?? "q8_0"}`,
    `Capsules: ${resolved.capsule_filter ?? "fuse8_simhash64"} (${resolved.evidence_strategy ?? "code_pinpoint"}, top_k=${resolved.evidence_top_k ?? "16"}, boost=${resolved.evidence_symbol_boost ?? "3.5"})`,
    `Speculative: ${resolved.spec_type ?? "ngram-mod_plus_dspark"} (autotune=${resolved.spec_autotune ?? "on"}) | Effort: ${resolved.thinking_effort ?? "max_deep_think"}`,
    `Tip: Run /capsule (or /capsule tui) to open the interactive modal, '?' for Help, 'v' for Graphical PNG mode.`,
  ].join("\n");
}

export interface FrameRenderSnapshot {
  readonly lines: readonly string[];
  readonly mouseRegions: readonly MouseHitRegion[];
  readonly width: number;
}

function renderHelpModalFrame(
  state: CapsuleControlState,
  width: number,
  topRowIndex: number,
  mouseRegions: MouseHitRegion[],
): readonly string[] {
  const innerWidth = width - 4;
  const proto = resolveActiveImageProtocol(state.visualDiagramMode);
  const asset = getCategoryDiagramAsset(state.activeCategory);

  const closeBtnPlain = "[ Close Help (? / Esc) ]";
  const visualBtnPlain = `[ Cycle Diagram Mode (v): ${state.visualDiagramMode.toUpperCase()} ]`;
  const headerPrefix = "HELP, ARCHITECTURE & INTERACTIVE CONTROLS GUIDE  ";
  const closeX0 = 2 + headerPrefix.length;
  mouseRegions.push({
    id: "help:close",
    x0: closeX0,
    y0: topRowIndex + 1,
    x1: closeX0 + closeBtnPlain.length - 1,
    y1: topRowIndex + 1,
    command: { _tag: "ToggleHelpModal" },
    tooltip: "Close the Help & Architecture overlay (? or Esc)",
  });
  const visX0 = closeX0 + closeBtnPlain.length + 2;
  mouseRegions.push({
    id: "help:visual_mode",
    x0: visX0,
    y0: topRowIndex + 1,
    x1: visX0 + visualBtnPlain.length - 1,
    y1: topRowIndex + 1,
    command: { _tag: "ToggleVisualMode" },
    tooltip: "Cycle terminal diagram mode (auto / graphical_image / ascii_only)",
  });

  const helpRows: string[] = [
    `${fgCyan("HELP, ARCHITECTURE & INTERACTIVE CONTROLS GUIDE")}  ${bgActiveTab(closeBtnPlain)}  ${bgButton(visualBtnPlain)}`,
    fgMuted(B_H.repeat(innerWidth)),
    `${fgYellow("1. KEYBOARD NAVIGATION & LIVE ACTIONS (100% Non-Vacuous Hexagonal Dispatch):")}`,
    `   ${fgWhiteBold("1..7 / Tab")}     Switch across the 7 architectural configuration categories (37 total parameters, ~145 variants)`,
    `   ${fgWhiteBold("Up/Down / j/k")}  Select parameter row in the Left Pane; Inspector immediately updates explanations & diagrams`,
    `   ${fgWhiteBold("Left/Right/Space")} Cycle the selected parameter's variant and view its live ${fgGreen("ACTIVE VARIANT")} explanation`,
    `   ${fgWhiteBold("Enter / g")}      Launch or restart the active ${fgCyan("llama-server")} instance with compiled 5-layer CLI flags`,
    `   ${fgWhiteBold("m / t / s")}      ${fgWhiteBold("m")}: Cycle Model Checkpoint | ${fgWhiteBold("t")}: Cycle Preset Template | ${fgWhiteBold("s")}: Save custom TOML preset`,
    `   ${fgWhiteBold("a / x / p")}      ${fgWhiteBold("a")}: Add parallel fleet node | ${fgWhiteBold("x")}: Hot-swap engine flavor | ${fgWhiteBold("p")}: Run Clang-21 IRPGO+ThinLTO PTO`,
    `   ${fgWhiteBold("e / r / v / ?")}  ${fgWhiteBold("e")}: Sync 8 Coding Agent SDKs & TOMLs | ${fgWhiteBold("r")}: Reset category defaults | ${fgWhiteBold("v")}: Diagram mode | ${fgWhiteBold("?")}: Toggle Help`,
    fgMuted(B_H.repeat(innerWidth)),
    `${fgYellow("2. ALL 7 ARCHITECTURAL CATEGORIES & WHAT THEY CONTROL:")}`,
    `   ${fgCyan("[1] Models & Presets")}  Backbone checkpoint, 5-layer preset template, Engram sidecar mode, and GGUF-X 2MiB alignment`,
    `   ${fgCyan("[2] llama.cpp Fleet")}   Engine binary flavor (ik_llama_pto_lto / upstream / worktree), HTTP port, NUMA node, in-place policy`,
    `   ${fgCyan("[3] Capsules & RAG")}    Binary Fuse8/16 + SimHash64 O(1) filter, Late-Interaction MaxSim Exact-Cover, symbol boost, top-K`,
    `   ${fgCyan("[4] KV & Paging")}       Context length (64K..1M), MLA-2/3, FlashAttn, -ctk/-ctv/-ictk quant, ZDD zero-page skip, SWA ring`,
    `   ${fgCyan("[5] Speculative")}       Multi-stage DSpark + N-Gram + TreeGraft, Not-a-Bandit counterfactual Thompson tuner, ConcurrencyKnee`,
    `   ${fgCyan("[6] Hardware & NUMA")}   EPYC 7453 NPS4 expert split, 56-thread Zen3 pinning, RTX 4090 L2 residency, Clang-21 Continuous IRPGO`,
    `   ${fgCyan("[7] Sampling & SDKs")}   Deep thinking effort budget, temperature, dry-multiplier, XGrammar, and 8-agent SDK synchronization`,
    fgMuted(B_H.repeat(innerWidth)),
    `${fgYellow("3. INLINE TERMINAL GRAPHICS (Ghostty / Kitty / WezTerm / iTerm2 / Pi TUI):")}`,
    `   Current Diagram Mode: ${fgGreen(state.visualDiagramMode.toUpperCase())} | Detected Terminal Protocol: ${fgCyan(proto ?? "unicode_box_drawing_fallback")}`,
    `   Active Category PNG Asset: ${fgWhiteBold(asset.title)} (${asset.dimensions.widthPx}x${asset.dimensions.heightPx} RGBA PNG, ID #${asset.imageId}, ${asset.base64Png.length} B base64)`,
    `   In Ghostty/Kitty/Pi TUI, pressing ${fgWhiteBold("v")} cycles ${fgCyan("AUTO -> GRAPHICAL_IMAGE -> ASCII_ONLY")} using @earendil-works/pi-tui Image.`,
    fgMuted(B_H.repeat(innerWidth)),
    `${fgYellow("4. FIVE-LAYER HIERARCHICAL TOML PRECEDENCE:")}`,
    `   ${fgMuted("Layer 1:")} 00-defaults.toml -> ${fgMuted("Layer 2:")} hardware/epyc_milan_rtx4090.toml -> ${fgMuted("Layer 3:")} models/<id>.toml -> ${fgMuted("Layer 4:")} presets/<id>.toml -> ${fgMuted("Layer 5:")} runtime/session.toml`,
  ];

  const framed: string[] = [];
  for (const row of helpRows) {
    framed.push(`${borderTone(B_V)} ${padOrTruncate(row, innerWidth)} ${borderTone(B_V)}`);
  }
  return framed;
}

/**
 * Pure frame layout & hit-region compiler built on `@earendil-works/pi-tui`
 * layout primitives (`VStack`, `HStack`, `Box`, `Text`, `TruncatedText`).
 * Produces exact `width`-column lines and a deterministic coordinate table of
 * `MouseHitRegion[]` for mouse click/wheel dispatch.
 */
export function renderCapsuleFrameSnapshot(
  state: CapsuleControlState,
  requestedWidth = DEFAULT_WIDTH,
): FrameRenderSnapshot {
  const width = Math.max(MIN_WIDTH, requestedWidth);
  const innerWidth = width - 4;
  const isStacked = width < STACKED_BREAKPOINT;
  const leftInner = isStacked ? innerWidth : LEFT_COL_INNER;
  const rightInner = isStacked ? innerWidth : width - LEFT_COL_INNER - 7;

  const mouseRegions: MouseHitRegion[] = [];
  const topLines: string[] = [];

  const pushBorderTop = (): void => {
    topLines.push(borderTone(`${B_TL}${B_H.repeat(width - 2)}${B_TR}`));
  };
  const pushBorderSep = (): void => {
    topLines.push(borderTone(`${B_LT}${B_H.repeat(width - 2)}${B_RT}`));
  };
  const pushFullRow = (content: string): number => {
    const rowIndex = topLines.length;
    const body = padOrTruncate(content, innerWidth);
    topLines.push(`${borderTone(B_V)} ${body} ${borderTone(B_V)}`);
    return rowIndex;
  };

  const activeModel =
    state.models.find((m) => m.id === state.activeModelId) ?? state.models[0];
  const activeTemplate =
    state.templates.find((t) => t.id === state.activeTemplateId) ?? state.templates[0];
  const activeInstance =
    state.instances.find((i) => i.id === state.activeInstanceId) ?? state.instances[0];
  const sys = state.systemTelemetry;
  const met = state.metrics;

  // Row 0: Top border
  pushBorderTop();

  const onlineBadge = sys.serverOnline
    ? fgGreen(`[ONLINE PID:${sys.pid ?? activeInstance.pid ?? "LIVE"}]`)
    : fgYellow("[OFFLINE - g:Launch]");
  const titleText = new TruncatedText(
    `${fgCyan(`${BULLET} CTX-CAPSULE CONTROL PLANE`)} ${fgMuted("|")} Model: ${fgWhiteBold(activeModel.id)} (${fgYellow(activeModel.quantization)}) ${fgMuted("|")} Preset: ${fgCyan(activeTemplate.id)} ${onlineBadge}`,
    0,
    0,
  ).render(innerWidth)[0] ?? "";
  pushFullRow(titleText);

  // Row 2: Live Hardware & Capsule Telemetry Bar
  const vramRatio = Math.min(1, Math.max(0, sys.vramUsedGiB / Math.max(1, sys.vramTotalGiB)));
  const vramFilled = Math.max(1, Math.min(10, Math.round(vramRatio * 10)));
  const vramBar = `${fgGreen(BLK_FULL.repeat(vramFilled))}${fgDim(BLK_LIGHT.repeat(10 - vramFilled))}`;
  const teleLine = new TruncatedText(
    `GPU:[${vramBar}] ${sys.vramUsedGiB.toFixed(1)}/${sys.vramTotalGiB.toFixed(0)}G (${sys.gpuUtilPct}%) | RAM:${sys.hostRamUsedGiB.toFixed(0)}/${sys.hostRamTotalGiB.toFixed(0)}G | HotKV:${fgCyan(`${Math.round(met.activeHotVramTokens / 1024)}K`)} Caps:${fgMagenta(`${met.evictedCapsulesCount} (${Math.round(met.coldCapsuleTokens / 1024)}K)`)} | Spec:${fgGreen(`${sys.specAcceptancePct.toFixed(0)}%`)} | ${sys.prefillTokPerSec.toFixed(0)}/${sys.decodeTokPerSec.toFixed(1)} tok/s`,
    0,
    0,
  ).render(innerWidth)[0] ?? "";
  pushFullRow(teleLine);

  // Row 3: Separator
  pushBorderSep();

  // Row 4: Clickable Category Tabs (1..7)
  const tabRowIndex = topLines.length;
  let tabCursorX = 2;
  const tabSegments: string[] = [];
  for (const cat of CATEGORIES) {
    const isSel = cat.id === state.activeCategory;
    const plainSeg = isSel ? `[ ${cat.shortLabel} ]` : ` ${cat.shortLabel} `;
    const segLen = plainSeg.length;
    mouseRegions.push({
      id: `tab:${cat.id}`,
      x0: tabCursorX,
      y0: tabRowIndex,
      x1: tabCursorX + segLen - 1,
      y1: tabRowIndex,
      command: { _tag: "SelectCategory", category: cat.id },
      tooltip: `Switch to category ${cat.index}: ${cat.fullTitle}`,
    });
    tabSegments.push(isSel ? bgActiveTab(plainSeg) : fgMuted(plainSeg));
    tabCursorX += segLen + 1;
  }
  pushFullRow(tabSegments.join(" "));

  // Row 5: Clickable Quick-Action Bar (includes [Visual(v)] and [Help(?)])
  const actionRowIndex = topLines.length;
  const actionDefs: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly command: DomainCommand;
    readonly tooltip: string;
    readonly highlight?: boolean;
  }> = [
    {
      id: "act:launch",
      label: sys.serverOnline ? "[Restart(Enter)]" : "[Launch(Enter/g)]",
      command: { _tag: "LaunchActiveInstance" },
      tooltip: "Launch or restart active llama-server instance with compiled 5-layer CLI flags",
      highlight: !sys.serverOnline,
    },
    {
      id: "act:switch_model",
      label: "[Model(m)]",
      command: { _tag: "CycleActiveModel", delta: 1 },
      tooltip: "Cycle active flagship model checkpoint",
    },
    {
      id: "act:cycle_template",
      label: "[Preset(t)]",
      command: { _tag: "CycleTemplate", delta: 1 },
      tooltip: "Cycle active preset template",
    },
    {
      id: "act:save_template",
      label: "[Save(s)]",
      command: {
        _tag: "SaveCurrentAsTemplate",
        templateId: Branded.unsafeTemplateId(`custom_${state.activeModelId}`),
        displayName: `Custom ${activeModel.displayName}`,
      },
      tooltip: "Save current settings as a reusable TOML template",
    },
    {
      id: "act:add_instance",
      label: "[+Node(a)]",
      command: buildNextAddInstanceCommand(state),
      tooltip: "Add a parallel llama-server fleet node",
    },
    {
      id: "act:replace_inplace",
      label: "[Swap(x)]",
      command: buildNextReplaceInstanceCommand(state),
      tooltip: "Hot-swap active instance engine flavor in-place",
    },
    {
      id: "act:pto_tune",
      label: "[PTO Tune & Swap (p)]",
      command: { _tag: "TriggerPtoTraceAndOptimize" },
      tooltip: "Run Clang-21 Continuous IRPGO + ThinLTO binary optimization",
    },
    {
      id: "act:sync_sdks",
      label: "[Sync(e)]",
      command: { _tag: "SyncAllAgentSdks" },
      tooltip: "Synchronize 8 coding agent SDK configs and 5-layer TOMLs",
    },
    {
      id: "btn:visual_mode",
      label: "[Visual(v)]",
      command: { _tag: "ToggleVisualMode" },
      tooltip: "Toggle inline terminal diagram mode (auto / graphical_image / ascii_only)",
    },
    {
      id: "btn:help_modal",
      label: "[Help(?)]",
      command: { _tag: "ToggleHelpModal" },
      tooltip: "Open Help, Architecture & Controls reference modal (?)",
      highlight: state.showHelpModal,
    },
  ];

  let actCursorX = 2;
  const actParts: string[] = [];
  for (const btn of actionDefs) {
    const len = btn.label.length;
    if (actCursorX + len - 2 <= innerWidth) {
      mouseRegions.push({
        id: btn.id,
        x0: actCursorX,
        y0: actionRowIndex,
        x1: actCursorX + len - 1,
        y1: actionRowIndex,
        command: btn.command,
        tooltip: btn.tooltip,
      });
      actParts.push(btn.highlight ? fgGreen(btn.label) : bgButton(btn.label));
      actCursorX += len + 1;
    }
  }
  pushFullRow(actParts.join(" "));

  // Row 6: Separator before body
  pushBorderSep();

  // If Help Modal is open, render the full-width interactive Help & Architecture Overlay
  if (state.showHelpModal) {
    const helpLines = renderHelpModalFrame(state, width, topLines.length, mouseRegions);
    const footerLines: string[] = [
      borderTone(`${B_LT}${B_H.repeat(width - 2)}${B_RT}`),
      `${borderTone(B_V)} ${padOrTruncate(
        `${fgGreen("STATUS:")} ${state.statusBanner} ${fgMuted("|")}TOML: ${fgCyan(state.hierarchyRootDir)}`,
        innerWidth,
      )} ${borderTone(B_V)}`,
      `${borderTone(B_V)} ${padOrTruncate(
        `${fgCyan("KEYS:")} ?/Esc:Close Help | v:Diagram Mode | 1-7/Tab:Category | Up/Down:Select | Left/Right:Value | q:Quit`,
        innerWidth,
      )} ${borderTone(B_V)}`,
      borderTone(`${B_BL}${B_H.repeat(width - 2)}${B_BR}`),
    ];

    const rootVStack = new VStack(
      [new FixedLinesWidget(topLines), new FixedLinesWidget(helpLines), new FixedLinesWidget(footerLines)],
      { gap: 0 },
    );
    const renderedLines = rootVStack.render(width).map((line) => padOrTruncate(line, width));
    return Object.freeze({
      lines: Object.freeze(renderedLines),
      mouseRegions: Object.freeze(mouseRegions),
      width,
    });
  }

  // Build Left Column (Settings List) and Right Column (Inspector + Active Variant + Diagram + Fleet)
  const catSettings = getSettingsForCategory(state.activeCategory);
  const selectedRowIdx = state.selectedRowByCategory[state.activeCategory] ?? 0;
  const activeOption: SettingOptionSpec = catSettings[selectedRowIdx] ?? catSettings[0];
  const catMeta = CATEGORIES.find((c) => c.id === state.activeCategory) ?? CATEGORIES[0];
  const activeVal = state.settingsValues[activeOption.key] ?? activeOption.defaultValue;

  const leftColLines: string[] = [];
  leftColLines.push(
    padOrTruncate(
      fgCyan(`CATEGORY ${catMeta.index}: ${catMeta.shortLabel} (${catSettings.length} params)`),
      leftInner,
    ),
  );
  leftColLines.push(fgMuted(B_H.repeat(leftInner)));

  const bodyStartRowIndex = topLines.length;
  for (let idx = 0; idx < catSettings.length; idx++) {
    const opt = catSettings[idx];
    const isRowSel = idx === selectedRowIdx;
    const curVal = state.settingsValues[opt.key] ?? opt.defaultValue;
    const prefix = isRowSel ? "> " : "  ";
    const valueToken = `[< ${curVal} >]`;
    const maxLabelWidth = Math.max(12, leftInner - prefix.length - valueToken.length - 1);
    const labelPadded = padOrTruncate(opt.label, maxLabelWidth);
    const styledRow = isRowSel
      ? bgActiveRow(`${prefix}${labelPadded} ${valueToken}`)
      : `${fgMuted(prefix)}${styleText(labelPadded, { fg: indexedColor(252) }, COLOR_MODE)} ${fgYellow(valueToken)}`;

    const rowY = bodyStartRowIndex + leftColLines.length;
    const valStartX = 2 + prefix.length + maxLabelWidth + 1;
    const valEndX = valStartX + valueToken.length - 1;
    const valMidX = Math.floor((valStartX + valEndX) / 2);

    mouseRegions.push({
      id: `row:${opt.key}:select`,
      x0: 2,
      y0: rowY,
      x1: valStartX - 1,
      y1: rowY,
      command: { _tag: "SelectRowIndex", rowIndex: idx },
      tooltip: `Select parameter ${opt.label}`,
    });
    mouseRegions.push({
      id: `row:${opt.key}:dec`,
      x0: valStartX,
      y0: rowY,
      x1: valMidX,
      y1: rowY,
      command: { _tag: "CycleCurrentSetting", delta: -1 },
      tooltip: `Previous choice for ${opt.label}`,
    });
    mouseRegions.push({
      id: `row:${opt.key}:inc`,
      x0: valMidX + 1,
      y0: rowY,
      x1: Math.min(2 + leftInner - 1, valEndX),
      y1: rowY,
      command: { _tag: "CycleCurrentSetting", delta: 1 },
      tooltip: `Next choice for ${opt.label}`,
    });

    leftColLines.push(padOrTruncate(styledRow, leftInner));
    const subLine = `   ${opt.cliFlag} | ${opt.envVar}`;
    leftColLines.push(padOrTruncate(fgDim(subLine), leftInner));
  }

  leftColLines.push(fgMuted(B_H.repeat(leftInner)));
  leftColLines.push(padOrTruncate(fgCyan("ACTIVE LLAMA.CPP FLEET ([g] Launch | [a] Add | [x] Swap):"), leftInner));
  for (const inst of state.instances.slice(0, 3)) {
    const isAct = inst.id === state.activeInstanceId;
    const statusLabel =
      isAct && sys.serverOnline
        ? fgGreen(`PID:${sys.pid ?? inst.pid ?? "LIVE"}`)
        : inst.status === "healthy"
          ? fgGreen(`PID:${inst.pid ?? "LIVE"}`)
          : fgYellow(inst.status.toUpperCase());
    const marker = isAct ? fgCyan("*") : " ";
    const instLine = `${marker}${inst.id} [${inst.engineFlavor}] :${inst.port} NUMA:${inst.numaNodes} ${statusLabel}`;
    leftColLines.push(padOrTruncate(instLine, leftInner));
  }
  const activeFlavorSetting = state.settingsValues.engine_flavor;
  if (activeFlavorSetting) {
    leftColLines.push(
      padOrTruncate(
        fgDim(`   Active Engine Flavor: ${activeFlavorSetting} | Handover: ${state.settingsValues.replace_policy ?? "atomic_port_rebind"}`),
        leftInner,
      ),
    );
  }

  // Right Column: Option Inspector + ACTIVE VARIANT Explanation + Diagram + Pros/Cons + Fit
  const rightColLines: string[] = [];
  const fitBadgeText = activeOption.fitRule.split(":")[0] ?? "OPTIMAL";
  const fitColor = fitBadgeText.includes("OPTIMAL")
    ? fgGreen
    : fitBadgeText.includes("WARN")
      ? fgYellow
      : fgCyan;

  rightColLines.push(
    padOrTruncate(
      `${fgWhiteBold(`OPTION: ${activeOption.label}`)}  ${fitColor(`[${fitBadgeText}]`)}`,
      rightInner,
    ),
  );
  rightColLines.push(
    padOrTruncate(
      `${fgCyan(`CLI: ${activeOption.cliFlag}`)} ${fgMuted("|")} ${fgYellow(`ENV: ${activeOption.envVar}`)} ${fgMuted("|")} Value: ${fgGreen(activeVal)}`,
      rightInner,
    ),
  );

  for (const fitLine of wrapTextToWidth(`FIT: ${activeOption.fitRule}`, rightInner).slice(0, 2)) {
    rightColLines.push(padOrTruncate(fgMuted(fitLine), rightInner));
  }

  // ACTIVE VARIANT specific explanation callout box
  const activeChoiceExplanation =
    activeOption.choiceDescriptions[activeVal] ??
    `Selected variant '${activeVal}' for ${activeOption.label} (${activeOption.cliFlag}).`;
  const choiceIndex = activeOption.choices.indexOf(activeVal);
  const variantCounter = `${Math.max(1, choiceIndex + 1)}/${activeOption.choices.length}`;
  rightColLines.push(
    padOrTruncate(
      `${fgGreen(`ACTIVE VARIANT [< ${activeVal} >] (${variantCounter}):`)} ${fgDim("(Left/Right/Space to cycle variants)")}`,
      rightInner,
    ),
  );
  for (const vLine of wrapTextToWidth(activeChoiceExplanation, rightInner - 2).slice(0, 2)) {
    rightColLines.push(padOrTruncate(`  ${fgWhiteBold(vLine)}`, rightInner));
  }

  // Other available variants summary line
  const otherVariantsSummary = activeOption.choices
    .map((c) => (c === activeVal ? `[${c}]` : c))
    .join(" | ");
  rightColLines.push(
    padOrTruncate(`${fgCyan("VARIANTS:")} ${fgMuted(otherVariantsSummary)}`, rightInner),
  );

  // Diagram Header (shows active visual mode + Kitty/Ghostty PNG asset metadata)
  const diagramAsset = getCategoryDiagramAsset(state.activeCategory);
  const activeProto = resolveActiveImageProtocol(state.visualDiagramMode);
  const diagModeBadge =
    state.visualDiagramMode === "graphical_image" || activeProto !== null
      ? `PNG#${diagramAsset.imageId}:${activeProto ?? "kitty_ready"}`
      : `Mode:${state.visualDiagramMode.toUpperCase()}`;
  rightColLines.push(
    padOrTruncate(
      `${fgMagenta(`DIAGRAM [${diagramAsset.title}]`)} ${fgCyan(`[${diagModeBadge} | v:Toggle]`)}`,
      rightInner,
    ),
  );
  for (const artLine of activeOption.asciiArt.slice(0, 5)) {
    rightColLines.push(padOrTruncate(fgCyan(`  ${artLine}`), rightInner));
  }

  // Impact + Pros & Cons
  for (const impLine of wrapTextToWidth(`IMPACT: ${activeOption.impact}`, rightInner).slice(0, 2)) {
    rightColLines.push(padOrTruncate(fgYellow(impLine), rightInner));
  }
  for (const pro of activeOption.pros.slice(0, 2)) {
    rightColLines.push(padOrTruncate(`${fgGreen("+")} ${pro}`, rightInner));
  }
  for (const con of activeOption.cons.slice(0, 1)) {
    rightColLines.push(padOrTruncate(`${fgRed("-")} ${con}`, rightInner));
  }
  if (state.telemetryLogs.length > 0) {
    const recentSpans = state.telemetryLogs
      .slice(-2)
      .map((entry) => `[${entry.spanName}] ${entry.message}`)
      .join(" | ");
    rightColLines.push(padOrTruncate(fgDim(`SPANS: ${recentSpans}`), rightInner));
  }

  // Compose Body using `@earendil-works/pi-tui` `HStack` (wide) or `VStack` (narrow)
  const bodyLines: string[] = [];
  if (!isStacked) {
    const rowCount = Math.max(leftColLines.length, rightColLines.length, 18);
    const normLeft: string[] = [];
    const normRight: string[] = [];
    for (let r = 0; r < rowCount; r++) {
      normLeft.push(padOrTruncate(leftColLines[r] ?? "", leftInner));
      normRight.push(padOrTruncate(rightColLines[r] ?? "", rightInner));
    }
    const sepLines = Array.from({ length: rowCount }, () => ` ${borderTone(B_V)} `);
    const dualPane = new HStack(
      [
        { component: new FixedLinesWidget(normLeft), basis: leftInner, grow: 0, shrink: 0 },
        { component: new FixedLinesWidget(sepLines), basis: 3, grow: 0, shrink: 0 },
        { component: new FixedLinesWidget(normRight), basis: rightInner, grow: 0, shrink: 0 },
      ],
      { gap: 0 },
    );
    for (const joined of dualPane.render(innerWidth)) {
      bodyLines.push(`${borderTone(B_V)} ${padOrTruncate(joined, innerWidth)} ${borderTone(B_V)}`);
    }
  } else {
    const stackedBox = new Box(0, 0);
    stackedBox.addChild(new FixedLinesWidget(leftColLines));
    stackedBox.addChild(new Text(fgMuted(B_H.repeat(innerWidth)), 0, 0));
    stackedBox.addChild(new FixedLinesWidget(rightColLines));
    for (const line of stackedBox.render(innerWidth)) {
      bodyLines.push(`${borderTone(B_V)} ${padOrTruncate(line, innerWidth)} ${borderTone(B_V)}`);
    }
  }

  // Footer: Status Banner + Key & Mouse Hint Bar
  const footerLines: string[] = [
    borderTone(`${B_LT}${B_H.repeat(width - 2)}${B_RT}`),
    `${borderTone(B_V)} ${padOrTruncate(
      `${fgGreen("STATUS:")} ${state.statusBanner} ${fgMuted("|")} TOML: ${fgCyan(state.hierarchyRootDir)}`,
      innerWidth,
    )} ${borderTone(B_V)}`,
    `${borderTone(B_V)} ${padOrTruncate(
      `${fgCyan("KEYS:")} 1-7/Tab:Cat | Up/Down:Row | Left/Right:Variant | Enter/g:Launch | m:Model | t:Preset | p:PTO | v:Visual | ?:Help | q:Quit`,
      innerWidth,
    )} ${borderTone(B_V)}`,
    borderTone(`${B_BL}${B_H.repeat(width - 2)}${B_BR}`),
  ];

  const rootVStack = new VStack(
    [
      new FixedLinesWidget(topLines),
      new FixedLinesWidget(bodyLines),
      new FixedLinesWidget(footerLines),
    ],
    { gap: 0 },
  );

  const renderedLines = rootVStack.render(width).map((line) => padOrTruncate(line, width));

  return Object.freeze({
    lines: Object.freeze(renderedLines),
    mouseRegions: Object.freeze(mouseRegions),
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
 * Interactive `@earendil-works/pi-tui` `Component` implementation with
 * keyboard + mouse support, responsive layout, and Hexagonal effect dispatch.
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
    if (data === "?" || (matchesKey(data, Key.escape) && this.state.showHelpModal)) {
      this.dispatchCommand({ _tag: "ToggleHelpModal" });
      return;
    }

    if (data === "v" || data === "V") {
      this.dispatchCommand({ _tag: "ToggleVisualMode" });
      return;
    }

    if (data === "q" || data === "Q" || matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onQuit?.();
      return;
    }

    if (data >= "1" && data <= "7") {
      const idx = Number(data) - 1;
      const cat = CATEGORIES[idx];
      if (cat) {
        if (this.state.showHelpModal) {
          this.dispatchCommand({ _tag: "ToggleHelpModal" });
        }
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
