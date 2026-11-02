export interface TransferProposal {
  action: 'transfer';
  receiver_id: string;
  amount_near: string;
  memo?: string;
  rationale?: string;
}

export interface ProposalValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  vaultState?: VaultInfo;
}

export interface VaultInfo {
  owner_id: string;
  per_tx_limit: string;
  daily_limit: string;
  spent_today: string;
  reset_in_seconds: number;
  paused: boolean;
  allowlist: string[];
  allowed_agents: string[];
  vault_balance: string;
}

export interface ExecutionResult {
  success: boolean;
  transactionHash?: string;
  explorerUrl?: string;
  errorMessage?: string;
  logs?: string[];
  rejectedEvent?: {
    reason: string;
    attempted_amount: string;
    limit_or_status: string;
  };
}

