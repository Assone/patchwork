import { Effect, Layer, Redacted } from "effect";
import * as vscode from "vscode";
import { MissingApiKeyError, SecretService, SecretStorageError } from "../services/secret";

const secretKey = (provider: string) => `patchwork.api-key.${provider}`;

export const SecretServiceLive = (context: vscode.ExtensionContext) =>
  Layer.succeed(SecretService, {
    getApiKey: (provider) =>
      Effect.gen(function* () {
        const key = yield* Effect.tryPromise({
          try: () => context.secrets.get(secretKey(provider)),
          catch: (cause) =>
            new SecretStorageError({
              message: `Could not read the ${provider} API key from secret storage.`,
              operation: "get",
              provider,
              cause,
            }),
        });

        if (key === undefined || key.length === 0) {
          return yield* Effect.fail(
            new MissingApiKeyError({
              message: `No API key configured for ${provider}`,
              provider,
            }),
          );
        }

        return Redacted.make(key);
      }),

    setApiKey: (provider, key) =>
      Effect.tryPromise({
        try: () => context.secrets.store(secretKey(provider), key),
        catch: (cause) =>
          new SecretStorageError({
            message: `Could not store the ${provider} API key in secret storage.`,
            operation: "store",
            provider,
            cause,
          }),
      }),

    deleteApiKey: (provider) =>
      Effect.tryPromise({
        try: () => context.secrets.delete(secretKey(provider)),
        catch: (cause) =>
          new SecretStorageError({
            message: `Could not delete the ${provider} API key from secret storage.`,
            operation: "delete",
            provider,
            cause,
          }),
      }),
  });
