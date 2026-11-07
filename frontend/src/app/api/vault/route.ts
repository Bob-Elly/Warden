import { NextResponse } from 'next/server';
import { getSnapshot } from '@/lib/warden/vault';
import { getConfig } from '@/lib/warden/config';
import { errorJson } from '@/lib/warden/http';

export const dynamic = 'force-dynamic';
// Never cache NEAR RPC or partner API responses: the dashboard must show live chain state.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/** Everything on the dashboard, read live from NEAR RPC. No cached or demo data. */
export async function GET() {
  const cfg = getConfig();
  try {
    const snapshot = await getSnapshot();
    return NextResponse.json({
      snapshot,
      features: {
        nearAi: !!cfg.nearAi.apiKey,
        nearAiModel: cfg.nearAi.model,
        redTeamModel: cfg.nearAi.redTeamModel,
        x402PayTo: cfg.x402.payTo,
        x402Price: cfg.x402.priceYocto,
        ownerId: cfg.ownerId,
        agentRoles: cfg.agents.map((a) => ({ role: a.role, accountId: a.accountId })),
        // Server agents that this vault does not know: a sign of mismatched env vars.
        unregisteredAgents: cfg.agents
          .map((a) => a.accountId)
          .filter((id) => !snapshot.agents.some((x) => x.accountId === id)),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/method is not found|MethodNotFound/i.test(msg)) {
      return errorJson(
        new Error(`${cfg.vaultId} is not a Warden v2 vault (contract method not found). Check VAULT_CONTRACT_ID, or run npm run setup.`),
        503
      );
    }
    return errorJson(e, 503);
  }
}
