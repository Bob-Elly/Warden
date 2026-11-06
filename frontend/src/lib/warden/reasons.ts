/** Human-readable text for the vault's reason codes. Safe to import in the browser. */
export const REASONS: Record<string, string> = {
  recipient_not_allowlisted: 'Recipient is not on the allowlist',
  per_tx_limit_exceeded: "Over the agent's per-payment limit",
  agent_daily_limit_exceeded: "Over the agent's daily budget",
  vault_daily_limit_exceeded: 'Over the vault-wide daily cap',
  vault_paused: 'The vault is paused',
  agent_suspended: 'The agent is suspended',
  approval_queue_full: 'The approval queue is full',
  insufficient_vault_balance: 'The vault does not have enough balance',
  invalid_amount: 'Invalid amount',
  not_due_yet: 'Not due yet',
  strike_limit_reached: 'Strike limit reached',
};

export function reasonText(code?: string | null): string {
  if (!code) return '';
  return REASONS[code] ?? code.replace(/_/g, ' ');
}

/** "1000000" -> "1,000,000", keeps decimals as typed. */
export function fmtNear(amount: string): string {
  const [w, f] = String(amount).split('.');
  const whole = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f ? `${whole}.${f}` : whole;
}
