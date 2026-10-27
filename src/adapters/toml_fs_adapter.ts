/**
 * Outbound Adapter: Filesystem TOML Hierarchy Repository (`TomlConfigRepositoryPort`).
 *
 * Persists and loads the 5-layer hierarchical TOML lattice:
 *   - `00-defaults.toml`
 *   - `hardware/<profile>.toml`
 *   - `models/<model>.toml`
 *   - `templates/<template>.toml`
 *   - `instances/active_fleet.toml`
 *   - Compiled `models.toml`
 *
 * All filesystem operations are wrapped in `Result.tryCatchAsync` returning
 * `Result<T, DomainError>`. Zero uncaught exceptions escape this adapter.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  Branded,
  DomainErrors,
  type DomainError,
  type FilePath,
  Result,
} from "../domain/result.ts";
import {
  compileHierarchicalTomlBundle,
  type HierarchicalTomlBundle,
  parseLayeredTomlDocument,
} from "../domain/toml_hierarchy.ts";
import type { CapsuleControlState, ConfigTemplateSpec } from "../domain/types.ts";
import type {
  TemplateSaveReceipt,
  TomlConfigRepositoryPort,
  TomlWriteReceipt,
} from "../ports/outbound.ts";

function toFileIoError(
  operation: "read" | "write" | "mkdir" | "stat",
  filePath: string,
  err: unknown,
): DomainError {
  if (err && typeof err === "object" && "code" in err) {
    const sysErr = err as { code?: string; message?: string };
    return DomainErrors.fileIo(
      operation,
      filePath,
      String(sysErr.code ?? "EIO"),
      String(sysErr.message ?? "Filesystem operation failed"),
    );
  }
  return DomainErrors.fileIo(operation, filePath, "EUNKNOWN", String(err));
}

export class FileSystemTomlConfigAdapter implements TomlConfigRepositoryPort {
  private readonly workspaceRoot: string;

  constructor(options?: { readonly workspaceRoot?: string }) {
    this.workspaceRoot = options?.workspaceRoot ?? process.cwd();
    Object.freeze(this);
  }

  private resolveTarget(rawPath: string): string {
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(this.workspaceRoot, rawPath);
  }

  async writeHierarchicalBundle(
    targetDir: FilePath,
    modelsTomlPath: FilePath,
    files: Readonly<Record<string, string>>,
    compiledModelsToml?: string,
  ): Promise<Result<TomlWriteReceipt, DomainError>> {
    const absTargetDir = this.resolveTarget(targetDir);
    const absModelsToml = this.resolveTarget(modelsTomlPath);

    return Result.tryCatchAsync(
      async () => {
        const writtenFiles: string[] = [];
        let totalBytesWritten = 0;

        for (const [relPath, content] of Object.entries(files)) {
          const fullFilePath = path.join(absTargetDir, relPath);
          await fs.mkdir(path.dirname(fullFilePath), { recursive: true });
          await fs.writeFile(fullFilePath, content, "utf8");
          writtenFiles.push(fullFilePath);
          totalBytesWritten += Buffer.byteLength(content, "utf8");
        }

        if (compiledModelsToml !== undefined) {
          await fs.mkdir(path.dirname(absModelsToml), { recursive: true });
          await fs.writeFile(absModelsToml, compiledModelsToml, "utf8");
          writtenFiles.push(absModelsToml);
          totalBytesWritten += Buffer.byteLength(compiledModelsToml, "utf8");
        }

        return Object.freeze({
          hierarchyRootDir: Branded.unsafeFilePath(absTargetDir),
          modelsTomlPath: Branded.unsafeFilePath(absModelsToml),
          writtenFiles: Object.freeze(writtenFiles),
          totalBytesWritten,
        });
      },
      (err) => toFileIoError("write", absTargetDir, err),
    );
  }

  async saveTemplateFile(
    templatePath: FilePath,
    template: ConfigTemplateSpec,
    tomlContent: string,
  ): Promise<Result<TemplateSaveReceipt, DomainError>> {
    const absPath = this.resolveTarget(templatePath);
    return Result.tryCatchAsync(
      async () => {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, tomlContent, "utf8");
        return Object.freeze({
          templateId: template.id,
          filePath: Branded.unsafeFilePath(absPath),
          bytesWritten: Buffer.byteLength(tomlContent, "utf8"),
        });
      },
      (err) => toFileIoError("write", absPath, err),
    );
  }

  async loadSavedTemplates(
    hierarchyRootDir: FilePath,
  ): Promise<Result<readonly ConfigTemplateSpec[], DomainError>> {
    const templatesDir = path.join(this.resolveTarget(hierarchyRootDir), "templates");

    const entriesResult = await Result.tryCatchAsync(
      async () => {
        try {
          return await fs.readdir(templatesDir);
        } catch (err) {
          if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT") {
            return [] as string[];
          }
          throw err;
        }
      },
      (err) => toFileIoError("read", templatesDir, err),
    );

    if (entriesResult.isErr()) {
      return Result.err(entriesResult.error);
    }

    const loaded: ConfigTemplateSpec[] = [];
    const tomlFiles = entriesResult.value.filter((f) => f.endsWith(".toml")).sort();

    for (const fileName of tomlFiles) {
      const fullPath = path.join(templatesDir, fileName);
      const readRes = await Result.tryCatchAsync(
        () => fs.readFile(fullPath, "utf8"),
        (err) => toFileIoError("read", fullPath, err),
      );
      if (readRes.isErr()) {
        return Result.err(readRes.error);
      }

      const parsedRes = parseLayeredTomlDocument(fullPath, readRes.value);
      if (parsedRes.isErr()) {
        return Result.err(parsedRes.error);
      }

      const sections = parsedRes.value;
      const baseId = fileName.replace(/\.toml$/, "");
      const metaSection = sections[`templates.${baseId}`] ?? sections.template ?? {};
      const overridesSection = sections[`templates.${baseId}.overrides`] ?? sections.overrides ?? {};

      const idRes = Branded.templateId(baseId);
      if (idRes.isErr()) {
        return Result.err(idRes.error);
      }

      loaded.push(
        Object.freeze({
          id: idRes.value,
          displayName: metaSection.display_name ?? baseId,
          description: metaSection.description ?? `Loaded template ${baseId}`,
          targetUseCase: metaSection.target_use_case ?? "Custom TOML template",
          builtIn: metaSection.built_in === "true",
          overrides: Object.freeze({ ...overridesSection }),
        }),
      );
    }

    return Result.ok(Object.freeze(loaded));
  }

  async exportFullStateBundle(
    state: CapsuleControlState,
  ): Promise<Result<{ readonly bundle: HierarchicalTomlBundle; readonly receipt: TomlWriteReceipt }, DomainError>> {
    const bundleRes = compileHierarchicalTomlBundle(state);
    if (bundleRes.isErr()) {
      return Result.err(bundleRes.error);
    }
    const bundle = bundleRes.value;

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

    const tomlMode = state.settingsValues.toml_hierarchy_mode ?? "layered_plus_compiled";
    const compiledToml =
      tomlMode === "layered_only" ? undefined : bundle.compiledModelsToml;

    const writeRes = await this.writeHierarchicalBundle(
      state.hierarchyRootDir,
      state.unifiedModelsTomlPath,
      files,
      compiledToml,
    );
    if (writeRes.isErr()) {
      return Result.err(writeRes.error);
    }

    return Result.ok(
      Object.freeze({
        bundle,
        receipt: writeRes.value,
      }),
    );
  }
}
