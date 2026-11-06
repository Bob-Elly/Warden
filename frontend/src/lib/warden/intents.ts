/**
 * NEAR Intents 1Click API: live, mainnet, dry-run quotes only (dry: true never
 * creates a deposit address, so nothing can be sent). NEAR Intents has no
 * testnet, so Warden uses quotes to price a swap the agent proposes and to
 * check it against the vault's limits before anything is signed.
 */

const ONECLICK = 'https://1click.chaindefuser.com/v0';

export const ASSETS = {
  NEAR: { id: 'nep141:wrap.near', decimals: 24, symbol: 'wNEAR' },
  USDC: { id: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', decimals: 6, symbol: 'USDC' },
  USDT: { id: 'nep141:usdt.tether-token.near', decimals: 6, symbol: 'USDT' },
} as const;

export type AssetKey = keyof typeof ASSETS;

export interface DryQuote {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  timeEstimate: number;
  correlationId?: string;
  timestamp?: string;
  fetchedAt: number;
  from: string;
  to: string;
  slippageBps: number;
}

function toBaseUnits(amount: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error('Amount must be a positive decimal');
  const [w, f = ''] = amount.split('.');
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals))).toString();
}

export async function dryQuote(from: AssetKey, to: AssetKey, amount: string, slippageBps = 100): Promise<DryQuote> {
  const a = ASSETS[from];
  const b = ASSETS[to];
  // Any existing mainnet account works as recipient for a dry quote; nothing is sent.
  const recipient = process.env.INTENTS_DRY_RUN_ACCOUNT || 'near.near';
  const body = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: slippageBps,
    originAsset: a.id,
    depositType: 'INTENTS',
    destinationAsset: b.id,
    amount: toBaseUnits(amount, a.decimals),
    refundTo: recipient,
    refundType: 'INTENTS',
    recipient,
    recipientType: 'INTENTS',
    deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.ONECLICK_JWT) headers['X-API-Key'] = process.env.ONECLICK_JWT;
  const res = await fetch(`${ONECLICK}/quote`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.quote) throw new Error(json.message || `1Click quote failed (HTTP ${res.status})`);
  return {
    ...json.quote,
    correlationId: json.correlationId,
    timestamp: json.timestamp,
    fetchedAt: Date.now(),
    from: a.symbol,
    to: b.symbol,
    slippageBps,
  };
}

/** Live token prices from the public 1Click token list. */
export async function tokenPrices(symbols = ['wNEAR', 'USDC', 'USDT', 'BTC', 'ETH', 'SOL']) {
  const res = await fetch(`${ONECLICK}/tokens`, { cache: 'no-store' } as any);
  if (!res.ok) throw new Error(`1Click tokens failed (HTTP ${res.status})`);
  const list: any[] = await res.json();
  const seen = new Set<string>();
  return list
    .filter((t) => symbols.includes(t.symbol) && !seen.has(t.symbol) && seen.add(t.symbol))
    .map((t) => ({ symbol: t.symbol, priceUsd: t.price, updatedAt: t.priceUpdatedAt, assetId: t.assetId }));
}
