# Change Log

All notable changes to the Patchwork extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-10-18

### Fixed

- A large selection no longer produces a prompt with units whose diffs are empty. The
  prompt budget handed the whole remaining allowance to the first oversized unit and
  then zero to every unit after it, so the tail of a big change set arrived as an empty
  diff block and the plan came back with those units unassigned. Unit bodies are no
  longer truncated at all: a selection over `patchwork.llm.maxPromptChars` is rejected
  with the size and what to do about it.
- A rejected plan is logged once, under its own heading, instead of the same sentence
  twice at `error`. A failure that propagates to the RPC layer is no longer logged
  again at the throw site, so one failure no longer reads as three.
- The model's raw reply is recorded without collapsing its whitespace, so it can still
  be parsed when a reply has to be examined after the fact.

### Added

- `patchwork.llm.maxPromptChars` (default 120,000 characters) caps the diff sent in one
  request.
- Generation logs what it sent — unit count, file count, size, and whether structured
  or text mode was used — and, when a plan is rejected, how far the model got: units
  placed out of the expected total, ids it invented or repeated, and whether it
  referenced a lock file. The unassigned-unit error alone could not distinguish a reply
  cut short from one with mangled ids, which need different fixes.
- `docs/architecture.md` records the output channel's level convention, so `error`,
  `warn`, `info`, and `debug` mean the same thing at every call site.

## [0.1.1] - 2026-10-18

### Fixed

- A streamed structured reply is no longer discarded when the terminal event carries
  no raw text; the streamed JSON is used as a fallback. Falling back to text mode or
  retrying is now logged at warning level instead of silently issuing a second request.

## [0.1.0] - 2026-10-18

### Added

- `vscode-lm` provider: use a model that VS Code already hosts (GitHub Copilot Chat,
  or any provider added with **Chat: Manage Models**) without configuring an API key.
  The model picker lists what VS Code exposes, and a selection that exceeds the
  model's input window is rejected with a token-count message before the request.

## [0.0.1] - 2026-10-18

### Added

- Commit Composer that splits selected changes at hunk level.
- LLM-generated commit messages following the Angular convention, with an optional
  custom prompt.
- Support for OpenAI, Anthropic, and OpenAI-compatible endpoints.
- Review and edit step before any commit is written.
- Atomic commit writing through a temporary index and a compare-and-swap ref update,
  with optional git hooks.
- Streamed responses with idle timeout and cancellation.
