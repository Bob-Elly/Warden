export interface VaultInfo {
  owner_id: string;
  paused: boolean;
  vault_daily_limit: string;
  vault_spent_today: string;
  reset_in_seconds: number;
  balance: string;
  available_balance: string;
  allowlist: string[];
  agent_count: number;
  pending_count: number;
  total_executed: number;
  total_blocked: number;
  strike_limit: number;
  quarantine_secs: number;
}

export interface AgentPolicy {
  label: string;
  per_tx_limit: string;
  daily_limit: string;
  spent_today: string;
  window_start: number;
  strikes: number;
  suspended: boolean;
  suspended_until_ms: number;
  executed_count: number;
  blocked_count: number;
}

export interface TokenPolicy {
  symbol: string;
  decimals: number;
  per_tx_limit: string;
  daily_limit: string;
  spent_today: string;
  window_start: number;
}

export interface TokenInfo {
  tokenId: string;
  policy: TokenPolicy;
  /** Vault balance on the token contract (ft_balance_of). */
  balance: string;
}

export interface PendingRequest {
  id: number;
  agent: string;
  receiver_id: string;
  amount: string;
  token: string | null;
  memo: string | null;
  reason: string;
  created_at_ms: number;
}

export interface Subscription {
  id: number;
  label: string;
  receiver_id: string;
  amount: string;
  token: string | null;
  interval_secs: number;
  next_due_ms: number;
  charges: number;
}

export interface Activity {
  seq: number;
  kind: 'executed' | 'rejected' | 'pending' | 'approved' | 'denied' | 'subscription' | 'suspended' | 'reinstated' | 'failed';
  actor: string;
  receiver_id: string | null;
  amount: string;
  token: string | null;
  reason: string | null;
  memo: string | null;
  timestamp_ms: number;
  block_height: number;
}

export interface AccessKeyView {
  public_key: string;
  permission: 'FullAccess' | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };
}

export interface VaultSnapshot {
  network: string;
  explorer: string;
  vaultId: string;
  info: VaultInfo;
  vaultKeys: AccessKeyView[];
  agents: { accountId: string; policy: AgentPolicy; keys: AccessKeyView[] }[];
  tokens: TokenInfo[];
  pending: PendingRequest[];
  subscriptions: Subscription[];
  activity: Activity[];
  fetchedAt: number;
}

export interface Proposal {
  action: 'transfer';
  receiver_id: string;
  /** Decimal amount in `token` units. Named amount_near for history; holds USDC amounts too. */
  amount_near: string;
  /** "NEAR" (default) or a token symbol registered in the vault, e.g. "USDC". */
  token?: string;
  memo?: string;
  rationale?: string;
}

export type VaultStatus = 'executed' | 'pending_approval' | 'rejected';

export interface ExecutionOutcome {
  status: VaultStatus | 'error';
  reason?: string | null;
  requestId?: number | null;
  strikes?: number | null;
  suspendedUntilMs?: number | null;
  txHash?: string;
  explorerUrl?: string;
  events: { event: string; data: Record<string, unknown> }[];
  error?: string;
  agent: string;
}
