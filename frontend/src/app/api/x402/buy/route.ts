import { NextRequest, NextResponse } from 'next/server';
import { defaultAgent, executeTransfer } from '@/lib/warden/vault';
import { verdictStep, type TraceStep } from '@/lib/warden/agent';
import { yoctoToNear } from '@/lib/warden/units';
import type { PaymentRequirements } from '@/lib/warden/x402';
import { rateLimited } from '@/lib/warden/http';

export const dynamic = 'force-dynamic';
// Never cache NEAR RPC or partner API responses: the dashboard must show live chain state.
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

/**
 * The agent buys data from a paid API by itself: request it, get a 402, pay
 * through the vault, then retry with proof of payment.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimited(req, 6);
  if (limited) return limited;
  const trace: TraceStep[] = [];
  try {
    const url = `${req.nextUrl.origin}/api/paid/market-data`;
    const first = await fetch(url, { cache: 'no-store' });
    if (first.status !== 402) {
      return NextResponse.json({ error: `Expected 402 from the paid API, got ${first.status}` }, { status: 502 });
    }
    const reqs: PaymentRequirements = (await first.json()).accepts[0];
    trace.push({
      id: 'x402',
      title: `The API answered 402: pay ${yoctoToNear(reqs.maxAmountRequired, 4)} NEAR to ${reqs.payTo}`,
      detail: `Payment nonce ${reqs.nonce.slice(0, 22)}… expires in 10 minutes`,
      status: 'info',
    });

    const cred = defaultAgent();
    const outcome = await executeTransfer(
      {
        action: 'transfer',
        receiver_id: reqs.payTo,
        amount_near: yoctoToNear(reqs.maxAmountRequired, 24),
        memo: reqs.nonce,
      },
      cred
    );
    const verdict = verdictStep(outcome);
    trace.push({ ...verdict, title: `Payment through the vault: ${verdict.title.charAt(0).toLowerCase()}${verdict.title.slice(1)}` });
    if (outcome.status !== 'executed' || !outcome.txHash) {
      return NextResponse.json({ trace, outcome });
    }

    const header = Buffer.from(JSON.stringify({ txHash: outcome.txHash, payer: cred.accountId })).toString('base64');
    const second = await fetch(url, { headers: { 'X-PAYMENT': header }, cache: 'no-store' });
    const data = await second.json();
    trace.push({
      id: 'resource',
      title: second.ok ? 'The API checked the payment on NEAR and returned the data' : `The API refused: ${data.error}`,
      detail: second.ok ? `It read tx ${outcome.txHash.slice(0, 10)}… from RPC and matched payee, amount and nonce` : '',
      status: second.ok ? 'ok' : 'fail',
    });
    return NextResponse.json({ trace, outcome, data: second.ok ? data : null });
  } catch (e) {
    trace.push({ id: 'x402', title: 'Purchase failed', detail: e instanceof Error ? e.message : String(e), status: 'fail' });
    return NextResponse.json({ trace }, { status: 500 });
  }
}
