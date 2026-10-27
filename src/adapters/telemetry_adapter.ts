/**
 * Outbound Adapter: `@earendil-works/pi-telemetry` + Hash-Chained JSONL Audit Sink (`CapsuleTelemetryPort`).
 *
 * Defines a compile-time validated `CAPSULE_TELEMETRY_SCHEMA` using `defineTelemetrySchema`
 * and `createTypedSpanStarter` from `@earendil-works/pi-telemetry`, backed by `InMemoryTelemetryContext`
 * plus an optional SHA-256 hash-chained `.jsonl` persistence sink.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  createTypedSpanStarter,
  defineTelemetrySchema,
  InMemoryTelemetryContext,
  type RecordedTelemetrySpan,
  type TelemetryContext,
} from "@earendil-works/pi-telemetry";
import { DomainErrors, type DomainError, Result } from "../domain/result.ts";
import type { DomainEffect, TelemetryLogEntry } from "../domain/types.ts";
import type { CapsuleTelemetryPort } from "../ports/outbound.ts";

export const CAPSULE_TELEMETRY_SCHEMA = defineTelemetrySchema({
  version: 1,
  spans: {
    "capsule.config.switch_model": {
      description: "Active model switched in ctx-capsule control plane",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "Human-readable transition summary" },
      },
      endAttributes: {
        status: { type: "string", description: "Transition status" },
      },
      status: { default: "ok", errorWhen: "Model not found or TOML export failed" },
    },
    "capsule.config.switch_template": {
      description: "Configuration template preset applied",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "Template transition summary" },
      },
      endAttributes: {
        status: { type: "string", description: "Transition status" },
      },
      status: { default: "ok", errorWhen: "Template not found" },
    },
    "capsule.config.save_template": {
      description: "Custom configuration template persisted to hierarchy/templates/",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "Saved template summary" },
      },
      endAttributes: {
        status: { type: "string", description: "Save status" },
      },
      status: { default: "ok", errorWhen: "Filesystem write failed" },
    },
    "capsule.config.update_setting": {
      description: "Single setting parameter updated",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "Setting update summary" },
      },
      endAttributes: {
        status: { type: "string", description: "Update status" },
      },
      status: { default: "ok", errorWhen: "Invalid setting value" },
    },
    "capsule.config.export_toml": {
      description: "5-layer hierarchical TOML bundle exported",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "Export summary" },
      },
      endAttributes: {
        status: { type: "string", description: "Export status" },
      },
      status: { default: "ok", errorWhen: "Filesystem write failed" },
    },
    "capsule.fleet.add_instance": {
      description: "New llama-server instance added to the active fleet",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "Instance spawn summary" },
      },
      endAttributes: {
        status: { type: "string", description: "Spawn status" },
      },
      status: { default: "ok", errorWhen: "Port conflict or process spawn error" },
    },
    "capsule.fleet.replace_instance": {
      description: "Existing llama-server instance replaced in-place",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "In-place replacement summary" },
      },
      endAttributes: {
        status: { type: "string", description: "Replacement status" },
      },
      status: { default: "ok", errorWhen: "Handover or process spawn error" },
    },
    "capsule.fleet.stop_instance": {
      description: "Running llama-server instance stopped and slabs released",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "Instance stop summary" },
      },
      endAttributes: {
        status: { type: "string", description: "Stop status" },
      },
      status: { default: "ok", errorWhen: "Process stop failed" },
    },
    "capsule.sdk.sync_harnesses": {
      description: "7 coding agent SDK configurations synchronized",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "SDK sync summary" },
      },
      endAttributes: {
        status: { type: "string", description: "Sync status" },
      },
      status: { default: "ok", errorWhen: "SDK config write failed" },
    },
    "capsule.pto.trace_and_optimize": {
      description: "Profile-Targeted Optimization (PTO / IRPGO + ThinLTO + Machine Split) executed and swapped",
      parents: { kind: "any" },
      startAttributes: {
        message: { type: "string", required: true, description: "PTO optimization summary" },
      },
      endAttributes: {
        status: { type: "string", description: "PTO optimization status" },
      },
      status: { default: "ok", errorWhen: "PTO trace, llvm-profdata merge, or ThinLTO build failed" },
    },
  },
});

function computeEntryHash(
  seq: number,
  timestampIso: string,
  spanName: string,
  message: string,
  prevHashHex: string,
): string {
  const payload = `${seq}|${timestampIso}|${spanName}|${message}|${prevHashHex}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

export interface PiTelemetryAdapterOptions {
  readonly jsonlFilePath?: string | null;
  readonly telemetryContext?: TelemetryContext;
}

export class PiCapsuleTelemetryAdapter implements CapsuleTelemetryPort {
  private readonly memoryContext: InMemoryTelemetryContext;
  private readonly telemetryContext: TelemetryContext;
  private readonly startTypedSpan: ReturnType<
    typeof createTypedSpanStarter<readonly [typeof CAPSULE_TELEMETRY_SCHEMA]>
  >;
  private readonly jsonlFilePath: string | null;
  private readonly entries: TelemetryLogEntry[] = [];

  constructor(options?: PiTelemetryAdapterOptions) {
    this.memoryContext = new InMemoryTelemetryContext();
    this.telemetryContext = options?.telemetryContext ?? this.memoryContext;
    this.startTypedSpan = createTypedSpanStarter(this.telemetryContext, [
      CAPSULE_TELEMETRY_SCHEMA,
    ] as const);
    this.jsonlFilePath = options?.jsonlFilePath ?? null;

    const genesisTs = "2026-10-27T05:00:00.000Z";
    const genesisPrev = "0000000000000000";
    const genesisMsg =
      "Initialized FOOP Hexagonal Control State (9 models, 4 templates, 3 fleet instances)";
    this.entries.push(
      Object.freeze({
        seq: 1,
        timestampIso: genesisTs,
        spanName: "capsule.config.init",
        status: "ok",
        message: genesisMsg,
        prevHashHex: genesisPrev,
        entryHashHex: computeEntryHash(1, genesisTs, "capsule.config.init", genesisMsg, genesisPrev),
      }),
    );
  }

  getRecordedPiSpans(): readonly RecordedTelemetrySpan[] {
    return this.memoryContext.getSpans();
  }

  getRecentEntries(limit = 16): readonly TelemetryLogEntry[] {
    return Object.freeze(this.entries.slice(-limit));
  }

  verifyHashChain(): Result<boolean, DomainError> {
    let expectedPrev = "0000000000000000";
    for (const entry of this.entries) {
      if (entry.prevHashHex !== expectedPrev) {
        return Result.err(
          DomainErrors.validation(
            "telemetryHashChain",
            `Broken prevHashHex at seq=${entry.seq}: expected ${expectedPrev}, got ${entry.prevHashHex}`,
            entry,
          ),
        );
      }
      const recomputed = computeEntryHash(
        entry.seq,
        entry.timestampIso,
        entry.spanName,
        entry.message,
        entry.prevHashHex,
      );
      if (entry.entryHashHex !== recomputed) {
        return Result.err(
          DomainErrors.validation(
            "telemetryHashChain",
            `Tampered entryHashHex at seq=${entry.seq}: expected ${recomputed}, got ${entry.entryHashHex}`,
            entry,
          ),
        );
      }
      expectedPrev = entry.entryHashHex;
    }
    return Result.ok(true);
  }

  async recordEffectSpan(
    effect: Extract<DomainEffect, { readonly _tag: "RecordTelemetrySpanEffect" }>,
  ): Promise<Result<TelemetryLogEntry, DomainError>> {
    return Result.tryCatchAsync(
      async () => {
        const spanCallback = async (span: {
          setAttributes(attrs: { readonly status?: string }): void;
          setStatus(status: { readonly status: "ok" }): void;
        }): Promise<void> => {
          span.setAttributes({ status: "ok" });
          span.setStatus({ status: "ok" });
        };
        const spanAttrs = { message: effect.message };
        switch (effect.spanName) {
          case "capsule.config.switch_model":
            await this.startTypedSpan("capsule.config.switch_model", spanAttrs, spanCallback);
            break;
          case "capsule.config.switch_template":
            await this.startTypedSpan("capsule.config.switch_template", spanAttrs, spanCallback);
            break;
          case "capsule.config.save_template":
            await this.startTypedSpan("capsule.config.save_template", spanAttrs, spanCallback);
            break;
          case "capsule.config.update_setting":
            await this.startTypedSpan("capsule.config.update_setting", spanAttrs, spanCallback);
            break;
          case "capsule.config.export_toml":
            await this.startTypedSpan("capsule.config.export_toml", spanAttrs, spanCallback);
            break;
          case "capsule.fleet.add_instance":
            await this.startTypedSpan("capsule.fleet.add_instance", spanAttrs, spanCallback);
            break;
          case "capsule.fleet.replace_instance":
            await this.startTypedSpan("capsule.fleet.replace_instance", spanAttrs, spanCallback);
            break;
          case "capsule.fleet.stop_instance":
            await this.startTypedSpan("capsule.fleet.stop_instance", spanAttrs, spanCallback);
            break;
          case "capsule.sdk.sync_harnesses":
            await this.startTypedSpan("capsule.sdk.sync_harnesses", spanAttrs, spanCallback);
            break;
          case "capsule.pto.trace_and_optimize":
            await this.startTypedSpan("capsule.pto.trace_and_optimize", spanAttrs, spanCallback);
            break;
        }

        const prevEntry = this.entries[this.entries.length - 1];
        const prevHashHex = prevEntry ? prevEntry.entryHashHex : "0000000000000000";
        const seq = this.entries.length + 1;
        const timestampIso = new Date().toISOString();
        const entryHashHex = computeEntryHash(
          seq,
          timestampIso,
          effect.spanName,
          effect.message,
          prevHashHex,
        );

        const entry: TelemetryLogEntry = Object.freeze({
          seq,
          timestampIso,
          spanName: effect.spanName,
          status: "ok",
          message: effect.message,
          prevHashHex,
          entryHashHex,
        });
        this.entries.push(entry);

        if (this.jsonlFilePath) {
          await fs.mkdir(path.dirname(this.jsonlFilePath), { recursive: true });
          const record = JSON.stringify({
            ...entry,
            attributes: effect.attributes,
          });
          await fs.appendFile(this.jsonlFilePath, `${record}\n`, "utf8");
        }

        return entry;
      },
      (err) =>
        DomainErrors.fileIo(
          "write",
          this.jsonlFilePath ?? "in-memory-telemetry",
          "ETELEMETRY",
          err instanceof Error ? err.message : String(err),
        ),
    );
  }
}
