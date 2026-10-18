import { groupForLockFile } from "../../domain/lock-files";
import { aliasForIndex } from "./aliases";
import { contextUnits, type ComposeUnit } from "./units";
import type { LLMMessage } from "../../services/llm";

const SYSTEM_PROMPT = `You split a code change into a series of git commits.

The input is a list of units. Each unit is identified by a short id and consists of either one hunk or one atomic whole-file change. Your job is to partition the units into 1..N coherent commits and write a commit message for each. Use the Angular convention by default; if the user's prompt explicitly asks for a different format or language, follow the user's prompt instead.

Rules:
- Every context unit must appear in exactly one commit, referenced by the exact id shown in its heading (\`u1\`, \`u2\`, …).
- Never invent ids and never reference the same id twice.
- Group units that belong to the same logical concern, even when they touch different files.
- Atomic units are marked as whole-file changes; place each one where it belongs, but do not try to split it.
- Lock files are listed separately and are not yours to place. Do not reference their ids.

Default commit message format (Angular convention):
- Header: \`type(scope): subject\`. The scope is optional.
- Allowed types: build, ci, docs, feat, fix, perf, refactor, style, test, chore, revert.
- Use the imperative, present tense ("add", not "added" or "adds").
- Do not capitalize the first letter of the subject and do not end it with a period.
- Keep the subject concise (72 characters or fewer).
- Add a body only when it adds information the subject cannot convey: the motivation, a non-obvious trade-off, or intent taken from the user's prompt. If the subject is self-explanatory, omit the body.
- When a body is present, separate it from the header with a blank line, use the imperative, present tense, and wrap lines at 72 characters.
- Put breaking changes in a footer as \`BREAKING CHANGE: <description>\`, and reference issues there when relevant.
- Examples: \`feat(compose): split hunks by concern\` needs no body; \`fix(commit): keep the index in sync after a partial commit\` should have a body explaining the failure mode.`;

const lockSection = (units: readonly ComposeUnit[]): string => {
  const locks = units.filter((unit) => unit.isLockFile);
  if (locks.length === 0) {
    return "";
  }
  const lines = locks.map((unit) => {
    const manifest = groupForLockFile(unit.path);
    return manifest === undefined
      ? `- \`${unit.path}\` — dependency lock file (diff withheld)`
      : `- \`${unit.path}\` — dependency lock file generated from \`${manifest}\` (diff withheld)`;
  });
  return `## Lock files\n${lines.join("\n")}`;
};

const unitHeader = (unit: ComposeUnit, id: string): string => {
  if (unit.kind === "file") {
    return `### ${id} — ${unit.path} (${unit.fileType}, whole file)`;
  }
  return `### ${id} — ${unit.path} (${unit.fileType}, hunk ${unit.header ?? ""})`.trimEnd();
};

export interface BuildMessagesOptions {
  /**
   * Upper bound on the diff text sent, in characters (not tokens).
   *
   * This replaces a fixed 128 KiB budget that was split into 32 KiB
   * per unit: once the budget ran out, every later unit was emitted
   * with an empty body, asking the model to place units it could not
   * read. Exceeding the limit is now an error rather than a silent
   * truncation, so the failure names its cause.
   */
  readonly maxDiffChars?: number;
}

/** `patchwork.llm.maxPromptChars`. */
export const DEFAULT_MAX_DIFF_CHARS = 120_000;

export class PromptTooLargeError extends Error {
  readonly totalChars: number;
  readonly limit: number;
  readonly units: number;
  readonly files: number;

  constructor(init: { totalChars: number; limit: number; units: number; files: number }) {
    const kilobytes = (value: number) => `${Math.ceil(value / 1024)} KB`;
    super(
      `The selected changes are too large to send in one request: ${kilobytes(init.totalChars)} of diff across ${init.units} units in ${init.files} files, over the ${kilobytes(init.limit)} limit. Select fewer files, split the change into smaller batches, or raise patchwork.llm.maxPromptChars for a model with a large context window.`,
    );
    this.name = "PromptTooLargeError";
    this.totalChars = init.totalChars;
    this.limit = init.limit;
    this.units = init.units;
    this.files = init.files;
  }
}

/** One unit as it appears in the prompt. */
const unitSection = (unit: ComposeUnit, alias: string): string =>
  `${unitHeader(unit, alias)}\n\`\`\`diff\n${unit.text}\n\`\`\``;

export const buildMessages = (
  userPrompt: string,
  units: readonly ComposeUnit[],
  options: BuildMessagesOptions = {},
): ReadonlyArray<LLMMessage> => {
  const limit = options.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS;
  const context = contextUnits(units);
  const total = context.reduce((sum, unit) => sum + unit.text.length, 0);
  const fileCount = new Set(context.map((unit) => unit.path)).size;

  if (total > limit) {
    throw new PromptTooLargeError({
      totalChars: total,
      limit,
      units: context.length,
      files: fileCount,
    });
  }

  const sections = context.map((unit, index) => unitSection(unit, aliasForIndex(index)));

  const user = [
    userPrompt.length > 0 ? `## User intent\n${userPrompt}\n` : "",
    `## Units\n${sections.join("\n\n")}`,
    lockSection(units),
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
};

/** What the prompt actually contains, for the output channel. */
export const describePrompt = (
  messages: ReadonlyArray<LLMMessage>,
  units: readonly ComposeUnit[],
): string => {
  const context = contextUnits(units);
  const files = new Set(context.map((unit) => unit.path)).size;
  const chars = messages.reduce((sum, message) => sum + message.content.length, 0);
  const locks = units.length - context.length;
  // Rough: characters/3 for mixed-code text. Latin code tokenises at
  // about 4 chars/token, CJK at nearer 1, so this is an indicator, not a
  // measurement — the provider's own tokenizer is authoritative.
  const tokens = Math.round(chars / 3);
  return `${context.length} unit(s) in ${files} file(s)${locks > 0 ? `, ${locks} lock unit(s)` : ""}, ${chars.toLocaleString("en-US")} chars (~${(tokens / 1000).toFixed(1)}k tokens est.)`;
};

export const jsonInstruction = (validationMessage: string): string => {
  const prefix =
    validationMessage.length > 0 ? `Your previous reply was invalid: ${validationMessage}. ` : "";
  return `${prefix}Reply with JSON only — no prose, no code fence. Shape: {"commits":[{"message":"feat(compose): split hunks by concern","hunkIds":["u1","u2"]}]}`;
};
