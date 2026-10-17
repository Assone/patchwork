const LOCK_FILE_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "Package.resolved",
  "packages.lock.json",
  "pubspec.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "flake.lock",
  "gradle.lockfile",
]);

/** Case-sensitive: `Cargo.lock` and `cargo.lock` are different files. */
export function isLockFile(path: string): boolean {
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  return name !== undefined && LOCK_FILE_NAMES.has(name);
}

export function isLockedPath(path: string): boolean {
  return isLockFile(path);
}

export function selectLockFiles(paths: Iterable<string>): readonly string[] {
  return [...paths].filter(isLockFile);
}

/**
 * The manifest a lock file belongs with, in the same directory.
 * `packages/a/package-lock.json` pairs with `packages/a/package.json`.
 */
export function groupForLockFile(path: string): string | undefined {
  const separator = path.lastIndexOf("/");
  const name = separator === -1 ? path : path.slice(separator + 1);
  const directory = separator === -1 ? "" : path.slice(0, separator + 1);
  const manifestName = manifestForLockFile(name);
  return manifestName === undefined ? undefined : `${directory}${manifestName}`;
}

const manifestForLockFile = (name: string): string | undefined => {
  switch (name) {
    case "pnpm-lock.yaml":
      return "pnpm-workspace.yaml";
    case "yarn.lock":
      return ".yarnrc.yml";
    case "bun.lock":
    case "bun.lockb":
      return "bunfig.toml";
    case "npm-shrinkwrap.json":
    case "package-lock.json":
    case "deno.lock":
      return "package.json";
    case "Cargo.lock":
      return "Cargo.toml";
    case "go.sum":
      return "go.mod";
    case "composer.lock":
      return "composer.json";
    case "Gemfile.lock":
      return "Gemfile";
    case "packages.lock.json":
      return "project.assets.json";
    case "Package.resolved":
      return "Package.swift";
    case "pubspec.lock":
      return "pubspec.yaml";
    case "poetry.lock":
      return "pyproject.toml";
    case "Pipfile.lock":
      return "Pipfile";
    case "uv.lock":
      return "pyproject.toml";
    case "flake.lock":
      return "flake.nix";
    case "gradle.lockfile":
      return "build.gradle";
    default:
      return undefined;
  }
};
