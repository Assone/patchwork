import { CommitPlanSchema, type Proposal } from "./schema";

/**
 * Recover a proposal from the shapes schema-ignoring endpoints actually
 * return: the object, a bare array, a fenced block, or JSON in prose.
 * Anything ambiguous is rejected rather than coerced.
 */
export const extractProposal = (raw: unknown): Proposal | null => {
  const direct = parseCandidate(raw);
  if (direct !== null) {
    return direct;
  }

  if (typeof raw !== "string") {
    return null;
  }

  for (const candidate of jsonCandidates(raw)) {
    const parsed = parseCandidate(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const parseCandidate = (candidate: unknown): Proposal | null => {
  const direct = CommitPlanSchema.safeParse(candidate);
  if (direct.success) {
    return direct.data;
  }

  if (Array.isArray(candidate)) {
    const wrapped = CommitPlanSchema.safeParse({ commits: candidate });
    if (wrapped.success) {
      return wrapped.data;
    }
  }

  return null;
};

const FENCED_JSON = /```(?:json)?\s*([\s\S]*?)```/gi;

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
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return parsed;
};

export const describeShape = (value: unknown): string => {
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
