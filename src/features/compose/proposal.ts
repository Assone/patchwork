import { CommitPlanSchema, type Proposal } from "./schema";

/**
 * Why a reply could not be turned into a plan.
 *
 * `not-json` means there was nothing to parse; `shape` means the JSON was
 * fine but did not describe a commit plan. They call for different
 * feedback — one asks for JSON, the other asks for the right keys — and
 * the old single error said "not parseable JSON" for both, which sent
 * people looking for a syntax problem in a perfectly valid reply.
 */
export type ProposalRejection = "not-json" | "shape";

export type ProposalInspection =
  | { readonly ok: true; readonly proposal: Proposal }
  | {
      readonly ok: false;
      readonly rejection: ProposalRejection;
      /** What was found instead, for the error message. */
      readonly found: string;
    };

/**
 * Recover a proposal from the shapes schema-ignoring endpoints actually
 * return: the object, a bare array, a fenced block, or JSON in prose.
 * Anything ambiguous is rejected rather than coerced.
 */
export const extractProposal = (raw: unknown): Proposal | null => {
  const inspection = inspectProposal(raw);
  return inspection.ok ? inspection.proposal : null;
};

/** `extractProposal`, with the reason a reply was refused. */
export const inspectProposal = (raw: unknown): ProposalInspection => {
  const direct = parseCandidate(raw);
  if (direct !== null) {
    return { ok: true, proposal: direct };
  }

  if (typeof raw !== "string") {
    // A JSON object or array that did not match the plan is a shape
    // problem; anything else was never JSON in the first place.
    const isJsonValue = typeof raw === "object" && raw !== null;
    return {
      ok: false,
      rejection: isJsonValue ? "shape" : "not-json",
      found: describeShape(raw),
    };
  }

  const parsed = jsonCandidates(raw);
  for (const candidate of parsed) {
    const proposal = parseCandidate(candidate);
    if (proposal !== null) {
      return { ok: true, proposal };
    }
  }

  if (parsed.length > 0) {
    // The reply was valid JSON; it just was not a commit plan.
    return { ok: false, rejection: "shape", found: describeShape(parsed[0]) };
  }
  return { ok: false, rejection: "not-json", found: "none" };
};

/**
 * The prompt talks about "units"; the plan schema calls the same ids
 * "hunkIds". Accept the prompt's spelling when recovering a reply, so a
 * model that answers in its own vocabulary is not thrown away for a key
 * name — and so a reply like the one in the bug report lands.
 */
const withUnitAlias = (candidate: unknown): unknown => {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return candidate;
  }
  const record = candidate as Record<string, unknown>;
  const commits = record.commits;
  if (!Array.isArray(commits)) {
    return candidate;
  }
  return {
    ...record,
    commits: commits.map((commit) => {
      if (typeof commit !== "object" || commit === null) {
        return commit;
      }
      const entry = commit as Record<string, unknown>;
      if (entry.hunkIds !== undefined || entry.units === undefined) {
        return commit;
      }
      return { ...entry, hunkIds: entry.units };
    }),
  };
};

const parseCandidate = (candidate: unknown): Proposal | null => {
  const direct = CommitPlanSchema.safeParse(candidate);
  if (direct.success) {
    return direct.data;
  }

  const aliased = CommitPlanSchema.safeParse(withUnitAlias(candidate));
  if (aliased.success) {
    return aliased.data;
  }

  if (Array.isArray(candidate)) {
    const wrapped = CommitPlanSchema.safeParse(withUnitAlias({ commits: candidate }));
    if (wrapped.success) {
      return wrapped.data;
    }
  }

  return null;
};

const FENCED_JSON = /```(?:json)?\s*([\s\S]*?)```/gi;

/**
 * Escape the control characters a model writes literally inside a JSON
 * string.
 *
 * A commit body needs a blank line after the header, and models often
 * write that as a real newline instead of the `\n` escape the grammar
 * requires — which makes the whole reply unparseable, body and all. One
 * stray character should not cost the entire plan, so try the repaired
 * form when the strict parse fails.
 */
const escapeControlCharacters = (text: string): string => {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (!inString) {
      if (char === '"') {
        inString = true;
      }
      result += char;
      continue;
    }
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      result += char;
      inString = false;
      continue;
    }
    if (char === "\n") {
      result += "\\n";
      continue;
    }
    if (char === "\r") {
      result += "\\r";
      continue;
    }
    if (char === "\t") {
      result += "\\t";
      continue;
    }
    result += char;
  }

  return result;
};

const jsonCandidates = (text: string): readonly unknown[] => {
  const texts: string[] = [text.trim()];

  for (const match of text.matchAll(FENCED_JSON)) {
    const body = match[1]?.trim();
    if (body !== undefined && body.length > 0) {
      texts.push(body);
    }
  }

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) {
      texts.push(text.slice(start, end + 1));
    }
  }

  const parsed: unknown[] = [];
  for (const candidate of new Set(texts)) {
    try {
      parsed.push(JSON.parse(candidate) as unknown);
      continue;
    } catch {
      // Not JSON as written; try the repaired form below.
    }
    try {
      parsed.push(JSON.parse(escapeControlCharacters(candidate)) as unknown);
    } catch {
      // Not JSON either; try the next candidate.
    }
  }
  return parsed;
};

const describeShape = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return `object{${Object.keys(value as Record<string, unknown>).join(", ")}}`;
  }
  return typeof value;
};

export const preview = (text: string, max = 160): string => {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
};
