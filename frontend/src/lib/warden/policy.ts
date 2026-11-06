import { nearToYocto, yoctoToNear } from './units';
import type { Proposal, VaultSnapshot } from './types';

export type Prediction = 'auto' | 'needs_approval' | 'blocked';

/**
 * The agent's own, off-chain read of what the vault will do. It is advisory
 * only: a compromised server can skip it, which is exactly why the same rules
 * are enforced again inside the contract.
 */
export function predict(
  proposal: Proposal,
  snap: VaultSnapshot,
  agentId: string
): { prediction: Prediction; reasons: string[] } {
  const agent = snap.agents.find((a) => a.accountId === agentId)?.policy;
  const amount = BigInt(nearToYocto(proposal.amount_near));
  if (snap.info.paused) return { prediction: 'blocked', reasons: ['The vault is paused by the owner'] };
  if (agent?.suspended) return { prediction: 'blocked', reasons: ['This agent is suspended after repeated blocked attempts'] };
  if (!snap.info.allowlist.includes(proposal.receiver_id)) {
    return { prediction: 'blocked', reasons: [`${proposal.receiver_id} is not on the vault allowlist`] };
  }
  const reasons: string[] = [];
  if (agent) {
    if (amount > BigInt(agent.per_tx_limit)) reasons.push(`Over the ${yoctoToNear(agent.per_tx_limit)} NEAR per-payment limit`);
    if (BigInt(agent.spent_today) + amount > BigInt(agent.daily_limit))
      reasons.push(`Over this agent's ${yoctoToNear(agent.daily_limit)} NEAR daily budget`);
  }
  if (BigInt(snap.info.vault_spent_today) + amount > BigInt(snap.info.vault_daily_limit))
    reasons.push(`Over the vault-wide ${yoctoToNear(snap.info.vault_daily_limit)} NEAR daily cap`);
  return reasons.length ? { prediction: 'needs_approval', reasons } : { prediction: 'auto', reasons: ['Within every limit'] };
}
