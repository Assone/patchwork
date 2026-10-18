import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import type {
  CompatibleApi,
  LLMConfigPatch,
  LLMConfigView,
  LLMProvider,
  TestConnectionResult,
} from "../../rpc/config-types";
import { Button } from "../components/Button";
import {
  ApiKeyField,
  Section,
  SelectField,
  StatusPanel,
  TextField,
  formatError,
} from "../components/settings/Fields";
import { useLLMConfig, useLLMConfigWriter } from "../hooks/useLLMConfig";
import { cn } from "../utils/cn";

export const Route = createFileRoute("/settings")({
  component: SettingsView,
});

function SettingsView() {
  const query = useLLMConfig();
  const writer = useLLMConfigWriter();

  if (query.isError) {
    return (
      <div
        className="bg-background-sidebar flex h-screen items-center justify-center p-4 text-center text-xs"
        style={{
          background: "var(--color-diff-delete-background)",
          color: "var(--color-badge-deleted)",
        }}
        role="alert"
      >
        Could not read the LLM configuration: {query.error.message}
      </div>
    );
  }

  if (query.data === undefined) {
    return (
      <div
        className="bg-background-sidebar text-foreground-muted flex h-screen items-center justify-center text-xs"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        Loading settings…
      </div>
    );
  }

  return <SettingsForm snapshot={query.data} writer={writer} />;
}

type Writer = ReturnType<typeof useLLMConfigWriter>;

interface SettingsFormProps {
  readonly snapshot: LLMConfigView;
  readonly writer: Writer;
}

function SettingsForm({ snapshot, writer }: SettingsFormProps) {
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Any configuration change invalidates the previous test result.
  const save = useCallback(
    async (patch: LLMConfigPatch) => {
      setTestResult(null);
      await writer.write(patch);
    },
    [writer],
  );

  const setApiKey = useCallback(
    async (provider: string, key: string) => {
      setTestResult(null);
      await writer.setApiKey(provider, key);
    },
    [writer],
  );

  const clearApiKey = useCallback(
    async (provider: string) => {
      setTestResult(null);
      await writer.clearApiKey(provider);
    },
    [writer],
  );

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await writer.test());
    } catch (cause) {
      setTestResult({ ok: false, reason: "unknown", message: formatError(cause) });
    } finally {
      setTesting(false);
    }
  }, [writer]);

  return (
    <div className="bg-background-sidebar text-foreground h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 text-xs">
        <header className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Model settings</h2>
          <p className="text-foreground-muted text-[11px] leading-snug">
            Patchwork uses this model to split changes and draft commit messages. Changes save
            automatically.
          </p>
        </header>

        <Section
          title="Connection"
          description="Verify the current provider, model, and key against the configured endpoint."
        >
          <StatusPanel snapshot={snapshot} />
          <Button type="button" disabled={testing} onClick={handleTest}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {testResult !== null && (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "rounded-sm border px-2 py-1 leading-snug break-words",
                testResult.ok ? "border-input-border bg-input-background" : "border-border",
              )}
              style={
                testResult.ok
                  ? undefined
                  : {
                      background: "var(--color-diff-delete-background)",
                      color: "var(--color-badge-deleted)",
                    }
              }
            >
              <span aria-hidden>{testResult.ok ? "✓ " : "⚠ "}</span>
              {testResult.ok ? `Connected to ${testResult.model}.` : testResult.message}
            </div>
          )}
        </Section>

        <Section
          title="Provider"
          description="The model id is passed through unchanged. VS Code models come from GitHub Copilot Chat or from providers added with “Chat: Manage Models”; Patchwork never stores a key for them."
        >
          <SelectField<LLMProvider>
            label="Provider"
            name="provider"
            value={snapshot.provider}
            options={[
              { value: "openai", label: "OpenAI" },
              { value: "anthropic", label: "Anthropic" },
              { value: "openai-compatible", label: "OpenAI-compatible" },
              { value: "vscode-lm", label: "VS Code (Copilot or built-in models)" },
            ]}
            onCommit={(provider) => save({ provider }).then(() => undefined)}
          />
          {snapshot.provider === "vscode-lm" ? (
            <>
              <SelectField<string>
                label="Model"
                name="model"
                value={snapshot.model}
                options={[
                  { value: "", label: "Auto (first available)" },
                  ...(snapshot.vscodeModels ?? []).map((model) => ({
                    value: model.id,
                    label: `${model.name} · ${model.vendor} · ${Math.round(model.maxInputTokens / 1000)}k ctx`,
                  })),
                ]}
                onCommit={(model) => save({ model }).then(() => undefined)}
              />
              {(snapshot.vscodeModels ?? []).length === 0 && (
                <p
                  className="text-[11px] leading-snug"
                  style={{ color: "var(--color-badge-deleted)" }}
                >
                  No VS Code language model is available. Install GitHub Copilot Chat, or run “Chat:
                  Manage Models” to add one.
                </p>
              )}
            </>
          ) : (
            <TextField
              label="Model id"
              name="model"
              value={snapshot.model}
              placeholder="e.g. gpt-4o, claude-sonnet-4-5…"
              onCommit={(model) => save({ model }).then(() => undefined)}
            />
          )}
          {snapshot.provider === "openai-compatible" && (
            <>
              <TextField
                label="baseURL"
                name="baseURL"
                type="url"
                inputMode="url"
                value={snapshot.baseURL ?? ""}
                placeholder="http://localhost:11434/v1…"
                onCommit={(baseURL) => save({ baseURL }).then(() => undefined)}
              />
              <SelectField<CompatibleApi>
                label="API format"
                name="api"
                value={snapshot.api ?? "chat-completions"}
                options={[
                  { value: "chat-completions", label: "Chat Completions (default)" },
                  { value: "responses", label: "Responses (Azure OpenAI, etc.)" },
                ]}
                onCommit={(api) => save({ api }).then(() => undefined)}
              />
            </>
          )}
        </Section>

        {snapshot.provider !== "vscode-lm" && (
          <Section
            title="API key"
            description="Stored in VS Code's encrypted secret storage. It is never shown again."
          >
            <ApiKeyField
              key={snapshot.provider}
              provider={snapshot.provider}
              present={snapshot.apiKeyPresent}
              onSet={setApiKey}
              onClear={clearApiKey}
            />
          </Section>
        )}
      </div>
    </div>
  );
}
