import { Context, Effect, Stream } from "effect";
import type { RepositoryChangeReason } from "../rpc/git-types";

export interface RepositoryInfo {
  readonly root: string;
}

export interface RepositoryChange {
  readonly repository: RepositoryInfo;
  /**
   * The shared vocabulary — see `../rpc/git-types`. The webview switches
   * on the same union, so the two sides can't drift.
   */
  readonly reason: RepositoryChangeReason;
}

export interface RepositoryServiceApi {
  readonly getRepositories: Effect.Effect<readonly RepositoryInfo[]>;
  readonly changes: Stream.Stream<RepositoryChange>;
}

export class RepositoryService extends Context.Service<RepositoryService, RepositoryServiceApi>()(
  "patchwork/RepositoryService",
) {}
