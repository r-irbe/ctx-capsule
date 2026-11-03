/**
 * "Playwright / Chrome DevTools for TUIs" -- Automated TUI Driver, Cell-Grid DOM
 * Inspector, Invariant Verifier, Asciinema v2 (`.cast`) Screencast Recorder,
 * and Self-Contained Interactive HTML/SVG Screencast Player Generator.
 *
 * Drives `CapsulePiTuiComponent` programmatically across:
 *   1. All 7 architectural category tabs (`1..7`)
 *   2. All 37 settings and every single option variant (~145 variants)
 *   3. The `?` Help, Architecture & Controls Modal
 *   4. The `v` Visual Diagram Mode toggle + `@earendil-works/pi-tui` `Image`
 *      Kitty (`\x1b_G...`) and iTerm2 (`\x1b]1337;File=...`) inline PNG rendering
 *   5. Preset switching (`ds41-1017-np1-512k-max-speed`, `ds41-1017-np1-1m-extreme`,
 *      `ds41-1017-np4-512k-swarm`, `ds41-1017-np8-1m-swarm`), model cycling (`m`),
 *      fleet node addition (`a`), in-place flavor swap (`x`), PTO optimization (`p`),
 *      and 88-column narrow responsive layout.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  resetCapabilitiesCache,
  setCapabilityOverrides,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  CapsulePiTuiComponent,
  type FrameRenderSnapshot,
  renderCategoryGraphicalPreview,
} from "../adapters/pi_tui_adapter.ts";
import {
  type CategoryDiagramAsset,
  getAllCategoryDiagramAssets,
  getCategoryDiagramAsset,
} from "../adapters/terminal_diagram_generator.ts";
import {
  getSettingsForCategory,
  hitTestMouseRegions,
} from "../domain/reducer.ts";
import {
  type DomainError,
  DomainErrors,
  Result,
} from "../domain/result.ts";
import {
  CATEGORIES,
  type MouseHitRegion,
  SETTINGS_SCHEMA,
} from "../domain/types.ts";

export interface TuiRecordedFrame {
  readonly frameIndex: number;
  readonly timestampSec: number;
  readonly chapterId: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly lines: readonly string[];
  readonly strippedLines: readonly string[];
  readonly activeCategory: string;
  readonly activeOptionKey: string;
  readonly activeOptionValue: string;
  readonly showHelpModal: boolean;
  readonly visualDiagramMode: string;
  readonly mouseRegionCount: number;
}

export interface TuiInlineGraphicsAuditEntry {
  readonly category: string;
  readonly title: string;
  readonly imageId: number;
  readonly pngBase64Length: number;
  readonly kittyRenderedLines: number;
  readonly kittyValidApc: boolean;
  readonly iterm2RenderedLines: number;
  readonly iterm2ValidOsc: boolean;
}

export interface TuiPlaywrightAuditReport {
  readonly totalFramesRecorded: number;
  readonly totalDurationSec: number;
  readonly categoriesAudited: number;
  readonly totalSettingsAudited: number;
  readonly totalVariantsCycledAndVerified: number;
  readonly helpModalVerified: boolean;
  readonly responsive88ColVerified: boolean;
  readonly mouseHitRegionsVerified: number;
  readonly geometryViolations: readonly string[];
  readonly explanationViolations: readonly string[];
  readonly inlineGraphicsAudit: readonly TuiInlineGraphicsAuditEntry[];
  readonly castFilePath: string | null;
  readonly htmlPlayerPath: string | null;
  readonly jsonReportPath: string | null;
}

function stripAnsiCodes(input: string): string {
  // Strip CSI (\x1b[...m) and OSC/APC sequences for plain-text DOM assertions
  return input
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b_G[^\x1b]*\x1b\\/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Playwright-style programmatic driver and cell-grid DOM inspector for `CapsulePiTuiComponent`.
 */
export class TuiPlaywrightPage {
  private readonly component: CapsulePiTuiComponent;
  private width: number;
  private currentTimestampSec = 0;
  private readonly frames: TuiRecordedFrame[] = [];
  private readonly geometryViolations: string[] = [];
  private readonly explanationViolations: string[] = [];
  private mouseHitRegionsVerified = 0;

  constructor(component: CapsulePiTuiComponent, width = 136) {
    this.component = component;
    this.width = width;
  }

  getComponent(): CapsulePiTuiComponent {
    return this.component;
  }

  getRecordedFrames(): readonly TuiRecordedFrame[] {
    return this.frames;
  }

  getGeometryViolations(): readonly string[] {
    return this.geometryViolations;
  }

  getExplanationViolations(): readonly string[] {
    return this.explanationViolations;
  }

  getMouseHitRegionsVerified(): number {
    return this.mouseHitRegionsVerified;
  }

  setViewportWidth(width: number): void {
    this.width = width;
  }

  /**
   * Sends a keyboard key or escape sequence (`"?"`, `"v"`, `"1".."7"`, `"\t"`, `"\x1b[B"`, etc.).
   */
  press(keyData: string): void {
    this.component.handleInput(keyData);
  }

  /**
   * Clicks a named mouse hit region by its `id` (e.g. `"tab:kv_paging"`, `"btn:help_modal"`, `"row:ctx_size:inc"`).
   */
  clickRegion(regionId: string, button: "left" | "right" = "left"): boolean {
    this.component.render(this.width);
    const snap = this.component.getLastSnapshot();
    const region: MouseHitRegion | undefined = snap.mouseRegions.find((r) => r.id === regionId);
    if (!region) {
      return false;
    }
    const clickX = Math.floor((region.x0 + region.x1) / 2);
    const clickY = region.y0;
    const hit = hitTestMouseRegions(snap.mouseRegions, clickX, clickY);
    if (!hit) {
      return false;
    }
    this.mouseHitRegionsVerified++;
    const res = this.component.handleMouse({
      type: "click",
      button,
      x: clickX,
      y: clickY,
      screenX: clickX,
      screenY: clickY,
      width: this.width,
      height: snap.lines.length,
      shift: false,
      alt: false,
      ctrl: false,
    });
    return Boolean(res?.handled);
  }

  /**
   * Dispatches a mouse wheel scroll event (`delta > 0` scrolls down, `delta < 0` scrolls up).
   */
  wheel(delta: number): boolean {
    const snap = this.component.getLastSnapshot();
    const res = this.component.handleMouse({
      type: "wheel",
      button: "none",
      x: 10,
      y: 10,
      screenX: 10,
      screenY: 10,
      width: this.width,
      height: snap.lines.length,
      shift: false,
      alt: false,
      ctrl: false,
      wheelDelta: delta,
    });
    if (res?.handled) {
      this.mouseHitRegionsVerified++;
    }
    return Boolean(res?.handled);
  }

  /**
   * Queries the current rendered frame for lines matching `pattern` (like Playwright's `page.locator(text)`).
   */
  locator(pattern: string | RegExp): {
    readonly count: number;
    readonly matchingLines: readonly string[];
  } {
    const lines = this.component.render(this.width).map((l) => stripAnsiCodes(l));
    const matches = lines.filter((line) =>
      typeof pattern === "string" ? line.includes(pattern) : pattern.test(line),
    );
    return Object.freeze({
      count: matches.length,
      matchingLines: Object.freeze(matches),
    });
  }

  /**
   * Captures a frame, verifies cell-grid geometry invariants (exact `width` columns,
   * rounded border integrity, zero horizontal clipping), and records it to the timeline.
   */
  captureFrame(
    chapterId: string,
    label: string,
    dwellSeconds = 0.18,
    verifyActiveOptionExplanation = true,
  ): TuiRecordedFrame {
    const lines = this.component.render(this.width);
    const snap: FrameRenderSnapshot = this.component.getLastSnapshot();
    const strippedLines = lines.map((l) => stripAnsiCodes(l));
    const state = this.component.getState();
    const catSettings = getSettingsForCategory(state.activeCategory);
    const rowIdx = state.selectedRowByCategory[state.activeCategory] ?? 0;
    const activeOpt = catSettings[rowIdx] ?? catSettings[0];
    const activeVal = state.settingsValues[activeOpt.key] ?? activeOpt.defaultValue;

    // 1. Assert exact visibleWidth on every single row and valid top/bottom/side borders
    for (let r = 0; r < lines.length; r++) {
      const vw = visibleWidth(lines[r]);
      if (vw !== this.width) {
        this.geometryViolations.push(
          `Frame #${this.frames.length} (${label}) row ${r}: expected visibleWidth=${this.width}, got ${vw}`,
        );
      }
      const plain = strippedLines[r];
      if (r === 0 && (!plain.startsWith("\u256D") || !plain.endsWith("\u256E"))) {
        this.geometryViolations.push(
          `Frame #${this.frames.length} (${label}) row 0 missing top rounded border`,
        );
      } else if (
        r === lines.length - 1 &&
        (!plain.startsWith("\u2570") || !plain.endsWith("\u256F"))
      ) {
        this.geometryViolations.push(
          `Frame #${this.frames.length} (${label}) last row missing bottom rounded border`,
        );
      }
    }

    // 2. When not in Help modal, assert that the right-hand inspector renders:
    //    - OPTION: <label>
    //    - ACTIVE VARIANT [< value >]
    //    - Non-empty explanation from choiceDescriptions[activeVal]
    if (!state.showHelpModal && verifyActiveOptionExplanation) {
      const joinedPlain = strippedLines.join("\n");
      const labelPrefix = activeOpt.label.slice(0, 32);
      if (!joinedPlain.includes(`OPTION: ${labelPrefix}`)) {
        this.explanationViolations.push(
          `Frame #${this.frames.length} (${label}): missing 'OPTION: ${labelPrefix}' in inspector`,
        );
      }
      if (!joinedPlain.includes(`ACTIVE VARIANT [< ${activeVal} >]`)) {
        this.explanationViolations.push(
          `Frame #${this.frames.length} (${label}): missing 'ACTIVE VARIANT [< ${activeVal} >]' in inspector`,
        );
      }
      const expectedChoiceDesc = activeOpt.choiceDescriptions[activeVal] ?? "";
      const firstWords = expectedChoiceDesc.split(/\s+/).slice(0, 4).join(" ");
      if (!firstWords || !joinedPlain.includes(firstWords)) {
        this.explanationViolations.push(
          `Frame #${this.frames.length} (${label}): missing variant explanation prefix '${firstWords}' for ${activeOpt.key}=${activeVal}`,
        );
      }
    }

    const frame: TuiRecordedFrame = Object.freeze({
      frameIndex: this.frames.length,
      timestampSec: Number(this.currentTimestampSec.toFixed(3)),
      chapterId,
      label,
      width: this.width,
      height: lines.length,
      lines: Object.freeze([...lines]),
      strippedLines: Object.freeze(strippedLines),
      activeCategory: state.activeCategory,
      activeOptionKey: activeOpt.key,
      activeOptionValue: activeVal,
      showHelpModal: state.showHelpModal,
      visualDiagramMode: state.visualDiagramMode,
      mouseRegionCount: snap.mouseRegions.length,
    });

    this.frames.push(frame);
    this.currentTimestampSec += dwellSeconds;
    return frame;
  }

  /**
   * Formats all recorded frames as an asciinema v2 `.cast` file (NDJSON header + `[time, "o", data]` events).
   */
  toAsciinemaCast(title = "ctx-capsule Interactive TUI Screencast (All 7 Tabs, 37 Options & ~145 Variants)"): string {
    const maxHeight = this.frames.reduce((acc, f) => Math.max(acc, f.height), 38);
    const header = JSON.stringify({
      version: 2,
      width: 136,
      height: maxHeight,
      timestamp: 1762135200,
      title,
      env: {
        TERM: "xterm-256color",
        SHELL: "/bin/bash",
      },
    });

    const events: string[] = [header];
    for (const frame of this.frames) {
      const clearAndHome = "\x1b[2J\x1b[H";
      const banner = `\x1b[1;36m[DEVTOOLS STEP ${frame.frameIndex + 1}/${this.frames.length}]\x1b[0m ${frame.label}\r\n`;
      const payload = clearAndHome + banner + frame.lines.join("\r\n");
      events.push(JSON.stringify([frame.timestampSec, "o", payload]));
    }
    return events.join("\n") + "\n";
  }

  /**
   * Generates a self-contained interactive HTML/SVG screencast player + DevTools DOM inspector
   * with embedded Ghostty/Kitty PNG architectural diagrams for all 7 categories.
   */
  toInteractiveHtmlPlayer(report: TuiPlaywrightAuditReport): string {
    const assets = getAllCategoryDiagramAssets();
    const compactFrames = this.frames.map((f) => ({
      idx: f.frameIndex,
      t: f.timestampSec,
      ch: f.chapterId,
      label: f.label,
      cat: f.activeCategory,
      key: f.activeOptionKey,
      val: f.activeOptionValue,
      help: f.showHelpModal,
      vis: f.visualDiagramMode,
      regions: f.mouseRegionCount,
      text: f.strippedLines.join("\n"),
    }));

    const galleryCardsHtml = assets
      .map(
        (asset: CategoryDiagramAsset) => `
        <div class="diagram-card">
          <div class="diagram-card-header">
            <span class="badge">${escapeHtml(asset.category)}</span>
            <strong>${escapeHtml(asset.title)}</strong>
            <span class="meta">Kitty ID #${asset.imageId} (${asset.dimensions.widthPx}x${asset.dimensions.heightPx} PNG)</span>
          </div>
          <img src="data:image/png;base64,${asset.base64Png}" alt="${escapeHtml(asset.title)}" />
          <div class="diagram-caption">${escapeHtml(asset.filename)} (${asset.base64Png.length} B base64)</div>
        </div>`,
      )
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ctx-capsule TUI DevTools &amp; Full Interactive Screencast</title>
  <style>
    :root {
      --bg: #0b0f19;
      --panel: #111827;
      --border: #334155;
      --cyan: #38bdf8;
      --green: #4ade80;
      --amber: #fbbf24;
      --violet: #a78bfa;
      --text: #e2e8f0;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      background: var(--bg);
      color: var(--text);
      font-family: ui-monospace, "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace;
    }
    h1, h2, h3 { margin: 0 0 10px 0; font-weight: 700; }
    .header-bar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      padding: 14px 18px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 16px;
    }
    .stats-row {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .stat-pill {
      padding: 4px 10px;
      border-radius: 999px;
      background: #1e293b;
      border: 1px solid var(--border);
    }
    .stat-pill strong { color: var(--green); }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 12px 16px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 12px;
    }
    button, select {
      background: #1e293b;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 12px;
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    button:hover { border-color: var(--cyan); color: var(--cyan); }
    button.active { background: var(--cyan); color: #090d16; font-weight: 700; }
    input[type="range"] { flex: 1; min-width: 220px; accent-color: var(--cyan); }
    .chapter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 14px;
    }
    .main-grid {
      display: grid;
      grid-template-columns: 1fr 360px;
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 1280px) {
      .main-grid { grid-template-columns: 1fr; }
    }
    .terminal-box {
      background: #050811;
      border: 1px solid var(--cyan);
      border-radius: 8px;
      padding: 14px;
      overflow-x: auto;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .terminal-step-banner {
      color: var(--cyan);
      font-size: 13px;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px dashed var(--border);
    }
    pre#screen {
      margin: 0;
      font-size: 12.2px;
      line-height: 1.28;
      color: #f1f5f9;
      white-space: pre;
    }
    .inspector-box {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      font-size: 12.5px;
    }
    .inspector-row {
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #1e293b;
    }
    .inspector-row .k { color: var(--muted); display: block; font-size: 11px; }
    .inspector-row .v { color: var(--cyan); font-weight: 600; }
    .inspector-preview-img {
      width: 100%;
      border-radius: 6px;
      border: 1px solid var(--border);
      margin-top: 6px;
    }
    .gallery-section {
      margin-top: 24px;
      padding: 16px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 14px;
      margin-top: 12px;
    }
    .diagram-card {
      background: #090d16;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
    }
    .diagram-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      margin-bottom: 8px;
    }
    .diagram-card img {
      width: 100%;
      height: auto;
      border-radius: 4px;
      border: 1px solid #1e293b;
    }
    .diagram-caption {
      color: var(--muted);
      font-size: 11px;
      margin-top: 6px;
    }
    .badge {
      background: #1e293b;
      color: var(--cyan);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10.5px;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div>
      <h1>ctx-capsule Playwright-for-TUI Screencast &amp; DOM Inspector</h1>
      <div style="color: var(--muted); font-size: 12.5px;">
        Full walkthrough of all 7 tabs, all ${report.totalSettingsAudited} options, all ${report.totalVariantsCycledAndVerified} variants, Help modal (?), and Ghostty/Kitty/Pi inline PNG diagrams (v)
      </div>
    </div>
    <div class="stats-row">
      <span class="stat-pill">Frames: <strong>${report.totalFramesRecorded}</strong></span>
      <span class="stat-pill">Categories: <strong>${report.categoriesAudited}/7</strong></span>
      <span class="stat-pill">Options: <strong>${report.totalSettingsAudited}/37</strong></span>
      <span class="stat-pill">Variants Verified: <strong>${report.totalVariantsCycledAndVerified}</strong></span>
      <span class="stat-pill">Geometry Violations: <strong>${report.geometryViolations.length}</strong></span>
      <span class="stat-pill">Explanation Violations: <strong>${report.explanationViolations.length}</strong></span>
    </div>
  </div>

  <div class="controls">
    <button id="playBtn" class="active">Pause</button>
    <button id="prevBtn">&larr; Prev Frame</button>
    <button id="nextBtn">Next Frame &rarr;</button>
    <input id="scrubber" type="range" min="0" max="${Math.max(0, this.frames.length - 1)}" value="0" />
    <span id="frameCounter" style="min-width: 110px; font-size: 12px;">1 / ${this.frames.length}</span>
    <label style="font-size: 12px; color: var(--muted);">Speed:
      <select id="speedSelect">
        <option value="500">1x (500ms)</option>
        <option value="250" selected>2x (250ms)</option>
        <option value="110">4x (110ms)</option>
        <option value="50">8x (50ms)</option>
      </select>
    </label>
  </div>

  <div class="chapter-bar" id="chapterBar"></div>

  <div class="main-grid">
    <div class="terminal-box">
      <div class="terminal-step-banner" id="stepBanner">Loading frame...</div>
      <pre id="screen"></pre>
    </div>
    <div class="inspector-box">
      <h3>TUI DevTools Live Frame Inspector</h3>
      <div class="inspector-row">
        <span class="k">Active Category Tab</span>
        <span class="v" id="inspCat">-</span>
      </div>
      <div class="inspector-row">
        <span class="k">Focused Parameter Key</span>
        <span class="v" id="inspKey">-</span>
      </div>
      <div class="inspector-row">
        <span class="k">Active Variant Value</span>
        <span class="v" id="inspVal" style="color: var(--green);">-</span>
      </div>
      <div class="inspector-row">
        <span class="k">Visual Diagram Mode / Help Overlay</span>
        <span class="v" id="inspMode">-</span>
      </div>
      <div class="inspector-row">
        <span class="k">Interactive Mouse Hit Regions</span>
        <span class="v" id="inspRegions">-</span>
      </div>
      <div>
        <span class="k" style="color: var(--muted); font-size: 11px;">Ghostty / Kitty / Pi TUI Inline PNG Schematic (Current Tab):</span>
        <img id="inspImg" class="inspector-preview-img" src="data:image/png;base64,${assets[0].base64Png}" alt="Active Category Schematic" />
      </div>
    </div>
  </div>

  <div class="gallery-section">
    <h2>Inline Terminal PNG Architectural Schematics (Ghostty / Kitty APC &amp; iTerm2 OSC)</h2>
    <p style="color: var(--muted); font-size: 12.5px; margin: 4px 0 0 0;">
      Rendered natively via <code>@earendil-works/pi-tui</code> <code>Image</code> component when <code>getCapabilities().images</code> is <code>"kitty"</code> or <code>"iterm2"</code> (toggle with <code>v</code> inside the TUI).
    </p>
    <div class="gallery-grid">
      ${galleryCardsHtml}
    </div>
  </div>

  <script>
    const FRAMES = ${JSON.stringify(compactFrames)};
    const CATEGORY_IMAGES = ${JSON.stringify(
      Object.fromEntries(assets.map((a: CategoryDiagramAsset) => [a.category, a.base64Png])),
    )};

    let currentIdx = 0;
    let playing = true;
    let intervalMs = 250;
    let timer = null;

    const screenEl = document.getElementById("screen");
    const stepBannerEl = document.getElementById("stepBanner");
    const scrubberEl = document.getElementById("scrubber");
    const frameCounterEl = document.getElementById("frameCounter");
    const playBtn = document.getElementById("playBtn");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    const speedSelect = document.getElementById("speedSelect");
    const chapterBar = document.getElementById("chapterBar");

    const inspCat = document.getElementById("inspCat");
    const inspKey = document.getElementById("inspKey");
    const inspVal = document.getElementById("inspVal");
    const inspMode = document.getElementById("inspMode");
    const inspRegions = document.getElementById("inspRegions");
    const inspImg = document.getElementById("inspImg");

    const chapters = [];
    const seenChapters = new Set();
    FRAMES.forEach((f, idx) => {
      if (!seenChapters.has(f.ch)) {
        seenChapters.add(f.ch);
        chapters.push({ ch: f.ch, idx });
      }
    });

    chapters.forEach((c) => {
      const btn = document.createElement("button");
      btn.textContent = c.ch;
      btn.onclick = () => {
        renderFrame(c.idx);
      };
      chapterBar.appendChild(btn);
    });

    function renderFrame(idx) {
      currentIdx = Math.max(0, Math.min(FRAMES.length - 1, idx));
      const f = FRAMES[currentIdx];
      screenEl.textContent = f.text;
      stepBannerEl.textContent = "[" + (currentIdx + 1) + "/" + FRAMES.length + " | t=" + f.t.toFixed(2) + "s | " + f.ch + "] " + f.label;
      scrubberEl.value = String(currentIdx);
      frameCounterEl.textContent = (currentIdx + 1) + " / " + FRAMES.length;
      inspCat.textContent = f.cat;
      inspKey.textContent = f.key;
      inspVal.textContent = "< " + f.val + " >";
      inspMode.textContent = "Diagram: " + f.vis.toUpperCase() + " | Help Modal: " + (f.help ? "OPEN" : "CLOSED");
      inspRegions.textContent = f.regions + " clickable regions";
      if (CATEGORY_IMAGES[f.cat]) {
        inspImg.src = "data:image/png;base64," + CATEGORY_IMAGES[f.cat];
      }
    }

    function restartTimer() {
      if (timer) clearInterval(timer);
      if (playing) {
        timer = setInterval(() => {
          renderFrame((currentIdx + 1) % FRAMES.length);
        }, intervalMs);
      }
    }

    playBtn.onclick = () => {
      playing = !playing;
      playBtn.textContent = playing ? "Pause" : "Play";
      playBtn.classList.toggle("active", playing);
      restartTimer();
    };
    prevBtn.onclick = () => {
      playing = false;
      playBtn.textContent = "Play";
      playBtn.classList.remove("active");
      if (timer) clearInterval(timer);
      renderFrame((currentIdx - 1 + FRAMES.length) % FRAMES.length);
    };
    nextBtn.onclick = () => {
      playing = false;
      playBtn.textContent = "Play";
      playBtn.classList.remove("active");
      if (timer) clearInterval(timer);
      renderFrame((currentIdx + 1) % FRAMES.length);
    };
    scrubberEl.oninput = (e) => {
      renderFrame(Number(e.target.value));
    };
    speedSelect.onchange = (e) => {
      intervalMs = Number(e.target.value);
      restartTimer();
    };

    renderFrame(0);
    restartTimer();
  </script>
</body>
</html>
`;
  }
}

export interface RunTuiScreencastOptions {
  readonly component: CapsulePiTuiComponent;
  readonly castOutputPath?: string | null;
  readonly htmlOutputPath?: string | null;
  readonly jsonReportPath?: string | null;
}

/**
 * Audits `@earendil-works/pi-tui`'s native `Image` component across all 7 categories
 * under both Kitty/Ghostty (`images: "kitty"`) and iTerm2 (`images: "iterm2"`) capability overrides.
 */
export function auditPiTuiInlineGraphics(): readonly TuiInlineGraphicsAuditEntry[] {
  const results: TuiInlineGraphicsAuditEntry[] = [];
  for (const cat of CATEGORIES) {
    const asset = getCategoryDiagramAsset(cat.id);

    setCapabilityOverrides({ images: "kitty" });
    const kittyPreview = renderCategoryGraphicalPreview(cat.id, 48);
    const kittyJoined = kittyPreview.lines.join("\n");
    const kittyValid = kittyJoined.includes("\x1b_G");

    setCapabilityOverrides({ images: "iterm2" });
    const itermPreview = renderCategoryGraphicalPreview(cat.id, 48);
    const itermJoined = itermPreview.lines.join("\n");
    const itermValid = itermJoined.includes("\x1b]1337;File=");

    setCapabilityOverrides({});
    resetCapabilitiesCache();

    results.push(
      Object.freeze({
        category: cat.id,
        title: asset.title,
        imageId: asset.imageId,
        pngBase64Length: asset.base64Png.length,
        kittyRenderedLines: kittyPreview.lines.length,
        kittyValidApc: kittyValid,
        iterm2RenderedLines: itermPreview.lines.length,
        iterm2ValidOsc: itermValid,
      }),
    );
  }
  return Object.freeze(results);
}

/**
 * Executes the complete Playwright-style TUI walkthrough & invariant audit across:
 *   - Initial state & Help Modal (`?`)
 *   - Visual Diagram Mode cycling (`v`: `auto` -> `graphical_image` -> `ascii_only` -> `auto`)
 *   - All 7 category tabs (`1..7`), all 37 settings, and every single variant (~145 variants)
 *   - Quick-action controls (`m`, `t`, `s`, `a`, `x`, `p`, `e`, `r`)
 *   - Responsive 88-column layout verification
 * and writes `.cast`, `.html`, and `.json` artifacts if paths are provided.
 */
export async function runComprehensiveTuiScreencastAndAudit(
  options: RunTuiScreencastOptions,
): Promise<Result<TuiPlaywrightAuditReport, DomainError>> {
  const page = new TuiPlaywrightPage(options.component, 136);

  // Chapter 0: Initial Dashboard & Help Modal (`?`)
  page.captureFrame(
    "0. Overview & Help (?)",
    "Initial ctx-capsule TUI Dashboard (Tab 1: Models & Presets)",
    0.35,
  );

  page.press("?");
  page.captureFrame(
    "0. Overview & Help (?)",
    "Opened Interactive Help, Architecture & Controls Guide Modal (?)",
    0.45,
    false,
  );
  const helpCheck = page.locator("HELP, ARCHITECTURE & INTERACTIVE CONTROLS GUIDE");
  const helpModalVerified = helpCheck.count > 0 && page.getComponent().getState().showHelpModal;

  // Close Help Modal via clickable button region `help:close`
  if (!page.clickRegion("help:close")) {
    page.press("?");
  }
  page.captureFrame(
    "0. Overview & Help (?)",
    "Closed Help Modal via Mouse Region [help:close]",
    0.25,
  );

  // Toggle Visual Diagram Mode (`v`) across auto -> graphical_image -> ascii_only -> auto
  page.clickRegion("btn:visual_mode");
  page.captureFrame(
    "0. Overview & Help (?)",
    "Switched Diagram Mode to GRAPHICAL_IMAGE (Ghostty/Kitty/Pi TUI PNG Mode)",
    0.28,
  );
  page.press("v");
  page.captureFrame(
    "0. Overview & Help (?)",
    "Switched Diagram Mode to ASCII_ONLY (Strict Terminal Fallback Mode)",
    0.22,
  );
  page.press("v");
  page.captureFrame(
    "0. Overview & Help (?)",
    "Restored Diagram Mode to AUTO (Capability Detection)",
    0.22,
  );

  // Chapters 1..7: Walk every category tab, every setting, and every variant
  let totalSettingsAudited = 0;
  let totalVariantsCycledAndVerified = 0;

  for (const cat of CATEGORIES) {
    const chapterTitle = `${cat.index}. ${cat.shortLabel}`;
    if (!page.clickRegion(`tab:${cat.id}`)) {
      page.press(String(cat.index));
    }
    page.captureFrame(
      chapterTitle,
      `Selected Tab ${cat.index}: ${cat.fullTitle} (${cat.id})`,
      0.28,
    );

    const catSettings = getSettingsForCategory(cat.id);
    for (let rowIdx = 0; rowIdx < catSettings.length; rowIdx++) {
      const opt = catSettings[rowIdx];
      totalSettingsAudited++;

      // Select this setting row via mouse click region `row:<key>:select`
      if (!page.clickRegion(`row:${opt.key}:select`)) {
        await page.getComponent().dispatchCommandAsync({
          _tag: "SelectRowIndex",
          rowIndex: rowIdx,
        });
      }

      const initialVal =
        page.getComponent().getState().settingsValues[opt.key] ?? opt.defaultValue;
      page.captureFrame(
        chapterTitle,
        `[${cat.shortLabel}] Option ${rowIdx + 1}/${catSettings.length}: ${opt.label} (${opt.cliFlag}) = < ${initialVal} >`,
        0.16,
      );
      totalVariantsCycledAndVerified++;

      // Cycle through all remaining choices for this option so every variant is rendered and verified
      for (let c = 1; c < opt.choices.length; c++) {
        page.press(" ");
        const curVal =
          page.getComponent().getState().settingsValues[opt.key] ?? opt.defaultValue;
        page.captureFrame(
          chapterTitle,
          `[${cat.shortLabel}] ${opt.label} -> Variant ${c + 1}/${opt.choices.length}: < ${curVal} >`,
          0.14,
        );
        totalVariantsCycledAndVerified++;
      }

      // Cycle once more to return the option cleanly to its starting value
      if (opt.choices.length > 1) {
        page.press(" ");
      }
    }
  }

  // Chapter 8: Fleet & Quick Actions (`m`, `t`, `a`, `x`, `p`, `e`) + 88-col Responsive Mode
  page.press("1");
  page.press("t");
  page.captureFrame(
    "8. Actions & Responsive",
    "Cycled Preset Template (t) -> Active Preset Updated",
    0.25,
  );
  page.press("m");
  page.captureFrame(
    "8. Actions & Responsive",
    "Cycled Active Model Checkpoint (m)",
    0.25,
  );
  page.press("a");
  page.captureFrame(
    "8. Actions & Responsive",
    "Added Parallel llama-server Fleet Instance (a)",
    0.25,
  );
  page.press("x");
  page.captureFrame(
    "8. Actions & Responsive",
    "Replaced Active Instance Engine Flavor In-Place (x)",
    0.25,
  );
  page.press("p");
  page.captureFrame(
    "8. Actions & Responsive",
    "Triggered Clang-21 Continuous IRPGO + ThinLTO PTO Optimization (p)",
    0.3,
  );

  // Verify 88-column narrow responsive layout (without adding non-136 frames to the 136-col cast)
  const narrowLines = page.getComponent().render(88);
  const responsive88ColVerified =
    narrowLines.length > 25 && narrowLines.every((l) => visibleWidth(l) === 88);
  page.getComponent().render(136);

  const inlineGraphicsAudit = auditPiTuiInlineGraphics();

  const report: TuiPlaywrightAuditReport = Object.freeze({
    totalFramesRecorded: page.getRecordedFrames().length,
    totalDurationSec: Number(
      (page.getRecordedFrames()[page.getRecordedFrames().length - 1]?.timestampSec ?? 0).toFixed(2),
    ),
    categoriesAudited: CATEGORIES.length,
    totalSettingsAudited,
    totalVariantsCycledAndVerified,
    helpModalVerified,
    responsive88ColVerified,
    mouseHitRegionsVerified: page.getMouseHitRegionsVerified(),
    geometryViolations: Object.freeze([...page.getGeometryViolations()]),
    explanationViolations: Object.freeze([...page.getExplanationViolations()]),
    inlineGraphicsAudit,
    castFilePath: options.castOutputPath ?? null,
    htmlPlayerPath: options.htmlOutputPath ?? null,
    jsonReportPath: options.jsonReportPath ?? null,
  });

  if (options.castOutputPath) {
    const castContent = page.toAsciinemaCast();
    const writeCastRes = await writeTextFileSafe(options.castOutputPath, castContent);
    if (writeCastRes.isErr()) return Result.err(writeCastRes.error);
  }

  if (options.htmlOutputPath) {
    const htmlContent = page.toInteractiveHtmlPlayer(report);
    const writeHtmlRes = await writeTextFileSafe(options.htmlOutputPath, htmlContent);
    if (writeHtmlRes.isErr()) return Result.err(writeHtmlRes.error);
  }

  if (options.jsonReportPath) {
    const jsonContent = JSON.stringify(report, null, 2) + "\n";
    const writeJsonRes = await writeTextFileSafe(options.jsonReportPath, jsonContent);
    if (writeJsonRes.isErr()) return Result.err(writeJsonRes.error);
  }

  return Result.ok(report);
}

async function writeTextFileSafe(
  targetPath: string,
  content: string,
): Promise<Result<string, DomainError>> {
  return fs
    .mkdir(path.dirname(targetPath), { recursive: true })
    .then(() => fs.writeFile(targetPath, content, "utf8"))
    .then(() => Result.ok(targetPath))
    .catch((err: unknown) =>
      Result.err(
        DomainErrors.fileIo(
          "write",
          targetPath,
          "EIO",
          err instanceof Error ? err.message : String(err),
        ),
      ),
    );
}

export { SETTINGS_SCHEMA };
