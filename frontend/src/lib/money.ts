/** US dollars as the studio shows them: cents, and "under $0.01" for the tiny agent calls. */
export function usd(amount: number | null | undefined): string {
  if (!amount) return '$0.00';
  if (amount < 0.01) return 'under $0.01';
  return `$${amount.toFixed(2)}`;
}
