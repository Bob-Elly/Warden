import { NextRequest, NextResponse } from 'next/server';
import { getAttestation } from '@/lib/warden/attestation';
import { errorJson, rateLimited } from '@/lib/warden/http';

export const dynamic = 'force-dynamic';
// Never cache NEAR RPC or partner API responses: the dashboard must show live chain state.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const limited = rateLimited(req, 10);
  if (limited) return limited;
  try {
    const model = req.nextUrl.searchParams.get('model') ?? undefined;
    return NextResponse.json(await getAttestation(model));
  } catch (e) {
    return errorJson(e, 502);
  }
}
