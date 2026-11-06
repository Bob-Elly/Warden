import { getConfig, type AgentCredential } from './config';
import { accessKeys, accountFor, collectLogs, lastResult, parseEvents, view } from './near';
import { nearToYocto } from './units';
import type {
  Activity,
  AgentPolicy,
  ExecutionOutcome,
  PendingRequest,
  Proposal,
  Subscription,
  VaultInfo,
  VaultSnapshot,
} from './types';

const GAS = 30_000_000_000_000n; // 30 TGas

export function requireVault(): string {
  const id = getConfig().vaultId;
  if (!id) throw new Error('VAULT_CONTRACT_ID is not set. Run `npm run setup` first.');
  return id;
}

export function defaultAgent(role?: string): AgentCredential {
  const agents = getConfig().agents;
  const found = role ? agents.find((a) => a.role === role) : agents[0];
  if (!found) throw new Error(`No agent credentials configured${role ? ` for role "${role}"` : ''}.`);
  return found;
}

/** Everything the dashboard shows, read straight from the chain. */
export async function getSnapshot(): Promise<VaultSnapshot> {
  const cfg = getConfig();
  const vaultId = requireVault();
  const [info, agents, pending, subscriptions, activity, vaultKeys] = await Promise.all([
    view<VaultInfo>(vaultId, 'get_vault_info'),
    view<[string, AgentPolicy][]>(vaultId, 'get_agents'),
    view<PendingRequest[]>(vaultId, 'get_pending'),
    view<Subscription[]>(vaultId, 'get_subscriptions'),
    view<Activity[]>(vaultId, 'get_activity', { limit: 30 }),
    accessKeys(vaultId).catch(() => []),
  ]);
  const withKeys = await Promise.all(
    agents.map(async ([accountId, policy]) => ({
      accountId,
      policy,
      keys: await accessKeys(accountId).catch(() => []),
    }))
  );
  return {
    network: cfg.networkId,
    explorer: cfg.explorer,
    vaultId,
    info,
    vaultKeys,
    agents: withKeys,
    pending,
    subscriptions,
    activity,
    fetchedAt: Date.now(),
  };
}

async function callVault(
  cred: AgentCredential,
  methodName: string,
  args: Record<string, unknown>
): Promise<ExecutionOutcome> {
  const cfg = getConfig();
  const vaultId = requireVault();
  const account = await accountFor(cred);
  try {
    const outcome: any = await account.functionCall({
      contractId: vaultId,
      methodName,
      args,
      gas: GAS,
      attachedDeposit: 0n,
    } as any);
    const txHash: string = outcome.transaction?.hash ?? outcome.transaction_outcome?.id;
    const result = lastResult<{ status: ExecutionOutcome['status']; reason?: string; request_id?: number; strikes?: number }>(
      outcome
    );
    return {
      status: result?.status ?? 'error',
      reason: result?.reason ?? null,
      requestId: result?.request_id ?? null,
      strikes: result?.strikes ?? null,
      txHash,
      explorerUrl: txHash ? `${cfg.explorer}/txns/${txHash}` : undefined,
      events: parseEvents(collectLogs(outcome)),
      agent: cred.accountId,
    };
  } catch (err: any) {
    // Protocol-level failures land here: e.g. the key is not allowed to call
    // this method, or the caller is not a registered agent.
    const txHash: string | undefined = err?.context?.transactionHash ?? err?.transaction_outcome?.id;
    return {
      status: 'error',
      error: cleanError(err),
      txHash,
      explorerUrl: txHash ? `${cfg.explorer}/txns/${txHash}` : undefined,
      events: [],
      agent: cred.accountId,
    };
  }
}

export async function executeTransfer(proposal: Proposal, cred = defaultAgent()): Promise<ExecutionOutcome> {
  return callVault(cred, 'execute_transfer', {
    receiver_id: proposal.receiver_id,
    amount: nearToYocto(proposal.amount_near),
    memo: proposal.memo ?? null,
  });
}

export async function chargeSubscription(subscriptionId: number, cred = defaultAgent()): Promise<ExecutionOutcome> {
  return callVault(cred, 'charge_subscription', { subscription_id: subscriptionId });
}

export function cleanError(err: any): string {
  const msg: string = err?.message ?? String(err);
  const panic = msg.match(/Smart contract panicked: ([^"\n]+)/);
  if (panic) return panic[1].trim();
  if (/MethodNameMismatch|method name.*not allowed|isn't allowed by the access key/i.test(msg)) {
    return 'this function-call key is not allowed to call that method (NEAR protocol rule)';
  }
  if (/signed with an access key which allows transaction to apply only one specific action|RequiresFullAccess/i.test(msg)) {
    return 'a function-call key cannot sign a NEAR transfer, only calls to its one contract (NEAR protocol rule)';
  }
  if (/ReceiverMismatch|receiver.*doesn't match/i.test(msg)) {
    return 'this function-call key only works for the vault contract (NEAR protocol rule)';
  }
  return msg.split('\n')[0].slice(0, 300);
}
