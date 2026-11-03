import { NextRequest, NextResponse } from 'next/server';
import { executeVaultTransfer, Proposal } from '@/lib/near';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { proposal } = await req.json();
    if (!proposal || !proposal.receiver_id || !proposal.amount_near) {
      return NextResponse.json({ error: 'Valid proposal is required' }, { status: 400 });
    }

    const result = await executeVaultTransfer(proposal as Proposal);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ success: false, errorMessage: err.message }, { status: 500 });
  }
}
