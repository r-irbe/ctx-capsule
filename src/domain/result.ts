/**
 * Pure Functional Object-Oriented Programming (FOOP) Core Primitives.
 *
 * Models all results, optional values, domain errors, and side effects as immutable
 * algebraic data types (ADTs / discriminated unions). Zero exceptions are thrown
 * inside the domain core; all effects and failures are data values interpreted
 * at the hexagonal adapter boundary.
 */

declare const BRAND_SYMBOL: unique symbol;

/**
 * Nominal / Branded Type helper for compile-time distinction of primitive IDs.
 */
export type Brand<K, T extends string> = K & { readonly [BRAND_SYMBOL]: T };

export type ModelId = Brand<string, "ModelId">;
export type ProfileId = Brand<string, "ProfileId">;
export type TemplateId = Brand<string, "TemplateId">;
export type InstanceId = Brand<string, "InstanceId">;
export type PortNumber = Brand<number, "PortNumber">;
export type FilePath = Brand<string, "FilePath">;

/**
 * Exhaustiveness guard for discriminated union pattern matching.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Exhaustiveness violation: unexpected value ${JSON.stringify(value)}`);
}

/**
 * Discriminated union of all domain-level errors.
 * Every failure mode is an explicit immutable value.
 */
export type DomainError =
  | {
      readonly _tag: "ValidationError";
      readonly field: string;
      readonly reason: string;
      readonly receivedValue: unknown;
    }
  | {
      readonly _tag: "TomlParseError";
      readonly sourcePath: string;
      readonly lineNumber: number;
      readonly message: string;
    }
  | {
      readonly _tag: "FileIoError";
      readonly operation: "read" | "write" | "mkdir" | "stat";
      readonly filePath: string;
      readonly systemCode: string;
      readonly message: string;
    }
  | {
      readonly _tag: "ModelNotFoundError";
      readonly modelId: string;
      readonly availableModels: readonly string[];
    }
  | {
      readonly _tag: "TemplateNotFoundError";
      readonly templateId: string;
      readonly availableTemplates: readonly string[];
    }
  | {
      readonly _tag: "InstanceNotFoundError";
      readonly instanceId: string;
      readonly availableInstances: readonly string[];
    }
  | {
      readonly _tag: "PortConflictError";
      readonly port: number;
      readonly conflictingInstanceId: string;
    }
  | {
      readonly _tag: "ProcessLifecycleError";
      readonly instanceId: string;
      readonly operation: "spawn" | "replace" | "stop" | "healthcheck";
      readonly binaryPath: string;
      readonly reason: string;
    }
  | {
      readonly _tag: "SdkIntegrationError";
      readonly harness: string;
      readonly reason: string;
    }
  | {
      readonly _tag: "PtoOptimizationError";
      readonly stage: "trace" | "merge" | "compile" | "verify";
      readonly toolchain: string;
      readonly reason: string;
    };

export const DomainErrors = {
  validation(field: string, reason: string, receivedValue: unknown): DomainError {
    return Object.freeze({ _tag: "ValidationError", field, reason, receivedValue });
  },
  tomlParse(sourcePath: string, lineNumber: number, message: string): DomainError {
    return Object.freeze({ _tag: "TomlParseError", sourcePath, lineNumber, message });
  },
  fileIo(
    operation: "read" | "write" | "mkdir" | "stat",
    filePath: string,
    systemCode: string,
    message: string,
  ): DomainError {
    return Object.freeze({ _tag: "FileIoError", operation, filePath, systemCode, message });
  },
  modelNotFound(modelId: string, availableModels: readonly string[]): DomainError {
    return Object.freeze({ _tag: "ModelNotFoundError", modelId, availableModels });
  },
  templateNotFound(templateId: string, availableTemplates: readonly string[]): DomainError {
    return Object.freeze({ _tag: "TemplateNotFoundError", templateId, availableTemplates });
  },
  instanceNotFound(instanceId: string, availableInstances: readonly string[]): DomainError {
    return Object.freeze({ _tag: "InstanceNotFoundError", instanceId, availableInstances });
  },
  portConflict(port: number, conflictingInstanceId: string): DomainError {
    return Object.freeze({ _tag: "PortConflictError", port, conflictingInstanceId });
  },
  processLifecycle(
    instanceId: string,
    operation: "spawn" | "replace" | "stop" | "healthcheck",
    binaryPath: string,
    reason: string,
  ): DomainError {
    return Object.freeze({ _tag: "ProcessLifecycleError", instanceId, operation, binaryPath, reason });
  },
  sdkIntegration(harness: string, reason: string): DomainError {
    return Object.freeze({ _tag: "SdkIntegrationError", harness, reason });
  },
  ptoOptimization(
    stage: "trace" | "merge" | "compile" | "verify",
    toolchain: string,
    reason: string,
  ): DomainError {
    return Object.freeze({ _tag: "PtoOptimizationError", stage, toolchain, reason });
  },
  format(err: DomainError): string {
    switch (err._tag) {
      case "ValidationError":
        return `[ValidationError:${err.field}] ${err.reason} (got ${JSON.stringify(err.receivedValue)})`;
      case "TomlParseError":
        return `[TomlParseError:${err.sourcePath}:${err.lineNumber}] ${err.message}`;
      case "FileIoError":
        return `[FileIoError:${err.operation}:${err.systemCode}] ${err.filePath}: ${err.message}`;
      case "ModelNotFoundError":
        return `[ModelNotFoundError] Unknown model '${err.modelId}'. Available: ${err.availableModels.join(", ")}`;
      case "TemplateNotFoundError":
        return `[TemplateNotFoundError] Unknown template '${err.templateId}'. Available: ${err.availableTemplates.join(", ")}`;
      case "InstanceNotFoundError":
        return `[InstanceNotFoundError] Unknown instance '${err.instanceId}'. Available: ${err.availableInstances.join(", ")}`;
      case "PortConflictError":
        return `[PortConflictError] Port ${err.port} is already bound by instance '${err.conflictingInstanceId}'`;
      case "ProcessLifecycleError":
        return `[ProcessLifecycleError:${err.operation}] Instance '${err.instanceId}' (${err.binaryPath}): ${err.reason}`;
      case "SdkIntegrationError":
        return `[SdkIntegrationError:${err.harness}] ${err.reason}`;
      case "PtoOptimizationError":
        return `[PtoOptimizationError:${err.stage}:${err.toolchain}] ${err.reason}`;
      default:
        return assertNever(err);
    }
  },
} as const;

/**
 * Pure FOOP Result ADT (`Ok<T>` | `Err<E>`).
 */
export type Result<T, E = DomainError> = Ok<T, E> | Err<T, E>;

export class Ok<out T, out E = never> {
  readonly _tag = "Ok" as const;
  readonly ok = true as const;
  readonly value: T;

  constructor(value: T) {
    this.value = value;
    Object.freeze(this);
  }

  isOk(): this is Ok<T, E> {
    return true;
  }

  isErr(): this is Err<T, E> {
    return false;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return new Ok(this.value);
  }

  flatMap<U, F>(fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return fn(this.value);
  }

  match<R>(handlers: { readonly ok: (value: T) => R; readonly err: (error: E) => R }): R {
    return handlers.ok(this.value);
  }

  unwrapOr(_fallback: T): T {
    return this.value;
  }
}

export class Err<out T = never, out E = DomainError> {
  readonly _tag = "Err" as const;
  readonly ok = false as const;
  readonly error: E;

  constructor(error: E) {
    this.error = error;
    Object.freeze(this);
  }

  isOk(): this is Ok<T, E> {
    return false;
  }

  isErr(): this is Err<T, E> {
    return true;
  }

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return new Err(this.error);
  }

  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }

  flatMap<U, F>(_fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return new Err(this.error);
  }

  match<R>(handlers: { readonly ok: (value: T) => R; readonly err: (error: E) => R }): R {
    return handlers.err(this.error);
  }

  unwrapOr<U>(fallback: U): T | U {
    return fallback;
  }
}

export const Result = {
  ok<const T, E = DomainError>(value: T): Result<T, E> {
    return new Ok(value);
  },
  err<T = never, const E = DomainError>(error: E): Result<T, E> {
    return new Err(error);
  },
  all<const T, E>(results: readonly Result<T, E>[]): Result<readonly T[], E> {
    const acc: T[] = [];
    for (const r of results) {
      if (r.isErr()) {
        return new Err(r.error);
      }
      acc.push(r.value);
    }
    return new Ok(Object.freeze(acc));
  },
  tryCatch<T>(
    thunk: () => T,
    onError: (unknownError: unknown) => DomainError = (e) =>
      DomainErrors.validation("tryCatch", e instanceof Error ? e.message : String(e), null),
  ): Result<T, DomainError> {
    try {
      return new Ok(thunk());
    } catch (e) {
      return new Err(onError(e));
    }
  },
  async tryCatchAsync<T>(
    thunk: () => Promise<T>,
    onError: (unknownError: unknown) => DomainError = (e) =>
      DomainErrors.validation("tryCatchAsync", e instanceof Error ? e.message : String(e), null),
  ): Promise<Result<T, DomainError>> {
    try {
      const value = await thunk();
      return new Ok(value);
    } catch (e) {
      return new Err(onError(e));
    }
  },
  map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return result.map(fn);
  },
  andThen<T, U, E, F>(result: Result<T, E>, fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return result.flatMap(fn);
  },
  unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
    return result.unwrapOr(fallback);
  },
} as const;

/**
 * Validated constructors for nominal Branded types.
 */
export const Branded = {
  modelId(raw: string): Result<ModelId, DomainError> {
    const trimmed = raw.trim();
    if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(trimmed)) {
      return Result.err(
        DomainErrors.validation("ModelId", "Must be 2..64 alphanumeric/underscore/dash characters", raw),
      );
    }
    return Result.ok(trimmed as ModelId);
  },
  profileId(raw: string): Result<ProfileId, DomainError> {
    const trimmed = raw.trim();
    if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(trimmed)) {
      return Result.err(
        DomainErrors.validation("ProfileId", "Must be 2..64 alphanumeric/underscore/dash characters", raw),
      );
    }
    return Result.ok(trimmed as ProfileId);
  },
  templateId(raw: string): Result<TemplateId, DomainError> {
    const trimmed = raw.trim();
    if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(trimmed)) {
      return Result.err(
        DomainErrors.validation("TemplateId", "Must be 2..64 alphanumeric/underscore/dash characters", raw),
      );
    }
    return Result.ok(trimmed as TemplateId);
  },
  instanceId(raw: string): Result<InstanceId, DomainError> {
    const trimmed = raw.trim();
    if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(trimmed)) {
      return Result.err(
        DomainErrors.validation("InstanceId", "Must be 2..64 alphanumeric/underscore/dash characters", raw),
      );
    }
    return Result.ok(trimmed as InstanceId);
  },
  portNumber(port: number): Result<PortNumber, DomainError> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return Result.err(DomainErrors.validation("PortNumber", "Port must be an integer in 1024..65535", port));
    }
    return Result.ok(port as PortNumber);
  },
  filePath(raw: string): Result<FilePath, DomainError> {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.includes("\0")) {
      return Result.err(DomainErrors.validation("FilePath", "File path must be non-empty and free of NUL bytes", raw));
    }
    return Result.ok(trimmed as FilePath);
  },
  unsafeModelId(raw: string): ModelId {
    return raw as ModelId;
  },
  unsafeProfileId(raw: string): ProfileId {
    return raw as ProfileId;
  },
  unsafeTemplateId(raw: string): TemplateId {
    return raw as TemplateId;
  },
  unsafeInstanceId(raw: string): InstanceId {
    return raw as InstanceId;
  },
  unsafePortNumber(port: number): PortNumber {
    return port as PortNumber;
  },
  unsafeFilePath(raw: string): FilePath {
    return raw as FilePath;
  },
} as const;
