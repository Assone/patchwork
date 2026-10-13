import { Layer, Effect, Queue, Stream } from "effect";
import {
  type RepositoryInfo,
  RepositoryService,
  type RepositoryChange,
} from "../services/repository";
import type { Repository, API as GitAPI } from "../types/git";
import * as vscode from "vscode";

const toRepositoryInfo = (repository: Repository): RepositoryInfo => ({
  root: repository.rootUri.fsPath,
});

export const RepositoryServiceLive = (git: GitAPI) =>
  Layer.succeed(RepositoryService, {
    getRepositories: Effect.sync(() => git.repositories.map(toRepositoryInfo)),

    changes: Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<RepositoryChange>();

        const subscriptions = new Map<Repository, vscode.Disposable[]>();

        const publish = (repository: Repository, reason: RepositoryChange["reason"]) => {
          Queue.offerUnsafe(queue, {
            repository: toRepositoryInfo(repository),
            reason,
          });
        };

        const subscribeRepository = (repository: Repository) => {
          if (subscriptions.has(repository)) {
            return;
          }

          const disposables = [
            repository.state.onDidChange(() => {
              publish(repository, "state");
            }),
          ];

          subscriptions.set(repository, disposables);
          publish(repository, "opened");
        };

        const unsubscribeRepository = (repository: Repository) => {
          const disposables = subscriptions.get(repository);

          if (!disposables) {
            return;
          }

          for (const disposable of disposables) {
            disposable.dispose();
          }

          subscriptions.delete(repository);
          publish(repository, "closed");
        };

        for (const repository of git.repositories) {
          subscribeRepository(repository);
        }

        const onDidOpenRepository = git.onDidOpenRepository(subscribeRepository);

        const onDidCloseRepository = git.onDidCloseRepository(unsubscribeRepository);

        return Stream.fromQueue(queue).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              onDidOpenRepository.dispose();
              onDidCloseRepository.dispose();

              for (const disposables of subscriptions.values()) {
                for (const disposable of disposables) {
                  disposable.dispose();
                }
              }

              subscriptions.clear();
            }),
          ),
        );
      }),
    ),
  });
