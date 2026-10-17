# Patchwork

Patchwork turns one large change into a series of small, meaningful commits.

Select the files you want to commit, optionally describe the intent, and Patchwork
splits their **hunks** into coherent commits with LLM-written messages that follow
the [Angular commit message convention](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md)
by default (`type(scope): subject`, imperative lowercase subject, optional
body/footer). A custom prompt can request a different format or language, and you can
review and edit every message before anything is written to git.

## Features

- **Hunk-level splitting** — recombines the changed hunks themselves, so one file can
  land in several commits.
- **Review before writing** — every message and unit assignment is editable; nothing is
  committed until you press **Commit**.
- **Bring your own model** — OpenAI, Anthropic, or any OpenAI-compatible endpoint such
  as Ollama, vLLM, DeepSeek, OpenRouter, or LM Studio.
- **Safe by default** — commits are written through a temporary index and a
  compare-and-swap ref update; a failure leaves HEAD where it was.
- **Live progress** — streamed responses, elapsed time, and a Cancel button that stops
  the request in the extension host.

## Quick start

1. Open a git repository in VS Code.
2. Click the Patchwork icon in the Source Control title bar, or run
   **Patchwork: Open Commit Composer** from the Command Palette.
3. Select the files to include, optionally describe the intent, and choose
   **Generate Commits**.
4. Review the proposed commits, edit any message, and choose **Commit**.

If no model is configured yet, choose **Configure Model** and fill in the settings
panel. The API key is stored in VS Code's encrypted secret storage.

## How it works

When the composer opens, files that already have staged changes (including partially
staged files) are selected; unstaged and untracked files stay opt-in.

1. The host reads the selected files as one `HEAD → working tree` diff, so staged and
   unstaged changes in the same file are considered together.
2. Each hunk becomes an opaque unit with a stable ID. Added, deleted, renamed,
   binary, mode-only, and lock files are **atomic** units because they cannot be
   split into independently applicable patches.
3. The LLM receives the units (never raw file metadata) and returns a partition:
   commit messages plus the unit IDs belonging to each commit.
4. The host validates that every unit appears exactly once, attaches lock-file units
   to the commit holding their manifest, and shows the result for review.
5. On confirm, the host rebuilds the units from the current diff (a stale plan is
   rejected), applies each commit's hunks to a temporary index, writes commit
   objects, and updates the branch ref atomically.

Responses are streamed. The composer shows the live elapsed time and how much output
has arrived, and a Cancel button stops the provider request in the extension host.
The request is bounded by `patchwork.llm.idleTimeoutSeconds` (default 120 s) of
**silence**, not by total wall-clock time, so a slow but steady generation may run as
long as it needs.

## Settings

Patchwork uses one of:

| Provider          | Required settings                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| OpenAI            | `patchwork.llm.model` + API key                                                                                 |
| Anthropic         | `patchwork.llm.model` + API key                                                                                 |
| OpenAI-compatible | `patchwork.llm.model`, `patchwork.llm.baseURL`, API key, optional `chat-completions` or `responses` wire format |

`patchwork.llm.idleTimeoutSeconds` controls how long the host waits for the next
chunk before giving up (default 120).

The settings panel (`Patchwork · Settings`) writes these and stores the API key in
VS Code's encrypted secret storage.

## Safety

- Commit writing uses a temporary index, `git write-tree`, `git commit-tree`, and a
  compare-and-swap `git update-ref`. A failure before the ref update leaves HEAD,
  the index, and the working tree untouched.
- GPG signing follows `commit.gpgSign` in both commit modes.
- Hooks are off by default. Set `patchwork.commits.runHooks` to commit through
  `git commit` (still with a temporary index) so `pre-commit`, `commit-msg`, and
  `post-commit` run. This mode is **not atomic**: a hook failure after the first
  commit leaves the earlier commits on the branch.
- Only paths touched by the plan are re-synced in the real index. Unrelated staged
  changes keep their state; unselected hunks of a selected file become unstaged.
- Merge, rebase, cherry-pick, unmerged files, and a locked index are rejected before
  writing.
- Binary files, renames, mode-only changes, and added/deleted files are committed as
  whole-file units. Empty added files and submodule (gitlink) changes are supported.
- A timed-out commit request is never retried automatically; the retry reuses an
  idempotency key.

## Limitations

- A file whose only change is a mode change is committed as a whole-file unit.
- In `runHooks` mode, hooks may modify the working tree; those changes are not part
  of the commit unless the hook stages them.

See [docs/architecture.md](docs/architecture.md) for the module map and invariants.

## Development

```bash
pnpm install
pnpm run compile          # extension + webview bundles
pnpm run test:unit        # Vitest, pure Node
pnpm run test:integration # vscode-test, extension host
pnpm run lint
pnpm run fmt:check
```

Unit tests live in `src/test/*.test.ts` and run under Vitest. Tests that need the
VS Code extension host are named `*.integration.test.ts` and run under
`@vscode/test-cli`.
