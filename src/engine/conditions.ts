/**
 * Pure condition evaluation functions for the RuleEngine.
 */

/**
 * Returns true if amountSOL >= the numeric value of conditionValue.
 * Returns false if conditionValue is not a valid number.
 */
export function evaluateThresholdCondition(
  amountSOL: number,
  conditionValue: string,
): boolean {
  const threshold = parseFloat(conditionValue);
  if (isNaN(threshold)) return false;
  return amountSOL >= threshold;
}

/**
 * Returns true if referralSource exactly matches conditionValue.
 * Returns false if referralSource is null.
 */
export function evaluateReferralCondition(
  referralSource: string | null,
  conditionValue: string,
): boolean {
  if (referralSource === null) return false;
  return referralSource === conditionValue;
}
