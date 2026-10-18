import { useCallback, useId, useState } from "react";
import type { LLMConfigView } from "../../../rpc/config-types";
import { Button } from "../Button";
import { cn } from "../../utils/cn";

const inputClass = cn(
  "w-full rounded-sm px-2 py-1 leading-snug",
  "bg-input-background text-input-foreground border-input-border border",
  "focus:border-focus-border outline-none",
  "placeholder:text-input-placeholder",
  "disabled:opacity-60",
);

export function formatError(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return String(cause);
}

export function Section({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-input-border border-t pt-3">
      <h3 className="text-foreground-muted mb-1 text-[10px] font-medium tracking-wide uppercase">
        {title}
      </h3>
      {description !== undefined && (
        <p className="text-foreground-muted mb-2 text-[11px] leading-snug">{description}</p>
      )}
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

const PROVIDER_LABELS: Readonly<Record<LLMConfigView["provider"], string>> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible",
  "vscode-lm": "VS Code",
};

export function StatusPanel({ snapshot }: { readonly snapshot: LLMConfigView }) {
  const native = snapshot.provider === "vscode-lm";
  const models = snapshot.vscodeModels ?? [];
  const parts: string[] = [PROVIDER_LABELS[snapshot.provider]];
  if (snapshot.model.length > 0) {
    parts.push(snapshot.model);
  } else if (native) {
    parts.push("auto");
  }
  if (!native && snapshot.baseURL !== undefined && snapshot.baseURL.length > 0) {
    parts.push(snapshot.baseURL);
  }

  return (
    <div
      className={cn(
        "rounded-sm border px-2 py-1 leading-snug break-words",
        snapshot.configured ? "border-input-border bg-input-background" : "border-border",
      )}
      style={
        snapshot.configured
          ? undefined
          : {
              background: "var(--color-diff-delete-background)",
              color: "var(--color-badge-deleted)",
            }
      }
    >
      <span aria-hidden>{snapshot.configured ? "✓ " : "⚠ "}</span>
      {parts.join(" · ")}
      {!snapshot.configured && (
        <div className="mt-1 text-[10px] opacity-80">
          {native ? (
            models.length === 0 ? (
              "No VS Code language model is available. "
            ) : (
              "Pick a model that is still available. "
            )
          ) : (
            <>
              {snapshot.model.length === 0 && "Set a model id. "}
              {snapshot.provider === "openai-compatible" &&
                (snapshot.baseURL ?? "").length === 0 &&
                "Set a baseURL. "}
              {!snapshot.apiKeyPresent && "Set an API key. "}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface TextFieldProps {
  readonly label: string;
  readonly name?: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly type?: "text" | "url";
  readonly inputMode?: "text" | "url";
  readonly onCommit: (next: string) => Promise<void>;
}

export function TextField({
  label,
  name,
  value,
  placeholder,
  type = "text",
  inputMode,
  onCommit,
}: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adjust state during render when the host pushes a new value.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const dirty = draft !== value;

  const handleCommit = useCallback(async () => {
    if (!dirty) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCommit(draft);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusy(false);
    }
  }, [dirty, draft, onCommit]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-foreground-muted text-[10px] font-medium">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        name={name ?? label}
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          void handleCommit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void handleCommit();
          } else if (event.key === "Escape") {
            setDraft(value);
          }
        }}
        disabled={busy}
        className={inputClass}
      />
      {error !== null && (
        <span
          role="status"
          aria-live="polite"
          className="text-[10px] leading-snug"
          style={{ color: "var(--color-badge-deleted)" }}
        >
          {error}
        </span>
      )}
    </label>
  );
}

interface SelectFieldProps<T extends string> {
  readonly label: string;
  readonly name?: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly onCommit: (next: T) => Promise<void>;
}

export function SelectField<T extends string>({
  label,
  name,
  value,
  options,
  onCommit,
}: SelectFieldProps<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback(
    async (next: T) => {
      if (next === value) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await onCommit(next);
      } catch (cause) {
        setError(formatError(cause));
      } finally {
        setBusy(false);
      }
    },
    [value, onCommit],
  );

  return (
    <label className="flex flex-col gap-1">
      <span className="text-foreground-muted text-[10px] font-medium">{label}</span>
      <select
        name={name ?? label}
        value={value}
        onChange={(event) => {
          void handleChange(event.target.value as T);
        }}
        disabled={busy}
        className={inputClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error !== null && (
        <span
          role="status"
          aria-live="polite"
          className="text-[10px] leading-snug"
          style={{ color: "var(--color-badge-deleted)" }}
        >
          {error}
        </span>
      )}
    </label>
  );
}

interface ApiKeyFieldProps {
  readonly provider: string;
  readonly present: boolean;
  readonly onSet: (provider: string, key: string) => Promise<void>;
  readonly onClear: (provider: string) => Promise<void>;
}

export function ApiKeyField({ provider, present, onSet, onClear }: ApiKeyFieldProps) {
  const inputId = useId();
  const [editing, setEditing] = useState(!present);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (draft.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSet(provider, draft);
      setDraft("");
      setEditing(false);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusy(false);
    }
  }, [draft, onSet, provider]);

  const handleClear = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onClear(provider);
      setEditing(true);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusy(false);
    }
  }, [onClear, provider]);

  return (
    <div className="flex flex-col gap-1">
      {present && !editing ? (
        <>
          <span className="text-foreground-muted text-[10px] font-medium">API key</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground-muted">Key is set.</span>
            {confirmingClear ? (
              <>
                <span className="text-foreground-muted text-[10px]">Clear the stored key?</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingClear(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setConfirmingClear(false);
                    void handleClear();
                  }}
                  disabled={busy}
                >
                  Confirm clear
                </Button>
              </>
            ) : (
              <>
                <Button type="button" onClick={() => setEditing(true)} disabled={busy}>
                  Replace
                </Button>
                <Button type="button" onClick={() => setConfirmingClear(true)} disabled={busy}>
                  Clear
                </Button>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="text-foreground-muted text-[10px] font-medium">
            API key
          </label>
          <input
            id={inputId}
            type="password"
            name="apiKey"
            autoComplete="new-password"
            spellCheck={false}
            value={draft}
            placeholder="Paste your API key…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSave();
              } else if (event.key === "Escape") {
                setDraft("");
                if (present) {
                  setEditing(false);
                }
              }
            }}
            disabled={busy}
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <Button type="button" onClick={handleSave} disabled={busy || draft.length === 0}>
              Save
            </Button>
            {present && (
              <Button
                type="button"
                onClick={() => {
                  setDraft("");
                  setEditing(false);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
      {error !== null && (
        <span
          role="status"
          aria-live="polite"
          className="text-[10px] leading-snug"
          style={{ color: "var(--color-badge-deleted)" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
