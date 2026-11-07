import { NextRequest, NextResponse } from 'next/server';
import { ASSETS, dryQuote, type AssetKey } from '@/lib/warden/intents';
import { errorJson, rateLimited } from '@/lib/warden/http';

export const dynamic = 'force-dynamic';
// Never cache NEAR RPC or partner API responses: the dashboard must show live chain state.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const limited = rateLimited(req, 20);
  if (limited) return limited;
  try {
    const { from = 'NEAR', to = 'USDC', amount = '1' } = await req.json();
    if (!(from in ASSETS) || !(to in ASSETS) || from === to) {
      return NextResponse.json({ error: 'Unsupported pair' }, { status: 400 });
    }
    const quote = await dryQuote(from as AssetKey, to as AssetKey, String(amount));
    return NextResponse.json({ quote });
  } catch (e) {
    return errorJson(e, 502);
  }
}
