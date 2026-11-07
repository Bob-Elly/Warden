import { NextRequest, NextResponse } from 'next/server';
import { chargeSubscription, defaultAgent } from '@/lib/warden/vault';
import { verdictStep } from '@/lib/warden/agent';
import { errorJson, rateLimited } from '@/lib/warden/http';

export const dynamic = 'force-dynamic';
// Never cache NEAR RPC or partner API responses: the dashboard must show live chain state.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const limited = rateLimited(req);
  if (limited) return limited;
  try {
    const { id, agentRole } = await req.json();
    if (typeof id !== 'number') return NextResponse.json({ error: 'id must be a number' }, { status: 400 });
    const outcome = await chargeSubscription(id, defaultAgent(agentRole));
    return NextResponse.json({ outcome, verdict: verdictStep(outcome) });
  } catch (e) {
    return errorJson(e);
  }
}
