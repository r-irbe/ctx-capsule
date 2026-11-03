/**
 * Terminal Diagram & Inline PNG Graphics Generator for `@earendil-works/pi-tui`
 * (`Image`, `getCapabilities`, `encodeKitty`, `encodeITerm2`).
 *
 * Generates valid, crisp, deterministic RGBA PNG diagrams in pure TypeScript (using
 * `node:zlib` deflateSync + IEEE 802.3 CRC32) for each of the 7 `ctx-capsule`
 * architectural categories:
 *   1. `models_templates`  : 5-Layer Hierarchical TOML Merge Lattice
 *   2. `llama_fleet`       : Multi-Port Fleet & UniversalSlabArena Handover
 *   3. `evidence_capsules` : ColBERT MaxSim + 225B Binary Fuse8 / SimHash-64 Capsule
 *   4. `kv_paging`         : DeepSeek-V4.1 SWA Ring (35L) + MLA/DSA Indexer (5L) + ZDD
 *   5. `speculative`       : Counterfactual Not-a-Bandit + TreeGraft Multi-Branch Verify
 *   6. `hardware_numa`     : Dual AMD EPYC 7453 NPS4 + RTX 4090 sm_89 + Clang-21 PTO
 *   7. `sampling_sdks`     : Thinking Effort CoT Budget + 8 Coding Agent SDK Bridges
 *
 * When rendered in Ghostty, Kitty, WezTerm, iTerm2, or Pi TUI with `getCapabilities().images`
 * active (or when `visualDiagramMode === "graphical_image"`), `@earendil-works/pi-tui`'s
 * `Image` component emits the inline Kitty (`\x1b_G...`) or iTerm2 (`\x1b]1337;File=...`)
 * graphics sequence, accompanied by a clean status label.
 */

import * as zlib from "node:zlib";
import {
  getCapabilities,
  Image,
  type ImageDimensions,
  type ImageProtocol,
} from "@earendil-works/pi-tui";
import type { CategoryId } from "../domain/types.ts";
import { CATEGORIES } from "../domain/types.ts";

export interface CategoryDiagramAsset {
  readonly category: CategoryId;
  readonly title: string;
  readonly filename: string;
  readonly dimensions: ImageDimensions;
  readonly base64Png: string;
  readonly imageId: number;
}

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(typeAscii: string, data: Uint8Array): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(typeAscii, "ascii");
  const crcInput = Buffer.concat([typeBuf, Buffer.from(data)]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, Buffer.from(data), crcBuf]);
}

interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function fillRect(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  color: RgbaColor,
): void {
  const xStart = Math.max(0, Math.floor(x0));
  const yStart = Math.max(0, Math.floor(y0));
  const xEnd = Math.min(width, Math.floor(x0 + w));
  const yEnd = Math.min(height, Math.floor(y0 + h));
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * width + x) * 4;
      pixels[idx] = color.r;
      pixels[idx + 1] = color.g;
      pixels[idx + 2] = color.b;
      pixels[idx + 3] = color.a;
    }
  }
}

function strokeRect(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  thickness: number,
  color: RgbaColor,
): void {
  fillRect(pixels, width, height, x0, y0, w, thickness, color);
  fillRect(pixels, width, height, x0, y0 + h - thickness, w, thickness, color);
  fillRect(pixels, width, height, x0, y0, thickness, h, color);
  fillRect(pixels, width, height, x0 + w - thickness, y0, thickness, h, color);
}

/**
 * Synthesizes a 320x96 architectural schematic PNG diagram for the given category.
 * Uses distinct, high-contrast color coding per subsystem so Ghostty / Kitty / Pi TUI
 * users get a crisp visual schematic of the active subsystem.
 */
function buildCategoryPngBase64(category: CategoryId): {
  readonly base64Png: string;
  readonly dimensions: ImageDimensions;
} {
  const width = 320;
  const height = 96;
  const pixels = new Uint8Array(width * height * 4);

  const bgDark: RgbaColor = { r: 16, g: 20, b: 28, a: 255 };
  const borderSlate: RgbaColor = { r: 72, g: 88, b: 115, a: 255 };
  const accentEmerald: RgbaColor = { r: 34, g: 197, b: 94, a: 255 };
  const accentAmber: RgbaColor = { r: 245, g: 158, b: 11, a: 255 };
  const accentCyan: RgbaColor = { r: 56, g: 189, b: 248, a: 255 };
  const accentViolet: RgbaColor = { r: 168, g: 85, b: 247, a: 255 };
  const accentRose: RgbaColor = { r: 244, g: 63, b: 94, a: 255 };
  const panelFill: RgbaColor = { r: 26, g: 34, b: 48, a: 255 };

  // Base canvas + outer frame
  fillRect(pixels, width, height, 0, 0, width, height, bgDark);
  strokeRect(pixels, width, height, 2, 2, width - 4, height - 4, 2, borderSlate);

  switch (category) {
    case "models_templates": {
      // 5 cascading TOML layer blocks converging into compiled models.toml
      const colors = [accentCyan, accentEmerald, accentAmber, accentViolet, accentRose];
      for (let i = 0; i < 5; i++) {
        const bx = 12 + i * 44;
        const by = 14 + i * 8;
        fillRect(pixels, width, height, bx, by, 38, 36, panelFill);
        strokeRect(pixels, width, height, bx, by, 38, 36, 2, colors[i]);
        fillRect(pixels, width, height, bx + 4, by + 6, 30, 6, colors[i]);
      }
      // Compiled output block on the right
      fillRect(pixels, width, height, 244, 20, 62, 56, panelFill);
      strokeRect(pixels, width, height, 244, 20, 62, 56, 2, accentEmerald);
      fillRect(pixels, width, height, 250, 28, 50, 10, accentEmerald);
      fillRect(pixels, width, height, 250, 44, 50, 6, accentCyan);
      fillRect(pixels, width, height, 250, 56, 50, 6, accentAmber);
      break;
    }

    case "llama_fleet": {
      // 3 server instance nodes + shared UniversalSlabArena bar at bottom
      const nodeColors = [accentEmerald, accentCyan, accentAmber];
      for (let i = 0; i < 3; i++) {
        const bx = 16 + i * 100;
        fillRect(pixels, width, height, bx, 12, 88, 38, panelFill);
        strokeRect(pixels, width, height, bx, 12, 88, 38, 2, nodeColors[i]);
        fillRect(pixels, width, height, bx + 6, 18, 76, 8, nodeColors[i]);
        fillRect(pixels, width, height, bx + 42, 50, 4, 12, nodeColors[i]);
      }
      // Shared 2 MiB UniversalSlabArena bus
      fillRect(pixels, width, height, 16, 62, 288, 22, panelFill);
      strokeRect(pixels, width, height, 16, 62, 288, 22, 2, accentViolet);
      for (let s = 0; s < 12; s++) {
        const sc = s < 7 ? accentEmerald : s < 10 ? accentCyan : accentAmber;
        fillRect(pixels, width, height, 22 + s * 23, 67, 19, 12, sc);
      }
      break;
    }

    case "evidence_capsules": {
      // Raw prompt chunks -> MaxSim filter funnel -> Hot KV + 225B Fuse8 Capsules
      for (let c = 0; c < 8; c++) {
        const isKept = c === 1 || c === 4 || c === 6;
        fillRect(
          pixels,
          width,
          height,
          14,
          10 + c * 9,
          56,
          6,
          isKept ? accentEmerald : borderSlate,
        );
      }
      // MaxSim + Exact-Cover scoring engine
      fillRect(pixels, width, height, 96, 20, 84, 56, panelFill);
      strokeRect(pixels, width, height, 96, 20, 84, 56, 2, accentCyan);
      fillRect(pixels, width, height, 104, 30, 68, 12, accentCyan);
      fillRect(pixels, width, height, 104, 48, 68, 16, accentAmber);
      // Right: Hot KV + Binary Fuse8 Capsule array
      fillRect(pixels, width, height, 204, 14, 100, 30, panelFill);
      strokeRect(pixels, width, height, 204, 14, 100, 30, 2, accentEmerald);
      fillRect(pixels, width, height, 210, 22, 88, 14, accentEmerald);

      fillRect(pixels, width, height, 204, 52, 100, 30, panelFill);
      strokeRect(pixels, width, height, 204, 52, 100, 30, 2, accentViolet);
      fillRect(pixels, width, height, 210, 60, 88, 14, accentViolet);
      break;
    }

    case "kv_paging": {
      // 35 SWA compressed ring layers vs 5 full MLA/DSA layers
      fillRect(pixels, width, height, 14, 14, 140, 68, panelFill);
      strokeRect(pixels, width, height, 14, 14, 140, 68, 2, accentEmerald);
      for (let r = 0; r < 5; r++) {
        fillRect(pixels, width, height, 22, 22 + r * 11, 48, 7, accentEmerald);
      }
      // 5 Full MLA + DSA Top-1024 layers
      fillRect(pixels, width, height, 168, 14, 138, 68, panelFill);
      strokeRect(pixels, width, height, 168, 14, 138, 68, 2, accentCyan);
      for (let r = 0; r < 5; r++) {
        fillRect(pixels, width, height, 176, 22 + r * 11, 122, 7, accentCyan);
      }
      break;
    }

    case "speculative": {
      // Counterfactual prefix tree k in [0..K] + TreeGraft branches
      fillRect(pixels, width, height, 16, 36, 54, 24, accentCyan);
      // Upper branch (DSpark Q8_0)
      for (let k = 0; k < 5; k++) {
        fillRect(pixels, width, height, 88 + k * 42, 18, 32, 18, accentEmerald);
      }
      // Lower branch (ngram-mod / CCD Suffix Trie)
      for (let k = 0; k < 5; k++) {
        fillRect(pixels, width, height, 88 + k * 42, 58, 32, 18, accentAmber);
      }
      // Connectors
      fillRect(pixels, width, height, 70, 24, 18, 4, accentEmerald);
      fillRect(pixels, width, height, 70, 64, 18, 4, accentAmber);
      break;
    }

    case "hardware_numa": {
      // Dual Socket EPYC NPS4 (2x4 nodes) + RTX 4090 GPU + NVMe io_uring
      for (let sock = 0; sock < 2; sock++) {
        const sx = 14 + sock * 96;
        fillRect(pixels, width, height, sx, 12, 88, 72, panelFill);
        strokeRect(pixels, width, height, sx, 12, 88, 72, 2, accentCyan);
        for (let n = 0; n < 4; n++) {
          const nx = sx + 8 + (n % 2) * 38;
          const ny = 20 + Math.floor(n / 2) * 28;
          fillRect(pixels, width, height, nx, ny, 34, 22, accentEmerald);
        }
      }
      // RTX 4090 24 GiB + 72 MiB L2
      fillRect(pixels, width, height, 210, 12, 96, 72, panelFill);
      strokeRect(pixels, width, height, 210, 12, 96, 72, 2, accentAmber);
      fillRect(pixels, width, height, 218, 22, 80, 24, accentAmber);
      fillRect(pixels, width, height, 218, 52, 80, 22, accentViolet);
      break;
    }

    case "sampling_sdks": {
      // Thinking Effort CoT meter on left + 8 SDK target badges on right
      fillRect(pixels, width, height, 14, 14, 96, 68, panelFill);
      strokeRect(pixels, width, height, 14, 14, 96, 68, 2, accentViolet);
      fillRect(pixels, width, height, 22, 24, 80, 12, accentRose);
      fillRect(pixels, width, height, 22, 40, 64, 12, accentAmber);
      fillRect(pixels, width, height, 22, 56, 44, 12, accentEmerald);

      for (let a = 0; a < 8; a++) {
        const col = a % 2;
        const row = Math.floor(a / 2);
        const ax = 124 + col * 92;
        const ay = 14 + row * 17;
        fillRect(pixels, width, height, ax, ay, 84, 13, panelFill);
        strokeRect(pixels, width, height, ax, ay, 84, 13, 1, accentCyan);
        fillRect(pixels, width, height, ax + 3, ay + 3, 22, 7, accentEmerald);
      }
      break;
    }
  }

  // Encode raw scanlines (filter byte 0 per row)
  const rawScanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawScanlines[rowStart] = 0; // Filter type 0 (None)
    const srcStart = y * width * 4;
    Buffer.from(pixels.buffer, pixels.byteOffset + srcStart, width * 4).copy(
      rawScanlines,
      rowStart + 1,
    );
  }

  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idatCompressed = zlib.deflateSync(rawScanlines, { level: 6 });
  const pngBuffer = Buffer.concat([
    pngSignature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idatCompressed),
    makePngChunk("IEND", new Uint8Array(0)),
  ]);

  return {
    base64Png: pngBuffer.toString("base64"),
    dimensions: { widthPx: width, heightPx: height },
  };
}

const DIAGRAM_CACHE = new Map<CategoryId, CategoryDiagramAsset>();

const CATEGORY_TITLES: Readonly<Record<CategoryId, string>> = Object.freeze({
  models_templates: "5-Layer Hierarchical TOML Merge Lattice",
  llama_fleet: "Multi-Port Fleet & UniversalSlabArena Handover",
  evidence_capsules: "ColBERT MaxSim + 225B Binary Fuse8 Capsule Pipeline",
  kv_paging: "DeepSeek-V4.1 35L SWA Ring + 5L MLA/DSA Indexer + ZDD",
  speculative: "Counterfactual Not-a-Bandit + TreeGraft Branch Fusion",
  hardware_numa: "Dual EPYC 7453 NPS4 + RTX 4090 sm_89 + Clang-21 PTO",
  sampling_sdks: "Deep Thinking CoT Budget + 8 Agent SDK Bridges",
});

const CATEGORY_IMAGE_IDS: Readonly<Record<CategoryId, number>> = Object.freeze({
  models_templates: 7101,
  llama_fleet: 7102,
  evidence_capsules: 7103,
  kv_paging: 7104,
  speculative: 7105,
  hardware_numa: 7106,
  sampling_sdks: 7107,
});

export function getCategoryDiagramAsset(category: CategoryId): CategoryDiagramAsset {
  const cached = DIAGRAM_CACHE.get(category);
  if (cached) {
    return cached;
  }
  const { base64Png, dimensions } = buildCategoryPngBase64(category);
  const asset: CategoryDiagramAsset = Object.freeze({
    category,
    title: CATEGORY_TITLES[category],
    filename: `ctx-capsule-${category}.png`,
    dimensions,
    base64Png,
    imageId: CATEGORY_IMAGE_IDS[category],
  });
  DIAGRAM_CACHE.set(category, asset);
  return asset;
}

export function getAllCategoryDiagramAssets(): readonly CategoryDiagramAsset[] {
  return Object.freeze(CATEGORIES.map((c) => getCategoryDiagramAsset(c.id)));
}

/**
 * Resolves the effective terminal image protocol based on `@earendil-works/pi-tui`'s
 * `getCapabilities()` and the user's `visualDiagramMode` toggle (`auto` | `graphical_image` | `ascii_only`).
 */
export function resolveActiveImageProtocol(
  visualDiagramMode: "auto" | "ascii_only" | "graphical_image",
): ImageProtocol {
  if (visualDiagramMode === "ascii_only") {
    return null;
  }
  const detected = getCapabilities().images;
  if (detected) {
    return detected;
  }
  if (visualDiagramMode === "graphical_image") {
    return "kitty";
  }
  return null;
}

/**
 * Instantiates an `@earendil-works/pi-tui` `Image` component for the given category's
 * PNG architectural diagram.
 */
export function createCategoryPiTuiImage(
  category: CategoryId,
  maxWidthCells = 48,
  maxHeightCells = 4,
): Image {
  const asset = getCategoryDiagramAsset(category);
  return new Image(
    asset.base64Png,
    "image/png",
    { fallbackColor: (s: string) => s },
    {
      maxWidthCells,
      maxHeightCells,
      filename: asset.filename,
      imageId: asset.imageId,
    },
    asset.dimensions,
  );
}
