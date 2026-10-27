# `@r-irbe/ctx-capsule`

**Pure TypeScript FOOP Hexagonal Control Plane, 5-Layer Hierarchical TOML Compiler, In-Place `llama.cpp` / `ik_llama.cpp` Fleet Manager, and 3-Tier Standardized Coding-Agent Integration for Binary Fuse8 & SimHash-64 Context Capsules.**

---

## Overview

`@r-irbe/ctx-capsule` manages ultra-long context (`256K` to `10M` tokens), Binary Fuse8/16 + SimHash-64 KV context capsules, ColBERT MaxSim + Exact-Cover evidence pruning, ZDD 64-token sparse KV skipping, cross-slot cohort KV cloning, and Clang-21 IRPGO + ThinLTO Profile-Targeted Optimization (`build-pto/bin/llama-server`) across local `llama.cpp` and `ik_llama.cpp` inference fleets.

The repository is structured as a **Pure Functional Object-Oriented Programming (FOOP) Hexagonal Architecture**:
- **Zero-Exception Domain Core (`src/domain/`)**: Branded nominal types (`ModelId`, `TemplateId`, `ProfileId`, `InstanceId`, `PortNumber`, `FilePath`), `Result<T, DomainError>` ADTs, immutable `CapsuleControlState` reducer (`transition`), 5-layer hierarchical TOML compiler/parser, and deterministic 64-bit SimHash + Binary Fuse8 + MaxSim context packer (`evidence_packer.ts`).
- **Outbound Ports (`src/ports/outbound.ts`)**: Explicit interfaces for TOML persistence, `llama-server` fleet lifecycle, live GPU/HTTP telemetry, `@earendil-works/pi-telemetry` hash-chained spans, PTO compilation, and multi-agent SDK bridges.
- **Hexagonal Adapters (`src/adapters/`)**: Interactive fullscreen `@earendil-works/pi-tui` mouse/keyboard TUI (`pi_tui_adapter.ts`), in-place `llama-server` process manager (`atomic_port_rebind` and `zero_downtime_shadow` staging port handover), live `nvidia-smi` + `/proc/meminfo` + `/metrics` poller, and Clang-21 IRPGO/ThinLTO builder.

---

## 3-Tier Standardized Coding-Agent Integration

### Tier 1: Native `@earendil-works/pi-coding-agent` Extension (`@r-irbe/ctx-capsule/pi-extension`)

First-class plugin for Pi and `pi-harness-bridge`:
- **Slash command**: `/capsule [status | preset <id> | model <id> | sync | pto | tui | tune <k=v> | help]`
- **Tool**: `ctx_capsule` (`status`, `preset`, `model`, `pack`, `sync`, `pto`)
- **Lifecycle Hooks (`before_model_request`, `session_start`, `turn_start`)**: Automatically attaches active cohort and evidence capsule headers (`X-Llama-Cohort`, `X-Llama-Capsule-Filter`, `X-Evidence-Filter`, `X-Evidence-Strategy`, `X-Evidence-Top-K`, `X-Evidence-Symbol-Boost`, `X-Evidence-Chunk-Expansion`, `X-Llama-Thinking-Effort`) plus `requestDefaults` to outgoing model requests, and suppresses lossy chat compaction (`compaction: "disabled_by_fuse8_capsules"`) whenever Binary Fuse8/16 capsules are active.
- **Status Bar Widget**: `getStatusBarWidget()` and `formatStatusBarLine(state)`.

```ts
import registerCapsulePiExtension, { createCapsulePiExtension } from "@r-irbe/ctx-capsule/pi-extension";

// Register directly on a Pi ExtensionAPI instance:
registerCapsulePiExtension(pi, {
  initialModelId: "deepseek-v4.1-1017-ud-q4kxl",
  initialTemplateId: "ds41-1017-np1-512k-max-speed",
});
```

### Tier 2: Universal Stdio JSON-RPC 2.0 MCP Server (`ctx-capsule-mcp` / `@r-irbe/ctx-capsule/mcp`)

Zero-dependency stdio MCP server compatible with **Claude Code**, **Antigravity CLI**, **OpenCode**, **Cursor**, **Codex CLI**, **GitHub Copilot**, and **Weft (`weftd` / `oh-my-agents`)**. Exposes 5 tools:

1. `capsule_status`: Returns active model, template preset, VRAM/RAM tier metrics, status bar line, and resolved `llama-server` CLI arguments (`--evidence-filter`, `--evidence-strategy`, `--evidence-top-k`, `--evidence-symbol-boost`, `--evidence-chunk-expansion`).
2. `capsule_switch_preset`: Switches active template (`templateId`) and/or model (`modelId`) and returns the updated state and CLI flags.
3. `capsule_pack_context`: Accepts `{ chunks: string[] | string, query?: string, keepRatio?: number, symbolBoost?: number }`, computes deterministic 64-bit SimHash + Binary Fuse8 fingerprint deduplication and MaxSim token-overlap scoring (with code identifier/symbol boost), and returns the selected evidence capsule chunks, deduplicated fingerprint count, and token compression ratio.
4. `capsule_sync_agents`: Synchronizes agent SDK configurations for any subset of `["pi", "antigravity", "opencode", "claude", "google_adk", "codex", "copilot", "weftd"]`.
5. `capsule_pto_tune`: Runs Clang-21 IRPGO + ThinLTO + Machine Function Splitting (`dry_run` or `live`).

### Tier 3: Standardized Multi-Agent Bootstrap CLI (`ctx-capsule init`)

Scaffolds `.ctx-capsule/config.toml` and `.ctx-capsule/templates/*.toml`, and wires any combination of coding agents in one command:

```bash
npx @r-irbe/ctx-capsule init \
  --target . \
  --agents pi,claude,antigravity,opencode,codex,copilot,weftd \
  --preset ds41-1017-np1-512k-max-speed \
  --model deepseek-v4.1-1017-ud-q4kxl
```

| Agent Target | Generated / Merged Wiring Files |
| :--- | :--- |
| `pi` | `.pi/provider-capsule.json` + `.pi/extensions/ctx-capsule.json` |
| `antigravity` / `claude` / `cursor` | `.mcp.json` (`mcpServers.ctx-capsule` -> `ctx-capsule-mcp`) |
| `opencode` | `opencode.json` (`provider.ctx_capsule` + `mcp.ctx-capsule`) |
| `codex` | `.codex/config.toml` (`model_providers.ctx_capsule` + `mcp_servers.ctx-capsule`) |
| `copilot` | `.github/copilot-capsule.json` |
| `weftd` (`oh-my-agents`) | `.weft/capsule-bridge.json` |

---

## CLI Usage & Verification

```bash
# Render single 136-column status frame
node --experimental-strip-types ./src/cli_entry.ts status

# Launch interactive fullscreen @earendil-works/pi-tui control plane
node --experimental-strip-types ./src/cli_entry.ts tui

# Run test suite & TypeScript typecheck
npm test
npm run typecheck
```

## License

Apache-2.0
