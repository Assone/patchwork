import type { Proposal } from "./schema";
import { contextUnits, type ComposeUnit } from "./units";

/**
 * The id the model sees for the nth context unit.
 *
 * Content-addressed ids (`u1_` + 22 random base64url characters) are the
 * right identity for the host: they change when a hunk changes, so a
 * stale plan cannot be applied to different content. They are terrible
 * for a language model to copy — dropping one character or adding a
 * trailing `-` is a common failure, and validation then rejects the whole
 * plan. Short per-request aliases are easy to reproduce exactly; the host
 * translates them back before validation.
 */
export const aliasForIndex = (index: number): string => `u${index + 1}`;

/** Alias → content-addressed unit id, in prompt order. */
export const unitAliases = (units: readonly ComposeUnit[]): ReadonlyMap<string, string> =>
  new Map(contextUnits(units).map((unit, index) => [aliasForIndex(index), unit.id]));

/**
 * Replace aliases in a model reply with the real unit ids.
 *
 * Unknown values pass through untouched so validation still reports them
 * (as the alias the model wrote, which is easier to debug than a 22-char
 * near-miss).
 */
export const translateProposal = (proposal: Proposal, units: readonly ComposeUnit[]): Proposal => {
  const aliases = unitAliases(units);
  return {
    commits: proposal.commits.map((commit) => ({
      message: commit.message,
      hunkIds: commit.hunkIds.map((id) => aliases.get(id) ?? id),
    })),
  };
};

/** Rewrite real unit ids back to aliases, for feedback the model can act on. */
export const toModelIds = (message: string, units: readonly ComposeUnit[]): string => {
  let result = message;
  for (const [alias, id] of unitAliases(units)) {
    result = result.replaceAll(id, alias);
  }
  return result;
};
