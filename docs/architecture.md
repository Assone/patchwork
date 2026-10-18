# Architecture

## Module map

```
src/
  domain/                 pure, no vscode/effect/react
    diff/                 unified-diff types, parser, patch assembly
    commit-plan.ts         CommitPlan + exact-partition validation
    lock-files.ts          lock-file detection and manifest pairing
  services/               Effect service interfaces (host)
    git.ts                 reads + commit writing
    config.ts              LLM configuration
    llm.ts                 provider-agnostic generation
    vscode-lm.ts           VS Code model service + pure helpers
    secret.ts, log.ts, repository.ts, vscode.ts
  infrastructure/         Effect layers backed by VS Code / git / Node
  features/
    compose/               hunk units, prompt, proposal recovery, plan, commit
    repository-root.ts     resolves the active repository root
  rpc/                     shared wire protocol, transport, contracts, DTOs
  host/ (via utils/webview) RPC handler registration, webview HTML, dev reload
  webview/                 React app: routes, hooks, components
  test/                    Vitest unit tests + vscode-test integration tests
```

Data flows in one direction: the webview holds selection and UI state; the host owns
git, diffs, the LLM, and the secret store. The webview never derives hunk IDs or git
metadata.

## Hunk units

`ChangeSet` is a `HEAD → working tree` diff for the selected paths. The parser keeps
each file header and each hunk's exact bytes (including CRLF and no-newline markers)
so patches can be reassembled without lossy reconstruction.

`features/compose/units.ts` converts the change set into `ComposeUnit`s:

- One unit per hunk for a plain modified text file.
- One atomic unit for added, deleted, renamed, copied, binary, mode-only, lock, and
  zero-hunk files. These cannot be split into independently applicable patches.
- IDs are SHA-256 hashes of the path, kind, hunk coordinates/header, and body.

The model never sees those hashes: `features/compose/aliases.ts` assigns a short
per-request alias (`u1`, `u2`, …) in prompt order and translates the reply back
before validation. Long random ids were a reliable source of dropped characters
and rejected plans; a mistyped alias is also easier to report in the retry
instruction.

The LLM sees only context units. Lock units are withheld and appended by the host to
the commit holding their manifest.

## Plan validation

`domain/commit-plan.ts` enforces an exact partition: every expected unit exactly
once, no unknown IDs, no empty commits or messages. Messages are not format-validated:
the prompt asks for the Angular convention by default, but the user's prompt (and the
review editor) can override it. The host re-derives units at commit time and rejects
a plan whose IDs no longer exist (a stale worktree). An invalid model plan gets one
automatic retry with the validation feedback rewritten in the aliases the model saw.

## Diagnostics

Every generation logs one line with the unit count, file count, lock unit count, and
request size (`features/compose/prompt.ts`, `describePrompt`). When a plan is
rejected, `features/compose/diagnose.ts` reports how far the reply got:
`placed N/M`, `first missing`, `unknown` and `duplicated` ids, `forbidden` lock ids,
and empty-commit count. The bare `hunks not assigned to a commit` message cannot
distinguish a reply cut short by the provider from one with mangled ids, and the two
need different fixes.

The token figure is an estimate (characters ÷ 3) for sizing only; the provider's own
tokenizer is authoritative.

### Log levels

The output channel is `log: true`, so these levels are what the user can filter in
the log level picker. Pick by _who needs to act_, not by how alarming the data looks:

| Level   | Use for                                                                | Example                                                |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `error` | A request failed and the user must do something.                       | Model replied with prose, not JSON; request too large. |
| `warn`  | Something was recovered from or retried; the run continues.            | Plan rejected, retrying with feedback; falling back.   |
| `info`  | One line per user-visible action, with the numbers needed to debug it. | `composing via text (…): 74 unit(s) in 43 file(s)`.    |
| `debug` | Raw payloads — request or reply bodies — for post-mortems.             | `raw reply (attempt 1): {"commits":…}`.                |

Rules that keep the channel readable:

- **A failure is logged once.** An `Effect.fail` already reaches the RPC layer,
  which logs `RPC handler "…" failed: …`. Do not also log it at the throw site; the
  same failure then reads as several errors.
- **One line per event.** Never emit two lines with the same prefix; a second line
  that adds detail is `info`/`debug` with its own prefix, not a copy of the first.
- **Diagnostics are data, not errors.** Counts like `placed 66/74` belong at `info`
  even when the plan around them was rejected.
- **Raw model output is `debug`.** It is the first thing needed for a post-mortem,
  but it is not something a normal run should print.
- Keep the string a user sees for a model-facing value distinct from the string sent
  back to the model (`retryFeedback`), so the log is not the only record of one of
  them.

## Generation transport

`infrastructure/llm-live.ts` always requests a stream. With a schema it passes
`outputSchema` + `stream: true` to `@tanstack/ai`, so partial JSON is never parsed:
the validated plan arrives in the terminal `structured-output.complete` event. The
text fallback concatenates `TEXT_MESSAGE_CONTENT` deltas. Providers whose adapter
cannot stream structured output (Anthropic 0.22 here) skip the schema and stream
text JSON instead, so the engine's blocking fallback never hides a slow request.

`infrastructure/llm-stream.ts` owns that loop and is unit-tested with fake chunks.
Every chunk resets an idle timer (`patchwork.llm.idleTimeoutSeconds`, default 120),
so total runtime is unbounded while output keeps flowing. The host forwards throttled
`llm.progress` notifications and aborts the provider request on `llm.cancelGenerate`
or when the panel closes.

### VS Code models

The `vscode-lm` provider is not another `@tanstack/ai` adapter. `services/vscode-lm.ts`
declares `VscodeLmService` (model listing plus one text generation) and the pure
helpers around it; `infrastructure/vscode-lm-live.ts` implements that service as a
layer over `vscode.lm`. `LLMService` and `LLMConfigService` depend on the service, so
the rest of the host never calls the VS Code API directly. VS Code owns the account
and the quota, so no API key is read.

The API has no system role and no structured-output mode, so `services/vscode-lm.ts`
folds system prompts into the first user turn and the caller takes the text-JSON path.
The same idle-timeout and cancellation scope wraps this provider: an `AbortSignal` is
bridged to a `CancellationToken`, and every streamed `LanguageModelTextPart` resets the
timer (the timer is paused while VS Code's access consent dialog is open, so reading it
cannot trip the timeout). Before sending, the adapter compares the tokenised
conversation with `LanguageModelChat.maxInputTokens` and fails with
`LLMContextLimitError` when the diff cannot fit.

## Commit writer

`infrastructure/git-live.ts`:

1. Preconditions: no merge/rebase/cherry-pick/revert, no unmerged index, identity
   configured, no `index.lock`.
2. Create a temporary index and `git read-tree HEAD` (or `--empty` on an unborn
   branch).
3. For each commit, apply its per-file patches with
   `GIT_INDEX_FILE=<tmp> git apply --cached --binary`, then `git write-tree` and
   `git commit-tree -F -`.
4. Compare-and-swap the branch ref with `git update-ref <ref> <new> <old>`.
5. Sync only the touched paths in the real index with
   `git --literal-pathspecs restore --staged --source=<new> -- <paths>`. Paths that
   the new commit deletes are removed with `git update-index --force-remove` instead:
   a path that is absent from both the commit and the index (a deletion the user had
   already staged) makes `restore` treat it as an unknown pathspec and abort the whole
   sync.

Failure before step 4 leaves refs, the index, and the working tree unchanged. If the
final index sync fails, the error carries the created hashes and the UI tells the
user to run `git reset`.

`commit.gpgSign` is honored: the atomic path passes `-S` to `commit-tree`. When
`patchwork.commits.runHooks` is enabled, the writer instead applies each commit to
the same temporary index and runs `GIT_INDEX_FILE=<tmp> git commit -F -`; this runs
the repository hooks and signing configuration but gives up atomicity — earlier
commits stay on the branch if a later hook fails. The error carries the hashes
created so far.

The Git binary comes from the VS Code Git extension, and every invocation pins
`GIT_PAGER=cat`, `--no-pager`, `--no-ext-diff`, `--no-color`, `--no-textconv`, and
explicit `a/`/`b/` prefixes.

## Testing

- Vitest: pure parser, patch, unit, plan, validation, and RPC transport tests.
- vscode-test: extension-host activation and real-git integration tests that create
  temporary repositories and verify commit trees, index sync, failure rollback, and
  idempotency.
