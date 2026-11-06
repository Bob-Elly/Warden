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
}

export interface AgentPolicy {
  label: string;
  per_tx_limit: string;
  daily_limit: string;
  spent_today: string;
  window_start: number;
  strikes: number;
  suspended: boolean;
  executed_count: number;
  blocked_count: number;
}

export interface PendingRequest {
  id: number;
  agent: string;
  receiver_id: string;
  amount: string;
  memo: string | null;
  reason: string;
  created_at_ms: number;
}

export interface Subscription {
  id: number;
  label: string;
  receiver_id: string;
  amount: string;
  interval_secs: number;
  next_due_ms: number;
  charges: number;
}

export interface Activity {
  seq: number;
  kind: 'executed' | 'rejected' | 'pending' | 'approved' | 'denied' | 'subscription' | 'suspended';
  actor: string;
  receiver_id: string | null;
  amount: string;
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
  pending: PendingRequest[];
  subscriptions: Subscription[];
  activity: Activity[];
  fetchedAt: number;
}

export interface Proposal {
  action: 'transfer';
  receiver_id: string;
  amount_near: string;
  memo?: string;
  rationale?: string;
}

export type VaultStatus = 'executed' | 'pending_approval' | 'rejected';

export interface ExecutionOutcome {
  status: VaultStatus | 'error';
  reason?: string | null;
  requestId?: number | null;
  strikes?: number | null;
  txHash?: string;
  explorerUrl?: string;
  events: { event: string; data: Record<string, unknown> }[];
  error?: string;
  agent: string;
}
