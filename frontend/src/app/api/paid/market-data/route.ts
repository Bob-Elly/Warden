import { NextRequest, NextResponse } from 'next/server';
import { paymentRequirements, verifyPayment } from '@/lib/warden/x402';
import { tokenPrices } from '@/lib/warden/intents';
import { errorJson } from '@/lib/warden/http';

export const dynamic = 'force-dynamic';

const DESCRIPTION = 'Live token prices from the NEAR Intents token list';

/**
 * A paid API. Without a valid X-PAYMENT header it answers 402 with payment
 * requirements. With one, it checks the vault payment on NEAR and returns
 * live token prices.
 */
export async function GET(req: NextRequest) {
  const header = req.headers.get('x-payment');
  const accepts = () => [paymentRequirements(req.nextUrl.pathname, DESCRIPTION)];
  if (!header) {
    return NextResponse.json({ error: 'Payment required', accepts: accepts() }, { status: 402 });
  }
  const check = await verifyPayment(header);
  if (!check.ok) {
    return NextResponse.json({ error: check.error, accepts: accepts() }, { status: 402 });
  }
  try {
    const prices = await tokenPrices();
    return NextResponse.json(
      { paidWith: check.txHash, payer: check.payer, source: '1click.chaindefuser.com/v0/tokens', prices },
      {
        headers: {
          'X-PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, txHash: check.txHash })).toString('base64'),
        },
      }
    );
  } catch (e) {
    return errorJson(e, 502);
  }
}
