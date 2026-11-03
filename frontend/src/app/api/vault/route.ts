import { NextResponse } from 'next/server';
import { getVaultState } from '@/lib/near';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const vaultInfo = await getVaultState();
    return NextResponse.json({ success: true, vault: vaultInfo });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to fetch vault state',
        // Fallback demo state if offline
        fallback: {
          owner_id: process.env.OWNER_ACCOUNT_ID || 'warden-owner.testnet',
          per_tx_limit: '5000000000000000000000000',
          daily_limit: '20000000000000000000000000',
          spent_today: '0',
          reset_in_seconds: 86400,
          paused: false,
          allowlist: ['sara.testnet', 'merchant.testnet'],
          allowed_agents: [process.env.AGENT_ACCOUNT_ID || 'warden-agent.testnet'],
          vault_balance: '3000000000000000000000000',
        },
      },
      { status: 200 }
    );
  }
}
