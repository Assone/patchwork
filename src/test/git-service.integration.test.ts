import * as assert from "assert";
import { existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { buildPatch, parser } from "../domain/diff";
import { GitServiceLive } from "../infrastructure/git-live";
import { GitService, type ChangeSet } from "../services/git";
import { makeDiffFixture, makeRepo, snapshot, type FixtureRepo } from "./helpers/git-fixture";

const runtime = ManagedRuntime.make(Layer.mergeAll(GitServiceLive("git")));

const run = <A, E>(effect: Effect.Effect<A, E, GitService>): Promise<A> =>
  runtime.runPromise(effect);

const readChangeSet = (root: string, paths?: readonly string[]): Promise<ChangeSet> =>
  run(
    Effect.gen(function* () {
      const git = yield* GitService;
      return yield* git.getChangeSet(root, paths);
    }),
  );

function makeTwoHunkRepo(): FixtureRepo {
  const repo = makeRepo("patchwork-commit-");
  const lines = Array.from({ length: 20 }, (_, index) => `line${index + 1}`);
  writeFileSync(join(repo.root, "a.txt"), `${lines.join("\n")}\n`);
  repo.git(["add", "a.txt"]);
  repo.git(["commit", "-q", "-m", "initial"]);

  // Hunk 1 grows the file by one line so hunk 2 must apply with an offset.
  const changed = [...lines];
  changed[1] = "line2a\nline2b";
  changed[17] = "line18-changed";
  writeFileSync(join(repo.root, "a.txt"), `${changed.join("\n")}\n`);
  return repo;
}

suite("Host git service (real git)", () => {
  test("reports staged and unstaged changes", async () => {
    const repo = makeDiffFixture();
    const files = await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.getChangedFiles(repo.root);
      }),
    );

    assert.ok(files.length >= 2);
    assert.strictEqual(files.find((file) => file.path === "staged.txt")?.staged, true);
    assert.strictEqual(files.find((file) => file.path === "unstaged.txt")?.unstaged, true);
  });

  test("getFileDiff returns one HEAD→worktree diff for a tracked file", async () => {
    const repo = makeDiffFixture();
    const diff = await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.getFileDiff(repo.root, "staged.txt");
      }),
    );

    assert.ok(diff.length > 0);
    const parsed = parser(diff);
    assert.strictEqual(parsed.length, 1);
    assert.ok((parsed[0]?.hunks.length ?? 0) > 0);
  });

  test("a partially staged file appears once with both sides of the change", async () => {
    const repo = makeRepo("patchwork-partial-");
    const lines = Array.from({ length: 20 }, (_, index) => `line${index + 1}`);
    writeFileSync(join(repo.root, "a.txt"), `${lines.join("\n")}\n`);
    repo.git(["add", "a.txt"]);
    repo.git(["commit", "-q", "-m", "initial"]);

    const staged = [...lines];
    staged[1] = "line2-staged";
    writeFileSync(join(repo.root, "a.txt"), `${staged.join("\n")}\n`);
    repo.git(["add", "a.txt"]);

    const unstaged = [...staged];
    unstaged[17] = "line18-unstaged";
    writeFileSync(join(repo.root, "a.txt"), `${unstaged.join("\n")}\n`);

    const changeSet = await readChangeSet(repo.root, ["a.txt"]);
    assert.strictEqual(changeSet.files.length, 1);
    assert.strictEqual(changeSet.files[0]?.hunks.length, 2);
    const raw = changeSet.files[0]?.raw ?? "";
    assert.ok(raw.includes("line2-staged"));
    assert.ok(raw.includes("line18-unstaged"));
  });

  test("createCommits writes one commit per hunk and syncs the index", async () => {
    const repo = makeTwoHunkRepo();
    const changeSet = await readChangeSet(repo.root, ["a.txt"]);
    const file = changeSet.files[0];
    assert.ok(file !== undefined);
    assert.strictEqual(file.hunks.length, 2);

    const hashes = await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createCommits(repo.root, [
          {
            message: "feat: first hunk",
            patches: [{ path: "a.txt", patch: buildPatch(file, [file.hunks[0]!]) }],
          },
          {
            message: "feat: second hunk",
            patches: [{ path: "a.txt", patch: buildPatch(file, [file.hunks[1]!]) }],
          },
        ]);
      }),
    );

    assert.strictEqual(hashes.length, 2);
    const log = repo.git(["log", "--format=%s"]).trim().split("\n");
    assert.deepStrictEqual(log, ["feat: second hunk", "feat: first hunk", "initial"]);
    assert.strictEqual(repo.git(["status", "--porcelain"]), "");
    assert.ok(repo.git(["show", "HEAD~1:a.txt"]).includes("line2a"));
    assert.ok(!repo.git(["show", "HEAD~1:a.txt"]).includes("line18-changed"));
    assert.ok(repo.git(["show", "HEAD:a.txt"]).includes("line18-changed"));
  });

  test("an untracked file is synthesized and committed", async () => {
    const repo = makeRepo("patchwork-untracked-");
    writeFileSync(join(repo.root, "base.txt"), "base\n");
    repo.git(["add", "base.txt"]);
    repo.git(["commit", "-q", "-m", "initial"]);
    writeFileSync(join(repo.root, "new.txt"), "new\n");

    const changeSet = await readChangeSet(repo.root, ["new.txt"]);
    const file = changeSet.files[0];
    assert.ok(file !== undefined);
    assert.strictEqual(file.oldPath, "/dev/null");

    await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createCommits(repo.root, [
          {
            message: "feat: add new file",
            patches: [{ path: "new.txt", patch: buildPatch(file, file.hunks) }],
          },
        ]);
      }),
    );

    assert.strictEqual(repo.git(["show", "HEAD:new.txt"]), "new\n");
    assert.strictEqual(repo.git(["status", "--porcelain"]), "");
  });

  test("a deleted file is committed and removed from the index", async () => {
    const repo = makeRepo("patchwork-deleted-");
    writeFileSync(join(repo.root, "gone.txt"), "gone\n");
    repo.git(["add", "gone.txt"]);
    repo.git(["commit", "-q", "-m", "initial"]);
    rmSync(join(repo.root, "gone.txt"));

    const changeSet = await readChangeSet(repo.root, ["gone.txt"]);
    const file = changeSet.files[0];
    assert.ok(file !== undefined);
    assert.strictEqual(file.newPath, "/dev/null");

    await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createCommits(repo.root, [
          {
            message: "chore: remove gone file",
            patches: [{ path: "gone.txt", patch: buildPatch(file, file.hunks) }],
          },
        ]);
      }),
    );

    const files = repo.git(["ls-files"]).trim();
    assert.ok(!files.split("\n").includes("gone.txt"));
    assert.strictEqual(repo.git(["status", "--porcelain"]), "");
  });

  test("a failed apply leaves HEAD, the index, and the worktree untouched", async () => {
    const repo = makeTwoHunkRepo();
    const before = snapshot(repo);

    const result = await run(
      Effect.match(
        Effect.gen(function* () {
          const git = yield* GitService;
          return yield* git.createCommits(repo.root, [
            { message: "fix: broken patch", patches: [{ path: "a.txt", patch: "not a patch" }] },
          ]);
        }),
        {
          onSuccess: (hashes) => ({ ok: true as const, hashes }),
          onFailure: (error) => ({ ok: false as const, error }),
        },
      ),
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error._tag, "CommitWriteError");
      assert.strictEqual(
        result.error._tag === "CommitWriteError" ? result.error.reason : "",
        "apply-failed",
      );
    }
    assert.deepStrictEqual(snapshot(repo), before);
  });

  test("a commit with no changes is rejected before the ref moves", async () => {
    const repo = makeTwoHunkRepo();
    const before = snapshot(repo);

    const result = await run(
      Effect.match(
        Effect.gen(function* () {
          const git = yield* GitService;
          return yield* git.createCommits(repo.root, [
            { message: "chore: empty commit", patches: [{ path: "a.txt", patch: "" }] },
          ]);
        }),
        {
          onSuccess: (hashes) => ({ ok: true as const, hashes }),
          onFailure: (error) => ({ ok: false as const, error }),
        },
      ),
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error._tag, "CommitWriteError");
      assert.strictEqual(
        result.error._tag === "CommitWriteError" ? result.error.reason : "",
        "empty-commit",
      );
    }
    assert.deepStrictEqual(snapshot(repo), before);
  });

  test("unselected staged changes stay staged", async () => {
    const repo = makeRepo("patchwork-staged-");
    writeFileSync(join(repo.root, "a.txt"), "a0\n");
    writeFileSync(join(repo.root, "b.txt"), "b0\n");
    repo.git(["add", "a.txt", "b.txt"]);
    repo.git(["commit", "-q", "-m", "chore: init"]);

    writeFileSync(join(repo.root, "a.txt"), "a1\n");
    writeFileSync(join(repo.root, "b.txt"), "b1\n");
    repo.git(["add", "a.txt", "b.txt"]);

    const changeSet = await readChangeSet(repo.root, ["a.txt"]);
    const file = changeSet.files[0];
    assert.ok(file !== undefined);
    await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createCommits(repo.root, [
          {
            message: "feat: update a",
            patches: [{ path: "a.txt", patch: buildPatch(file, file.hunks) }],
          },
        ]);
      }),
    );

    const cached = repo.git(["diff", "--cached", "--name-only"]);
    assert.ok(cached.split("\n").includes("b.txt"), "b.txt should remain staged");
    assert.ok(!cached.split("\n").includes("a.txt"), "a.txt should be committed");
  });

  test("an empty untracked file is committed", async () => {
    const repo = makeRepo("patchwork-empty-");
    writeFileSync(join(repo.root, "base.txt"), "base\n");
    repo.git(["add", "base.txt"]);
    repo.git(["commit", "-q", "-m", "chore: init"]);
    writeFileSync(join(repo.root, "empty.txt"), "");

    const changeSet = await readChangeSet(repo.root, ["empty.txt"]);
    const file = changeSet.files[0];
    assert.ok(file !== undefined);
    assert.strictEqual(file.oldPath, "/dev/null");

    await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createCommits(repo.root, [
          {
            message: "feat: add empty file",
            patches: [{ path: "empty.txt", patch: buildPatch(file, file.hunks) }],
          },
        ]);
      }),
    );

    assert.strictEqual(repo.git(["show", "HEAD:empty.txt"]), "");
    assert.strictEqual(repo.git(["status", "--porcelain"]), "");
  });

  test("a submodule gitlink change is committed", async () => {
    const sub = makeRepo("patchwork-sub-");
    writeFileSync(join(sub.root, "f.txt"), "v1\n");
    sub.git(["add", "f.txt"]);
    sub.git(["commit", "-q", "-m", "feat: v1"]);

    const main = makeRepo("patchwork-super-");
    main.git(["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub.root, "sub"]);
    main.git(["commit", "-q", "-m", "chore: add submodule"]);

    writeFileSync(join(sub.root, "f.txt"), "v2\n");
    sub.git(["add", "f.txt"]);
    sub.git(["commit", "-q", "-m", "feat: v2"]);
    const newSha = sub.git(["rev-parse", "HEAD"]).trim();
    main.git(["-C", "sub", "fetch", "-q"]);
    main.git(["-C", "sub", "checkout", "-q", newSha]);

    const changeSet = await readChangeSet(main.root, ["sub"]);
    const file = changeSet.files[0];
    assert.ok(file !== undefined);
    assert.strictEqual(file.hunks.length, 1);

    await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createCommits(main.root, [
          {
            message: "feat: update submodule",
            patches: [{ path: "sub", patch: buildPatch(file, file.hunks) }],
          },
        ]);
      }),
    );

    const tree = main.git(["ls-tree", "HEAD", "sub"]).trim();
    assert.ok(tree.includes("160000"));
    assert.ok(tree.includes(newSha));
  });

  test("runHooks executes pre-commit hooks", async () => {
    const repo = makeTwoHunkRepo();
    writeFileSync(
      join(repo.root, ".git", "hooks", "pre-commit"),
      "#!/bin/sh\necho ran > .git/hook-ran\n",
      { mode: 0o755 },
    );

    const changeSet = await readChangeSet(repo.root, ["a.txt"]);
    const file = changeSet.files[0];
    assert.ok(file !== undefined);
    const hashes = await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createCommits(
          repo.root,
          [
            {
              message: "feat: run hook",
              patches: [{ path: "a.txt", patch: buildPatch(file, [file.hunks[0]!]) }],
            },
          ],
          { runHooks: true },
        );
      }),
    );

    assert.strictEqual(hashes.length, 1);
    assert.strictEqual(existsSync(join(repo.root, ".git", "hook-ran")), true);
  });

  test("reusing an idempotency key does not create a second commit", async () => {
    const repo = makeTwoHunkRepo();
    const changeSet = await readChangeSet(repo.root, ["a.txt"]);
    const file = changeSet.files[0]!;
    const commits = [
      {
        message: "feat: one",
        patches: [{ path: "a.txt", patch: buildPatch(file, [file.hunks[0]!]) }],
      },
    ];

    const first = await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createCommits(repo.root, commits, { idempotencyKey: "same-plan" });
      }),
    );
    const second = await run(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createCommits(repo.root, commits, { idempotencyKey: "same-plan" });
      }),
    );

    assert.deepStrictEqual(second, first);
    assert.strictEqual(repo.git(["rev-list", "--count", "HEAD"]).trim(), "2");
  });
});
