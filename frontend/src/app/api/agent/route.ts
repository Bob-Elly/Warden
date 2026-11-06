import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '@/lib/warden/agent';
import { errorJson, rateLimited } from '@/lib/warden/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const limited = rateLimited(req);
  if (limited) return limited;
  try {
    const body = await req.json();
    const instruction = String(body.instruction ?? '').slice(0, 1000).trim();
    if (!instruction) return NextResponse.json({ error: 'instruction is required' }, { status: 400 });
    const run = await runAgent({
      instruction,
      untrustedContent: body.untrustedContent ? String(body.untrustedContent).slice(0, 4000) : undefined,
      mode: body.mode === 'redteam' ? 'redteam' : 'normal',
      agentRole: typeof body.agentRole === 'string' ? body.agentRole : undefined,
    });
    return NextResponse.json(run);
  } catch (e) {
    return errorJson(e);
  }
}
