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
