import { useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LLMConfigPatch, LLMConfigView } from "../../rpc/config-types";
import { useRpc } from "../rpc-context";
import { llmKeys } from "./queryKeys";

const CONFIG_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;

export function useLLMConfig() {
  const client = useRpc();
  return useQuery({
    queryKey: llmKeys.config(),
    queryFn: () => client.call("llm.getConfig", undefined, { timeoutMs: CONFIG_TIMEOUT_MS }),
    // Cheap enough to refresh whenever the window regains focus, which
    // picks up edits made directly in settings.json.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useLLMConfigured(): boolean | null {
  const query = useLLMConfig();
  return query.data === undefined ? null : query.data.configured;
}

/**
 * Serialized config writes.
 *
 * Each save returns a full snapshot. Without ordering, two in-flight
 * field edits can resolve out of order and the older snapshot wins.
 */
export function useLLMConfigWriter() {
  const client = useRpc();
  const queryClient = useQueryClient();
  const queue = useRef<Promise<void>>(Promise.resolve());

  const enqueue = useCallback(<T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(run, run);
    queue.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const write = useCallback(
    async (patch: LLMConfigPatch): Promise<LLMConfigView> => {
      const next = await enqueue(() =>
        client.call("llm.updateConfig", patch, { timeoutMs: CONFIG_TIMEOUT_MS }),
      );
      queryClient.setQueryData(llmKeys.config(), next);
      return next;
    },
    [client, enqueue, queryClient],
  );

  const setApiKey = useCallback(
    async (provider: string, key: string): Promise<void> => {
      await enqueue(() =>
        client.call("secrets.setApiKey", { provider, key }, { timeoutMs: CONFIG_TIMEOUT_MS }),
      );
      const next = await enqueue(() =>
        client.call("llm.getConfig", undefined, { timeoutMs: CONFIG_TIMEOUT_MS }),
      );
      queryClient.setQueryData(llmKeys.config(), next);
    },
    [client, enqueue, queryClient],
  );

  const clearApiKey = useCallback(
    async (provider: string): Promise<void> => {
      const next = await enqueue(() =>
        client.call("secrets.clearApiKey", { provider }, { timeoutMs: CONFIG_TIMEOUT_MS }),
      );
      queryClient.setQueryData(llmKeys.config(), next);
    },
    [client, enqueue, queryClient],
  );

  const test = useCallback(
    () =>
      enqueue(() => client.call("llm.testConnection", undefined, { timeoutMs: TEST_TIMEOUT_MS })),
    [client, enqueue],
  );

  return { write, setApiKey, clearApiKey, test };
}
