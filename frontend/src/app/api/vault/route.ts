import { NextResponse } from 'next/server';
import { getSnapshot } from '@/lib/warden/vault';
import { getConfig } from '@/lib/warden/config';
import { errorJson } from '@/lib/warden/http';

export const dynamic = 'force-dynamic';

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
      },
    });
  } catch (e) {
    return errorJson(e, 503);
  }
}
