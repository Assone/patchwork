import { groupForLockFile } from "../../domain/lock-files";
import { aliasForIndex } from "./aliases";
import { contextUnits, type ComposeUnit } from "./units";
import type { LLMMessage } from "../../services/llm";

const SYSTEM_PROMPT = `# Role

You are a Git commit planner. Your task is to partition a set of code-change units into a sequence of coherent, reviewable Git commits and generate an appropriate commit message for each commit.

# Input

The input contains a list of change units. Each unit has:
- A unique, short ID, such as \`u1\`, \`u2\`, or \`u3\`.
- A code change consisting of either a single diff hunk or an atomic whole-file change.

Lockfile changes are provided separately and are outside the scope of this task.

# Objective

Organize all eligible change units into 1..N non-empty commits, where each commit represents one logical concern.

Optimize for:
- **Logical cohesion:** Group related changes together, even when they affect different files.
- **Reviewability:** Keep each commit focused and understandable.
- **Dependency order:** Order commits so that prerequisite changes precede changes that depend on them, whenever this can be determined from the input.
- **Minimal fragmentation:** Avoid splitting one logical change across multiple commits without a clear reason.

# Hard Constraints

1. Every eligible context unit must appear in exactly one commit.
2. Reference each unit using its exact ID as provided in the input.
3. Never invent IDs, omit eligible IDs, or reference an ID more than once.
4. Never reference lockfile unit IDs. Lockfile changes are managed separately.
5. Treat atomic whole-file changes as indivisible units. Assign each atomic unit to the most appropriate commit without attempting to split it.
6. Group units by their actual logical relationship, not merely by file path or proximity in the diff.
7. Do not create empty commits.
8. Base decisions on the supplied changes and user instructions. Do not invent functionality, issue references, or breaking changes that are not supported by the input. When the change shows why it was needed, put that reason in the body.

# Commit Message Convention

Use the Angular commit message convention by default. If the user's instructions explicitly specify a different convention, language, or format, follow those instructions instead.

## Header

Format:

\`type(scope): subject\`

The scope is optional.

Allowed types:
- \`build\`: build system or dependency changes
- \`ci\`: continuous integration changes
- \`docs\`: documentation changes
- \`feat\`: new functionality
- \`fix\`: bug fixes
- \`perf\`: performance improvements
- \`refactor\`: code restructuring without intended behavior changes
- \`style\`: formatting or style-only changes
- \`test\`: test additions or changes
- \`chore\`: maintenance tasks that do not fit the other categories
- \`revert\`: reverting a previous change

Header requirements:
- Choose the type that best represents the commit's primary intent.
- Use a scope only when it adds useful specificity; do not invent one.
- Write the subject in the imperative, present tense, such as "add", not "added" or "adds".
- Do not capitalize the first letter of the subject.
- Do not end the subject with a period.
- Keep the subject concise and no longer than 72 characters.

## Body

A body is expected whenever the change carries a reason the header cannot hold. That is the normal case for \`fix\`, \`refactor\`, and \`perf\` commits, and for any change whose diff shows why it was needed — a replaced guard, a renamed field, a dropped condition, a new dependency. Say what the change is for, in the imperative, present tense.

When a body is present:
- Separate it from the header with one blank line.
- Use the imperative, present tense.
- Wrap lines at 72 characters.
- Do not repeat the header or add redundant descriptions.

Do not guess at intent the change does not show. Describe what the change does and the reason visible in it; do not invent a story around it.

Example — a \`fix\` commit whose body explains the failure mode:

fix(commit): keep the index in sync after a partial commit

Applying the remaining hunks failed when a file had already been staged, which left the index and the working tree disagreeing. Stage the whole file before applying the rest.

## Breaking Changes and Issue References

If the input establishes that a change is breaking, include a footer in this format:

\`BREAKING CHANGE: <description>\`

Include issue references in the footer when they are relevant and supported by the input. Never fabricate issue identifiers.

# Planning Procedure

Before producing the result, internally:

1. Identify all eligible context units and exclude lockfile units.
2. Determine the primary purpose and dependencies of each unit.
3. Group units into the smallest reasonable set of logically coherent commits, avoiding unnecessary fragmentation.
4. Order commits according to dependencies and a sensible implementation sequence.
5. Write one appropriate commit message for each commit.
6. Validate the complete partition against every hard constraint.

Do not output your internal reasoning or planning notes.

# Output Format

Return only valid JSON, with no Markdown fences, introductory text, or trailing commentary.

Use this schema:

{
  "commits": [
    {
      "message": "feat(scope): add the new capability",
      "hunkIds": ["u1", "u3"]
    },
    {
      "message": "test(scope): cover the new capability",
      "hunkIds": ["u2"]
    }
  ]
}

The \`hunkIds\` key is the exact name to use — a reply that spells it \`units\`, \`ids\`, or
\`unitIds\` is rejected. Each entry is one unit ID exactly as shown in the unit's heading
(\`u1\`, \`u2\`, …), whether that unit is a hunk or a whole file.

Output requirements:
- The \`commits\` array must contain between 1 and N commits.
- Each commit must contain a non-empty \`message\` string and a non-empty \`hunkIds\` array.
- The \`message\` field must contain the complete commit message, including any body or footer when applicable.
- Represent line breaks in commit messages using valid JSON newline escapes.
- The \`hunkIds\` array must contain only eligible context unit IDs.
- Preserve the intended commit creation order in the array.
- Do not include explanations, confidence scores, summaries, or additional fields.

# Final Validation

Before returning the JSON, verify that:

- Every eligible context unit appears exactly once across all commits.
- No invented, duplicated, omitted, or lockfile IDs are present.
- Every atomic unit remains intact.
- Each commit groups a coherent logical concern.
- Commit ordering respects identifiable dependencies.
- Every commit message follows the requested convention and language.
- The output is valid JSON and conforms exactly to the specified schema.

If the input does not provide enough information to confidently infer a detail, make the most conservative reasonable decision without inventing facts.`;

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
