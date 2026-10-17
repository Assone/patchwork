import { validatePlan, type CommitPlan, type PlanValidation } from "../../domain/commit-plan";
import { reconcileLockUnits } from "./reconcile";
import { contextUnits, type ComposeUnit } from "./units";
import { toCommitPlan, type Proposal } from "./schema";

export interface PlanResult {
  readonly plan: CommitPlan;
  readonly validation: PlanValidation;
}

/**
 * Validate the model's partition of context units, then add the
 * host-pinned lock units and validate the complete partition.
 */
export const buildPlan = (proposal: Proposal, units: readonly ComposeUnit[]): PlanResult => {
  const context = contextUnits(units);
  const base = toCommitPlan(proposal);
  const contextValidation = validatePlan(base, new Set(context.map((unit) => unit.id)));
  if (!contextValidation.valid) {
    return { plan: base, validation: contextValidation };
  }

  const reconciled = reconcileLockUnits(base, units);
  return {
    plan: reconciled,
    validation: validatePlan(reconciled, new Set(units.map((unit) => unit.id))),
  };
};
