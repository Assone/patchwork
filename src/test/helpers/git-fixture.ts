import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixtureRepo {
  readonly root: string;
  readonly git: (args: readonly string[]) => string;
}

export function makeRepo(prefix = "patchwork-test-"): FixtureRepo {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const git = (args: readonly string[]) =>
    execFileSync("git", [...args], { cwd: root, encoding: "utf8" });

  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  return { root, git };
}

/** A repo with one staged and one unstaged change. */
export function makeDiffFixture(): FixtureRepo {
  const repo = makeRepo("patchwork-diff-");
  writeFileSync(join(repo.root, "staged.txt"), "before\n");
  writeFileSync(join(repo.root, "unstaged.txt"), "original\n");
  repo.git(["add", "staged.txt", "unstaged.txt"]);
  repo.git(["commit", "-q", "-m", "initial"]);

  writeFileSync(join(repo.root, "staged.txt"), "after\n");
  repo.git(["add", "staged.txt"]);
  writeFileSync(join(repo.root, "unstaged.txt"), "modified\n");
  return repo;
}

export interface RepoSnapshot {
  readonly head: string;
  readonly status: string;
  readonly index: string;
}

export function snapshot(repo: FixtureRepo): RepoSnapshot {
  return {
    head: repo.git(["rev-parse", "HEAD"]).trim(),
    status: repo.git(["status", "--porcelain"]),
    index: repo.git(["ls-files", "-s"]),
  };
}
