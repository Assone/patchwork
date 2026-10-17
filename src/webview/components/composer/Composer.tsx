import type { ReactNode } from "react";
import { Button } from "../Button";
import { ErrorBanner } from "../ErrorBanner";
import { PromptField } from "../PromptField";

const Root: React.FC<{ readonly children: ReactNode }> = ({ children }) => (
  <div className="border-border flex flex-col border-t">{children}</div>
);

const Error: React.FC<{ readonly reason: string | null }> = ({ reason }) =>
  reason === null ? null : <ErrorBanner title="Drafting failed:" message={reason} />;

const Frame: React.FC<{ readonly onSubmit?: () => void; readonly children: ReactNode }> = ({
  onSubmit,
  children,
}) => (
  <form
    className="flex flex-col gap-2 p-2"
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit?.();
    }}
  >
    {children}
  </form>
);

interface PromptProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}

const Prompt: React.FC<PromptProps> = ({ value, onChange, disabled }) => (
  <PromptField
    label="Prompt (optional)"
    value={value}
    onChange={onChange}
    rows={3}
    placeholder="Describe what these changes accomplish…"
    disabled={disabled}
  />
);

const Submit: React.FC<{ readonly disabled: boolean }> = ({ disabled }) => (
  <Button type="submit" disabled={disabled}>
    Generate Commits
  </Button>
);

export const Composer = { Root, Error, Frame, Prompt, Submit };

export interface ConfiguredComposerProps {
  readonly prompt: string;
  readonly setPrompt: (value: string) => void;
  readonly disabled: boolean;
  readonly errorReason: string | null;
  readonly onSubmit: () => void;
}

/** Composer variant when the LLM is configured: generate commits. */
export const ConfiguredComposer: React.FC<ConfiguredComposerProps> = ({
  prompt,
  setPrompt,
  disabled,
  errorReason,
  onSubmit,
}) => (
  <Composer.Root>
    <Composer.Error reason={errorReason} />
    <Composer.Frame onSubmit={onSubmit}>
      <Composer.Prompt value={prompt} onChange={setPrompt} disabled={disabled} />
      <Composer.Submit disabled={disabled} />
    </Composer.Frame>
  </Composer.Root>
);

export interface UnconfiguredComposerProps {
  readonly prompt: string;
  readonly setPrompt: (value: string) => void;
  readonly errorReason: string | null;
  /** A link or button that navigates to the settings route. */
  readonly configureAction: ReactNode;
}

/** Composer variant before the LLM is configured: navigate to settings. */
export const UnconfiguredComposer: React.FC<UnconfiguredComposerProps> = ({
  prompt,
  setPrompt,
  errorReason,
  configureAction,
}) => (
  <Composer.Root>
    <Composer.Error reason={errorReason} />
    <Composer.Frame>
      <Composer.Prompt value={prompt} onChange={setPrompt} />
      {configureAction}
    </Composer.Frame>
  </Composer.Root>
);
