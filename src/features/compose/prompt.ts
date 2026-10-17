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

const MAX_UNIT_TEXT = 32 * 1024;
const MAX_TOTAL_TEXT = 128 * 1024;

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

export const buildMessages = (
  userPrompt: string,
  units: readonly ComposeUnit[],
): ReadonlyArray<LLMMessage> => {
  let remaining = MAX_TOTAL_TEXT;
  const sections = contextUnits(units).map((unit, index) => {
    const allowance = Math.min(MAX_UNIT_TEXT, remaining);
    const included = Math.min(unit.text.length, allowance);
    const body =
      included < unit.text.length ? `${unit.text.slice(0, included)}\n…(truncated)` : unit.text;
    remaining -= included;
    return `${unitHeader(unit, aliasForIndex(index))}\n\`\`\`diff\n${body}\n\`\`\``;
  });

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

export const jsonInstruction = (validationMessage: string): string => {
  const prefix =
    validationMessage.length > 0 ? `Your previous reply was invalid: ${validationMessage}. ` : "";
  return `${prefix}Reply with JSON only — no prose, no code fence. Shape: {"commits":[{"message":"feat(compose): split hunks by concern","hunkIds":["u1","u2"]}]}`;
};
