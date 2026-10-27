/**
 * Live Telemetry Polling Adapter (`HttpNvidiaSmiTelemetryAdapter`).
 *
 * Implements `LiveTelemetryProbePort` by querying:
 *   1. `http://<host>:<port>/health`, `/slots`, and `/metrics` for live `llama-server`
 *      online state, active slots, KV cache utilization, prefill/decode tok/s,
 *      speculative acceptance rate, and evidence pruning counts.
 *   2. `nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits`
 *      for real RTX 4090 VRAM used/total GiB and GPU utilization %.
 *   3. `/proc/meminfo` + `/proc/<pid>/status` (or `pgrep -f llama-server`) for host RAM,
 *      HugeTLB pages, and live server PID.
 *
 * Strictly returns `Result<SystemTelemetry, DomainError>` with zero uncaught exceptions.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import { type DomainError, Result } from "../domain/result.ts";
import type { SystemTelemetry } from "../domain/types.ts";
import type { LiveTelemetryProbePort } from "../ports/outbound.ts";

export interface HttpNvidiaSmiTelemetryOptions {
  readonly timeoutMs?: number;
  readonly fetchEndpointFn?: (url: string, timeoutMs: number) => Promise<{ readonly statusCode: number; readonly body: string } | null>;
  readonly queryNvidiaSmiFn?: (timeoutMs: number) => Promise<string | null>;
  readonly readMeminfoFn?: () => Promise<string | null>;
  readonly discoverPidFn?: (port: number, pidHint?: number | null) => Promise<number | null>;
}

function defaultFetchEndpoint(
  url: string,
  timeoutMs: number,
): Promise<{ readonly statusCode: number; readonly body: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: { readonly statusCode: number; readonly body: string } | null): void => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };

    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          finish({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      });
      req.on("timeout", () => {
        req.destroy();
        finish(null);
      });
      req.on("error", () => {
        finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

function defaultQueryNvidiaSmi(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        "nvidia-smi",
        [
          "--query-gpu=memory.used,memory.total,utilization.gpu",
          "--format=csv,noheader,nounits",
        ],
        { timeout: timeoutMs },
        (err, stdout) => {
          if (err || !stdout) {
            resolve(null);
            return;
          }
          resolve(stdout.trim());
        },
      );
    } catch {
      resolve(null);
    }
  });
}

async function defaultReadMeminfo(): Promise<string | null> {
  try {
    return await fs.readFile("/proc/meminfo", "utf8");
  } catch {
    return null;
  }
}

async function isPidAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    const statusText = await fs.readFile(`/proc/${pid}/status`, "utf8");
    return statusText.length > 0;
  } catch {
    return false;
  }
}

function defaultDiscoverPid(port: number, pidHint?: number | null): Promise<number | null> {
  return new Promise((resolve) => {
    void (async () => {
      if (pidHint && (await isPidAlive(pidHint))) {
        resolve(pidHint);
        return;
      }
      try {
        execFile(
          "pgrep",
          ["-a", "llama-server"],
          { timeout: 600 },
          (err, stdout) => {
            if (err || !stdout) {
              resolve(null);
              return;
            }
            const lines = stdout
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean);
            for (const line of lines) {
              const firstSpace = line.indexOf(" ");
              const pidStr = firstSpace > 0 ? line.slice(0, firstSpace) : line;
              const parsed = Number.parseInt(pidStr, 10);
              if (Number.isInteger(parsed) && parsed > 0) {
                if (line.includes(String(port)) || lines.length === 1) {
                  resolve(parsed);
                  return;
                }
              }
            }
            if (lines.length > 0) {
              const fallbackPid = Number.parseInt(lines[0].split(/\s+/)[0] ?? "", 10);
              if (Number.isInteger(fallbackPid) && fallbackPid > 0) {
                resolve(fallbackPid);
                return;
              }
            }
            resolve(null);
          },
        );
      } catch {
        resolve(null);
      }
    })();
  });
}

export function parsePrometheusMetricValue(metricsText: string, metricNames: readonly string[]): number {
  const lines = metricsText.split(/\r?\n/);
  for (const name of metricNames) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed.length === 0) {
        continue;
      }
      if (trimmed.startsWith(name)) {
        const rest = trimmed.slice(name.length).trim();
        if (rest.startsWith("{")) {
          const closeBrace = rest.indexOf("}");
          if (closeBrace >= 0) {
            const valStr = rest.slice(closeBrace + 1).trim().split(/\s+/)[0] ?? "";
            const num = Number.parseFloat(valStr);
            if (Number.isFinite(num)) {
              return num;
            }
          }
        } else {
          const valStr = rest.split(/\s+/)[0] ?? "";
          const num = Number.parseFloat(valStr);
          if (Number.isFinite(num)) {
            return num;
          }
        }
      }
    }
  }
  return 0;
}

export function parseMeminfoMetrics(meminfoText: string | null): {
  readonly hostRamUsedGiB: number;
  readonly hostRamTotalGiB: number;
  readonly hugePagesTotal: number;
  readonly hugePagesFree: number;
} {
  if (!meminfoText) {
    return {
      hostRamUsedGiB: 0,
      hostRamTotalGiB: 0,
      hugePagesTotal: 0,
      hugePagesFree: 0,
    };
  }
  let memTotalKb = 0;
  let memAvailKb = 0;
  let hugeTotal = 0;
  let hugeFree = 0;

  for (const rawLine of meminfoText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("MemTotal:")) {
      memTotalKb = Number.parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
    } else if (line.startsWith("MemAvailable:")) {
      memAvailKb = Number.parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
    } else if (line.startsWith("HugePages_Total:")) {
      hugeTotal = Number.parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
    } else if (line.startsWith("HugePages_Free:")) {
      hugeFree = Number.parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
    }
  }

  const totalGiB = Number((memTotalKb / (1024 * 1024)).toFixed(2));
  const usedGiB = Number((Math.max(0, memTotalKb - memAvailKb) / (1024 * 1024)).toFixed(2));

  return {
    hostRamUsedGiB: usedGiB,
    hostRamTotalGiB: totalGiB,
    hugePagesTotal: hugeTotal,
    hugePagesFree: hugeFree,
  };
}

export function parseNvidiaSmiCsv(csvText: string | null): {
  readonly vramUsedGiB: number;
  readonly vramTotalGiB: number;
  readonly gpuUtilPct: number;
} {
  if (!csvText) {
    return { vramUsedGiB: 0, vramTotalGiB: 24.0, gpuUtilPct: 0 };
  }
  const firstLine = csvText.split(/\r?\n/)[0] ?? "";
  const parts = firstLine.split(",").map((p) => Number.parseFloat(p.trim()));
  const usedMiB = Number.isFinite(parts[0]) ? parts[0] : 0;
  const totalMiB = Number.isFinite(parts[1]) && parts[1] > 0 ? parts[1] : 24564;
  const utilPct = Number.isFinite(parts[2]) ? parts[2] : 0;

  return {
    vramUsedGiB: Number((usedMiB / 1024).toFixed(2)),
    vramTotalGiB: Number((totalMiB / 1024).toFixed(2)),
    gpuUtilPct: Math.round(utilPct),
  };
}

export class HttpNvidiaSmiTelemetryAdapter implements LiveTelemetryProbePort {
  readonly #timeoutMs: number;
  readonly #fetchEndpointFn: (url: string, timeoutMs: number) => Promise<{ readonly statusCode: number; readonly body: string } | null>;
  readonly #queryNvidiaSmiFn: (timeoutMs: number) => Promise<string | null>;
  readonly #readMeminfoFn: () => Promise<string | null>;
  readonly #discoverPidFn: (port: number, pidHint?: number | null) => Promise<number | null>;

  public constructor(options?: HttpNvidiaSmiTelemetryOptions) {
    this.#timeoutMs = options?.timeoutMs ?? 800;
    this.#fetchEndpointFn = options?.fetchEndpointFn ?? defaultFetchEndpoint;
    this.#queryNvidiaSmiFn = options?.queryNvidiaSmiFn ?? defaultQueryNvidiaSmi;
    this.#readMeminfoFn = options?.readMeminfoFn ?? defaultReadMeminfo;
    this.#discoverPidFn = options?.discoverPidFn ?? defaultDiscoverPid;
  }

  public async probeSystemTelemetry(
    host: string,
    port: number,
    pidHint?: number | null,
  ): Promise<Result<SystemTelemetry, DomainError>> {
    const baseUrl = `http://${host}:${port}`;

    const [healthRes, slotsRes, metricsRes, smiCsv, meminfoText, discoveredPid] =
      await Promise.all([
        this.#fetchEndpointFn(`${baseUrl}/health`, this.#timeoutMs),
        this.#fetchEndpointFn(`${baseUrl}/slots`, this.#timeoutMs),
        this.#fetchEndpointFn(`${baseUrl}/metrics`, this.#timeoutMs),
        this.#queryNvidiaSmiFn(this.#timeoutMs),
        this.#readMeminfoFn(),
        this.#discoverPidFn(port, pidHint),
      ]);

    const gpu = parseNvidiaSmiCsv(smiCsv);
    const mem = parseMeminfoMetrics(meminfoText);

    const serverOnline =
      healthRes !== null &&
      healthRes.statusCode >= 200 &&
      healthRes.statusCode < 300;

    let activeSlots = 0;
    let totalSlots = 0;

    if (slotsRes && slotsRes.statusCode >= 200 && slotsRes.statusCode < 300) {
      try {
        const parsedSlots = JSON.parse(slotsRes.body) as unknown;
        if (Array.isArray(parsedSlots)) {
          totalSlots = parsedSlots.length;
          for (const slot of parsedSlots) {
            if (typeof slot === "object" && slot !== null) {
              const s = slot as Record<string, unknown>;
              if (
                s.is_processing === true ||
                (typeof s.state === "number" && s.state !== 0) ||
                s.state === "processing"
              ) {
                activeSlots++;
              }
            }
          }
        }
      } catch {
        // Ignore malformed /slots JSON
      }
    }

    let kvCacheUsedPct = 0;
    let prefillTokPerSec = 0;
    let decodeTokPerSec = 0;
    let specAcceptancePct = 0;
    let evidencePrunedChunks = 0;

    if (metricsRes && metricsRes.statusCode >= 200 && metricsRes.statusCode < 300) {
      const mText = metricsRes.body;
      const kvRatio = parsePrometheusMetricValue(mText, [
        "llamacpp:kv_cache_usage_ratio",
        "llama_kv_cache_usage_ratio",
      ]);
      kvCacheUsedPct = kvRatio <= 1.0 && kvRatio > 0 ? Number((kvRatio * 100).toFixed(1)) : Number(kvRatio.toFixed(1));

      prefillTokPerSec = parsePrometheusMetricValue(mText, [
        "llamacpp:prompt_tokens_seconds",
        "llama_prompt_tokens_seconds",
      ]);
      decodeTokPerSec = parsePrometheusMetricValue(mText, [
        "llamacpp:predicted_tokens_seconds",
        "llama_predicted_tokens_seconds",
      ]);
      const specRate = parsePrometheusMetricValue(mText, [
        "llamacpp:speculative_acceptance_rate",
        "llama_speculative_acceptance_rate",
      ]);
      specAcceptancePct = specRate <= 1.0 && specRate > 0 ? Number((specRate * 100).toFixed(1)) : Number(specRate.toFixed(1));
      evidencePrunedChunks = Math.round(
        parsePrometheusMetricValue(mText, [
          "llamacpp:evidence_pruned_chunks_total",
          "llama_evidence_pruned_chunks_total",
        ]),
      );

      if (totalSlots === 0) {
        const busySlots = Math.round(
          parsePrometheusMetricValue(mText, ["llamacpp:requests_processing"]),
        );
        activeSlots = busySlots;
        totalSlots = Math.max(1, busySlots);
      }
    }

    const telemetry: SystemTelemetry = Object.freeze({
      serverOnline,
      pid: serverOnline ? discoveredPid : null,
      host,
      port,
      activeSlots,
      totalSlots: totalSlots > 0 ? totalSlots : serverOnline ? 1 : 0,
      kvCacheUsedPct,
      vramUsedGiB: gpu.vramUsedGiB,
      vramTotalGiB: gpu.vramTotalGiB,
      gpuUtilPct: gpu.gpuUtilPct,
      hostRamUsedGiB: mem.hostRamUsedGiB,
      hostRamTotalGiB: mem.hostRamTotalGiB,
      hugePagesTotal: mem.hugePagesTotal,
      hugePagesFree: mem.hugePagesFree,
      prefillTokPerSec: Number(prefillTokPerSec.toFixed(2)),
      decodeTokPerSec: Number(decodeTokPerSec.toFixed(2)),
      specAcceptancePct,
      evidencePrunedChunks,
      lastPolledIso: new Date().toISOString(),
    });

    return Result.ok(telemetry);
  }
}
