import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as assert from "assert";
import { Effect, Layer, ManagedRuntime } from "effect";
import { GitServiceLive } from "../infrastructure/git-live";
import { GitService } from "../services/git";
import { parser } from "../diff";

/**
 * Host-side git diagnostics against a throwaway repository.
 *
 * These hit the real `git` binary, so they answer what the in-memory
 * RPC tests cannot: when the webview asks for a file's diff, does the
 * host produce a *non-empty* unified diff that `parser()` can turn into
 * renderable lines? An empty diff here would explain a blank diff pane
 * even if every RPC frame round-trips correctly.
 */
const runtime = ManagedRuntime.make(Layer.mergeAll(GitServiceLive));

/** Creates a repo with one staged + one unstaged change. */
function makeFixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "patchwork-diff-"));
  const git = (args: readonly string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });

  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);

  writeFileSync(join(root, "staged.txt"), "before\n");
  writeFileSync(join(root, "unstaged.txt"), "original\n");
  git(["add", "staged.txt", "unstaged.txt"]);
  git(["commit", "-q", "-m", "initial"]);

  // Staged change.
  writeFileSync(join(root, "staged.txt"), "after\n");
  git(["add", "staged.txt"]);

  // Unstaged change (working tree only).
  writeFileSync(join(root, "unstaged.txt"), "modified\n");

  return root;
}

suite("Host git service (real git)", () => {
  test("reports staged and unstaged changes", async () => {
    const root = makeFixtureRepo();

    const files = await runtime.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.getChangedFiles(root);
      }),
    );

    console.log("changed files:", JSON.stringify(files));
    assert.ok(files.length >= 2, "both changed files should be reported");
    const staged = files.find((file) => file.path === "staged.txt");
    const unstaged = files.find((file) => file.path === "unstaged.txt");
    assert.ok(staged?.staged === true, "staged.txt should be marked staged");
    assert.ok(unstaged?.unstaged === true, "unstaged.txt should be marked unstaged");
  });

  test("getFileDiff returns a parseable diff for a staged file", async () => {
    const root = makeFixtureRepo();

    const diff = await runtime.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.getFileDiff(root, "staged.txt", "staged");
      }),
    );

    console.log("staged diff:", JSON.stringify(diff));
    assert.ok(diff.length > 0, "staged diff should not be empty");
    const parsed = parser(diff);
    assert.strictEqual(parsed.length, 1, "should parse to one file");
    assert.ok(
      (parsed[0]?.hunks.length ?? 0) > 0,
      "the staged diff should contain at least one hunk",
    );
  });

  test("getFileDiff returns a parseable diff for an unstaged file", async () => {
    const root = makeFixtureRepo();

    const diff = await runtime.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.getFileDiff(root, "unstaged.txt", "unstaged");
      }),
    );

    console.log("unstaged diff:", JSON.stringify(diff));
    assert.ok(diff.length > 0, "unstaged diff should not be empty");
    const parsed = parser(diff);
    assert.ok((parsed[0]?.hunks.length ?? 0) > 0, "should contain at least one hunk");
  });

  test("asking for the wrong area yields an empty, not an error", async () => {
    const root = makeFixtureRepo();

    // staged.txt has no *unstaged* change, so this should be empty
    // rather than throwing. This is why the host — not the webview —
    // picks the area: guessing wrong here silently yields nothing.
    const diff = await runtime.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.getFileDiff(root, "staged.txt", "unstaged");
      }),
    );

    console.log("cross-area diff:", JSON.stringify(diff));
    assert.strictEqual(parser(diff).length, 0, "no hunks for the wrong area");
  });

  test("each file's flags point at the area that actually has its diff", async () => {
    const root = makeFixtureRepo();

    // Mirrors the host handler's decision: prefer the staged view when
    // the file has one, otherwise fall back to the working tree. Both
    // branches must produce a renderable diff.
    const report = await runtime.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        const changed = yield* git.getChangedFiles(root);
        return yield* Effect.forEach(changed, (file) =>
          Effect.gen(function* () {
            const area = file.staged === true ? "staged" : "unstaged";
            const diff = yield* git.getFileDiff(root, file.path, area);
            return {
              path: file.path,
              area,
              hunks: parser(diff).reduce((total, entry) => total + entry.hunks.length, 0),
            };
          }),
        );
      }),
    );

    console.log("area report:", JSON.stringify(report));
    assert.ok(report.length >= 2, "both changed files should be reported");
    for (const entry of report) {
      assert.ok(
        entry.hunks > 0,
        `${entry.path} (${entry.area}) produced no hunks — the area chosen from its flags was wrong`,
      );
    }
  });
});
