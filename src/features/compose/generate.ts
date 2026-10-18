import { Effect } from "effect";
import type { CommitPlan } from "../../domain/commit-plan";
import type { FileView, GenerateCommitsResult, UnitView } from "../../rpc/commit-types";
import { LLMConfigError, LLMConfigService } from "../../services/config";
import { GitService } from "../../services/git";
import {
  LLMGenerateError,
  LLMService,
  toLLMGenerateError,
  type LLMMessage,
  type LLMModelSpec,
  type LLMProgress,
  type LLMServiceApi,
} from "../../services/llm";
import { LoggerService, type LoggerServiceApi } from "../../services/log";
import { describeDiagnosis, diagnoseProposal } from "./diagnose";
import { buildPlan } from "./plan";
import { buildMessages, describePrompt, jsonInstruction, PromptTooLargeError } from "./prompt";
import { describeShape, extractProposal, preview } from "./proposal";
import { CommitPlanSchema } from "./schema";
import { buildUnits, type ComposeUnit } from "./units";
import { toModelIds, translateProposal } from "./aliases";

export interface GenerateCommitsInput {
  readonly repositoryRoot: string;
  readonly files: readonly { readonly path: string }[];
  readonly prompt: string;
  /** Cancels both the structured attempt and its text fallback. */
  readonly abortSignal?: AbortSignal;
  /** Called as model output arrives. Throttling is the host's job. */
  readonly onProgress?: (progress: ComposeProgress) => void;
  /**
   * Hard cap on the diff text sent. Supplied by the host (which owns the
   * settings) so this module stays free of the `vscode` API.
   */
  readonly maxPromptChars?: number;
}

/** Which of the two attempts is currently streaming. */
export interface ComposeProgress {
  readonly phase: "structured" | "text";
  readonly receivedChars: number;
}

/**
 * Keep a raw payload readable *and* intact: `preview` collapses whitespace,
 * which is fine for prose but destroys the JSON this line exists to record.
 */
const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…(${text.length} chars)`;

const fail = (message: string, cause?: unknown): LLMGenerateError =>
  new LLMGenerateError({ reason: "unknown", message, ...(cause === undefined ? {} : { cause }) });

export const generateCommits = (
  input: GenerateCommitsInput,
): Effect.Effect<
  GenerateCommitsResult,
  LLMGenerateError,
  LoggerService | GitService | LLMService | LLMConfigService
> =>
  Effect.gen(function* () {
    if (input.files.length === 0) {
      return yield* Effect.fail(fail("No files selected."));
    }

    const log = yield* LoggerService;
    const config = yield* LLMConfigService;
    const git = yield* GitService;
    const llm = yield* LLMService;

    const spec = yield* config.resolveSpec().pipe(
      Effect.mapError(
        (cause: LLMConfigError) =>
          new LLMGenerateError({
            reason: cause.reason === "auth" ? "auth" : "unknown",
            message: cause.message,
            cause,
          }),
      ),
    );
    const changeSet = yield* git
      .getChangeSet(
        input.repositoryRoot,
        input.files.map((file) => file.path),
      )
      .pipe(Effect.mapError(toLLMGenerateError));

    const built = buildUnits(changeSet);
    if (built.conflicted.length > 0) {
      return yield* Effect.fail(
        fail(`Resolve the conflicted files first: ${built.conflicted.join(", ")}`),
      );
    }
    if (built.missing.length > 0) {
      return yield* Effect.fail(
        fail(
          `No diff could be read for: ${built.missing.join(", ")}. Empty or unreadable files cannot be split into commits.`,
        ),
      );
    }
    if (built.units.length === 0) {
      return yield* Effect.fail(fail("The selected files have no changes to commit."));
    }

    let messages: ReadonlyArray<LLMMessage>;
    try {
      messages = buildMessages(input.prompt, built.units, {
        ...(input.maxPromptChars === undefined ? {} : { maxDiffChars: input.maxPromptChars }),
      });
    } catch (cause) {
      if (cause instanceof PromptTooLargeError) {
        // Report once, through the error itself: the RPC layer logs it on
        // the way out, so logging here as well would double every failure.
        return yield* Effect.fail(fail(cause.message, cause));
      }
      throw cause;
    }

    const plan = yield* draftPlan({
      llm,
      log,
      spec,
      messages,
      units: built.units,
      ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
      ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    });

    return toResult(plan, built.units, input, changeSet.headSha);
  });

interface DraftArgs {
  readonly llm: LLMServiceApi;
  readonly log: LoggerServiceApi;
  readonly spec: LLMModelSpec;
  readonly messages: ReadonlyArray<LLMMessage>;
  readonly units: readonly ComposeUnit[];
  readonly abortSignal?: AbortSignal;
  readonly onProgress?: (progress: ComposeProgress) => void;
}

/**
 * Endpoints that already failed structured output in this extension-host
 * session. Some OpenAI-compatible servers close the connection when they
 * see `response_format`/`json_schema`; retrying structured mode on every
 * request only wastes a round-trip and clutters the log.
 */
const textOnlyEndpoints = new Set<string>();

const endpointKey = (spec: LLMModelSpec): string =>
  spec.provider === "openai-compatible"
    ? `${spec.provider}|${spec.baseURL}|${spec.api ?? "chat-completions"}|${spec.model}`
    : `${spec.provider}|${spec.model}`;

const shouldDisableStructured = (message: string): boolean =>
  /terminated|response_format|json_schema|json schema|structured output|unsupported|not supported/i.test(
    message,
  );

const draftPlan = ({ llm, log, spec, messages, units, abortSignal, onProgress }: DraftArgs) =>
  Effect.gen(function* () {
    const key = endpointKey(spec);
    let validationMessage = "";

    const mode =
      textOnlyEndpoints.has(key) || !llm.streamsStructuredOutput(spec) ? "text" : "structured";
    // One line per request: the shape of what was sent is the first thing to
    // check when a plan comes back partly unassigned, and two overlapping
    // summaries made it hard to tell how many requests even ran.
    log.info(`composing via ${mode} (${key}): ${describePrompt(messages, units)}`);

    const progress =
      onProgress === undefined
        ? undefined
        : (phase: ComposeProgress["phase"]) => (event: LLMProgress) =>
            onProgress({ phase, receivedChars: event.receivedChars });

    if (textOnlyEndpoints.has(key)) {
      validationMessage =
        "structured output is disabled for this endpoint after an earlier failure";
      log.debug(`skipping structured output for ${key}; using text mode`);
    } else if (!llm.streamsStructuredOutput(spec)) {
      // No incremental deltas on this provider, so a slow plan would look
      // like a hang and could hit the idle timeout. Stream text JSON
      // instead; `extractProposal` recovers the object.
      log.debug(`provider ${spec.provider} has no streaming structured output; using text mode`);
    } else {
      const structured = yield* llm
        .generate({
          model: spec,
          messages,
          schema: CommitPlanSchema,
          temperature: 0.2,
          ...(abortSignal === undefined ? {} : { abortSignal }),
          ...(progress === undefined ? {} : { onProgress: progress("structured") }),
        })
        .pipe(
          Effect.mapError(toLLMGenerateError),
          Effect.match({
            onSuccess: (value) => ({ ok: true as const, value }),
            onFailure: (error) => ({ ok: false as const, error }),
          }),
        );

      if (structured.ok) {
        // The adapter normally returns the parsed object, but a streamed
        // structured reply can arrive as raw JSON only. Never throw away
        // a reply that is still parseable.
        const proposal =
          extractProposal(structured.value.value) ?? extractProposal(structured.value.text);
        if (proposal !== null) {
          const result = buildPlan(translateProposal(proposal, units), units);
          if (result.validation.valid) {
            return result.plan;
          }
          validationMessage = toModelIds(result.validation.message, units);
          log.warn(`structured plan rejected, falling back to text: ${validationMessage}`);
          log.info(
            `plan diagnostics: ${describeDiagnosis(
              diagnoseProposal({ proposal, units, replyChars: structured.value.text.length }),
            )}`,
          );
          log.debug(`raw structured reply: ${clip(structured.value.text, 4000)}`);
        } else {
          validationMessage = `the reply did not match the expected shape (${describeShape(structured.value.value)})`;
          textOnlyEndpoints.add(key);
          log.warn(`structured output unusable for ${key}: ${validationMessage}`);
        }
      } else {
        // A timeout or cancellation is a reason to stop, not to start a
        // second (likely slower) request that will hit the same wall.
        if (
          structured.error.reason === "auth" ||
          structured.error.reason === "timeout" ||
          structured.error.reason === "cancelled"
        ) {
          return yield* Effect.fail(structured.error);
        }
        validationMessage = structured.error.message;
        if (shouldDisableStructured(validationMessage)) {
          textOnlyEndpoints.add(key);
          log.warn(`disabling structured output for ${key}`, structured.error.cause);
        } else {
          log.warn(
            `structured call failed, falling back to text: ${validationMessage}`,
            structured.error.cause,
          );
        }
      }
    }

    // One retry with the validation feedback: an omitted alias or a
    // near-miss is usually fixable without the user regenerating. Each
    // retry re-sends the full diff, so cap it low.
    const MAX_TEXT_ATTEMPTS = 2;
    let feedback = validationMessage;
    let lastReply: string | undefined;

    /** A second request is about to be made; say so in the output channel. */
    const noteRetry = (attempt: number): void => {
      if (attempt < MAX_TEXT_ATTEMPTS) {
        log.warn(
          `retrying with the validation feedback (attempt ${attempt + 1}/${MAX_TEXT_ATTEMPTS})`,
        );
      }
    };

    for (let attempt = 1; attempt <= MAX_TEXT_ATTEMPTS; attempt += 1) {
      const textAttempt = yield* llm
        .generate({
          model: spec,
          messages: [...messages, { role: "user", content: jsonInstruction(feedback) }],
          temperature: 0,
          ...(abortSignal === undefined ? {} : { abortSignal }),
          ...(progress === undefined ? {} : { onProgress: progress("text") }),
        })
        .pipe(
          Effect.mapError(toLLMGenerateError),
          Effect.match({
            onSuccess: (value) => ({ ok: true as const, value }),
            onFailure: (error) => ({ ok: false as const, error }),
          }),
        );

      if (!textAttempt.ok) {
        const error = textAttempt.error;
        return yield* Effect.fail(
          new LLMGenerateError({
            reason: error.reason,
            message:
              validationMessage.length > 0
                ? `The model call failed: ${error.message} (structured attempt: ${validationMessage})`
                : `The model call failed: ${error.message}`,
            cause: error.cause,
          }),
        );
      }

      const text = textAttempt.value;
      lastReply = text.text;
      const proposal = extractProposal(text.text);
      if (proposal === null) {
        feedback = `the reply was not parseable JSON (it started with: ${preview(text.text)})`;
        log.error(
          `model reply was not recoverable JSON (attempt ${attempt}): ${preview(text.text)}`,
        );
        noteRetry(attempt);
        continue;
      }

      const result = buildPlan(translateProposal(proposal, units), units);
      if (result.validation.valid) {
        return result.plan;
      }

      const retryFeedback = toModelIds(result.validation.message, units);
      log.warn(`model plan rejected (attempt ${attempt}/${MAX_TEXT_ATTEMPTS}): ${retryFeedback}`);
      log.info(
        `plan diagnostics (attempt ${attempt}): ${describeDiagnosis(
          diagnoseProposal({ proposal, units, replyChars: text.text.length }),
        )}`,
      );
      log.debug(`raw reply (attempt ${attempt}): ${clip(text.text, 4000)}`);
      feedback = retryFeedback;
      noteRetry(attempt);
    }

    return yield* Effect.fail(
      fail(`The model did not return a valid commit plan: ${feedback}`, lastReply),
    );
  });

const toFileView = (unit: ComposeUnit): FileView => ({
  path: unit.path,
  oldPath: unit.file.oldPath,
  diffKind: unit.file.type,
  ...(unit.file.oldMode === undefined ? {} : { oldMode: unit.file.oldMode }),
  ...(unit.file.newMode === undefined ? {} : { newMode: unit.file.newMode }),
  ...(unit.file.oldHash === undefined ? {} : { oldHash: unit.file.oldHash }),
  ...(unit.file.newHash === undefined ? {} : { newHash: unit.file.newHash }),
  additions: unit.file.additions,
  deletions: unit.file.deletions,
  ...(unit.file.similarity === undefined ? {} : { similarity: unit.file.similarity }),
  isBinary: unit.file.isBinary,
  header: unit.file.header,
  hunks: unit.file.hunks.map(({ raw: _raw, ...hunk }) => hunk),
});

const toUnitView = (unit: ComposeUnit): UnitView => ({
  id: unit.id,
  kind: unit.kind,
  path: unit.path,
  oldPath: unit.oldPath,
  fileType: unit.fileType,
  diffKind: unit.diffKind,
  ...(unit.header === undefined ? {} : { header: unit.header }),
  ...(unit.hunkIndex === undefined ? {} : { hunkIndex: unit.hunkIndex }),
  ...(unit.oldStart === undefined ? {} : { oldStart: unit.oldStart }),
  ...(unit.newStart === undefined ? {} : { newStart: unit.newStart }),
  isBinary: unit.isBinary,
  isLockFile: unit.isLockFile,
});

const toResult = (
  plan: CommitPlan,
  units: readonly ComposeUnit[],
  input: GenerateCommitsInput,
  headSha: string | null,
): GenerateCommitsResult => {
  const files = new Map<string, FileView>();
  for (const unit of units) {
    if (!files.has(unit.path)) {
      files.set(unit.path, toFileView(unit));
    }
  }

  return {
    headSha,
    prompt: input.prompt,
    paths: input.files.map((file) => file.path),
    files: [...files.values()],
    units: units.map(toUnitView),
    commits: plan.commits.map((commit, index) => ({
      id: `c${index}`,
      message: commit.message,
      hunkIds: [...commit.hunkIds],
    })),
  };
};
