/**
 * What the agents cost, as an estimate: token counts times list prices, never the bill itself. So it reads
 * approximate: whole dollars from $1 up, cents below, and "under $0.01" for the tiny agent calls.
 */
export function usd(amount: number | null | undefined): string {
  if (!amount) return '$0';
  if (amount < 0.01) return 'under $0.01';
  if (amount < 1) return `≈ $${amount.toFixed(2)}`;
  return `≈ $${Math.round(amount)}`;
}

/** The hover text on every cost: where the number comes from and where the real one is. */
export const COST_NOTE = 'An estimate from the tokens each agent used and the models\' list prices. '
  + 'The billed amount is in the Anthropic Console, under Cost.';
