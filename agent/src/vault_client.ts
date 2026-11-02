import { connect, keyStores, KeyPair, Account, Contract } from 'near-api-js';
import { ExecutionResult, VaultInfo, TransferProposal } from './types.js';

export interface VaultConfig {
  networkId: string;
  nodeUrl: string;
  vaultContractId: string;
  agentAccountId: string;
  agentPrivateKey: string;
}

export class VaultClient {
  private config: VaultConfig;
  private account: Account | null = null;

  constructor(config: VaultConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    const keyStore = new keyStores.InMemoryKeyStore();
    if (this.config.agentPrivateKey) {
      const keyPair = KeyPair.fromString(this.config.agentPrivateKey as any);
      await keyStore.setKey(this.config.networkId, this.config.agentAccountId, keyPair);
    }

    const near = await connect({
      networkId: this.config.networkId,
      nodeUrl: this.config.nodeUrl,
      keyStore,
    } as any);

    this.account = await near.account(this.config.agentAccountId);
  }

  async getVaultInfo(): Promise<VaultInfo> {
    if (!this.account) {
      throw new Error('VaultClient not initialized');
    }

    const result = await this.account.viewFunction({
      contractId: this.config.vaultContractId,
      methodName: 'get_vault_info',
      args: {},
    });

    return result as VaultInfo;
  }

  async isAllowlisted(recipientId: string): Promise<boolean> {
    if (!this.account) {
      throw new Error('VaultClient not initialized');
    }

    const result = await this.account.viewFunction({
      contractId: this.config.vaultContractId,
      methodName: 'is_allowlisted',
      args: { account_id: recipientId },
    });

    return Boolean(result);
  }

  /**
   * Executes a proposed transfer using the agent's function-call key.
   * Scoped to the vault contract `execute_transfer` method.
   */
  async executeProposal(proposal: TransferProposal): Promise<ExecutionResult> {
    if (!this.account) {
      throw new Error('VaultClient not initialized');
    }

    // Convert NEAR to yoctoNEAR (1 NEAR = 10^24 yoctoNEAR)
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
      // 30 TGas = 30 * 10^12 gas units
      const gas = '30000000000000';
      const outcome = await this.account.functionCall({
        contractId: this.config.vaultContractId,
        methodName: 'execute_transfer',
        args: {
          receiver_id: proposal.receiver_id,
          amount: amountYocto,
          memo: proposal.memo || null,
        },
        gas: BigInt(gas) as any,
        attachedDeposit: BigInt(0) as any,
      });

      const txHash = (outcome as any).transaction?.hash || 'tx_unknown';
      const explorerUrl = `https://testnet.nearblocks.io/txns/${txHash}`;

      // Extract events from logs
      const allLogs: string[] = [];
      const receipts = (outcome as any).receipts_outcome || [];
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
      
      // Parse rejection from contract error message
      let rejectedReason = 'unknown';
      if (errorMsg.includes('Warden: Target recipient is not on the allowlist')) {
        rejectedReason = 'recipient_not_allowlisted';
      } else if (errorMsg.includes('Warden: Requested amount exceeds per-transaction limit')) {
        rejectedReason = 'per_tx_limit_exceeded';
      } else if (errorMsg.includes('Warden: Requested amount would exceed 24-hour spending limit')) {
        rejectedReason = 'daily_limit_exceeded';
      } else if (errorMsg.includes('Warden: Vault is currently paused by owner')) {
        rejectedReason = 'vault_paused';
      } else if (errorMsg.includes('Warden: Caller is not authorized as agent or owner')) {
        rejectedReason = 'unauthorized_caller';
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
}
