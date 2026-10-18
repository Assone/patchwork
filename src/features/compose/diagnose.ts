import type { Proposal } from "./schema";
import { contextUnits, type ComposeUnit } from "./units";

export interface PlanDiagnosis {
  /** Commits in the reply, and ids across all of them. */
  readonly commits: number;
  readonly idsReferenced: number;
  readonly distinctIds: number;
  /** Units whose body the model could read. */
  readonly expected: number;
  readonly placed: number;
  readonly missing: readonly string[];
  /** Ids that are not aliases of any unit (typos, invented ids, prose ids). */
  readonly unknown: readonly string[];
  readonly duplicated: readonly string[];
  /** Ids of units the model should not have named (lock files). */
  readonly forbidden: readonly string[];
  readonly emptyCommits: number;
  /** Length of the raw reply, and how many `hunkIds` arrays it contained. */
  readonly replyChars: number;
}

export interface DiagnosisInput {
  readonly proposal: Proposal | null;
  readonly units: readonly ComposeUnit[];
  readonly replyChars: number;
  /** Ids as the model wrote them (aliases), before translation. */
  readonly rawIds?: readonly string[];
}

const orderedMostFrequent = (values: Iterable<string>): readonly string[] => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value);
};

/**
 * Describe how far a rejected reply got, without judging it.
 *
 * The "hunks not assigned" message alone cannot distinguish a model that
 * dropped the tail of a long list from one that mangled ids or refused
 * part way; all three produce the same text. This reports the counts
 * those messages hide:
 *
 * - `placed` ≈ `expected` with a growing `missing` tail means the reply
 *   was cut short (provider or output limit), not misclassified.
 * - `unknown`/`duplicated` non-empty means the ids were mangled.
 * - `emptyCommits` and a low `idsReferenced` mean the model summarised
 *   instead of partitioning.
 */
export const diagnoseProposal = (input: DiagnosisInput): PlanDiagnosis => {
  const context = contextUnits(input.units);
  const assignable = new Set(context.map((unit) => unit.id));
  const namable = new Set(context.map((unit) => unit.id));
  const lockIds = new Set(input.units.filter((unit) => unit.isLockFile).map((unit) => unit.id));

  const commits = input.proposal?.commits ?? [];
  const rawIds = input.rawIds ?? commits.flatMap((commit) => commit.hunkIds);
  const translated = commits.flatMap((commit) => commit.hunkIds);
  const referenced = new Set(translated);
  const aliases = new Set(context.map((_, index) => `u${index + 1}`));

  return {
    commits: commits.length,
    idsReferenced: translated.length,
    distinctIds: referenced.size,
    expected: assignable.size,
    placed: [...assignable].filter((id) => referenced.has(id)).length,
    missing: [...assignable].filter((id) => !referenced.has(id)),
    unknown: [...new Set(rawIds.filter((id) => !aliases.has(id) && !namable.has(id)))],
    duplicated: orderedMostFrequent(translated),
    forbidden: [...referenced].filter((id) => lockIds.has(id)),
    emptyCommits: commits.filter((commit) => commit.hunkIds.length === 0).length,
    replyChars: input.replyChars,
  };
};

/** One line for the output channel; no alias→id translation, on purpose. */
export const describeDiagnosis = (diagnosis: PlanDiagnosis): string => {
  const list = (values: readonly string[]) =>
    values.length === 0 ? "none" : values.slice(0, 12).join(",") + (values.length > 12 ? ",…" : "");

  return [
    `reply ${diagnosis.replyChars} chars`,
    `commits=${diagnosis.commits}`,
    `placed ${diagnosis.placed}/${diagnosis.expected}`,
    `ids=${diagnosis.idsReferenced}/${diagnosis.distinctIds}`,
    `emptyCommits=${diagnosis.emptyCommits}`,
    `missing=${diagnosis.missing.length === 0 ? "none" : `${diagnosis.missing.length} (first ${diagnosis.missing[0]})`}`,
    `unknown=${list(diagnosis.unknown)}`,
    `duplicated=${list(diagnosis.duplicated)}`,
    `forbidden=${list(diagnosis.forbidden)}`,
  ].join(" ");
};
