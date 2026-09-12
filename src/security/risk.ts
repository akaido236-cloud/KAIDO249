import { ConfirmationPolicy, RiskLevel } from '../core/types.js';

export type RiskAssessment = {
  level: RiskLevel;
  /** True when the agent's policy demands an explicit user approval first. */
  requiresConfirmation: boolean;
  /** True when the agent's policy forbids the action outright. */
  forbidden: boolean;
  reason: string;
};

const ORDER: RiskLevel[] = [
  RiskLevel.LOW,
  RiskLevel.MEDIUM,
  RiskLevel.HIGH,
  RiskLevel.CRITICAL,
];

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/**
 * The RiskEngine decides, per action, whether KAIDO may proceed silently,
 * must ask the user, or is forbidden. External effects that leave KAIDO
 * (sending mail, pushing code, deleting data) escalate the base risk of the
 * tool, so a read-shaped tool used with write intent cannot slip through.
 */
export class RiskEngine {
  /** Escalate a tool's declared risk when its invocation has external effect. */
  assess(
    baseLevel: RiskLevel,
    opts: {
      sideEffect: boolean;
      touchesCredentials?: boolean;
      bulkOperation?: boolean;
      financial?: boolean;
      crossBoundary?: boolean;
    },
  ): RiskLevel {
    let level = baseLevel;
    if (opts.touchesCredentials || opts.financial) level = RiskLevel.CRITICAL;
    if (opts.bulkOperation) level = maxRisk(level, RiskLevel.CRITICAL);
    if (opts.crossBoundary && ORDER.indexOf(level) < ORDER.indexOf(RiskLevel.HIGH)) {
      level = RiskLevel.HIGH;
    }
    if (opts.sideEffect && ORDER.indexOf(level) < ORDER.indexOf(RiskLevel.MEDIUM)) {
      level = RiskLevel.MEDIUM;
    }
    return level;
  }

  evaluate(level: RiskLevel, policy: ConfirmationPolicy, preAuthorised = false): RiskAssessment {
    if (policy.forbiddenLevels.includes(level)) {
      return {
        level,
        requiresConfirmation: false,
        forbidden: true,
        reason: `Risk level ${level} is forbidden by this agent's policy.`,
      };
    }
    const needsConfirm = policy.requireConfirmationFor.includes(level);
    if (needsConfirm && preAuthorised && policy.allowAutomationOverride) {
      return {
        level,
        requiresConfirmation: false,
        forbidden: false,
        reason: `Approved by a user-authored automation rule.`,
      };
    }
    return {
      level,
      requiresConfirmation: needsConfirm,
      forbidden: false,
      reason: needsConfirm
        ? `Risk level ${level} requires explicit confirmation.`
        : `Risk level ${level} may proceed under this agent's policy.`,
    };
  }
}
