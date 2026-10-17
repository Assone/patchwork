import { Context, Data, Effect, Redacted } from "effect";

export class MissingApiKeyError extends Data.TaggedError("MissingApiKeyError")<{
  readonly provider: string;
}> {}

export class SecretStorageError extends Data.TaggedError("SecretStorageError")<{
  readonly operation: "get" | "store" | "delete";
  readonly provider: string;
  readonly cause: unknown;
}> {}

export interface SecretServiceApi {
  readonly getApiKey: (
    provider: string,
  ) => Effect.Effect<Redacted.Redacted<string>, MissingApiKeyError | SecretStorageError>;

  readonly setApiKey: (provider: string, key: string) => Effect.Effect<void, SecretStorageError>;

  readonly deleteApiKey: (provider: string) => Effect.Effect<void, SecretStorageError>;
}

export class SecretService extends Context.Service<SecretService, SecretServiceApi>()(
  "patchwork/SecretService",
) {}
