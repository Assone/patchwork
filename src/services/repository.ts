import { Context, Effect, Stream } from "effect";

export interface RepositoryInfo {
  readonly root: string;
}

export interface RepositoryChange {
  readonly repository: RepositoryInfo;
  readonly reason: "state" | "index" | "workingTree" | "closed" | "opened";
}

export interface RepositoryServiceApi {
  readonly getRepositories: Effect.Effect<readonly RepositoryInfo[]>;
  readonly changes: Stream.Stream<RepositoryChange>;
}

export class RepositoryService extends Context.Service<RepositoryService, RepositoryServiceApi>()(
  "patchwork/RepositoryService",
) {}
