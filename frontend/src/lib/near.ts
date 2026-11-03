import { connect, keyStores, KeyPair } from 'near-api-js';

const NETWORK_ID = process.env.NEAR_NETWORK_ID || 'testnet';
const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org';
const VAULT_CONTRACT_ID = process.env.VAULT_CONTRACT_ID || '';
const AGENT_ACCOUNT_ID = process.env.AGENT_ACCOUNT_ID || '';
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || '';

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

export interface Proposal {
  action: 'transfer';
  receiver_id: string;
  amount_near: string;
  memo?: string;
  rationale?: string;
}

export async function getNearConnection() {
  const keyStore = new keyStores.InMemoryKeyStore();
  if (AGENT_PRIVATE_KEY && AGENT_ACCOUNT_ID) {
    const keyPair = KeyPair.fromString(AGENT_PRIVATE_KEY as any);
    await keyStore.setKey(NETWORK_ID, AGENT_ACCOUNT_ID, keyPair);
  }

  const near = await connect({
    networkId: NETWORK_ID,
    nodeUrl: NODE_URL,
    keyStore,
  } as any);

  return { near, keyStore };
}

export async function getVaultState(): Promise<VaultInfo> {
  const { near } = await getNearConnection();
  const account = await near.account(AGENT_ACCOUNT_ID || 'dontcare.testnet');

  const result = await account.viewFunction({
    contractId: VAULT_CONTRACT_ID,
    methodName: 'get_vault_info',
    args: {},
  });

  return result as VaultInfo;
}

export async function executeVaultTransfer(proposal: Proposal) {
  const { near } = await getNearConnection();
  const account = await near.account(AGENT_ACCOUNT_ID);

  // Convert NEAR to yoctoNEAR
  const yoctoMultiplier = 10n ** 24n;
  const parts = proposal.amount_near.split('.');
  const whole = BigInt(parts[0] || '0') * yoctoMultiplier;
  let fraction = 0n;
  if (parts[1]) {
    const fracStr = parts[1].slice(0, 24).padEnd(24, '0');
    fraction = BigInt(fracStr);
  }
  const amountYocto = (whole + fraction).toString();

  try {
    const gas = 30000000000000n; // 30 TGas
    const outcome: any = await account.functionCall({
      contractId: VAULT_CONTRACT_ID,
      methodName: 'execute_transfer',
      args: {
        receiver_id: proposal.receiver_id,
        amount: amountYocto,
        memo: proposal.memo || null,
      },
      gas: gas as any,
      attachedDeposit: 0n as any,
    });

    const txHash = outcome.transaction?.hash || 'tx_success';
    const explorerUrl = `https://testnet.nearblocks.io/txns/${txHash}`;

    const allLogs: string[] = [];
    const receipts = outcome.receipts_outcome || [];
    for (const r of receipts) {
      if (r.outcome?.logs) {
        allLogs.push(...r.outcome.logs);
      }
    }

    return {
      success: true,
      transactionHash: txHash,
      explorerUrl,
      logs: allLogs,
    };
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    let rejectedReason = 'contract_rejection';

    if (errorMsg.includes('Warden: Target recipient is not on the allowlist')) {
      rejectedReason = 'recipient_not_allowlisted';
    } else if (errorMsg.includes('Warden: Requested amount exceeds per-transaction limit')) {
      rejectedReason = 'per_tx_limit_exceeded';
    } else if (errorMsg.includes('Warden: Requested amount would exceed 24-hour spending limit')) {
      rejectedReason = 'daily_limit_exceeded';
    } else if (errorMsg.includes('Warden: Vault is currently paused by owner')) {
      rejectedReason = 'vault_paused';
    }

    return {
      success: false,
      errorMessage: errorMsg,
      rejectedEvent: {
        reason: rejectedReason,
        attempted_amount: proposal.amount_near,
        limit_or_status: errorMsg,
      },
    };
  }
}
